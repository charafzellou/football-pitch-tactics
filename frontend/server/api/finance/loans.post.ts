import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { loans, teams } from '../../db/schema'
import {
  LOAN_STEP,
  LOAN_TERMS,
  MIN_LOAN,
  activeLoans,
  borrowingLimitFor,
  loanRateFor,
  repaymentPerRoundFor,
  totalInterestFor,
} from '../../core/loans'
import { forecastForSave, postLedger } from '../../core/finance'
import { postNews } from '../../core/news'
import { requireActiveManager } from '../../core/save'
import { getSeasonStatus } from '../../core/season'

interface Body {
  action?: 'borrow' | 'repay'
  amount?: number
  seasons?: number
  loanId?: number
}

/**
 * Borrowing and paying back early.
 *
 * Note what is *not* here: no check against a recommended transfer or wage
 * budget. Borrowing is refused only when the club is over the limit its own
 * income supports, which is a lender's decision about the club rather than a
 * verdict on the manager's plan.
 */
export default defineEventHandler(async (event) => {
  const gameState = await requireActiveManager(event)
  const body = await readBody<Body>(event)

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club)
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  const status = await getSeasonStatus(gameState)
  const round = status?.round ?? 0

  // -------------------------------------------------------------------------
  // Paying a loan off early
  // -------------------------------------------------------------------------
  if (body?.action === 'repay') {
    const loanId = Number(body.loanId)
    const loan = loanId
      ? await db.query.loans.findFirst({
          where: and(eq(loans.id, loanId), eq(loans.teamId, club.id), eq(loans.status, 'active')),
        })
      : null

    if (!loan)
      throw createError({ statusCode: 404, statusMessage: 'That loan is already settled' })

    const requested = Math.round(Number(body.amount ?? loan.outstanding))
    const amount = Math.min(loan.outstanding, Math.max(0, requested))

    if (amount <= 0)
      throw createError({ statusCode: 400, statusMessage: 'Nothing to repay' })

    if (club.bankBalance < amount)
      throw createError({ statusCode: 400, statusMessage: 'You cannot afford this' })

    const remaining = loan.outstanding - amount

    await db.transaction(async (tx) => {
      await tx.update(loans)
        .set({ outstanding: remaining, status: remaining > 0 ? 'active' : 'settled' })
        .where(eq(loans.id, loan.id))

      await postLedger(tx, [{
        teamId: club.id,
        season: gameState.season,
        round,
        type: 'loan_repayment',
        amount: -amount,
        description: remaining > 0 ? 'Early repayment' : 'Loan settled in full',
      }])
    })

    return { success: true, repaid: amount, outstanding: remaining }
  }

  // -------------------------------------------------------------------------
  // Drawing one down
  // -------------------------------------------------------------------------
  const amount = Math.round(Number(body?.amount))
  const seasons = Math.round(Number(body?.seasons))

  if (!Number.isFinite(amount) || amount < MIN_LOAN)
    throw createError({ statusCode: 400, statusMessage: `The smallest loan is ${MIN_LOAN}` })

  if (amount % LOAN_STEP !== 0)
    throw createError({ statusCode: 400, statusMessage: `Loans are written in steps of ${LOAN_STEP}` })

  if (!(LOAN_TERMS as readonly number[]).includes(seasons))
    throw createError({ statusCode: 400, statusMessage: 'That term is not on offer' })

  const [book, forecast] = await Promise.all([
    activeLoans(db, club.id),
    forecastForSave(gameState),
  ])

  const outstanding = book.reduce((total, loan) => total + loan.outstanding, 0)
  const annualIncome = forecast?.projection.find(season => !season.partial)?.totalIncome
    ?? forecast?.projection[0]?.totalIncome
    ?? 0

  const limit = borrowingLimitFor(annualIncome, outstanding)
  if (amount > limit)
    throw createError({ statusCode: 400, statusMessage: 'No lender will go that far on this income' })

  const rate = loanRateFor(club.reputation, club.bankBalance)
  const repaymentPerRound = repaymentPerRoundFor(amount, seasons)

  await db.transaction(async (tx) => {
    await tx.insert(loans).values({
      teamId: club.id,
      principal: amount,
      outstanding: amount,
      ratePerSeason: rate,
      takenSeason: gameState.season,
      termSeasons: seasons,
      // A loan taken mid-season still runs its full term of seasons.
      untilSeason: gameState.season + seasons - 1,
      repaymentPerRound,
      createdAt: new Date(),
    })

    await postLedger(tx, [{
      teamId: club.id,
      season: gameState.season,
      round,
      type: 'loan_in',
      amount,
      description: `${seasons}-season facility at ${rate}%`,
    }])

    await postNews(tx, gameState.id, [{
      season: gameState.season,
      round,
      category: 'finance',
      tone: 'neutral',
      headline: `${amount.toLocaleString('en-IE')} borrowed over ${seasons} `
        + `${seasons === 1 ? 'season' : 'seasons'}`,
      body: `${repaymentPerRound.toLocaleString('en-IE')} of principal plus interest leaves the account `
        + 'every matchday until it is repaid, whatever the season brings.',
    }])
  })

  return {
    success: true,
    amount,
    seasons,
    rate,
    repaymentPerRound,
    totalInterest: totalInterestFor(amount, rate, seasons),
  }
})
