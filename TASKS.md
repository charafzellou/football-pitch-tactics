# Project Task List

This file outlines the development tasks for the Football Pitch Tactics game, broken down by feature and development area.

## Phase 1: Core Setup & Database

- [ ] **1. Project Initialization:**
    - [X] Set up Nuxt.js project with Bun.
    - [X] Install necessary dependencies: Nuxt UI, Pinia, TypeScript.
    - [X] Configure ESLint and Prettier for code quality.

- [X] **2. Database Schema Definition:**
    - [X] Define `countries` table (id, name).
    - [X] Define `leagues` table (id, name, country_id).
    - [X] Define `teams` table (id, name, league_id, bank_balance, tactics).
    - [X] Define `players` table (id, name, age, position, skill_level, stamina, market_value, team_id).
    - [X] Define `matches` table (id, home_team_id, away_team_id, home_score, away_score, season, match_date).
    - [X] Define `match_events` table (id, match_id, minute, event_type, player_id, team_id).

- [X] **3. Database Seeding:**
    - [X] Create a script (`server/db/seed.ts`) to populate the database with initial data.
    - [X] Add sample data for countries, leagues, teams, and players.
    - [X] Add a `bun run setup:db` script to `package.json` that executes the seeding script.
    - [X] **Bonus**: Add a script to generate a full season schedule for a league.

## Phase 2: Backend Development (Nuxt Server API)

- [ ] **1. Game State API:**
    - [X] `POST /api/game/start`: Endpoint to initialize a new game session, select a team for the player, and generate the season's match schedule.
    - [X] `GET /api/game/state`: Endpoint to retrieve the current game state (e.g., current date, player's team, season).
    - [X] `POST /api/game/next-day`: Endpoint to advance the game to the next day.

- [ ] **2. Data Fetching API:**
    - [X] `GET /api/countries`: Endpoint to fetch all available countries.
    - [X] `GET /api/leagues?countryId=:id`: Endpoint to fetch leagues for a selected country.
    - [X] `GET /api/teams?leagueId=:id`: Endpoint to fetch teams for a selected league.

- [ ] **3. Team Management API:**
    - [X] `GET /api/team/:id`: Endpoint to get detailed information for a specific team, including its squad.
    - [X] `PUT /api/team/:id/tactics`: Endpoint to update a team's tactics.

- [ ] **4. Match Simulation API:**
    - [X] `POST /api/match/simulate`: Endpoint to run the match simulation for the next scheduled match.
    - [X] `GET /api/match/:id`: Endpoint to get details and events for a specific match.
    - [X] `GET /api/schedule`: Endpoint to get the match schedule for the player's team.
    - [X] `GET /api/standings?leagueId=:id`: Endpoint to get the current league table.

- [ ] **5. Player Transfers API:**
    - [X] `GET /api/players/search?query=:q`: Endpoint to search for players available for transfer.
    - [X] `POST /api/transfers`: Endpoint to handle player transfer logic (buy/sell).
    - [X] `GET /api/transfers/history`: Endpoint to view the user's transfer history.

## Phase 3: Frontend Development (Nuxt/Vue)

- [ ] **1. Index Page (`pages/index.vue`):**
    - [X] Display a welcome message and game description.
    - [X] Add a "Start New Game" button that navigates to the team selection page.
    - [X] Add a "Load Game" button (for future implementation).

- [ ] **2. New Game / Team Selection Page (`pages/new-game.vue`):**
    - [X] Create dropdowns to select Country, League, and Team.
    - [X] Dropdowns should be populated dynamically from the API.
    - [X] A "Start Game" button to post the selection and navigate to the main game screen.

- [ ] **3. Main Game Layout (`layouts/default.vue` & `components/Sidebar.vue`):**
    - [X] Create a main layout with a persistent sidebar for navigation.
    - [X] Sidebar links: Dashboard, Team, Tactics, Schedule, Standings, Transfers.

- [ ] **4. Dashboard Page (`pages/game/index.vue`):**
    - [X] Display a summary of the club's status (league position, bank_balance).
    - [X] Show the next match details.
    - [X] A button to "Play Next Match".

- [ ] **5. Team Management Page (`pages/game/team.vue`):**
    - [X] Display a list of all players in the user's squad.
    - [X] Show player attributes (Position, Age, Skill, etc.).
    - [X] Allow sorting and filtering of players.

- [ ] **6. Tactics Page (`pages/game/tactics.vue`):**
    - [X] UI for viewing and changing the team's formation and strategy.
    - [X] Save updated tactics to the backend.

- [ ] **7. Schedule Page (`pages/game/schedule.vue`):**
    - [X] Display a list of all played and upcoming matches for the season.
    - [X] Show scores for played matches.
    - [X] Allow clicking on a match to see detailed stats.

- [ ] **8. Standings Page (`pages/game/standings.vue`):**
    - [X] Display the full league table.
    - [X] Highlight the player's team in the table.

- [ ] **9. Transfers Page (`pages/game/transfers.vue`):**
    - [X] Search input to find players.
    - [X] Display search results with player details and market value.
    - [X] "Buy" button to initiate a transfer.
    - [X] A section to list the user's own players with a "Sell" button.

- [ ] **10. Match Report Modal/Page (`components/MatchReport.vue`):**
    - [X] Display the final score.
    - [X] Show a timeline of key match events (goals, cards).
    - [X] Basic match statistics (possession, shots - if implemented).
    - [X] Player ratings for the match.

## Phase 4: Core Game Logic & State Management

- [X] **1. Pinia State Management:**
    - [X] Create a `gameStore` to manage the overall game state (season, year, user team).
    - [X] Create a `teamStore` to manage the player's team data (squad, bank_balance, tactics).
    - [X] Create a `leagueStore` to manage league data (schedule, standings).
    - [X] Create a `notificationsStore` for handling user feedback (toasts, etc.).

- [X] **2. Match Simulation Engine (`server/core/match-engine.ts`):**
    - [X] Develop the core logic for simulating a match.
    - [X] The engine should take two teams' data as input.
    - [X] Use player/team skill levels and tactics to influence the outcome.
    - [X] Generate random events based on weighted probabilities.
    - [X] The simulation should produce a final score and a list of match events.

- [X] **3. Season Progression:**
    - [X] Logic to advance the game week by week.
    - [X] At the end of a season, calculate final standings.
    - [X] Logic to handle player aging and potential retirement/regeneration.
    - [X] Reset for a new season.
    - [X] Generate end-of-season summary report.

## Phase 5: UI/UX & Final Touches

- [X] **1. Styling:**
    - [X] Apply consistent styling using Nuxt UI components.
    - [X] Ensure the application is responsive and usable on different screen sizes.

- [X] **2. User Feedback:**
    - [X] Use toasts or notifications for actions like saving tactics or completing a transfer.
    - [X] Implement loading states for data fetching.
    - [X] Add clear error handling messages for API failures.