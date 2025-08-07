# Football Pitch Tactics

Football Pitch Tactics is a project that aims to recreate the classic football management games, inspired by titles like "Cyberfoot" (2007).

The game features :
- A simple match simulation engine, based on random events and basic team/player attributes.
- Football divisions from around the world, with a focus on popular leagues.
- Basic team management features, including player transfers.

## Implementation Details

The game is built using :
- Bun for the JavaScript runtime and package manager.
- Nuxt.js for the frontend framework.
- Nuxt UI for the component library.
- Pinia for state management.
- TypeScript for static type checking.
- SQLite for the database for initial data storage.

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
- **Stamina**: A measure of the player's energy levels, affecting their performance during matches.
- **Market Value**: The estimated worth of the player in the transfer market. This is the price a user should pay to acquire the player, or the price a user receives if they sell a player.

### Team Attributes

- **Name**: The team's name.
- **League**: The league in which the team competes.
- **Tactics**: The team's preferred playing style and strategy.
- **Squad Quality**: An assessment of the team's overall player quality and availability.
- **Finances**: The team's financial status represented as a net worth (available funds for transfers).

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