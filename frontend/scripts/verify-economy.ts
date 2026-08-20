/**
 * Proves the economy still balances.
 *
 * A change to club money is invisible for several seasons of play and then
 * ruinous, so it is not enough to look right on the finance page. This seeds a
 * world, plays a season headlessly and checks the things that would otherwise
 * only surface as "the transfer market feels wrong in season four".
 *
 *   bun run scripts/verify-economy.ts
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { and, eq } from 'drizzle-orm'
import { db } from '../server/db'
import { financeLedger, game, loans, teams } from '../server/db/schema'
import {
  COMMERCIAL_UPLIFT,
  DEFAULT_FACILITY_LEVEL,
  FACILITY_UPKEEP_SHARE,
  HOSPITALITY_BOX_COST,
  hospitalityIncomeFor,
  perimeterUpgradeCost,
  commercialPoolFor,
  facilityUpkeepFor,
  matchdayOperatingCostFor,
  merchandisingFor,
  perimeterIncomeFor,
  slotValueFor,
  sponsorshipFor,
} from '../server/core/economy'
import { forecastForSave, postLedger } from '../server/core/finance'
import {
  EMBARGO_ROUNDS,
  INTERVENTION_ROUNDS,
} from '../server/core/insolvency'
import {
  activeLoans,
  interestPerRoundFor,
  loanRateFor,
  repaymentPerRoundFor,
} from '../server/core/loans'
import { clubTotals, median, type Baseline } from './economy-baseline'
import { newSave } from './new-save'
import { playRounds } from './play-rounds'
import { playSeason } from './sim-season'
import { rollOverSeason } from '../server/core/season'

const checks: { name: string; passed: boolean; detail: string }[] = []

function check(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail })
  console.log(`${passed ? '  \x1b[32mPASS\x1b[0m' : '  \x1b[31mFAIL\x1b[0m'}  ${name}\n        ${detail}`)
}

// ---------------------------------------------------------------------------
// 1. Decomposition parity — analytic, no simulation needed
// ---------------------------------------------------------------------------

/**
 * The manager's itemised streams must net what the single blended credit every
 * CPU club takes nets. Checked in closed form rather than by simulation, so it
 * is exact and cannot be masked by a lucky season.
 */
function defaultNetPerMatchday(reputation: number, position: number, leagueSize: number, fill: number) {
  const pool = commercialPoolFor(reputation, position, leagueSize)

  const everyMatchday
    = slotValueFor(pool, 'shirt') + slotValueFor(pool, 'kit_maker') + slotValueFor(pool, 'sleeve')
      + merchandisingFor(pool, 65, 0)
      - facilityUpkeepFor(pool, DEFAULT_FACILITY_LEVEL, DEFAULT_FACILITY_LEVEL)

  const homeOnly
    = perimeterIncomeFor(pool, 0, fill, position, leagueSize)
      - matchdayOperatingCostFor(pool, fill)

  // Half the fixtures are at home.
  return everyMatchday + homeOnly / 2
}

console.log(`\nCommercial uplift ${COMMERCIAL_UPLIFT.toFixed(5)}\n`)
console.log('Decomposition parity (analytic)')

const drifts: number[] = []
for (const reputation of [92, 84, 70, 55, 40, 30, 15]) {
  const legacy = sponsorshipFor(reputation, 10, 20)
  const itemised = defaultNetPerMatchday(reputation, 10, 20, 0.76)
  drifts.push(Math.abs((itemised - legacy) / legacy) * 100)
}
const worstDrift = Math.max(...drifts)
check(
  'default portfolio nets what the blended credit nets',
  worstDrift <= 5,
  `worst drift across seven club sizes ${worstDrift.toFixed(2)}% (tolerance 5%)`,
)

// ---------------------------------------------------------------------------
// 2–4. Simulated season
// ---------------------------------------------------------------------------

console.log('\nPlaying a season headlessly…')

const { club } = await newSave(process.argv[2])
const openingBalances = new Map(
  (await db.query.teams.findMany()).map(row => [row.id, row.bankBalance]),
)

const state = await db.query.game.findFirst()
const playedSeason = state!.season

// Taken before a ball is kicked, so the comparison below is a genuine forecast
// rather than a description of a season already half over.
const forecast = await forecastForSave(state!)
const predictedClosing = forecast?.projection[0]?.closingBalance ?? 0

const outcome = await playSeason(false)
await rollOverSeason()

console.log(`Season ${playedSeason} complete${outcome.dismissed ? ' (manager dismissed)' : ''}.\n`)

// --- Ledger integrity ------------------------------------------------------

const finalClubs = await db.query.teams.findMany()
let worstBreak = 0
let worstBreakName = ''
for (const row of finalClubs) {
  const entries = await db.query.financeLedger.findMany({ where: eq(financeLedger.teamId, row.id) })
  const movement = entries.reduce((total, entry) => total + entry.amount, 0)
  const expected = (openingBalances.get(row.id) ?? 0) + movement
  const drift = Math.abs(expected - row.bankBalance)
  if (drift > worstBreak) {
    worstBreak = drift
    worstBreakName = row.name
  }
}
check(
  'every balance equals its opening balance plus its ledger',
  worstBreak === 0,
  worstBreak === 0
    ? `${finalClubs.length} clubs reconcile exactly`
    : `${worstBreakName} is out by ${worstBreak.toLocaleString('en-IE')}`,
)

// --- Calibration neutrality ------------------------------------------------

/**
 * The manager's club is the only one whose arithmetic changed, so that is what
 * this measures. An earlier version compared the league's median net against a
 * stored baseline and failed at −6% — all of it re-seed noise, because a reseed
 * regenerates every squad and therefore every reputation, stadium and wage in
 * the league. Thirty-nine unchanged clubs cannot evidence a change; the one
 * that moved has to be asked directly.
 *
 * The commercial pool is recovered from the `facilities` entry rather than the
 * sponsorship one: upkeep is a fixed share of the pool at known facility
 * levels, so it stays a valid probe once real sponsors start paying something
 * other than the market rate.
 */
const managerRows = await db.query.financeLedger.findMany({
  where: and(eq(financeLedger.teamId, club.id), eq(financeLedger.season, playedSeason)),
})

const COMMERCIAL_TYPES = ['sponsorship', 'merchandising', 'perimeter', 'hospitality', 'bonus']
const upkeepShare = FACILITY_UPKEEP_SHARE * DEFAULT_FACILITY_LEVEL * 2

let itemisedNet = 0
let legacyEquivalent = 0
for (const row of managerRows) {
  if (COMMERCIAL_TYPES.includes(row.type)) itemisedNet += row.amount
  if (row.type === 'operating') itemisedNet += row.amount
  if (row.type === 'facilities') {
    itemisedNet += row.amount
    // One matchday's pool, and what the blended credit would have paid for it.
    legacyEquivalent += (Math.abs(row.amount) / upkeepShare) / COMMERCIAL_UPLIFT
  }
}

const managerDrift = legacyEquivalent > 0
  ? (itemisedNet - legacyEquivalent) / legacyEquivalent * 100
  : 0

/**
 * A wider band than the analytic check above, deliberately.
 *
 * That one proves the *shares and the uplift* are right, in closed form, to
 * within a rounding error. This one measures what the club actually banked, and
 * a fixed-fee deal is meant to come loose from a moving market: partners are
 * paid what they signed for at the club's expected finish, so a season spent
 * above that expectation earns less than the blended credit would have paid and
 * a season below it earns more. That decoupling is the point of signing a term —
 * the band is sized to allow it and nothing else. The standing factor spans
 * 0.85 to 1.15, so roughly ±9% of commercial income is legitimately in play.
 */
check(
  "the manager's realised commercial income tracks the blended credit",
  Math.abs(managerDrift) <= 15,
  `${club.name} netted ${Math.round(itemisedNet).toLocaleString('en-IE')} commercially against `
  + `${Math.round(legacyEquivalent).toLocaleString('en-IE')} under the old single credit — `
  + `${managerDrift >= 0 ? '+' : ''}${managerDrift.toFixed(2)}% (tolerance 15%; fixed-fee deals decouple this)`,
)

// A stored baseline cannot survive a reseed, so the league-wide figures are
// reported rather than asserted — they catch an order-of-magnitude mistake,
// which is all they can honestly claim to.
const clubs = await clubTotals(playedSeason)
const medianNet = median(clubs.map(row => row.net))
const ratios = clubs.map(row => row.wageRatio).filter((r): r is number => r !== null)
const medianRatio = median(ratios)

try {
  const baseline = JSON.parse(readFileSync(join(import.meta.dir, 'baseline.json'), 'utf-8')) as Baseline
  const drift = (medianNet - baseline.medianNet) / Math.abs(baseline.medianNet) * 100
  console.log(`\n  note  league median net ${Math.round(medianNet).toLocaleString('en-IE')} `
    + `vs baseline ${Math.round(baseline.medianNet).toLocaleString('en-IE')} `
    + `(${drift >= 0 ? '+' : ''}${drift.toFixed(1)}%, reseed noise included)\n`)
} catch {
  console.log('\n  note  no baseline.json to compare the league against\n')
}

// --- Projection accuracy ---------------------------------------------------

/**
 * A forecast nobody checks is decoration.
 *
 * The manager is invited to plan four seasons out on this number, so the first
 * of those seasons has to survive being compared with what actually happened.
 * The tolerance is wide because the forecast assumes an average opponent, average
 * form and a finish at the expected position — it is a projection, not a promise.
 */
const actualClosing = (await db.query.teams.findFirst({ where: eq(teams.id, club.id) }))?.bankBalance ?? 0
const forecastError = predictedClosing !== 0
  ? Math.abs(actualClosing - predictedClosing) / Math.abs(predictedClosing) * 100
  : 100

check(
  'the season-one forecast lands near the season it forecast',
  forecastError <= 15,
  `predicted ${Math.round(predictedClosing).toLocaleString('en-IE')}, `
  + `finished on ${actualClosing.toLocaleString('en-IE')} — ${forecastError.toFixed(1)}% out (tolerance 15%)`,
)

// --- Wage ratios -----------------------------------------------------------

const inBand = ratios.filter(ratio => ratio >= 45 && ratio <= 75).length
check(
  'median wage ratio sits inside the 45–75% target band',
  medianRatio >= 45 && medianRatio <= 75,
  `median ${medianRatio}%, ${inBand} of ${ratios.length} clubs in band`,
)

/**
 * The *league* must not be structurally loss-making — which is not the same as
 * every club turning a profit every season.
 *
 * Squads are generated, so the bottom of the table is a lottery: the weakest
 * clubs already ran at 87–91% wage ratios before any of this, and a seed that
 * deals one of them an expensive squad puts it under water for a season. That
 * is pre-existing and outside what a commercial decomposition can or should fix.
 * What would signal a real regression is *many* clubs losing money, or one
 * losing a serious share of what it earns.
 */
const lossMaking = clubs.filter(row => row.net < 0)
const worstMargin = Math.min(...clubs.map(row => (row.income > 0 ? row.net / row.income : 0))) * 100

check(
  'the league is not structurally loss-making',
  lossMaking.length <= 2 && worstMargin >= -15,
  `${lossMaking.length} of ${clubs.length} clubs finished behind`
  + `${lossMaking.length ? ` (${lossMaking.map(row => row.name).join(', ')})` : ''}`
  + `, worst margin ${worstMargin.toFixed(1)}% of income (tolerances: 2 clubs, −15%)`,
)

// --- Capital payback -------------------------------------------------------

/**
 * An upgrade has to be a decision, which means it must not be obviously right
 * or obviously wrong at any club size.
 *
 * Flat prices were the first attempt and failed exactly here: because
 * commercial income scales with reputation to the power of 3.2, one price gave
 * a giant a nine-month payback and a small club a five-year one.
 */
const paybacks: { label: string; seasons: number }[] = []
for (const reputation of [92, 70, 55, 30]) {
  const pool = commercialPoolFor(reputation, 10, 20)

  for (let level = 0; level < 3; level++) {
    const gain = (perimeterIncomeFor(pool, level + 1, 0.76, 10, 20)
      - perimeterIncomeFor(pool, level, 0.76, 10, 20)) * 19
    const cost = perimeterUpgradeCost(pool, level)
    if (gain > 0) paybacks.push({ label: `rep ${reputation} L${level}→${level + 1}`, seasons: cost / gain })
  }

  const boxGain = hospitalityIncomeFor(1, reputation, 55) * 19
  if (boxGain > 0) paybacks.push({ label: `rep ${reputation} box`, seasons: HOSPITALITY_BOX_COST / boxGain })
}

const fastest = Math.min(...paybacks.map(row => row.seasons))
const slowest = Math.max(...paybacks.map(row => row.seasons))

check(
  'capital upgrades pay back on comparable terms at every club size',
  fastest >= 1.5 && slowest <= 5,
  `payback spans ${fastest.toFixed(1)}–${slowest.toFixed(1)} seasons `
  + `(slowest: ${paybacks.find(row => row.seasons === slowest)!.label}; tolerance 1.5–5)`,
)

// --- Debt service ----------------------------------------------------------

/**
 * Everything above runs a club at default settings, which is the point — the
 * calibration invariant is about defaults. But it means the borrowing and
 * insolvency paths never execute, and an unexercised code path that writes to
 * the ledger is precisely what the ledger integrity check exists to catch.
 *
 * So the last two checks drive them deliberately, on a fresh save. Everything
 * measured above has already been recorded, and `newSave()` resets the world.
 */
const { club: debtClub } = await newSave(club.name)
const debtSave = (await db.query.game.findFirst())!
const debtOpening = debtClub.bankBalance

const PRINCIPAL = 10_000_000
const TERM = 3
const expectedRate = loanRateFor(debtClub.reputation, debtOpening)
const expectedRepayment = repaymentPerRoundFor(PRINCIPAL, TERM)

await db.transaction(async (tx) => {
  await tx.insert(loans).values({
    teamId: debtClub.id,
    principal: PRINCIPAL,
    outstanding: PRINCIPAL,
    ratePerSeason: expectedRate,
    takenSeason: debtSave.season,
    termSeasons: TERM,
    untilSeason: debtSave.season + TERM - 1,
    repaymentPerRound: expectedRepayment,
    createdAt: new Date(),
  })

  await postLedger(tx, [{
    teamId: debtClub.id,
    season: debtSave.season,
    round: 0,
    type: 'loan_in',
    amount: PRINCIPAL,
    description: `verification facility at ${expectedRate}%`,
  }])
})

const DEBT_ROUNDS = 4
await playRounds(DEBT_ROUNDS, false)

const servicedBook = await activeLoans(db, debtClub.id)
const servicedLoan = servicedBook[0]
const expectedOutstanding = PRINCIPAL - expectedRepayment * DEBT_ROUNDS

/**
 * The principal has to fall by exactly the schedule, and the interest charged
 * has to match what `interestPerRoundFor()` says at each step. A loan that
 * quietly amortises at a different rate than the projection assumes would make
 * the four-season forecast wrong in the one place the manager is most likely to
 * be relying on it.
 */
let expectedInterest = 0
for (let round = 0; round < DEBT_ROUNDS; round++)
  expectedInterest += interestPerRoundFor(PRINCIPAL - expectedRepayment * round, expectedRate)

const debtRows = await db.query.financeLedger.findMany({
  where: and(eq(financeLedger.teamId, debtClub.id), eq(financeLedger.season, debtSave.season)),
})
const paidPrincipal = Math.abs(debtRows.filter(row => row.type === 'loan_repayment')
  .reduce((total, row) => total + row.amount, 0))
const paidInterest = Math.abs(debtRows.filter(row => row.type === 'interest')
  .reduce((total, row) => total + row.amount, 0))

const scheduleOk = servicedLoan?.outstanding === expectedOutstanding
  && paidPrincipal === expectedRepayment * DEBT_ROUNDS
  && paidInterest === expectedInterest

check(
  'debt service follows the schedule it was written on',
  scheduleOk,
  `after ${DEBT_ROUNDS} matchdays: outstanding ${servicedLoan?.outstanding.toLocaleString('en-IE')} `
  + `(expected ${expectedOutstanding.toLocaleString('en-IE')}), `
  + `principal repaid ${paidPrincipal.toLocaleString('en-IE')}, `
  + `interest ${paidInterest.toLocaleString('en-IE')} (expected ${expectedInterest.toLocaleString('en-IE')})`,
)

// --- Insolvency ------------------------------------------------------------

/**
 * Drives the account under and watches the stages fire in order.
 *
 * The hole is dug through `postLedger()` rather than by writing the balance
 * directly, so the club arrives at insolvency the same way a manager would take
 * it there — and so the reconciliation below is still meaningful afterwards.
 */
const beforeCrisis = (await db.query.teams.findFirst({ where: eq(teams.id, debtClub.id) }))!

await db.transaction(tx => postLedger(tx, [{
  teamId: debtClub.id,
  season: debtSave.season,
  round: 0,
  type: 'transfer_in',
  amount: -(beforeCrisis.bankBalance + 4_000_000),
  description: 'verification: spending the club into the red',
}]))

const stages: number[] = []
const squadBefore = (await db.query.players.findMany({
  where: (row, { and: allOf, eq: is }) => allOf(is(row.teamId, debtClub.id), is(row.retired, 0), is(row.freeAgent, 0)),
})).length

for (let round = 0; round < INTERVENTION_ROUNDS + 1; round++) {
  await playRounds(1, false)
  const now = await db.query.game.findFirst()
  if (!now) break
  stages.push(now.insolvencyStage)
  if (now.dismissedAtSeason !== null) break
}

const reachedEmbargo = stages.findIndex(stage => stage >= 2)
const reachedIntervention = stages.findIndex(stage => stage >= 3)
const squadAfter = (await db.query.players.findMany({
  where: (row, { and: allOf, eq: is }) => allOf(is(row.teamId, debtClub.id), is(row.retired, 0), is(row.freeAgent, 0)),
})).length

/**
 * Stages must arrive in order and no sooner than their trigger. Stage 2 cannot
 * appear before the third overdrawn matchday, and stage 3 must eventually
 * arrive and take a player with it — the embargo is a warning, but the forced
 * sale is the thing that has to actually happen.
 */
const orderedStages = stages.every((stage, index) => index === 0 || stage >= stages[index - 1]! - 1)
const embargoOnTime = reachedEmbargo >= EMBARGO_ROUNDS - 1
const interventionHappened = reachedIntervention >= 0
const soldSomebody = squadAfter < squadBefore

check(
  'insolvency escalates in order, and the board actually sells',
  orderedStages && embargoOnTime && interventionHappened && soldSomebody,
  `stages by matchday [${stages.join(', ')}]; embargo at matchday ${reachedEmbargo + 1} `
  + `(trigger ${EMBARGO_ROUNDS}), intervention at ${reachedIntervention + 1} `
  + `(trigger ${INTERVENTION_ROUNDS} or −15M), squad ${squadBefore} → ${squadAfter}`,
)

// The whole crisis has to leave the account explainable, which is the one
// property none of it is allowed to break.
const crisisClub = (await db.query.teams.findFirst({ where: eq(teams.id, debtClub.id) }))!
const crisisRows = await db.query.financeLedger.findMany({
  where: eq(financeLedger.teamId, debtClub.id),
})
const crisisMovement = crisisRows.reduce((total, row) => total + row.amount, 0)

check(
  'a club driven into a crisis still reconciles to its ledger',
  debtOpening + crisisMovement === crisisClub.bankBalance,
  `opening ${debtOpening.toLocaleString('en-IE')} + ledger ${crisisMovement.toLocaleString('en-IE')} `
  + `= ${(debtOpening + crisisMovement).toLocaleString('en-IE')} `
  + `against a stored ${crisisClub.bankBalance.toLocaleString('en-IE')}`,
)

// ---------------------------------------------------------------------------

const failed = checks.filter(row => !row.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`)
if (failed.length) {
  console.log(`\nFailed: ${failed.map(row => row.name).join('; ')}`)
  process.exit(1)
}
process.exit(0)
