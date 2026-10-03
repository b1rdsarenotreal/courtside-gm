#!/usr/bin/env python3
"""Build Courtside's historical league file (js/data.js) from wehoop WNBA Stats data.

Covers every season 1997..2026:
  * teams per season (franchise id, city, nickname, abbreviation, conference, record)
  * every player's real season lines and a rating for each season she played,
    computed from her career-to-date (recency weighted, era normalised)
  * bio: height, college, country, draft info, birth year
  * the real franchise timeline (expansions, relocations/renames, folds)

Usage:
    python scripts/build_history.py                         # download from GitHub
    python scripts/build_history.py --data-dir ../wehoop-wnba-stats-data
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

RAW = "https://raw.githubusercontent.com/sportsdataverse/wehoop-wnba-stats-data/main/"
FIRST, LAST = 1997, 2026

# Badge colours per abbreviation (display only; no logos).
COLORS = {
    "ATL": "#C8102E", "CHI": "#418FDE", "CON": "#F05023", "DAL": "#0C2340", "GSV": "#6A4C93",
    "IND": "#E03A3E", "LAS": "#552583", "LVA": "#8A8D8F", "MIN": "#236192", "NYL": "#3FA88E",
    "PDX": "#D9531E", "POR": "#B22234", "PHX": "#CB6015", "PHO": "#CB6015", "SEA": "#2C5234",
    "TOR": "#7A1F3D", "WAS": "#1F3A93", "HOU": "#B5121B", "CHA": "#00778B", "CLE": "#E35205",
    "SAC": "#5A2D81", "UTA": "#0093B2", "SAS": "#5B6770", "DET": "#B3122E", "TUL": "#1D3E6E",
    "ORL": "#0066B3", "MIA": "#F26522",
}


def load(path, data_dir):
    if data_dir:
        return pd.read_parquet(data_dir / path)
    with urllib.request.urlopen(RAW + path) as r:
        return pd.read_parquet(io.BytesIO(r.read()))


def zs(s: pd.Series, mask: pd.Series) -> pd.Series:
    m, sd = s[mask].mean(), s[mask].std()
    return (s - m) / (sd if sd and sd > 0 else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path)
    ap.add_argument("--decay", type=float, default=0.8, help="per-season weight for older seasons")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "js" / "data.js")
    a = ap.parse_args()
    LD = "wnba_stats/leaguedash/parquet/"

    seasons, bios, teams, league, schedules, playoffs = [], [], {}, {}, {}, {}
    positions = {}
    for y in range(FIRST, LAST + 1):
        print("season", y, file=sys.stderr)
        b = load(f"{LD}player_stats_base_{y}.parquet", a.data_dir)
        ad = load(f"{LD}player_stats_advanced_{y}.parquet", a.data_dir)
        bio = load(f"{LD}player_bio_{y}.parquet", a.data_dir)
        st = load(f"{LD}standings_{y}.parquet", a.data_dir)
        b = b[b.season_type == "Regular Season"].sort_values("gp", ascending=False).drop_duplicates("player_id")
        ad = ad[ad.season_type == "Regular Season"].sort_values("gp", ascending=False).drop_duplicates("player_id")
        bio = bio[bio.season_type == "Regular Season"].drop_duplicates("player_id")
        b = b.merge(ad[["player_id", "pie"]], on="player_id", how="left").rename(columns={"fg3_m": "fg3m", "fg3_a": "fg3a"})
        b["season"] = y
        b = b[b["min"] > 0].copy()
        g = (b.pts + 0.4 * b.fgm - 0.7 * b.fga - 0.4 * (b.fta - b.ftm) + 0.7 * b.oreb
             + 0.3 * b.dreb + b.stl + 0.7 * b.ast + 0.7 * b.blk - 0.4 * b.pf - b.tov)
        b["gmsc36"] = g * 36 / b["min"]
        b["mpg"] = b["min"] / b.gp
        q = b["min"] >= 150
        for col in ["gmsc36", "pie", "mpg"]:
            b["z_" + col] = zs(b[col].fillna(b[col][q].median()), q).clip(-3, 4)
        seasons.append(b)
        bio["season"] = y
        bios.append(bio)
        abbr = dict(b[["team_id", "team_abbreviation"]].drop_duplicates().values)
        tl = []
        for t in st.itertuples():
            ab = abbr.get(t.team_id, (t.team_city or "")[:3].upper())
            gp = t.wins + t.losses
            tl.append({"fid": str(t.team_id)[-2:], "abbr": ab, "city": t.team_city, "name": t.team_name,
                       "conf": t.conference if isinstance(t.conference, str) and t.conference else None,
                       "w": int(t.wins), "l": int(t.losses),
                       "ppg": float(t.points_pg) if pd.notna(t.points_pg) else None,
                       "oppg": float(t.opp_points_pg) if pd.notna(t.opp_points_pg) else None,
                       "color": COLORS.get(ab, "#666")})
        teams[y] = tl
        # Real regular-season schedule: [days from opening night, home, away, home pts, away pts]
        sc = load(f"wnba_stats/schedules/parquet/wnba_schedule_{y}.parquet", a.data_dir)
        sc = sc[sc.season_type == "regular-season"].copy()
        sc["d"] = pd.to_datetime(sc.game_date)
        d0 = sc.d.min()
        sc = sc.sort_values(["d", "game_id"])
        schedules[y] = {"start": d0.strftime("%Y-%m-%d"),
                        "g": [[int((r.d - d0).days), str(r.home_team_id)[-2:], str(r.away_team_id)[-2:],
                               int(r.home_pts) if pd.notna(r.home_pts) else None, int(r.away_pts) if pd.notna(r.away_pts) else None]
                              for r in sc.itertuples()]}
        # Real playoff series: [team a, team b, a wins, b wins, round index, label].
        po = load(f"wnba_stats/schedules/parquet/wnba_schedule_{y}.parquet", a.data_dir)
        po = po[(po.season_type == "playoffs") & po.home_pts.notna()].copy()
        if len(po):
            po["d"] = pd.to_datetime(po.game_date)
            ser = {}
            for r in po.sort_values("d").itertuples():
                h, aw = str(r.home_team_id)[-2:], str(r.away_team_id)[-2:]
                key = tuple(sorted((h, aw)))
                x = ser.setdefault(key, {"t": key, "w": {key[0]: 0, key[1]: 0}, "d0": r.d})
                x["w"][h if r.home_pts > r.away_pts else aw] += 1
            order = sorted(ser.values(), key=lambda x: x["d0"])
            seen = {}
            for x in order:
                x["r"] = max(seen.get(x["t"][0], 0), seen.get(x["t"][1], 0))
                for k in x["t"]: seen[k] = x["r"] + 1
            top = max(x["r"] for x in order)
            conf = {t["fid"]: t["conf"] for t in tl}
            out = []
            for x in order:
                ta, tb = x["t"]; fe = top - x["r"]
                same = y < 2016 and conf.get(ta) and conf.get(ta) == conf.get(tb)  # league-wide seeding since 2016
                lab = "Finals" if fe == 0 else (f"{conf[ta]} final" if fe == 1 else f"{conf[ta]} round {x['r'] + 1}") if same else ("Semifinals" if fe == 1 else f"Round {x['r'] + 1}")
                out.append([ta, tb, x["w"][ta], x["w"][tb], x["r"], lab])
            if sum(1 for x in order if x["r"] == top) == 1:  # skip a postseason still in progress
                playoffs[y] = out
        ppg = np.nanmean([t["ppg"] for t in tl if t["ppg"]])
        league[y] = {"ppg": round(float(ppg), 1), "games": int(max(t["w"] + t["l"] for t in tl))}
        if y >= 2020:
            r = load(f"wnba_stats/rosters/parquet/rosters_{y}.parquet", a.data_dir)
            for p in r.itertuples():
                if isinstance(p.position, str) and p.position:
                    positions[int(p.player_id)] = p.position

    car = pd.concat(seasons, ignore_index=True)
    car = car[car.player_id.notna()].copy()
    car["player_id"] = car.player_id.astype("int64")
    car["team_id"] = car.team_id.fillna(0).astype("int64")
    bio = pd.concat(bios, ignore_index=True)
    bio = bio[bio.player_id.notna()].copy()
    bio["player_id"] = bio.player_id.astype("int64")

    # ---- per-season ratings from career-to-date -----------------------------
    REPL, PRIOR = -1.0, 300.0
    rating_rows = []
    for y in range(FIRST, LAST + 1):
        ids = set(car.player_id[car.season == y])
        c = car[(car.season <= y) & car.player_id.isin(ids)].copy()
        c["decay"] = a.decay ** (y - c.season)
        c["w"] = c["min"] * c.decay
        grp = c.groupby("player_id")
        W = grp.w.sum()
        eff = (c["min"] * c.decay).groupby(c.player_id).sum()
        k = eff / (eff + PRIOR)
        def wav(col):
            return (c[col] * c.w).groupby(c.player_id).sum() / W * k + REPL * (1 - k)
        def ds(col):
            return (c[col] * c.decay).groupby(c.player_id).sum()
        rated = eff >= 120
        comp = 0.55 * zs(wav("z_gmsc36"), rated) + 0.2 * zs(wav("z_pie"), rated) + 0.25 * zs(wav("z_mpg"), rated)
        ovr = (58 + 11.5 * zs(comp, rated)).clip(35, 97)
        m36 = eff.clip(lower=1)
        p36 = lambda col: ds(col) * 36 / m36
        def skill(s):
            v = 55 + 13 * zs(s, rated)
            return (v * k + 45 * (1 - k)).clip(25, 99)
        two_pct = (ds("fgm") - ds("fg3m") + 0.45 * 60) / (ds("fga") - ds("fg3a") + 60)
        thr_pct = (ds("fg3m") + 0.31 * 40) / (ds("fg3a") + 40)
        ft_pct = (ds("ftm") + 0.74 * 30) / (ds("fta") + 30)
        out = pd.DataFrame({
            "ovr": ovr,
            "ins": skill(0.6 * zs(p36("pts") - 3 * p36("fg3m"), rated) + 0.4 * zs(two_pct, rated)),
            "thr": skill(0.55 * zs(thr_pct, rated) + 0.45 * zs(p36("fg3a"), rated)),
            "fts": skill(zs(ft_pct, rated)),
            "ply": skill(0.75 * zs(p36("ast"), rated) - 0.25 * zs(p36("tov"), rated)),
            "reb": skill(zs(p36("reb"), rated)),
            "def": skill(0.6 * zs(p36("stl") + p36("blk"), rated) + 0.4 * zs(wav("z_mpg"), rated)),
            "ath": skill(0.5 * zs(p36("oreb") + p36("blk") + p36("stl"), rated) + 0.5 * zs(p36("fta"), rated)),
        }).round().astype(int)
        out["season"] = y
        rating_rows.append(out.reset_index())
    rat = pd.concat(rating_rows, ignore_index=True).set_index(["player_id", "season"])

    # ---- calibrate team strength -> margin (pooled over seasons) -------------
    xs, ys = [], []
    for y in range(FIRST, LAST + 1):
        cy = car[car.season == y]
        for t in teams[y]:
            fid = t["fid"]
            ps = cy[cy.team_id.astype(str).str[-2:] == fid].player_id
            ovrs = sorted((rat.loc[(p, y), "ovr"] for p in ps if (p, y) in rat.index), reverse=True)[:10]
            if len(ovrs) < 6 or not t["ppg"]:
                continue
            wts = [34, 32, 30, 28, 26, 20, 14, 8, 5, 3][:len(ovrs)]
            tr = sum(o * w for o, w in zip(ovrs, wts)) / sum(wts)
            xs.append(tr - 58)
            ys.append((t["ppg"] - t["oppg"]) * 80 / league[y]["ppg"])
    k80 = float(np.polyfit(xs, ys, 1)[0])
    print(f"margin per rating point (per 80 pts): {k80:.2f}, r={np.corrcoef(xs, ys)[0,1]:.2f}", file=sys.stderr)

    # ---- players ----------------------------------------------------------------
    lastbio = bio.sort_values("season").groupby("player_id").last()
    players = []
    for pid, grp in car.groupby("player_id"):
        bi = lastbio.loc[pid] if pid in lastbio.index else None
        first = grp.sort_values("season").iloc[0]
        born = int(first.season - (first.age if pd.notna(first.age) else 24))
        ht = int(bi.player_height_inches) if bi is not None and pd.notna(bi.player_height_inches) else None
        sl = {}
        for r in grp.sort_values("season").itertuples():
            rr = rat.loc[(pid, r.season)]
            g = max(1, r.gp)
            sl[str(r.season)] = [str(r.team_id)[-2:], int(r.gp), round(r.min / g, 1), round(r.pts / g, 1),
                                 round(r.reb / g, 1), round(r.ast / g, 1), round(r.stl / g, 1), round(r.blk / g, 1),
                                 round(float(r.fg_pct or 0), 3), round(float(r.fg3_pct or 0), 3), round(float(r.ft_pct or 0), 3),
                                 int(rr.ovr), int(rr.ins), int(rr.thr), int(rr.fts), int(rr.ply), int(rr.reb), int(rr["def"]), int(rr.ath)]
        pos = positions.get(int(pid))
        if not pos:
            last = list(sl.values())[-1]
            rebr, thr = last[16], last[13]
            pos = "C" if (ht or 72) >= 77 or (rebr >= 72 and thr < 45) else "F" if (ht or 72) >= 73 or rebr >= 60 else "G"
        dy = str(bi.draft_year) if bi is not None else "Undrafted"
        players.append({
            "id": int(pid), "n": first.player_name, "pos": pos, "ht": ht, "born": born,
            "col": (bi.college if bi is not None and isinstance(bi.college, str) else "") .replace("''", "'"),
            "ctry": bi.country if bi is not None and isinstance(bi.country, str) else "",
            "dy": int(dy) if dy.isdigit() else None,
            "dr": int(bi.draft_round) if bi is not None and str(bi.draft_round).isdigit() else None,
            "dn": int(bi.draft_number) if bi is not None and str(bi.draft_number).isdigit() else None,
            "s": sl,
        })

    out = {
        "source": "sportsdataverse/wehoop-wnba-stats-data", "first": FIRST, "last": LAST, "decay": a.decay,
        "fields": ["fid", "gp", "min", "pts", "reb", "ast", "stl", "blk", "fg", "tp", "ft",
                   "ovr", "ins", "thr", "fts", "ply", "rebR", "def", "ath"],
        "marginPer80": round(k80, 3), "league": league, "teams": teams, "schedules": schedules, "playoffs": playoffs, "players": players,
    }
    a.out.write_text("// Generated by scripts/build_history.py from " + out["source"] + " - do not edit.\n"
                     "window.LEAGUE_DATA = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print(f"Wrote {a.out}: {len(players)} players, {a.out.stat().st_size // 1024} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
