#!/usr/bin/env python3
"""Build the simulator's starting league from wehoop WNBA Stats data.

Reads the 2026 season files from sportsdataverse/wehoop-wnba-stats-data
(rosters, per-game box and advanced stats, player impact metrics, standings,
draft) and writes js/data.js, which the browser app loads as its baseline.

Usage:
    python scripts/build_league.py                       # download from GitHub
    python scripts/build_league.py --data-dir ../wehoop-wnba-stats-data
    python scripts/build_league.py --season 2026

Player ratings are derived from the stats (see README "How ratings work").
Contracts are ESTIMATES: the source data has no salary information, so salaries
are modelled from player value on a scale shaped like the 2026 CBA.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

RAW = "https://raw.githubusercontent.com/sportsdataverse/wehoop-wnba-stats-data/main/"

# Short display colours per franchise (badges only; no logos are used).
TEAM_COLORS = {
    "ATL": "#C8102E", "CHI": "#418FDE", "CON": "#F05023", "DAL": "#0C2340",
    "GSV": "#6A4C93", "IND": "#E03A3E", "LAS": "#552583", "LVA": "#A7A8AA",
    "MIN": "#236192", "NYL": "#6ECEB2", "PDX": "#D9531E", "PHX": "#CB6015",
    "SEA": "#2C5234", "TOR": "#7A1F3D", "WAS": "#0C2340",
}

# Economic settings for the first simulated season (2027), estimated from the
# 2026 CBA ($7M cap, ~$1.4M supermax, ~$270K minimum) with ~7% growth.
ECON = {
    "salaryCap": 7_500_000,
    "maxSalary": 1_500_000,
    "minSalary": 285_000,
    "rookieTopSalary": 535_000,
    "capGrowth": 0.07,
    "rosterMin": 12,
    "rosterMax": 15,
}


def h01(*parts) -> float:
    """Deterministic pseudo-random number in [0,1) from the given parts."""
    s = "|".join(str(p) for p in parts).encode()
    return int(hashlib.sha1(s).hexdigest()[:8], 16) / 0xFFFFFFFF


def load(path: str, data_dir: Path | None) -> pd.DataFrame:
    if data_dir:
        return pd.read_parquet(data_dir / path)
    url = RAW + path
    print("  downloading", url, file=sys.stderr)
    with urllib.request.urlopen(url) as r:
        return pd.read_parquet(io.BytesIO(r.read()))


def z(s: pd.Series, mask: pd.Series) -> pd.Series:
    m, sd = s[mask].mean(), s[mask].std()
    return (s - m) / (sd if sd > 0 else 1)


def height_in(h) -> int | None:
    m = re.match(r"(\d+)-(\d+)", str(h or ""))
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=None)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "js" / "data.js")
    a = ap.parse_args()
    S = a.season

    print(f"Loading {S} data...", file=sys.stderr)
    rosters = load(f"wnba_stats/rosters/parquet/rosters_{S}.parquet", a.data_dir)
    pss = load(f"wnba_stats/player_season_stats/parquet/player_season_stats_{S}.parquet", a.data_dir)
    impact = load(f"wnba_stats/player_impact/parquet/wnba_player_impact_{S}.parquet", a.data_dir)
    standings = load(f"wnba_stats/standings/parquet/standings_{S}.parquet", a.data_dir)
    draft = load(f"wnba_stats/draft/parquet/draft_{S}.parquet", a.data_dir)

    rs = pss[(pss.season_type == "regular-season") & (pss.per_mode == "pergame")]
    rs = rs.sort_values("gp", ascending=False).drop_duplicates(["player_id", "measure_type"])
    impact = impact.sort_values("gp", ascending=False).drop_duplicates(["player_id", "season_type"])
    rosters = rosters.drop_duplicates("player_id")
    base = rs[rs.measure_type == "base"].set_index("player_id")
    adv = rs[rs.measure_type == "advanced"].set_index("player_id")
    imp = impact[impact.season_type == "Regular Season"].set_index("player_id")

    # ---- Teams ---------------------------------------------------------
    abbr_by_id = dict(base[["team_id", "team_abbreviation"]].drop_duplicates().values)
    teams = []
    for _, t in standings.sort_values("league_rank").iterrows():
        ab = abbr_by_id.get(t.team_id)
        teams.append({
            "id": ab, "nbaId": int(t.team_id), "city": t.team_city, "name": t.team_name,
            "conf": t.conference, "color": TEAM_COLORS.get(ab, "#555"),
            "last": {"w": int(t.wins), "l": int(t.losses), "ppg": float(t.points_pg),
                     "oppg": float(t.opp_points_pg), "seed": int(t.playoff_seeding or 0)},
        })
    team_ids = {t["nbaId"]: t["id"] for t in teams}

    # ---- Player pool: everyone on a roster + anyone who played ------------
    df = pd.DataFrame(index=sorted(set(rosters.player_id) | set(base.index)))
    df.index.name = "player_id"
    num = ["gp", "min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf",
           "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "fg_pct", "fg3_pct", "ft_pct", "plus_minus"]
    df = df.join(base[num + ["player_name", "team_abbreviation", "age"]])
    df = df.join(adv[["ts_pct", "usg_pct", "ast_pct", "reb_pct", "pie", "net_rating"]])
    df = df.join(imp[["bpm", "obpm", "dbpm", "war", "adj_rapm"]])
    r = rosters.drop_duplicates("player_id").set_index("player_id")
    df = df.join(r[["player", "team_id", "position", "height", "weight", "age", "exp", "school",
                    "how_acquired", "birth_date"]], rsuffix="_r")
    df[num] = df[num].fillna(0)
    df["name"] = df.player.fillna(df.player_name)
    df["age"] = df.age_r.fillna(df.age).fillna(24)

    tot_min = df["min"] * df["gp"]
    m = tot_min.clip(lower=1)
    per36 = lambda col: df[col] * df["gp"] * 36 / m
    rated = tot_min >= 120

    # Game Score per 36, shrunk toward replacement level by minutes played.
    gmsc = (df.pts + 0.4 * df.fgm - 0.7 * df.fga - 0.4 * (df.fta - df.ftm) + 0.7 * df.oreb
            + 0.3 * df.dreb + df.stl + 0.7 * df.ast + 0.7 * df.blk - 0.4 * df.pf - df.tov)
    gmsc36 = gmsc * df.gp * 36 / m
    prior = 300.0
    repl_g = gmsc36[rated].quantile(0.15)
    w = tot_min / (tot_min + prior)
    gmsc_s = gmsc36 * w + repl_g * (1 - w)
    bpm_s = df.bpm.fillna(-6).clip(-15, 15) * w + (-6) * (1 - w)
    rapm_s = df.adj_rapm.fillna(-3) * w + (-3) * (1 - w)
    mpg = df["min"]

    comp = 0.50 * z(gmsc_s, rated) + 0.20 * z(bpm_s, rated) + 0.15 * z(rapm_s, rated) + 0.15 * z(mpg, rated)
    zc = z(comp, rated)
    ovr = (58 + 11.5 * zc).clip(38, 97)
    # Players with no WNBA minutes (rookies who didn't play / deep reserves)
    ovr[tot_min < 1] = 44
    df["ovr"] = ovr.round().astype(int)

    # Skill sub-ratings from per-36 rates (regressed for low-minute players).
    def skill(series, lo=30, hi=99, reg=45):
        s = 55 + 13 * z(series, rated)
        s = s * w + reg * (1 - w)
        return s.clip(lo, hi).round().astype(int)

    two_a = (df.fga - df.fg3a)
    two_pct = ((df.fgm - df.fg3m) / two_a.replace(0, np.nan)).fillna(0.42)
    two_pct_s = two_pct * (two_a * df.gp / (two_a * df.gp + 60)) + 0.45 * (60 / (two_a * df.gp + 60))
    df["ins"] = skill(0.6 * z(per36("pts") - 3 * per36("fg3m"), rated) + 0.4 * z(two_pct_s, rated))
    three_pct_s = (df.fg3m * df.gp + 0.32 * 40) / (df.fg3a * df.gp + 40)
    df["thr"] = skill(0.55 * z(three_pct_s, rated) + 0.45 * z(per36("fg3a"), rated))
    ft_s = (df.ftm * df.gp + 0.75 * 30) / (df.fta * df.gp + 30)
    df["fts"] = skill(z(ft_s, rated))
    df["ply"] = skill(0.75 * z(per36("ast"), rated) - 0.25 * z(per36("tov"), rated))
    df["reb_r"] = skill(z(per36("reb"), rated))
    df["def"] = skill(0.4 * z(per36("stl") + per36("blk"), rated)
                      + 0.4 * z(df.dbpm.fillna(-2).clip(-8, 8), rated) + 0.2 * z(mpg, rated))
    df["ath"] = skill(0.5 * z(per36("oreb") + per36("blk") + per36("stl"), rated)
                      + 0.5 * z(per36("fta"), rated))

    # Potential: young players get room to grow.
    def potential(row):
        age = row.age + 1  # age entering 2027
        room = max(0.0, 27 - age) * 2.4 * (0.6 + 0.8 * h01(row.name, "pot"))
        return int(min(99, round(row.ovr + room)))
    df["pot"] = [potential(row) for row in df.itertuples()]

    # ---- Contracts (estimated) -------------------------------------------
    pick_re = re.compile(r"#(\d+) Pick in (\d{4}) Draft")
    def contract(pid, row):
        mn, mx = ECON["minSalary"], ECON["maxSalary"]
        acq = str(row.how_acquired or "")
        pm = pick_re.search(acq)
        if pm and int(pm.group(2)) >= S - 2:
            pick, yr = int(pm.group(1)), int(pm.group(2))
            if pick <= 15:
                sal = ECON["rookieTopSalary"] - (pick - 1) * (ECON["rookieTopSalary"] - 330_000) / 14
            else:
                sal = mn
            years = max(1, 4 - (S - yr) - 1)
            return int(round(sal, -3)), years, True
        f = max(0.0, (row.ovr - 50) / 44)
        sal = mn + (mx - mn) * f ** 2.1
        sal *= 0.92 + 0.16 * h01(pid, "sal")
        sal = min(mx, max(mn, sal))
        years = 1 + int(h01(pid, "yrs") * (4 if row.age < 31 else 2))
        return int(round(sal, -4)), years, False

    players = []
    on_team = df.team_id.notna() & df.team_id.isin(team_ids.keys())
    for pid, row in df.iterrows():
        team = team_ids.get(row.team_id) if on_team[pid] else None
        # Free agents: only keep those who actually played meaningful minutes.
        if team is None and tot_min[pid] < 60:
            continue
        sal, yrs, rookie = contract(pid, row)
        if team is None:
            sal, yrs = 0, 0
        pos = row.position if isinstance(row.position, str) and row.position else (
            "C" if df.loc[pid, "reb_r"] > 70 and df.loc[pid, "thr"] < 45 else "F" if df.loc[pid, "reb_r"] > 58 else "G")
        players.append({
            "id": int(pid), "name": row["name"], "team": team, "pos": pos,
            "ht": height_in(row.height), "age": int(row.age) + 1,
            "exp": 0 if str(row.exp) == "R" else int(row.exp) if str(row.exp).isdigit() else None,
            "school": row.school if isinstance(row.school, str) else "",
            "acq": row.how_acquired if isinstance(row.how_acquired, str) else "",
            "r": {"ovr": int(row.ovr), "pot": int(row.pot), "ins": int(row.ins), "thr": int(row.thr),
                  "fts": int(row.fts), "ply": int(row.ply), "reb": int(row.reb_r), "def": int(row["def"]),
                  "ath": int(row.ath)},
            "c": {"sal": sal, "yrs": yrs, "rookie": rookie},
            "s": {k: (round(float(row[k]), 3) if k.endswith("pct") else round(float(row[k]), 1))
                  for k in ["gp", "min", "pts", "reb", "ast", "stl", "blk", "tov", "fg_pct", "fg3_pct", "ft_pct"]}
                 | {"ts": round(float(row.ts_pct), 3) if pd.notna(row.ts_pct) else None,
                    "bpm": round(float(row.bpm), 1) if pd.notna(row.bpm) else None,
                    "war": round(float(row.war), 2) if pd.notna(row.war) else None,
                    "team": row.team_abbreviation if isinstance(row.team_abbreviation, str) else None},
        })

    # ---- Calibrate team strength -> point margin ---------------------------
    # Team rating = minutes-weighted OVR of the top-10 rotation; fit the slope
    # that maps rating differences onto 2026 per-game point differential.
    def team_rating(abbr):
        ps = sorted((p["r"]["ovr"] for p in players if p["team"] == abbr), reverse=True)[:10]
        wts = [36, 33, 31, 29, 26, 20, 15, 11, 7, 4][:len(ps)]
        return sum(o * wt for o, wt in zip(ps, wts)) / sum(wts)
    tr = np.array([team_rating(t["id"]) for t in teams])
    diff = np.array([t["last"]["ppg"] - t["last"]["oppg"] for t in teams])
    slope = float(np.polyfit(tr - tr.mean(), diff, 1)[0])
    corr = float(np.corrcoef(tr, diff)[0, 1])
    print(f"Team rating vs point diff: slope={slope:.2f} pts/rating pt, r={corr:.2f}", file=sys.stderr)

    out = {
        "source": "sportsdataverse/wehoop-wnba-stats-data",
        "baseSeason": S, "startSeason": S + 1,
        "econ": ECON,
        "sim": {"marginPerRating": round(max(1.2, min(3.5, slope)), 3), "homeAdv": 2.2,
                "pace": 80.0, "leaguePts": round(float(np.mean([t["last"]["ppg"] for t in teams])), 1),
                "games": int(standings.wins.iloc[0] + standings.losses.iloc[0])},
        "teams": teams,
        "players": players,
        "draft": [{"pick": int(d.overall_pick), "round": int(d.round_number), "name": d.player_name,
                   "team": d.team_abbreviation, "school": d.organization} for d in draft.itertuples()],
    }
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text("// Generated by scripts/build_league.py from " + out["source"] + " - do not edit.\n"
                     "window.LEAGUE_DATA = " + json.dumps(out, separators=(",", ":")) + ";\n")
    n_fa = sum(1 for p in players if p["team"] is None)
    print(f"Wrote {a.out} ({len(players)} players, {n_fa} free agents, {len(teams)} teams)", file=sys.stderr)


if __name__ == "__main__":
    main()
