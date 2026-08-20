import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { teams } from '../../db/schema'
import {
  LOAN_STEP,
  LOAN_TERMS,
  MAX_BORROWING_SHARE,
  MIN_LOAN,
  OVERDRAFT_RATE,
  activeLoans,
  borrowingLimitFor,
  interestPerRoundFor,
  loanRateFor,
  overdraftInterestFor,
  repaymentPerRoundFor,
  totalInterestFor,
} from '../../core/loans'
import { forecastForSave } from '../../core/finance'
import { requireSave } from '../../core/save'

/**
 * The club's debt, and what more of it would cost.
 *
 * The borrowing limit is taken from the same four-season forecast the projection
 * page draws, not from a second estimate — a lender and a manager looking at
 * different numbers for the same club is how a game teaches people to distrust
 * its own advice.
 */
export default defineEventHandler(async () => {
  const gameState = await requireSave()

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club)
    return null

  const [book, forecast] = await Promise.all([
    activeLoans(db, club.id),
    forecastForSave(gameState),
  ])

  /**
   * A full season of income, which is what a lender underwrites.
   *
   * The current season is usually a partial, so the first *whole* season in the
   * forecast is the honest figure — using the partial would shrink a club's
   * borrowing power the further into a season it got, for no reason connected
   * to the club.
   */
  const annualIncome = forecast?.projection.find(season => !season.partial)?.totalIncome
    ?? forecast?.projection[0]?.totalIncome
    ?? 0

  const outstanding = book.reduce((total, loan) => total + loan.outstanding, 0)
  const rate = loanRateFor(club.reputation, club.bankBalance)
  const limit = borrowingLimitFor(annualIncome, outstanding)

  return {
    balance: club.bankBalance,
    reputation: club.reputation,
    season: gameState.season,
    annualIncome,
    outstanding,
    /** Interest and principal leaving the account every matchday, as it stands. */
    servicePerRound: book.reduce(
      (total, loan) => total + loan.repaymentPerRound + interestPerRoundFor(loan.outstanding, loan.ratePerSeason),
      0,
    ),
    overdraftPerRound: overdraftInterestFor(club.bankBalance),
    overdraftRate: OVERDRAFT_RATE,
    rate,
    limit,
    minLoan: MIN_LOAN,
    step: LOAN_STEP,
    maxShare: MAX_BORROWING_SHARE,
    /** What each available term would cost on the smallest loan, per unit shown. */
    terms: LOAN_TERMS.map(seasons => ({
      seasons,
      repaymentPerRoundPerMillion: repaymentPerRoundFor(1_000_000, seasons),
      interestPerMillion: totalInterestFor(1_000_000, rate, seasons),
    })),
    loans: book.map(loan => ({
      id: loan.id,
      principal: loan.principal,
      outstanding: loan.outstanding,
      ratePerSeason: loan.ratePerSeason,
      takenSeason: loan.takenSeason,
      termSeasons: loan.termSeasons,
      untilSeason: loan.untilSeason,
      repaymentPerRound: loan.repaymentPerRound,
      interestPerRound: interestPerRoundFor(loan.outstanding, loan.ratePerSeason),
      /** How much of the principal is already back, 0–100. */
      repaidPercent: loan.principal > 0
        ? Math.round(((loan.principal - loan.outstanding) / loan.principal) * 100)
        : 100,
    })),
    health: {
      stage: gameState.insolvencyStage,
      insolventRounds: gameState.insolventRounds,
    },
  }
})
