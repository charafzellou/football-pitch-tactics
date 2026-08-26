# Football Pitch Tactics

Football Pitch Tactics is a project that aims to recreate the classic football management games, inspired by titles like "Cyberfoot" (2007).

The game features :
- A simple match simulation engine, based on random events and basic team/player attributes.
- Live matchday playback with a half-time break, in-match substitutions, mid-match tactical changes, and player fatigue that carries between matches.
- Football divisions from around the world, with a focus on popular leagues.
- Basic team management features, including player transfers.

## Implementation Details

The game is built using :
- Bun for the JavaScript runtime and package manager.
- Nuxt.js for the frontend framework.
- Nuxt UI for the component library.
- Pinia for state management.
- TypeScript for static type checking.
- SQLite for the database. One shared file holds every player's save — there's no login, just an anonymous per-browser save token — see [docs/technical/database-schema.md](docs/technical/database-schema.md#multi-tenancy).

## Gameplay Loop

1. On the index page, the player can see a short description of the game, and a button to start a new game.
2. After starting a new game, the player is taken to the team selection screen, where they can choose the starting nation, league, and team from a list of available options.
3. Once the team is selected, the player is taken to the main game screen, where they can manage their team, view match schedules, and participate in matches.
4. The player can access various game features through a sidebar menu, including team management, team tactics, or advancing to the next match.
5. The player can view simplistic match statistics after each match, allowing them to analyze their team's performance and make strategic decisions for future matches. The match statistics are based on the events calculated during the match simulation.
6. Game after game, the player can refine their strategies, make key player transfers, and ultimately aim for success in their chosen league.
7. Once all the scheduled matches are played, the player can view the final league standings and receive a summary of their team's performance throughout the season.
8. A new season begins, allowing the player to continue the game loop with their current team.

## Game Mechanics

### Player Attributes

- **Name**: The player's name.
- **Age**: The player's age.
- **Position**: The player's position on the field (e.g., Forward, Midfielder, Defender, Goalkeeper).
- **Skill Level**: A numerical representation of the player's overall skill (1-100).
- **Stamina**: A measure of the player's energy levels (0-100), affecting their performance during matches. Drains while on the pitch — faster for outfield players than for a goalkeeper — and only partially recovers between matches, so repeatedly fielding the same lineup gradually wears a squad down.
- **Injury Status**: Whether a player is available for selection. An in-match injury takes them off immediately and rules them out for a handful of upcoming matches.
- **Substitutions**: Up to five changes per side are allowed during a match. Goalkeepers can only be replaced by another goalkeeper; outfield players cannot replace a goalkeeper or become one through a substitution.
- **Squad depth**: Every seeded club starts with at least 2 goalkeepers, 5 defenders, 5 midfielders, 2 forwards, and 16 players in total. These minimums are also preserved when selling players.
- **Market Value**: The estimated worth of the player in the transfer market. This is the price a user should pay to acquire the player, or the price a user receives if they sell a player.

### Team Attributes

- **Name**: The team's name.
- **League**: The league in which the team competes.
- **Tactics**: The team's preferred playing style and strategy.
- **Squad Quality**: An assessment of the team's overall player quality and availability.
- **Reputation**: A 0–100 standing derived from squad strength and league rank. It is the single input the whole economy hangs off — it sizes the stadium, commercial income and prize money, sets the fair ticket price and the starting balance, and seeds the board's expectations.
- **Finances**: Not a net worth. A club runs a real profit and loss, settled every matchday through a ledger: gate receipts, sponsors, the club shop, advertising, hospitality and stadium hire on one side; wages, matchday operations, facility upkeep and debt service on the other. Every movement is recorded, so a balance can always be explained rather than merely asserted.
- **The ground**: Capacity, ticket price, season tickets, executive boxes, advertising boards and pitch condition — the pitch wears when the ground is hired out for a concert, and a worn pitch costs the home side.
- **Facilities**: An academy and a training ground, 0–3 each, which shape youth intake, player development and recovery — and pay back over seasons rather than within one.
- **Debt**: A club can borrow against its projected income. Going overdrawn costs interest, then a transfer embargo, then forced sales.

See [docs/functional/finances.md](docs/functional/finances.md) for the decisions and [docs/technical/economy.md](docs/technical/economy.md) for the formulas.

### Match Attributes

- **Home Team**: The team playing at their home stadium.
- **Away Team**: The team playing at the away stadium.
- **Score**: The current score of the match (Home Team - Away Team).
- **Match Events**: A list of key events that occur during the match (e.g., goals, yellow cards, substitutions).

## Development Setup

To set up the development environment, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/charafzellou/football-pitch-tactics.git
   cd football-pitch-tactics
   ```

2. Install dependencies using Bun:
   ```bash
   bun install
   ```

3. Set up the database:
   ```bash
   bun run setup:db
   ```

4. Start the development server:
   ```bash
   bun run dev
   ```

5. Open your browser and navigate to `http://localhost:8080` to see the application in action.

## Testing

```bash
cd frontend
bun run test              # unit tests
bun run test:coverage     # unit tests with a coverage report
```

Unit tests cover the game's pure logic — `server/core/*`, `shared/*`, `app/utils/*` — and run in GitHub Actions CI on every push and PR. See [docs/technical/testing.md](docs/technical/testing.md) for scope, conventions, and known gaps.