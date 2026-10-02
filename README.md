# Courtside Commissioner

An alternate-history WNBA simulator that runs in the browser. Pick any season from **1997 to 2026** and start the league from that year's real teams, rosters and players. From there you're the commissioner: you set the rules and the league's structure, and the sim runs every team.

Data comes from [sportsdataverse/wehoop-wnba-stats-data](https://github.com/sportsdataverse/wehoop-wnba-stats-data).

Fan-made. Not affiliated with or endorsed by the WNBA, its teams or its players.

## What you control

- **Playoff format.** Number of teams, seeding (league-wide or by conference), and series length for the early rounds, semifinals and Finals. Top seeds get byes when the field doesn't fill a bracket.
- **Conferences.** Create, rename and dissolve conferences, and move teams between them.
- **Franchises.**
  - *Expansion:* the new team gets an expansion draft with protected lists, and picks first in its first draft.
  - *Relocation and rebrands.*
  - *Contraction:* folding a team sends its players to a dispersal draft.
- **League rules.** Season length, salary cap and growth, max salary, roster limits, draft rounds, draft lottery, expansion protection and the trade deadline.
- **Real history.** Real expansions, relocations, folds and schedule changes come up on their real dates, and you approve or veto each one. Examples: the Detroit Shock joining in 1998, the Utah Starzz moving to San Antonio in 2003, the Houston Comets folding after 2008.

## What the sim runs

- 30 seasons of real rosters, ratings and stats, including the original 1997 teams.
- **Real draft classes:** players enter the draft in their real draft year, so Sue Bird arrives in 2002, Candace Parker in 2008 and Caitlin Clark in 2024. Generated prospects fill the remaining picks and every class after 2026.
- **Real career arcs** (on by default): each season, a real player's rating follows how she actually played that year. After 2026, or in seasons she didn't play, normal simulated development takes over.
- AI front offices handle drafting, re-signing, free agency under your cap, and trades. Contending teams buy veterans and rebuilding teams collect youth.
- **Real schedules.** When your league matches a real season's teams and length, the real schedule is played on the real dates, with the real scores shown alongside yours. Otherwise a balanced schedule is generated.
- **Visual playoff bracket.** Conference brackets face each other with the Finals in the middle, or a single league-wide bracket. Byes, live series scores and the champion are all shown. During the season it shows the bracket as it would look if the season ended today, and past seasons' brackets stay viewable.
- **Schedule tab** covering every season. Browse by day or by team (with a running record), plus playoff series game by game. Every game's score is kept for the life of the league. Full box scores, with team totals and shooting splits, are kept for the current and previous season.
- **Your own logos.** Upload an image for the league or any team in Save & info. Logos are stored only in your browser (IndexedDB), never in this repo.
- Game-by-game simulation with box scores, injuries, standings, playoffs, awards (MVP, DPOY, ROY, Finals MVP, All-League), transactions and a league record book. The record book compares your alternate history with what really happened.

## Play

Open `index.html` in a browser; no build step or server is needed. On GitHub Pages, go to Settings → Pages → *Deploy from a branch* → `main`, `/ (root)`.

`dist/courtside.html` is the same app as one self-contained file.

## Project layout

```
index.html                 app shell
css/style.css              styles (light + dark)
js/data.js                 generated 1997-2026 league history (do not edit by hand)
js/names.js                name pools for generated players
js/engine.js               simulation, AI front offices, commissioner powers
js/ui.js                   views and interactions
scripts/build_history.py   builds js/data.js from wehoop parquet files
scripts/bundle.py          builds dist/courtside.html
tests/sim_test.js          headless multi-season test: node tests/sim_test.js 1997 30
```

## Rebuilding the data

```sh
pip install pandas pyarrow numpy
python scripts/build_history.py                    # downloads from GitHub
python scripts/build_history.py --data-dir ../wehoop-wnba-stats-data
python scripts/bundle.py
node tests/sim_test.js 2005 10
```

Sources per season: `schedules/wnba_schedule_*` (real schedules and scores), `leaguedash/player_stats_base_*` and `player_stats_advanced_*` (season totals, PIE), `player_bio_*` (height, college, country, draft), `standings_*` (teams, conferences, records, scoring), and `rosters_*` for positions from 2020 on.

## How ratings work

A player's rating for any season uses her whole career up to that point:

1. Each season is graded against that year's league (z-scores of Game Score per 36, PIE and minutes per game), so eras compare fairly.
2. Seasons are averaged by minutes played, with each year back counting 80% as much as the year after it (`--decay` changes this).
3. Players with few minutes are pulled toward replacement level, and the scale centers the league near 58.

Skill ratings (inside scoring, 3-point, free throws, playmaking, rebounding, defense, athleticism) come from recency-weighted career per-36 rates and shooting percentages.

Game results come from each team's minutes-weighted rating. The gap between two teams converts to a point margin using a slope fitted across all 30 real seasons, and scoring follows each real season's league average.

## Money

The source data has no salaries. Caps before 2026 are rough estimates, and the 2026 cap is $7M (new CBA). Salaries scale with whatever cap you set.

## Credits

Data: [wehoop-wnba-stats-data](https://github.com/sportsdataverse/wehoop-wnba-stats-data) by SportsDataverse, CC BY 4.0. Code: MIT (see `LICENSE`).
