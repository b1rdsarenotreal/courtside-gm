# Courtside GM

A WNBA general manager simulator that runs in the browser. Every roster, rating and stat line starts from the real **2026 season**, built from [sportsdataverse/wehoop-wnba-stats-data](https://github.com/sportsdataverse/wehoop-wnba-stats-data).

Pick one of the 15 franchises and run it:

- **Roster and rotation.** Set your starters and minutes order. Release players, with dead money counted against the cap.
- **Trades.** Trade players and draft picks (three rounds, two years out) with AI front offices. Contending teams value current production, while rebuilding teams value youth, potential and picks. *What would make this work?* asks the other team what it would take.
- **Free agency.** Make offers under a hard cap. Players weigh salary, contract length and how good your team is.
- **Seasons.** A 44-game schedule with box scores, injuries, standings and league leaders, followed by playoffs: best-of-3, best-of-5, then a best-of-7 Finals.
- **Offseason.** Awards (MVP, DPOY, ROY, Finals MVP), a draft lottery, a 3-round draft with scouting estimates, re-signings, player development and aging, retirements, and cap growth.
- **Save.** Saves automatically in your browser. You can export or import a save code to move a league between devices.

Fan-made. Not affiliated with or endorsed by the WNBA, its teams or its players.

## Play

Open `index.html` in a browser. There's no build step and no server needed.

To host it on **GitHub Pages**, go to Settings → Pages, choose *Deploy from a branch*, then pick `main` and `/ (root)`.

`dist/courtside-gm.html` is the same app as a single self-contained file.

## Project layout

```
index.html              app shell
css/style.css           styles (light + dark)
js/data.js              generated league baseline (do not edit by hand)
js/names.js             name pools for generated prospects
js/engine.js            simulation: games, AI, trades, free agency, draft, offseason
js/ui.js                views and interactions
scripts/build_league.py builds js/data.js from wehoop parquet files
scripts/bundle.py       builds dist/courtside-gm.html
tests/sim_test.js       headless multi-season smoke test
```

## Rebuilding the data

```sh
pip install pandas pyarrow numpy
python scripts/build_league.py                    # downloads 2026 files from GitHub
python scripts/build_league.py --data-dir ../wehoop-wnba-stats-data   # or use a local clone
python scripts/bundle.py                          # refresh the single-file build
node tests/sim_test.js 3                          # simulate 3 seasons as a check
```

The builder reads these files:

| File | Used for |
|---|---|
| `rosters/rosters_2026` | teams, positions, height, age, experience, how acquired |
| `player_season_stats/…_2026` (base + advanced, per game) | box-score production, TS%, usage |
| `leaguedash/player_stats_base_*`, `player_stats_advanced_*` (1997–2026) | full career season totals, PIE; player-card career tables |
| `player_impact/wnba_player_impact_2026` | BPM, adjusted RAPM, WAR |
| `standings/standings_2026` | team records and point differential (to calibrate the game sim) |
| `draft/draft_2026` | reference for the real 2026 draft |

## How ratings work

- **OVR uses each player's full WNBA career**, from 1997 through 2026. Each season is first scored against that year's league, which keeps eras with different pace comparable. Those season scores are averaged by minutes played, with each earlier year counting 80% as much as the one after it, so a 2019 MVP season still counts but recent form counts most. The career inputs are Game Score per 36 (45%), PIE (15%) and minutes per game (15%). The 2026 Box Plus/Minus (15%) and adjusted RAPM (10%) are added as a current-form check. Players with few career minutes are shrunk toward replacement level, and the scale puts the league average near 58. Change the weighting with `--career-decay`: `1.0` counts every season equally, `0.5` leans hard on recent seasons.
- **Skill ratings** come from recency-weighted career per-36 rates and career shooting percentages: inside scoring, 3-point, free throw, playmaking, rebounding, defense and athleticism.
- **Potential** adds growth room for players younger than 27.
- **Game sim.** Team strength is the minutes-weighted OVR of the rotation. Strength gaps convert to point margin with a slope fitted to real 2026 point differentials (r ≈ 0.87), plus home court and randomness. Player box scores are then distributed by skill ratings.

## Contracts are estimates

The source data has no salaries, so contracts are modelled from player value on a scale shaped like the 2026 CBA (about $7M cap, $1.4M supermax, $270K minimum). The first simulated season (2027) uses a $7.5M hard cap, $1.5M max and $285K minimum, growing about 7% a year. Contract lengths are assigned deterministically per player, and 2024–2026 draftees are on rookie-scale deals.

## Credits

- Data: [wehoop-wnba-stats-data](https://github.com/sportsdataverse/wehoop-wnba-stats-data) by SportsDataverse, CC BY 4.0.
- Draft prospects and some filler free agents are generated with invented names.

Code is MIT licensed (see `LICENSE`).
