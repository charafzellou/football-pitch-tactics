/**
 * Player lifecycle: ageing, development, decline, retirement and youth intake.
 *
 * Applied once per season rollover, never during a season. Everything here is
 * a pure function of a player's current numbers so it can be unit-checked
 * without a database.
 *
 * The attribute model stays deliberately simple: one `skillLevel` plus a
 * `potential` ceiling. Development moves skill toward potential while the
 * player is young, plateaus through their peak, and reverses from 30 onward.
 */

export const SQUAD_TARGET_SIZE = 22
export const MIN_SKILL = 40
export const MAX_SKILL = 99
export const RETIREMENT_FLOOR_AGE = 34
export const FORCED_RETIREMENT_AGE = 40

/** A balanced squad. Used to decide which positions youth intake should fill. */
export const SQUAD_SHAPE: Record<PositionCode, number> = {
  GK: 3,
  DEF: 7,
  MID: 7,
  ATT: 5,
}

export type PositionCode = 'GK' | 'DEF' | 'MID' | 'ATT'

const POSITION_CODES: PositionCode[] = ['GK', 'DEF', 'MID', 'ATT']

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ---------------------------------------------------------------------------
// Potential
// ---------------------------------------------------------------------------

/**
 * Headroom a player is seeded with. A teenager can still gain a lot; a player
 * already at peak age has essentially none, so their skill is their ceiling.
 */
export function initialPotential(skillLevel: number, age: number): number {
  const headroom
    = age <= 18 ? randomBetween(8, 28)
      : age <= 21 ? randomBetween(5, 22)
        : age <= 24 ? randomBetween(2, 14)
          : age <= 27 ? randomBetween(0, 7)
            : randomBetween(0, 3)

  return Math.round(clamp(skillLevel + headroom, skillLevel, MAX_SKILL))
}

// ---------------------------------------------------------------------------
// Development
// ---------------------------------------------------------------------------

/**
 * One season of development, returning the player's new skill level.
 *
 * `age` is the age the player is *becoming*. Growth is a fraction of remaining
 * headroom, so a player near their ceiling improves slowly and one already at
 * it simply plateaus. Decline is absolute and steepens with age.
 */
export function developSkill(skillLevel: number, potential: number, age: number): number {
  const ceiling = Math.max(skillLevel, potential)
  const headroom = Math.max(0, ceiling - skillLevel)

  let next = skillLevel

  if (age <= 21)
    next = skillLevel + headroom * randomBetween(0.18, 0.38)
  else if (age <= 24)
    next = skillLevel + headroom * randomBetween(0.10, 0.24)
  else if (age <= 27)
    next = skillLevel + headroom * randomBetween(0.03, 0.12)
  else if (age <= 29)
    next = skillLevel + headroom * randomBetween(0, 0.05)
  else if (age <= 32)
    next = skillLevel - randomBetween(0.5, 2)
  else if (age <= 35)
    next = skillLevel - randomBetween(1.5, 3.5)
  else
    next = skillLevel - randomBetween(2.5, 5.5)

  return Math.round(clamp(next, MIN_SKILL, ceiling))
}

// The trend label the UI shows lives in `#shared/progression` so the client can
// import it without pulling this server-only module into its bundle.
export { developmentTrend } from '#shared/progression'
export type { DevelopmentTrend } from '#shared/progression'

// ---------------------------------------------------------------------------
// Retirement
// ---------------------------------------------------------------------------

/**
 * Retirement chance for a player who has just turned `age`.
 *
 * Nobody retires before 34 and everybody retires at 40. In between, the
 * decisive factor is how far their level has fallen — which is what keeps a
 * still-excellent veteran playing while a faded one steps away.
 */
export function retirementChance(age: number, skillLevel: number): number {
  if (age >= FORCED_RETIREMENT_AGE) return 1
  if (age < RETIREMENT_FLOOR_AGE) return 0

  const base
    = age <= 36 ? 0.08
      : age <= 38 ? 0.30
        : 0.60

  // A skill of 70+ adds nothing; below that the chance climbs steadily.
  const declinePenalty = Math.max(0, 70 - skillLevel) * 0.015

  return clamp(base + declinePenalty, 0, 1)
}

export function shouldRetire(age: number, skillLevel: number): boolean {
  return Math.random() < retirementChance(age, skillLevel)
}

// ---------------------------------------------------------------------------
// Market value
// ---------------------------------------------------------------------------

/**
 * Transfer value from skill and age.
 *
 * Exponential in skill, so the gap between a good player and a great one is
 * meaningful rather than linear. Deliberately calibrated to the *existing*
 * economy — a 95 tops out around €25M against club balances of €1–50M —
 * because there is no wage or income system yet (that is a later tranche), and
 * realistic valuations would simply make everyone unaffordable.
 *
 * Under 23, potential is partly priced in: a promising teenager costs more
 * than their current level alone would suggest.
 */
export function marketValueFor(skillLevel: number, age: number, potential?: number): number {
  const priced = age < 23 && potential && potential > skillLevel
    ? skillLevel + (potential - skillLevel) * 0.5
    : skillLevel

  const base = 4036 * Math.exp(0.0919 * priced)
  const jitter = randomBetween(0.88, 1.12)

  return Math.max(50_000, Math.round(base * ageMultiplier(age) * jitter))
}

/** Value peaks through the mid-twenties and falls away sharply after 30. */
function ageMultiplier(age: number): number {
  if (age <= 18) return 0.8
  if (age <= 21) return 0.95
  if (age <= 27) return 1
  if (age <= 30) return 0.85
  if (age <= 33) return 0.6
  if (age <= 36) return 0.35
  return 0.15
}

// ---------------------------------------------------------------------------
// Youth intake
// ---------------------------------------------------------------------------

export interface GeneratedPlayer {
  name: string
  age: number
  position: PositionCode
  skillLevel: number
  potential: number
  stamina: number
  marketValue: number
  teamId: number
}

/**
 * Which positions a squad is short of, relative to `SQUAD_SHAPE`.
 *
 * This also repairs a seeding flaw: the fallback squad generator picked
 * positions uniformly at random, so a club could end up with no goalkeeper at
 * all (which is why `autoSelectLineup` needs its "top up with leftovers" path).
 * Intake fills the biggest shortfall first.
 */
export function positionsToFill(
  currentCounts: Record<PositionCode, number>,
  slots: number,
): PositionCode[] {
  const counts = { ...currentCounts }
  const wanted: PositionCode[] = []

  for (let i = 0; i < slots; i++) {
    let neediest: PositionCode = 'MID'
    let worstDeficit = -Infinity

    for (const code of POSITION_CODES) {
      const deficit = SQUAD_SHAPE[code] - (counts[code] ?? 0)
      if (deficit > worstDeficit) {
        worstDeficit = deficit
        neediest = code
      }
    }

    wanted.push(neediest)
    counts[neediest] = (counts[neediest] ?? 0) + 1
  }

  return wanted
}

/** A 16–19 year old with modest ability and real headroom. */
export function generateYouthPlayer(teamId: number, position: PositionCode): GeneratedPlayer {
  const age = Math.floor(randomBetween(16, 20))
  const skillLevel = Math.round(randomBetween(42, 60))
  const potential = Math.round(clamp(skillLevel + randomBetween(10, 38), skillLevel, MAX_SKILL))

  return {
    name: generateName(),
    age,
    position,
    skillLevel,
    potential,
    stamina: 100,
    marketValue: marketValueFor(skillLevel, age, potential),
    teamId,
  }
}

/**
 * Names for youth intake.
 *
 * Hand-rolled rather than using faker: faker is a devDependency and this runs
 * inside the Nitro server at season rollover, so importing it would pull a
 * dev-only package into the production build.
 */
const FIRST_NAMES = [
  'Alex', 'Andre', 'Antonio', 'Ben', 'Bruno', 'Carlos', 'Daniel', 'Diego', 'Eduardo', 'Elliot',
  'Emre', 'Enzo', 'Fabio', 'Felix', 'Gabriel', 'Hugo', 'Ibrahim', 'Isaac', 'Jack', 'Javier',
  'Joel', 'Jonas', 'Jordi', 'Kai', 'Kieran', 'Leo', 'Liam', 'Lucas', 'Luka', 'Marco',
  'Mateo', 'Mattia', 'Miguel', 'Nathan', 'Nico', 'Noah', 'Oliver', 'Omar', 'Pablo', 'Pedro',
  'Rafael', 'Raul', 'Ryan', 'Samuel', 'Sergio', 'Theo', 'Thomas', 'Tobias', 'Victor', 'Yusuf',
]

const LAST_NAMES = [
  'Almeida', 'Andersen', 'Bailey', 'Barros', 'Bennett', 'Blanco', 'Carter', 'Castro', 'Clarke', 'Costa',
  'Delgado', 'Dumont', 'Esposito', 'Ferreira', 'Fischer', 'Fletcher', 'Garrido', 'Gomes', 'Grant', 'Hayes',
  'Herrera', 'Iglesias', 'Jansen', 'Keller', 'Lambert', 'Lindqvist', 'Lopes', 'Marchetti', 'Mendes', 'Moreau',
  'Navarro', 'Nowak', 'Okafor', 'Oliveira', 'Pereira', 'Petrov', 'Quintero', 'Ramos', 'Reyes', 'Ricci',
  'Salgado', 'Santos', 'Schmidt', 'Silva', 'Sorensen', 'Tavares', 'Vargas', 'Vieira', 'Walsh', 'Zielinski',
]

function generateName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]!
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]!
  return `${first} ${last}`
}
