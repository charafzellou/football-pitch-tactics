/**
 * Borrowing, and what it costs.
 *
 * The pure half is a set of formulas like `economy.ts` — rate, limit, schedule
 * — so the page that offers a loan, the projection that carries it and the
 * matchday that services it all price the same debt identically. The DB half is
 * one function: `settleDebtForRound`, which is the only place an outstanding
 * balance ever falls.
 *
 * ## Why debt is priced off the club, not off a rate card
 *
 * A flat interest rate would make borrowing a strictly good idea for a big club
 * and a strictly bad one for a small club, with nothing in between. Pricing it
 * off reputation *and* off whether the account is already overdrawn produces the
 * behaviour that actually matters: money is cheapest to the clubs that least
 * need it, and a club borrowing its way out of trouble pays four points more for
 * the privilege — which is how a cash-flow problem becomes a solvency problem if
 * it is not fixed.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { loans } from '../db/schema'
import { roundsFor } from './calendar'
import type { LedgerEntry } from './finance'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Client = Tx | typeof db

/** Money moves once per matchday, so that is the denominator for every rate. */
const MATCHDAYS_PER_SEASON = roundsFor(20)

/** Nothing smaller is worth the paperwork, and the slider steps in these. */
export const MIN_LOAN = 500_000
export const LOAN_STEP = 500_000

/** Terms a lender will write, in seasons. */
export const LOAN_TERMS = [1, 2, 3, 4, 5] as const

/**
 * The most a club may owe, as a share of what it earns in a season.
 *
 * A lender is underwriting the income, not the ambition. At 60% a club can
 * borrow roughly seven months of turnover — enough to fund a stand or a striker,
 * never enough to buy its way out of its own division.
 */
export const MAX_BORROWING_SHARE = 0.60

/** Annual rate charged on an unauthorised overdraft. */
export const OVERDRAFT_RATE = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * What a lender charges this club, as an annual percentage.
 *
 * Base plus a standing premium plus a distress premium. A club at reputation 100
 * with money in the bank borrows at 4%; a club at reputation 30 already
 * overdrawn borrows at 12.2%.
 */
export function loanRateFor(reputation: number, balance: number): number {
  const base = 4 + (1 - clamp(reputation, 0, 100) / 100) * 6
  return Math.round((base + (balance < 0 ? 4 : 0)) * 10) / 10
}

/** Headroom left to borrow, given what the club already owes. */
export function borrowingLimitFor(projectedAnnualIncome: number, outstandingDebt: number): number {
  const ceiling = Math.max(0, projectedAnnualIncome) * MAX_BORROWING_SHARE
  return Math.max(0, Math.floor((ceiling - outstandingDebt) / LOAN_STEP) * LOAN_STEP)
}

/**
 * Principal repaid each matchday.
 *
 * Straight-line: the term is a promise about when the debt ends, and a schedule
 * that back-loads it would let a manager take a five-season loan and feel none
 * of it until the season they had already planned around.
 */
export function repaymentPerRoundFor(principal: number, termSeasons: number): number {
  const rounds = Math.max(1, Math.round(termSeasons)) * MATCHDAYS_PER_SEASON
  return Math.ceil(principal / rounds)
}

/** Interest for one matchday on an outstanding balance. */
export function interestPerRoundFor(outstanding: number, ratePerSeason: number): number {
  if (outstanding <= 0) return 0
  return Math.round((outstanding * ratePerSeason / 100) / MATCHDAYS_PER_SEASON)
}

/**
 * What being overdrawn costs per matchday.
 *
 * Charged on the balance, not on a stage — the interest is a fact of the account
 * being negative, and it starts the moment it is, which is what makes stage 1 a
 * warning with a price on it rather than a label.
 */
export function overdraftInterestFor(balance: number): number {
  if (balance >= 0) return 0
  return Math.round((Math.abs(balance) * OVERDRAFT_RATE / 100) / MATCHDAYS_PER_SEASON)
}

/**
 * Total interest over a loan's life, for the preview on the borrowing page.
 *
 * Approximated against a straight-line balance — the average outstanding across
 * the term is half the principal — because the exact figure depends on rounding
 * every matchday and the manager is deciding whether to borrow, not auditing a
 * bank.
 */
export function totalInterestFor(principal: number, ratePerSeason: number, termSeasons: number): number {
  return Math.round(principal / 2 * (ratePerSeason / 100) * Math.max(1, termSeasons))
}

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

export async function activeLoans(client: Client, teamId: number) {
  return client.query.loans.findMany({
    where: and(eq(loans.teamId, teamId), eq(loans.status, 'active')),
  })
}

export async function totalOutstanding(client: Client, teamId: number): Promise<number> {
  return (await activeLoans(client, teamId)).reduce((total, loan) => total + loan.outstanding, 0)
}

/**
 * One matchday of debt service: interest on everything outstanding, principal
 * off every active loan, and interest on the overdraft if there is one.
 *
 * Returns entries rather than posting them so a matchday's whole ledger goes
 * through `postLedger()` in a single write, and so debt service cannot move a
 * balance without appearing in the account it moved.
 */
export async function settleDebtForRound(tx: Tx, input: {
  teamId: number
  season: number
  round: number
  /** Balance at the start of the matchday, which is what the overdraft is on. */
  balance: number
}): Promise<LedgerEntry[]> {
  const { teamId, season, round, balance } = input
  const base = { teamId, season, round }
  const entries: LedgerEntry[] = []

  const book = await activeLoans(tx, teamId)

  let repayment = 0
  let interest = 0

  for (const loan of book) {
    const due = Math.min(loan.outstanding, loan.repaymentPerRound)
    const charge = interestPerRoundFor(loan.outstanding, loan.ratePerSeason)
    const remaining = Math.max(0, loan.outstanding - due)

    repayment += due
    interest += charge

    await tx.update(loans)
      .set({ outstanding: remaining, status: remaining > 0 ? 'active' : 'settled' })
      .where(eq(loans.id, loan.id))
  }

  if (repayment > 0) {
    entries.push({
      ...base,
      type: 'loan_repayment',
      amount: -repayment,
      description: book.length === 1 ? 'Loan repayment' : `Loan repayments — ${book.length} facilities`,
    })
  }

  if (interest > 0)
    entries.push({ ...base, type: 'interest', amount: -interest, description: 'Interest on borrowings' })

  const overdraft = overdraftInterestFor(balance)
  if (overdraft > 0) {
    entries.push({
      ...base,
      type: 'interest',
      amount: -overdraft,
      description: `Overdraft interest at ${OVERDRAFT_RATE}%`,
    })
  }

  return entries
}
