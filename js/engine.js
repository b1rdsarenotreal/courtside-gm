// Courtside commissioner engine: an alternate-history WNBA that starts in any
// season from 1997 to 2026. Every team is AI-run; the commissioner controls
// the league's structure and rules. No DOM access in this file.
(function () {
  "use strict";
  const D = window.LEAGUE_DATA;
  const NP = window.NAME_POOL;
  const F = Object.fromEntries(D.fields.map((k, i) => [k, i]));
  const REAL = Object.fromEntries(D.players.map((p) => [p.id, p]));
  const LAST_REAL = D.last;

  // ---------- helpers ----------
  const rnd = Math.random;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const randn = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const round1 = (x) => Math.round(x * 10) / 10;
  const MIN_TEMPLATE = [34, 32, 30, 28, 26, 20, 14, 8, 5, 3];
  const SAVE_KEY = "courtside-commish-v2";
  const SKILLS = ["ins", "thr", "fts", "ply", "reb", "def", "ath"];

  let S = null;

  // ---------- era defaults ----------
  function eraCap(y) {
    // Estimated salary caps (the source data has no salary information).
    const pts = [[1997, 500e3], [2008, 800e3], [2019, 1.0e6], [2020, 1.3e6], [2025, 1.5e6], [2026, 7.0e6]];
    if (y >= 2026) return 7.0e6;
    for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) {
      const [y0, c0] = pts[i - 1], [y1, c1] = pts[i];
      return Math.round((c0 + ((y - y0) / (y1 - y0)) * (c1 - c0)) / 5000) * 5000;
    }
    return 7.0e6;
  }
  function eraRules(y) {
    const games = (D.league[y] || D.league[LAST_REAL]).games;
    const base = {
      games, cap: eraCap(y), capGrowth: 0.05, maxPct: 0.2, minPct: 0.04,
      rosterMin: 11, rosterMax: y >= 2026 ? 15 : 13, draftRounds: y >= 2026 ? 3 : y >= 2003 ? 3 : 4,
      lottery: true, lotteryTeams: 4, lotteryPicks: 4, expansionProtect: 6,
      playoffTeams: 8, seeding: "conference", earlyBo: 3, semisBo: 3, finalsBo: 3, tradeDeadline: 0.65,
    };
    if (y === 1997) Object.assign(base, { playoffTeams: 4, seeding: "overall", earlyBo: 1, semisBo: 1, finalsBo: 1 });
    else if (y < 2005) Object.assign(base, { playoffTeams: Math.min(8, Math.max(4, D.teams[y].length >= 12 ? 8 : 4)) });
    else if (y < 2016) Object.assign(base, { finalsBo: 5 });
    else if (y < 2025) Object.assign(base, { seeding: "overall", semisBo: 5, finalsBo: 5 });
    else Object.assign(base, { seeding: "overall", semisBo: 5, finalsBo: 7 });
    return base;
  }

  // ---------- real data access ----------
  const realLine = (pid, y) => { const r = REAL[pid]; return r && r.s[y] ? r.s[y] : null; };
  const realSeasons = (pid) => (REAL[pid] ? Object.keys(REAL[pid].s).map(Number) : []);
  function realRatings(pid, y) {
    const l = realLine(pid, y); if (!l) return null;
    return { ovr: l[F.ovr], ins: l[F.ins], thr: l[F.thr], fts: l[F.fts], ply: l[F.ply], reb: l[F.rebR], def: l[F.def], ath: l[F.ath] };
  }
  function realPeakFrom(pid, y) {
    const ss = realSeasons(pid).filter((s) => s >= y);
    return ss.length ? Math.max(...ss.map((s) => realLine(pid, s)[F.ovr])) : null;
  }
  const fidAbbr = (fid, y) => { const t = (D.teams[y] || []).find((x) => x.fid === fid); return t ? t.abbr : fid; };

  // ---------- new league ----------
  function newLeague(startYear, opts = {}) {
    const y = startYear;
    S = {
      version: 2, startYear: y, season: y, phase: "preseason", day: 0,
      opts: { realCareers: opts.realCareers !== false, followHistory: opts.followHistory !== false, realSchedule: opts.realSchedule !== false },
      rules: eraRules(y), rulesNext: null,
      conferences: [],
      teams: [], players: {}, nextPid: 9000000, nextFid: 1,
      schedule: [], boxes: {}, playoffs: null, draft: null, lastDraft: null,
      history: [], news: [], transactions: [], events: [], awards: null,
    };
    const tl = D.teams[y];
    const confs = [...new Set(tl.map((t) => t.conf).filter(Boolean))];
    S.conferences = confs.length ? confs : ["League"];
    for (const t of tl) S.teams.push(mkTeam({ fid: t.fid, abbr: t.abbr, city: t.city, name: t.name, color: t.color, conf: t.conf || S.conferences[0] }, y));

    // Players: everyone who played in season y; plus those who sat out y but played y-1 and y+1 (injured).
    for (const rp of D.players) {
      const line = rp.s[y];
      const ss = Object.keys(rp.s).map(Number);
      if (line) {
        const p = mkRealPlayer(rp, y);
        p.team = S.teams.find((t) => t.fid === line[F.fid]) ? line[F.fid] : null;
        p.c = estContract(p, true);
        if (!p.team) { p.c = { sal: 0, yrs: 0 }; p.ask = askingContract(p); }
        S.players[p.id] = p;
      } else if (rp.s[y - 1] && rp.s[y + 1]) {
        const p = mkRealPlayer(rp, y - 1);
        p.team = S.teams.find((t) => t.fid === rp.s[y - 1][F.fid]) ? rp.s[y - 1][F.fid] : null;
        if (p.team) { p.c = estContract(p, true); p.inj = 999; p.injType = "out for the season"; }
        S.players[p.id] = p;
      }
    }
    // Free-agent pool depth.
    for (let i = 0; i < 20; i++) { const p = genPlayer({ age: 24 + Math.floor(rnd() * 8), ovrMean: 44, ovrSd: 5, potRoom: 2 }); p.ask = askingContract(p); S.players[p.id] = p; }
    for (const t of S.teams) aiRosterFix(t.fid, true);
    if (S.opts.followHistory) queueHistoryEvents(y + 1);
    log(`You are the commissioner. The ${y} season is ready: ${S.teams.length} teams, ${S.rules.games} games, ${S.rules.playoffTeams} playoff spots.`);
    save();
    return S;
  }
  function mkTeam(t, y) {
    return { fid: t.fid, abbr: t.abbr, city: t.city, name: t.name, color: t.color || "#666", conf: t.conf, founded: y, active: true,
      w: 0, l: 0, hw: 0, hl: 0, pf: 0, pa: 0, streak: 0, dead: [], hist: [], titles: 0 };
  }
  function mkRealPlayer(rp, y) {
    const r = realRatings(rp.id, y);
    const peak = realPeakFrom(rp.id, y) ?? r.ovr;
    return {
      id: rp.id, name: rp.n, pos: rp.pos, ht: rp.ht, born: rp.born, school: (rp.col && rp.col !== "None" ? rp.col : rp.ctry) || "", ctry: rp.ctry,
      real: true, team: null, r: { ...r, pot: Math.max(r.ovr, peak) }, c: { sal: 0, yrs: 0 }, inj: 0, injType: null,
      stats: {}, po: {}, career: [], awards: [], draft: rp.dy ? { season: rp.dy, round: rp.dr, pick: rp.dn, real: true } : null,
    };
  }
  function genPlayer({ age, ovrMean, ovrSd, potRoom, draft }) {
    const ovr = Math.round(clamp(ovrMean + randn() * ovrSd, 32, 82));
    const pos = pick(["G", "G", "G", "F", "F", "F", "C", "G-F", "F-C"]);
    const big = pos.includes("C") ? 1 : pos === "F" || pos === "F-C" ? 0.5 : 0;
    const sk = (b) => Math.round(clamp(b + randn() * 9, 25, 95));
    const id = S.nextPid++;
    return {
      id, name: pick(NP.first) + " " + pick(NP.last), pos, ht: Math.round(70 + big * 7 + randn() * 2), born: S.season - age,
      school: pick(NP.schools), real: false, team: null,
      r: { ovr, pot: Math.round(clamp(ovr + Math.max(0, potRoom * (0.6 + 0.6 * rnd())), ovr, 95)),
        ins: sk(ovr - 4 + big * 10), thr: sk(ovr - 2 - big * 14), fts: sk(ovr - 2), ply: sk(ovr - 4 - big * 10), reb: sk(ovr - 8 + big * 22), def: sk(ovr - 2 + big * 4), ath: sk(ovr) },
      c: { sal: 0, yrs: 0 }, inj: 0, injType: null, stats: {}, po: {}, career: [], awards: [], draft: null,
    };
  }

  // ---------- accessors ----------
  const P = (id) => S.players[id];
  const T = (fid) => S.teams.find((t) => t.fid === fid);
  const activeTeams = () => S.teams.filter((t) => t.active);
  const teamName = (fid) => { const t = T(fid); return t ? `${t.city} ${t.name}` : "Free agent"; };
  const age = (p) => S.season - p.born;
  const roster = (fid) => Object.values(S.players).filter((p) => p.team === fid && !p.retired);
  const freeAgents = () => Object.values(S.players).filter((p) => !p.team && !p.retired && !p.prospect);
  const payroll = (fid) => sum(roster(fid).map((p) => p.c.sal)) + sum(T(fid).dead.filter((d) => d.season === S.season).map((d) => d.sal));
  const capSpace = (fid) => S.rules.cap - payroll(fid);
  const econ = () => ({ cap: S.rules.cap, max: S.rules.cap * S.rules.maxPct, min: S.rules.cap * S.rules.minPct });
  function log(text, fid, kind) { S.news.unshift({ season: S.season, day: S.day, phase: S.phase, text, team: fid || null, kind: kind || null }); if (S.news.length > 400) S.news.length = 400; }
  function txn(text, fid) { S.transactions.unshift({ season: S.season, phase: S.phase, text, team: fid }); if (S.transactions.length > 600) S.transactions.length = 600; }

  // ---------- valuation & contracts ----------
  function talent(p) {
    const a = age(p);
    const yf = a <= 22 ? 0.65 : a <= 24 ? 0.5 : a <= 26 ? 0.3 : a <= 27 ? 0.15 : 0;
    let t = p.r.ovr + (p.r.pot - p.r.ovr) * yf;
    if (a >= 31) t -= (a - 30) * 1.4;
    return t;
  }
  function marketSalary(p) {
    const e = econ(); const f = clamp((talent(p) - 50) / 44, 0, 1);
    return clamp(e.min + (e.max - e.min) * Math.pow(f, 2.1), e.min, e.max);
  }
  function estContract(p, initial) {
    const sal = Math.round(marketSalary(p) * (0.9 + rnd() * 0.2) / 1000) * 1000;
    const yrs = age(p) >= 31 ? 1 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 4);
    return { sal, yrs };
  }
  function askingContract(p) {
    const e = econ();
    const sal = Math.round(marketSalary(p) * (0.95 + rnd() * 0.15) / 1000) * 1000;
    const a = age(p);
    return { sal: clamp(sal, e.min, e.max), yrs: a >= 32 ? 1 : a >= 29 ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 3) };
  }
  function playerValue(p, forTeam) {
    const mode = forTeam ? teamMode(forTeam) : "neutral";
    const a = age(p);
    const t = mode === "rebuild" ? talent(p) + (a <= 24 ? 3 : 0) - (a >= 29 ? (a - 28) * 2 : 0)
      : mode === "contend" ? p.r.ovr * 0.75 + talent(p) * 0.25 : talent(p);
    let v = Math.pow(Math.max(0, t - 44), 2.2) / 12;
    v += ((marketSalary(p) - p.c.sal) / (econ().cap / 70)) * Math.min(Math.max(1, p.c.yrs), 3) * 0.8;
    if (p.inj > 10) v *= 0.8;
    return Math.max(0, v);
  }
  function teamRating(fid) {
    const rot = rotation(fid, true);
    if (!rot.length) return 40;
    return sum(rot.map((x) => P(x.id).r.ovr * x.min)) / sum(rot.map((x) => x.min));
  }
  let rankCache = null;
  function powerRanks() {
    const key = S.season + S.phase + S.day + S.teams.length + Object.keys(S.players).length;
    if (rankCache && rankCache.key === key) return rankCache.map;
    const arr = activeTeams().map((t) => { const gp = t.w + t.l; return { fid: t.fid, s: teamRating(t.fid) + (gp ? (t.w / gp - 0.5) * 30 * Math.min(1, gp / 20) : 0) }; }).sort((a, b) => b.s - a.s);
    const map = {}; arr.forEach((x, i) => (map[x.fid] = i + 1));
    rankCache = { key, map };
    return map;
  }
  function teamMode(fid) {
    const n = activeTeams().length, r = powerRanks()[fid] || n;
    return r <= Math.ceil(n / 3) ? "contend" : r > n - Math.ceil(n / 3) ? "rebuild" : "neutral";
  }

  // ---------- rotation ----------
  function rotation(fid, ignoreInj) {
    const order = roster(fid).filter((p) => ignoreInj ? p.inj < 999 : p.inj === 0).sort((a, b) => b.r.ovr - a.r.ovr);
    const n = Math.min(order.length, MIN_TEMPLATE.length);
    const mins = MIN_TEMPLATE.slice(0, n);
    const deficit = 200 - sum(mins);
    if (deficit > 0 && n) for (let i = 0; i < n; i++) mins[i] += deficit / n;
    return order.slice(0, n).map((p, i) => ({ id: p.id, min: mins[i], start: i < 5 }));
  }

  // ---------- schedule ----------
  function rrRounds(ids) {
    const arr = ids.concat(ids.length % 2 ? [null] : []);
    const m = arr.length, rounds = [];
    let a = arr.slice();
    for (let r = 0; r < m - 1; r++) {
      const g = [];
      for (let i = 0; i < m / 2; i++) { const x = a[i], y = a[m - 1 - i]; if (x && y) g.push(rnd() < 0.5 ? [x, y] : [y, x]); }
      rounds.push(g);
      a = [a[0], a[m - 1], ...a.slice(1, m - 1)];
    }
    return rounds;
  }
  // The real schedule is used when the league's teams and season length match
  // that real season exactly; otherwise a balanced schedule is generated.
  function realScheduleFor(y) {
    const rs = D.schedules && D.schedules[y];
    if (!rs || S.opts.realSchedule === false) return null;
    const fids = new Set(activeTeams().map((t) => t.fid));
    const cnt = {};
    for (const g of rs.g) { cnt[g[1]] = (cnt[g[1]] || 0) + 1; cnt[g[2]] = (cnt[g[2]] || 0) + 1; }
    const rf = Object.keys(cnt);
    if (rf.length !== fids.size || rf.some((f) => !fids.has(f))) return null;
    if (Object.values(cnt).some((c) => c !== S.rules.games)) return null;
    return rs;
  }
  function realScheduleStatus(y = S.season) {
    if (!D.schedules || !D.schedules[y]) return { ok: false, why: `There's no real schedule after ${D.last}.` };
    if (S.opts.realSchedule === false) return { ok: false, why: "Real schedules are turned off in the League office." };
    if (realScheduleFor(y)) return { ok: true };
    return { ok: false, why: `Your ${y} league doesn't match the real ${y} teams and season length, so the schedule is generated.` };
  }
  function makeSchedule() {
    const rs = realScheduleFor(S.season);
    if (rs) {
      const offs = [...new Set(rs.g.map((g) => g[0]))].sort((a, b) => a - b);
      const dayOf = Object.fromEntries(offs.map((o, i) => [o, i + 1]));
      S.schedInfo = { real: true, start: rs.start };
      return rs.g.map((g, i) => ({ gid: i + 1, day: dayOf[g[0]], off: g[0], home: g[1], away: g[2], real: [g[3], g[4]], played: false }));
    }
    S.schedInfo = { real: false };
    const ids = shuffle(activeTeams().map((t) => t.fid));
    const n = ids.length, G = S.rules.games;
    let days = [];
    const full = Math.floor(G / (n - 1));
    for (let c = 0; c < full; c++) days.push(...rrRounds(shuffle(ids.slice())));
    const extra = G - full * (n - 1);
    if (extra > 0) days.push(...shuffle(rrRounds(shuffle(ids.slice()))).slice(0, extra));
    days = shuffle(days);
    const out = []; let gid = 1;
    days.forEach((g, d) => g.forEach(([h, a]) => out.push({ gid: gid++, day: d + 1, home: h, away: a, played: false })));
    return out;
  }
  const lastDay = () => Math.max(0, ...S.schedule.map((g) => g.day));
  const tradeDeadlineDay = () => Math.round(lastDay() * S.rules.tradeDeadline);

  // ---------- game sim ----------
  function leaguePts() { return (D.league[S.season] || D.league[LAST_REAL]).ppg; }
  function simGame(h, a, opts = {}) {
    const lp = leaguePts();
    const k = Math.max(0.95, D.marginPer80) * lp / 80, home = opts.neutral ? 0 : 2.2 * lp / 87;
    const rh = rotation(h), ra = rotation(a);
    const trh = rh.length ? sum(rh.map((x) => P(x.id).r.ovr * x.min)) / 200 : 40;
    const tra = ra.length ? sum(ra.map((x) => P(x.id).r.ovr * x.min)) / 200 : 40;
    const margin = (trh - tra) * k + home, sd = 8.6 * lp / 87;
    let hs = Math.round(lp + margin / 2 + randn() * sd), as = Math.round(lp - margin / 2 + randn() * sd), ot = 0;
    while (hs === as) { ot++; hs += Math.round(lp / 9 + randn() * 3.5 + (trh - tra) * 0.15); as += Math.round(lp / 9 + randn() * 3.5); }
    const box = { gid: opts.gid, home: h, away: a, hs, as, ot, players: {} };
    box.players[h] = distributeBox(rh, hs, as, ot, lp);
    box.players[a] = distributeBox(ra, as, hs, ot, lp);
    return box;
  }
  function distributeBox(rot, pts, oppPts, ot, lp) {
    if (!rot.length) return [];
    const extra = ot * 5, sc = lp / 87;
    const ps = rot.map((x) => ({ p: P(x.id), min: x.min * (0.88 + rnd() * 0.24), start: x.start }));
    const tm = sum(ps.map((x) => x.min)); ps.forEach((x) => (x.min = (x.min * (200 + extra)) / tm));
    const lw = () => Math.exp(randn() * 0.33);
    const alloc = (total, wfn) => {
      const w = ps.map((x) => x.min * wfn(x.p) * lw()); const W = sum(w) || 1;
      const raw = w.map((v) => (v / W) * total); const out = raw.map(Math.floor);
      let rem = Math.round(total) - sum(out);
      const ord = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]);
      for (let i = 0; rem > 0 && i < ord.length; i++, rem--) out[ord[i][1]]++;
      return out;
    };
    const off = (p) => 0.45 * p.r.ins + 0.35 * p.r.thr + 0.2 * p.r.ovr;
    const ptsA = alloc(pts, (p) => Math.exp((off(p) - 55) / 26));
    const eraThree = S.season < 2010 ? 0.7 : S.season < 2018 ? 0.85 : 1;
    const lines = ps.map((x, i) => {
      const p = x.p, pt = ptsA[i];
      const f3 = clamp((0.05 + (p.r.thr - 35) * 0.009) * eraThree, 0, 0.55);
      const fft = clamp(0.13 + (p.r.ath - 50) * 0.003 + (p.r.ins - 50) * 0.002, 0.04, 0.3);
      let tpm = clamp(Math.round((pt * f3) / 3 + (rnd() - 0.5)), 0, Math.floor(pt / 3));
      let ftm = clamp(Math.round(pt * fft + (rnd() - 0.5) * 2), 0, pt - tpm * 3);
      if ((pt - tpm * 3 - ftm) % 2) ftm += ftm > 0 && rnd() < 0.5 ? -1 : 1;
      ftm = clamp(ftm, 0, pt - tpm * 3);
      const twom = Math.max(0, (pt - tpm * 3 - ftm) / 2);
      const p3 = clamp(0.25 + p.r.thr * 0.0017 + randn() * 0.06, 0.15, 0.6);
      const p2 = clamp(0.39 + p.r.ins * 0.0017 + randn() * 0.06, 0.3, 0.72);
      const pf = clamp(0.58 + p.r.fts * 0.0033, 0.5, 0.96);
      const tpa = tpm + Math.max(0, Math.round(tpm * (1 / p3 - 1) + (rnd() - 0.5) * 0.8)) + (!tpm && p.r.thr > 50 && x.min > 12 && rnd() < 0.5 ? 1 : 0);
      const twoa = Math.round(twom / p2 + (rnd() - 0.5) * 0.8);
      const fta = ftm + Math.max(0, Math.round(ftm * (1 / pf - 1) + (rnd() - 0.5) * 0.8));
      return { id: p.id, min: Math.round(x.min), start: x.start, pts: pt, tpm, tpa, fgm: twom + tpm, fga: twoa + tpa, ftm, fta, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
    });
    const fgm = sum(lines.map((l) => l.fgm));
    const rebA = alloc(clamp(Math.round((34 + (pts - oppPts) * 0.08 + randn() * 4) * (0.8 + 0.2 * sc)), 20, 52), (p) => Math.exp((p.r.reb - 50) / 27));
    const astA = alloc(Math.round(fgm * (0.58 + randn() * 0.06)), (p) => Math.exp((p.r.ply - 50) / 15));
    const stlA = alloc(clamp(Math.round(7.5 + randn() * 2.5), 1, 16), (p) => Math.exp((p.r.def + p.r.ath - 100) / 24));
    const blkA = alloc(clamp(Math.round(3.8 + randn() * 1.8), 0, 11), (p) => Math.exp((p.r.reb + p.r.def + p.r.ath - 150) / 22));
    const tovA = alloc(clamp(Math.round(14 + randn() * 3), 5, 25), (p) => Math.exp((off(p) - 55) / 30) * Math.exp((p.r.ply - 50) / 60));
    lines.forEach((l, i) => { l.reb = rebA[i]; l.ast = astA[i]; l.stl = stlA[i]; l.blk = blkA[i]; l.tov = tovA[i]; });
    return lines;
  }
  function applyBox(box, playoff) {
    for (const fid of [box.home, box.away]) for (const l of box.players[fid]) {
      const p = P(l.id), bucket = playoff ? p.po : p.stats;
      const st = (bucket[S.season] ||= { team: fid, gp: 0, gs: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 });
      st.team = fid; st.gp++; if (l.start) st.gs++;
      for (const k of ["min", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]) st[k] += l[k];
      if (p.inj === 0 && rnd() < 0.0045 * (l.min / 30)) {
        const g = Math.max(1, Math.round(-Math.log(rnd()) * 5));
        p.inj = g; p.injType = pick(["ankle sprain", "knee soreness", "hamstring strain", "back spasms", "concussion protocol", "foot soreness", "illness", "wrist sprain"]);
        if (g >= 8 && p.r.ovr >= 75) log(`${p.name} (${T(fid).abbr}) is out ~${g} games with ${p.injType}.`, fid, "injury");
      }
    }
  }
  function healDay(fids) { for (const p of Object.values(S.players)) if (p.inj > 0 && p.inj < 999 && p.team && (!fids || fids.has(p.team))) { p.inj--; if (!p.inj) p.injType = null; } }

  // ---------- season ----------
  function startSeason() {
    if (S.phase !== "preseason") return { ok: false };
    if (activeTeams().length < 2) return { ok: false, msg: "The league needs at least two teams." };
    for (const t of activeTeams()) aiRosterFix(t.fid);
    S.schedule = makeSchedule();
    S.boxes = {};
    S.phase = "regular"; S.day = 0;
    log(`The ${S.season} season tips off: ${activeTeams().length} teams, ${S.rules.games} games each.`);
    save();
    return { ok: true };
  }
  function simDays(n) {
    if (S.phase !== "regular") return;
    const end = lastDay();
    for (let i = 0; i < n && S.day < end; i++) {
      S.day++;
      for (const g of S.schedule.filter((x) => x.day === S.day && !x.played)) {
        const b = simGame(g.home, g.away, { gid: g.gid });
        g.played = true; g.hs = b.hs; g.as = b.as; g.ot = b.ot;
        S.boxes[g.gid] = b; applyBox(b, false);
        const h = T(g.home), a = T(g.away);
        h.pf += b.hs; h.pa += b.as; a.pf += b.as; a.pa += b.hs;
        if (b.hs > b.as) { h.w++; h.hw++; a.l++; h.streak = h.streak > 0 ? h.streak + 1 : 1; a.streak = a.streak < 0 ? a.streak - 1 : -1; }
        else { a.w++; h.l++; h.hl++; a.streak = a.streak > 0 ? a.streak + 1 : 1; h.streak = h.streak < 0 ? h.streak - 1 : -1; }
      }
      healDay();
      if (S.day % 4 === 0) for (const t of activeTeams()) if (roster(t.fid).filter((p) => !p.inj).length < 9) aiRosterFix(t.fid);
      if (S.day % 9 === 0 && S.day <= tradeDeadlineDay()) aiTrades(1);
    }
    if (S.day >= end) endRegularSeason();
    save();
  }
  function standings(conf) {
    return activeTeams().filter((t) => !conf || t.conf === conf).sort((a, b) => {
      const pa = a.w / Math.max(1, a.w + a.l), pb = b.w / Math.max(1, b.w + b.l);
      return pb !== pa ? pb - pa : (b.pf - b.pa) - (a.pf - a.pa);
    });
  }
  function activeConfs() { return S.conferences.filter((c) => activeTeams().some((t) => t.conf === c)); }

  // ---------- playoffs ----------
  function seedOrder(B) { let o = [1]; while (o.length < B) { const n = o.length * 2 + 1; o = o.flatMap((s) => [s, n - s]); } return o; }
  function bestOfFor(fromEnd) { const r = S.rules; return fromEnd === 0 ? r.finalsBo : fromEnd === 1 ? r.semisBo : r.earlyBo; }
  function mkBracket(label, seeds, extraRoundsAfter) {
    const n = seeds.length;
    const br = { label, seeds, rounds: [], champion: null, extra: extraRoundsAfter, R: n <= 1 ? 0 : Math.ceil(Math.log2(n)) };
    if (n === 1) { br.champion = seeds[0]; return br; }
    const B = 2 ** br.R, ord = seedOrder(B), first = [];
    for (let i = 0; i < B; i += 2) {
      const a = seeds[ord[i] - 1], b = seeds[ord[i + 1] - 1];
      first.push(mkSeries(a || b, a && b ? b : null, bestOfFor(br.R - 1 + extraRoundsAfter)));
    }
    br.rounds.push(first);
    advanceBracket(br);
    return br;
  }
  function mkSeries(hi, lo, bo) { return { hi, lo, bestOf: bo, wh: 0, wl: 0, games: [], winner: lo ? null : hi }; }
  function advanceBracket(br) {
    while (!br.champion) {
      const cur = br.rounds[br.rounds.length - 1];
      if (cur.some((s) => !s.winner)) return;
      if (cur.length === 1) { br.champion = cur[0].winner; return; }
      const next = [], r = br.rounds.length;
      for (let i = 0; i < cur.length; i += 2) {
        let a = cur[i].winner, b = cur[i + 1].winner;
        if (br.seeds.indexOf(b) < br.seeds.indexOf(a)) [a, b] = [b, a];
        next.push(mkSeries(a, b, bestOfFor(br.R - 1 - r + br.extra)));
      }
      br.rounds.push(next);
    }
  }
  function seedBrackets() {
    const r = S.rules, confs = activeConfs(), all = standings(), brackets = [];
    if (r.seeding === "conference" && confs.length > 1) {
      const per = Math.max(1, Math.round(r.playoffTeams / confs.length));
      const extra = Math.ceil(Math.log2(confs.length));
      for (const c of confs) brackets.push(mkBracket(`${c}`, standings(c).slice(0, per).map((t) => t.fid), extra));
    } else brackets.push(mkBracket("Playoffs", all.slice(0, Math.min(r.playoffTeams, all.length)).map((t) => t.fid), 0));
    return brackets;
  }
  // "If the season ended today": the bracket current standings would produce.
  function projectedPlayoffs() {
    const brackets = seedBrackets();
    return { brackets, final: null, champion: null, projected: true, qualified: brackets.flatMap((b) => b.seeds) };
  }
  function endRegularSeason() {
    const all = standings();
    S.seasonOrder = all.map((t) => t.fid);
    const brackets = seedBrackets();
    S.playoffs = { brackets, final: null, champion: null, qualified: brackets.flatMap((b) => b.seeds) };
    checkPlayoffProgress();
    S.awards = computeAwards();
    S.phase = "playoffs";
    log(`Regular season over. ${teamName(all[0].fid)} finish with the best record, ${all[0].w}-${all[0].l}.`);
  }
  function checkPlayoffProgress() {
    const po = S.playoffs;
    po.brackets.forEach(advanceBracket);
    if (po.brackets.length === 1) { if (po.brackets[0].champion) finishPlayoffs(po.brackets[0]); return; }
    if (!po.final && po.brackets.every((b) => b.champion)) {
      const champs = po.brackets.map((b) => b.champion).sort((a, b) => S.seasonOrder.indexOf(a) - S.seasonOrder.indexOf(b));
      po.final = mkBracket("Finals", champs, 0);
    }
    if (po.final) { advanceBracket(po.final); if (po.final.champion) finishPlayoffs(po.final); }
  }
  function finishPlayoffs(br) {
    const po = S.playoffs; if (po.champion) return;
    po.champion = br.champion;
    const last = br.rounds[br.rounds.length - 1][0];
    po.runnerUp = last ? (last.winner === last.hi ? last.lo : last.hi) : null;
    po.finalsMvp = finalsMvp(po.champion);
    T(po.champion).titles++;
    log(`🏆 The ${teamName(po.champion)} win the ${S.season} championship. Finals MVP: ${P(po.finalsMvp)?.name || "–"}.`, po.champion, "title");
  }
  function activeSeries() {
    const po = S.playoffs, out = [];
    for (const br of [...po.brackets, po.final].filter(Boolean)) {
      if (br.champion || !br.rounds.length) continue;
      for (const s of br.rounds[br.rounds.length - 1]) if (!s.winner) out.push(s);
    }
    return out;
  }
  function simPlayoffGame() {
    const po = S.playoffs; if (!po || po.champion) return false;
    const act = activeSeries();
    for (const s of act) {
      const g = s.games.length;
      const hiHome = s.bestOf === 1 ? true : s.bestOf === 3 ? g !== 1 : [0, 1, 4, 6].includes(g);
      const home = hiHome ? s.hi : s.lo, away = hiHome ? s.lo : s.hi;
      const b = simGame(home, away, { gid: `po${S.season}-${s.hi}-${s.lo}-${g + 1}` });
      S.boxes[b.gid] = b; applyBox(b, true);
      if ((home === s.hi) === (b.hs > b.as)) s.wh++; else s.wl++;
      s.games.push({ home, away, hs: b.hs, as: b.as, gid: b.gid });
      const need = Math.ceil(s.bestOf / 2);
      if (s.wh === need || s.wl === need) { s.winner = s.wh === need ? s.hi : s.lo; log(`${teamName(s.winner)} beat the ${teamName(s.winner === s.hi ? s.lo : s.hi)} ${Math.max(s.wh, s.wl)}-${Math.min(s.wh, s.wl)}.`, s.winner); }
    }
    healDay(new Set(act.flatMap((s) => [s.hi, s.lo])));
    checkPlayoffProgress();
    return true;
  }
  function simPlayoffs(mode) {
    if (S.phase !== "playoffs") return;
    let guard = 0;
    if (mode === "all") while (!S.playoffs.champion && guard++ < 200) simPlayoffGame();
    else if (mode === "round") {
      const before = activeSeries();
      while (!S.playoffs.champion && before.some((s) => !s.winner) && guard++ < 20) simPlayoffGame();
    } else simPlayoffGame();
    save();
  }

  // ---------- awards ----------
  function perGame(p, season = S.season, po = false) {
    const st = (po ? p.po : p.stats)[season];
    if (!st || !st.gp) return null;
    const g = st.gp;
    return { team: st.team, gp: g, gs: st.gs, min: round1(st.min / g), pts: round1(st.pts / g), reb: round1(st.reb / g), ast: round1(st.ast / g),
      stl: round1(st.stl / g), blk: round1(st.blk / g), tov: round1(st.tov / g), fg: st.fga ? st.fgm / st.fga : 0, tp: st.tpa ? st.tpm / st.tpa : 0,
      ft: st.fta ? st.ftm / st.fta : 0, ts: st.fga + st.fta ? st.pts / (2 * (st.fga + 0.44 * st.fta)) : 0 };
  }
  function awardScore(p) {
    const s = perGame(p); if (!s || s.gp < S.rules.games * 0.45) return -1;
    const t = T(s.team); const wp = t.w / Math.max(1, t.w + t.l);
    const sc = 87 / leaguePts();
    return (s.pts * sc) + 1.1 * s.reb + 1.4 * s.ast + 2 * (s.stl + s.blk) - s.tov + (s.ts - 0.54) * 40 + wp * 12;
  }
  function computeAwards() {
    const ps = Object.values(S.players).filter((p) => p.team && perGame(p));
    const by = (f) => ps.filter((p) => f(p) > -1).sort((a, b) => f(b) - f(a));
    const mvp = by(awardScore);
    const roy = by((p) => (isRookie(p) ? awardScore(p) : -1));
    const dpoy = by((p) => { const s = perGame(p); if (!s || s.gp < S.rules.games * 0.45) return -1; return 3 * (s.stl + s.blk) + 0.4 * s.reb + p.r.def * 0.12 + s.min * 0.05; });
    const a = { mvp: mvp[0]?.id, roy: roy[0]?.id, dpoy: dpoy[0]?.id, allLeague: mvp.slice(0, 5).map((p) => p.id) };
    const tag = (id, name) => { if (id) { P(id).awards.push(`${S.season} ${name}`); log(`${P(id).name} (${T(P(id).team).abbr}) wins ${S.season} ${name}.`, P(id).team, "award"); } };
    tag(a.mvp, "MVP"); tag(a.dpoy, "Defensive Player of the Year"); tag(a.roy, "Rookie of the Year");
    a.allLeague.forEach((id) => P(id).awards.push(`${S.season} All-League`));
    return a;
  }
  const isRookie = (p) => p.firstSeason === S.season || (S.season === S.startYear && p.real && Math.min(...realSeasons(p.id)) === S.season);
  function finalsMvp(fid) {
    const ps = roster(fid).filter((p) => p.po[S.season]);
    ps.sort((a, b) => { const x = a.po[S.season], y = b.po[S.season]; return (y.pts + y.reb + y.ast) - (x.pts + x.reb + x.ast); });
    return ps[0]?.id;
  }

  // ---------- history events ----------
  function queueHistoryEvents(y) {
    if (!D.teams[y] || !D.teams[y - 1]) return;
    const prev = Object.fromEntries(D.teams[y - 1].map((t) => [t.fid, t]));
    const cur = Object.fromEntries(D.teams[y].map((t) => [t.fid, t]));
    const add = (e) => { if (S.events.some((x) => x.id === `${y}-${e.type}-${e.fid}`)) return; S.events.push({ id: `${y}-${e.type}-${e.fid}`, season: y, approved: true, done: false, ...e }); };
    for (const fid in cur) if (!prev[fid]) add({ type: "expand", fid, team: cur[fid], text: `${cur[fid].city} ${cur[fid].name} join the league` });
    for (const fid in prev) if (!cur[fid]) add({ type: "fold", fid, text: `${prev[fid].city} ${prev[fid].name} fold` });
    for (const fid in cur) if (prev[fid] && (prev[fid].city !== cur[fid].city || prev[fid].name !== cur[fid].name))
      add({ type: "relocate", fid, team: cur[fid], text: `${prev[fid].city} ${prev[fid].name} become the ${cur[fid].city} ${cur[fid].name}` });
    const g0 = D.league[y - 1].games, g1 = D.league[y].games;
    if (g0 !== g1) add({ type: "games", fid: "L", games: g1, text: `Regular season changes from ${g0} to ${g1} games` });
  }
  const pendingEvents = () => S.events.filter((e) => e.season === S.season + 1 && !e.done);
  function setEventApproval(id, ok) { const e = S.events.find((x) => x.id === id); if (e) { e.approved = ok; save(); } }
  function applyHistoryEvents() {
    for (const e of pendingEvents()) {
      e.done = true;
      if (!e.approved) { log(`Commissioner vetoed: ${e.text} (${e.season}).`, null, "office"); continue; }
      const t = T(e.fid);
      if (e.type === "expand") {
        if (t && t.active) continue;
        const conf = S.conferences.includes(e.team.conf) ? e.team.conf : smallestConf();
        expandTeam({ fid: e.fid, abbr: e.team.abbr, city: e.team.city, name: e.team.name, color: e.team.color, conf }, true);
      } else if (e.type === "fold") { if (t && t.active) foldTeam(e.fid, true); }
      else if (e.type === "relocate") { if (t && t.active) relocateTeam(e.fid, { city: e.team.city, name: e.team.name, abbr: e.team.abbr, color: e.team.color }, true); }
      else if (e.type === "games") { S.rules.games = e.games; log(`The regular season is now ${e.games} games.`, null, "office"); }
    }
  }
  const smallestConf = () => S.conferences.slice().sort((a, b) => activeTeams().filter((t) => t.conf === a).length - activeTeams().filter((t) => t.conf === b).length)[0];

  // ---------- commissioner powers ----------
  const officeOpen = () => S.phase === "preseason" || S.phase === "offseason";
  function setRules(patch) {
    const r = { ...(S.phase === "regular" || S.phase === "playoffs" ? (S.rulesNext || S.rules) : S.rules), ...patch };
    const n = activeTeams().length;
    r.playoffTeams = clamp(Math.round(r.playoffTeams), 2, Math.max(2, n));
    r.games = clamp(Math.round(r.games), 4, 100);
    r.rosterMin = clamp(Math.round(r.rosterMin), 8, 20); r.rosterMax = clamp(Math.round(r.rosterMax), r.rosterMin, 20);
    r.draftRounds = clamp(Math.round(r.draftRounds), 0, 6);
    r.lotteryTeams = clamp(Math.round(r.lotteryTeams), 0, n); r.lotteryPicks = clamp(Math.round(r.lotteryPicks), 0, r.lotteryTeams);
    if (S.phase === "regular" || S.phase === "playoffs") { S.rulesNext = r; log("Rule changes approved. They take effect next season.", null, "office"); }
    else { S.rules = r; log("Rule changes are in effect.", null, "office"); }
    save();
  }
  function addConference(name) {
    name = String(name || "").trim(); if (!name || S.conferences.includes(name)) return { ok: false, msg: "Pick a new, non-empty conference name." };
    S.conferences.push(name); log(`New conference created: ${name}.`, null, "office"); save(); return { ok: true };
  }
  function renameConference(old, name) {
    name = String(name || "").trim(); if (!name || S.conferences.includes(name)) return { ok: false, msg: "That name is empty or taken." };
    S.conferences = S.conferences.map((c) => (c === old ? name : c));
    S.teams.forEach((t) => { if (t.conf === old) t.conf = name; });
    log(`The ${old} conference is renamed ${name}.`, null, "office"); save(); return { ok: true };
  }
  function removeConference(c) {
    if (S.conferences.length <= 1) return { ok: false, msg: "The league needs at least one conference." };
    S.conferences = S.conferences.filter((x) => x !== c);
    S.teams.forEach((t) => { if (t.conf === c) t.conf = smallestConf(); });
    log(`The ${c} conference is dissolved; its teams were moved.`, null, "office"); save(); return { ok: true };
  }
  function setTeamConf(fid, c) { if (!officeOpen()) return; T(fid).conf = c; log(`${teamName(fid)} move to the ${c} conference.`, fid, "office"); save(); }

  function expandTeam(info, fromHistory) {
    if (!fromHistory && !officeOpen()) return { ok: false, msg: "Expansion is only allowed in the preseason or offseason." };
    const abbr = String(info.abbr || "").trim().toUpperCase().slice(0, 3);
    if (!info.city || !info.name || abbr.length < 2) return { ok: false, msg: "Give the team a city, a nickname and a 2-3 letter abbreviation." };
    if (activeTeams().some((t) => t.abbr === abbr)) return { ok: false, msg: `${abbr} is already used by an active team.` };
    let t = info.fid && T(info.fid);
    if (t) Object.assign(t, { active: true, city: info.city, name: info.name, abbr, color: info.color || t.color, conf: info.conf, w: 0, l: 0, hw: 0, hl: 0, pf: 0, pa: 0, streak: 0, revived: S.season });
    else { t = mkTeam({ fid: info.fid || `X${S.nextFid++}`, abbr, city: info.city, name: info.name, color: info.color, conf: info.conf || smallestConf() }, S.season + (S.phase === "offseason" ? 1 : 0)); t.expansion = true; S.teams.push(t); }
    t.expansionYear = S.season + (S.phase === "offseason" ? 1 : 0);
    log(`${fromHistory ? "" : "Commissioner approves expansion: "}the ${t.city} ${t.name} join the league in ${t.expansionYear}.`, t.fid, "office");
    expansionDraft(t.fid);
    rankCache = null; save();
    return { ok: true, fid: t.fid };
  }
  function expansionDraft(fid) {
    const protectN = S.rules.expansionProtect;
    const pool = [];
    for (const t of activeTeams()) {
      if (t.fid === fid) continue;
      const ps = roster(t.fid).sort((a, b) => playerValue(b, t.fid) - playerValue(a, t.fid));
      ps.slice(protectN).forEach((p) => pool.push(p));
    }
    const target = Math.min(activeTeams().length - 1, S.rules.rosterMin);
    const taken = new Set(); const picks = [];
    pool.sort((a, b) => playerValue(b, fid) - playerValue(a, fid));
    for (const p of pool) {
      if (picks.length >= target) break;
      if (taken.has(p.team)) continue;
      taken.add(p.team); picks.push(p);
      txn(`Expansion draft: ${teamName(fid)} select ${p.name} from the ${teamName(p.team)}.`, fid);
      p.team = fid; p.acq = `Expansion draft ${S.season}`;
    }
    log(`Expansion draft: the ${teamName(fid)} take ${picks.length} players${picks[0] ? `, led by ${picks.sort((a, b) => b.r.ovr - a.r.ovr)[0].name}` : ""}.`, fid, "office");
  }
  function relocateTeam(fid, info, fromHistory) {
    if (!fromHistory && !officeOpen()) return { ok: false, msg: "Relocation is only allowed in the preseason or offseason." };
    const t = T(fid); const old = `${t.city} ${t.name}`;
    const abbr = String(info.abbr || t.abbr).trim().toUpperCase().slice(0, 3);
    if (activeTeams().some((x) => x.abbr === abbr && x.fid !== fid)) return { ok: false, msg: `${abbr} is already used.` };
    Object.assign(t, { city: info.city || t.city, name: info.name || t.name, abbr, color: info.color || t.color });
    t.renames = (t.renames || []).concat([{ season: S.season, from: old }]);
    log(`${fromHistory ? "" : "Commissioner approves: "}the ${old} become the ${t.city} ${t.name}.`, fid, "office");
    save(); return { ok: true };
  }
  function foldTeam(fid, fromHistory) {
    if (!fromHistory && !officeOpen()) return { ok: false, msg: "Teams can only fold in the preseason or offseason." };
    if (activeTeams().length <= 2) return { ok: false, msg: "The league needs at least two teams." };
    const t = T(fid); t.active = false; t.folded = S.season;
    const pool = roster(fid).sort((a, b) => b.r.ovr - a.r.ovr);
    pool.forEach((p) => (p.team = null));
    log(`${fromHistory ? "" : "Commissioner's decision: "}the ${t.city} ${t.name} fold. Their ${pool.length} players go to a dispersal draft.`, fid, "office");
    // Dispersal draft: worst teams pick first; teams pass when the player wouldn't help.
    const order = standings().reverse().map((x) => x.fid);
    let round = 0, any = true;
    while (pool.some((p) => !p.team) && any && round < 5) {
      any = false; round++;
      for (const tf of order) {
        const avail = pool.filter((p) => !p.team);
        if (!avail.length) break;
        const ros = roster(tf);
        const worst = ros.length ? Math.min(...ros.map((p) => p.r.ovr)) : 0;
        const best = avail.sort((a, b) => playerValue(b, tf) - playerValue(a, tf))[0];
        if (ros.length < S.rules.rosterMax || best.r.ovr > worst + 3) {
          if (ros.length >= S.rules.rosterMax) { const cut = ros.sort((a, b) => a.r.ovr - b.r.ovr)[0]; releaseToFA(cut, tf); }
          best.team = tf; best.acq = `Dispersal draft ${S.season}`; any = true;
          txn(`Dispersal draft: ${teamName(tf)} take ${best.name}.`, tf);
        }
      }
    }
    pool.filter((p) => !p.team).forEach((p) => { p.c = { sal: 0, yrs: 0 }; p.ask = askingContract(p); });
    rankCache = null; save(); return { ok: true };
  }
  function releaseToFA(p, fid) { p.team = null; p.c = { sal: 0, yrs: 0 }; p.ask = askingContract(p); txn(`${teamName(fid)} waive ${p.name}.`, fid); }

  // ---------- offseason ----------
  function toOffseason() {
    if (S.phase !== "playoffs" || !S.playoffs.champion) return;
    const po = S.playoffs;
    const realBest = D.teams[S.season] ? D.teams[S.season].slice().sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l))[0] : null;
    S.history.unshift({ season: S.season, champion: po.champion, champName: teamName(po.champion), runnerUp: po.runnerUp, runnerName: teamName(po.runnerUp), finalsMvp: po.finalsMvp, ...S.awards,
      best: S.seasonOrder[0], bestRec: `${T(S.seasonOrder[0]).w}-${T(S.seasonOrder[0]).l}`, teams: activeTeams().length,
      real: realBest ? { team: `${realBest.city} ${realBest.name}`, rec: `${realBest.w}-${realBest.l}` } : null });
    // team histories
    const reached = {};
    const allBr = [...po.brackets, po.final].filter(Boolean);
    for (const br of allBr) br.rounds.forEach((rd) => rd.forEach((s) => { for (const f of [s.hi, s.lo]) if (f) reached[f] = Math.max(reached[f] || 0, 1); }));
    for (const t of activeTeams()) {
      const res = t.fid === po.champion ? "Champion" : t.fid === po.runnerUp ? "Finals" : po.qualified.includes(t.fid) ? "Playoffs" : "–";
      t.hist.push({ season: S.season, name: `${t.city} ${t.name}`, abbr: t.abbr, w: t.w, l: t.l, res, conf: t.conf });
    }
    for (const p of Object.values(S.players)) { const s = perGame(p); if (s) p.career.push({ season: S.season, ...s, ovr: p.r.ovr }); }
    archiveSeason();
    S.phase = "offseason";
    if (S.opts.followHistory) queueHistoryEvents(S.season + 1);
    log(`The offseason begins. The commissioner's office is open.`, null, "office");
    save();
  }

  // Run everything between seasons: history events, draft, re-signings, free agency, development.
  function advanceToNextSeason() {
    if (S.phase !== "offseason") return { ok: false };
    if (S.opts.followHistory) applyHistoryEvents();
    runDraft();
    contractsAndFreeAgency();
    S.season++;
    if (S.rulesNext) { S.rules = S.rulesNext; S.rulesNext = null; }
    S.rules.cap = Math.round(S.rules.cap * (1 + S.rules.capGrowth) / 5000) * 5000;
    if (S.opts.followHistory && S.season === 2026 && S.rules.cap < 7e6) { S.rules.cap = 7e6; log("The 2026 CBA resets the salary cap to $7.0M.", null, "office"); }
    for (const p of Object.values(S.players)) if (p.inj) { p.inj = 0; p.injType = null; }
    develop();
    retirements();
    for (const p of freeAgents()) p.ask = askingContract(p);
    aiFreeAgency(1); aiFreeAgency(1);
    aiTrades(3);
    for (const t of activeTeams()) { Object.assign(t, { w: 0, l: 0, hw: 0, hl: 0, pf: 0, pa: 0, streak: 0 }); aiRosterFix(t.fid); t.dead = t.dead.filter((d) => d.season >= S.season); }
    S.prevBoxes = { season: S.season - 1, boxes: S.boxes };
    S.playoffs = null; S.awards = null; S.boxes = {}; S.schedule = []; S.day = 0;
    pruneSave();
    S.phase = "preseason";
    log(`Welcome to the ${S.season} preseason: ${activeTeams().length} teams, ${S.rules.games} games, ${S.rules.playoffTeams} playoff spots.`, null, "office");
    save();
    return { ok: true };
  }

  // Draft: real players whose WNBA debut is next season enter, plus generated prospects.
  function draftClass(y) {
    const out = [];
    if (y <= LAST_REAL) {
      for (const rp of D.players) {
        if (!rp.s[y] || S.players[rp.id]) continue;
        const ss = Object.keys(rp.s).map(Number); const first = Math.min(...ss);
        const p = mkRealPlayer(rp, y);
        if (first !== y) { p.ask = askingContract(p); S.players[p.id] = p; continue; } // returning veteran: free agent
        p.firstSeason = y;
        // Rookies arrive a little below their first-season level; their real arc does the rest.
        if (S.opts.realCareers) p.r.ovr = Math.max(35, p.r.ovr - 1);
        p.prospect = y; p.born = rp.born; S.players[p.id] = p;
        const viaDraft = rp.dy && rp.dy >= y - 2;
        if (viaDraft) out.push(p.id); else { p.prospect = null; p.ask = askingContract(p); }
      }
    }
    const need = Math.max(0, activeTeams().length * S.rules.draftRounds + 8 - out.length);
    for (let i = 0; i < need; i++) {
      const a = 20 + Math.floor(rnd() * 4);
      // While real draft classes exist (through 2026) generated players only fill the lower slots.
      const tier = y <= LAST_REAL ? (i < 5 ? 50 : i < 20 ? 45 : 41) : (i < 3 ? 62 : i < 10 ? 55 : i < 25 ? 48 : 43);
      const p = genPlayer({ age: a, ovrMean: tier, ovrSd: 4.5, potRoom: Math.max(3, (25 - a) * 3.5 + (i < 10 ? 5 : 0)), draft: true });
      p.prospect = y; p.firstSeason = y; S.players[p.id] = p; out.push(p.id);
    }
    return out;
  }
  function runDraft() {
    const y = S.season + 1;
    const cls = draftClass(y);
    const R = S.rules.draftRounds;
    if (!R) { finishDraftClass(cls); return; }
    const teams = activeTeams();
    const recOrder = teams.slice().sort((a, b) => (a.w / Math.max(1, a.w + a.l)) - (b.w / Math.max(1, b.w + b.l))).map((t) => t.fid);
    const newT = teams.filter((t) => t.expansionYear === y).map((t) => t.fid);
    let base = recOrder.filter((f) => !newT.includes(f));
    let order1 = base;
    if (S.rules.lottery && S.rules.lotteryTeams > 0) {
      const nonPO = base.filter((f) => !lastQualified().includes(f));
      const pool = nonPO.slice(0, S.rules.lotteryTeams).map((f, i) => ({ f, w: Math.max(1, S.rules.lotteryTeams - i) ** 1.5 }));
      const won = [];
      for (let k = 0; k < Math.min(S.rules.lotteryPicks, pool.length); k++) {
        const W = sum(pool.map((x) => x.w)); let r = rnd() * W, i = 0;
        while (r > pool[i].w) { r -= pool[i].w; i++; }
        won.push(pool.splice(i, 1)[0].f);
      }
      order1 = won.concat(base.filter((f) => !won.includes(f)));
      if (won[0]) log(`Draft lottery: the ${teamName(won[0])} win the #1 pick.`, won[0], "draft");
    }
    const slots = [];
    for (let r = 1; r <= R; r++) (newT.concat(r === 1 ? order1 : base)).forEach((f) => slots.push({ round: r, fid: f }));
    const picks = [];
    slots.forEach((s, i) => {
      const av = cls.map(P).filter((p) => p.prospect === y);
      if (!av.length) return;
      const mode = teamMode(s.fid);
      const val = (p) => (p.r.ovr * (mode === "contend" ? 0.6 : 0.45) + p.r.pot * (mode === "contend" ? 0.4 : 0.55)) + randn() * 3;
      const ch = av.map((p) => [p, val(p)]).sort((a, b) => b[1] - a[1])[0][0];
      ch.prospect = null; ch.team = s.fid; ch.draft = { season: y, round: s.round, pick: i + 1, team: s.fid };
      ch.c = rookieContract(i + 1, s.round); ch.acq = `#${i + 1} pick, ${y} draft`;
      picks.push({ pick: i + 1, round: s.round, fid: s.fid, pid: ch.id });
      if (i < 3) log(`${y} draft, pick ${i + 1}: the ${teamName(s.fid)} select ${ch.name}${ch.real ? "" : " (generated)"}.`, s.fid, "draft");
    });
    S.lastDraft = { season: y, picks };
    finishDraftClass(cls);
    // Rookies push rosters over the max; teams trim later in aiRosterFix.
  }
  const lastQualified = () => (S.playoffs ? S.playoffs.qualified : []);
  function finishDraftClass(cls) { cls.map(P).filter((p) => p.prospect).forEach((p) => { p.prospect = null; p.ask = { sal: econ().min, yrs: 1 }; if (!p.real) p.undrafted = true; }); }
  function rookieContract(pick, round) {
    const e = econ();
    if (round === 1) return { sal: Math.round((e.min * 1.9 - ((pick - 1) / 14) * e.min * 0.8) / 1000) * 1000, yrs: 4, rookie: true };
    return { sal: Math.round(e.min / 1000) * 1000, yrs: 2, rookie: true, nonGuaranteed: true };
  }
  function contractsAndFreeAgency() {
    // Contracts tick down; expiring players are re-signed or released by their (AI) team.
    for (const p of Object.values(S.players)) {
      if (!p.team || p.retired) continue;
      if (p.draft && p.draft.season === S.season + 1) continue; // just drafted
      p.c.yrs--;
      if (p.c.yrs > 0) continue;
      const fid = p.team, keep = (p.r.ovr >= 58 || (age(p) <= 25 && p.r.pot >= 65)) && age(p) <= 34 && rnd() < 0.72;
      if (keep) { const a = askingContract(p); p.c = { sal: a.sal, yrs: a.yrs }; }
      else { p.team = null; p.c = { sal: 0, yrs: 0 }; if (p.r.ovr >= 70) log(`${p.name} becomes a free agent, leaving the ${teamName(fid)}.`, fid, "fa"); }
    }
  }
  function develop() {
    const curve = (a) => a <= 21 ? 3 : a <= 22 ? 2.6 : a <= 23 ? 2.2 : a <= 24 ? 1.6 : a <= 25 ? 1 : a <= 26 ? 0.6 : a <= 27 ? 0.2 : a <= 28 ? 0 : a <= 29 ? -0.6 : a <= 30 ? -1.1 : a <= 31 ? -1.7 : a <= 32 ? -2.4 : a <= 33 ? -3 : -4;
    for (const p of Object.values(S.players)) {
      if (p.retired || p.prospect) continue;
      const old = p.r.ovr;
      const real = S.opts.realCareers && p.real ? realRatings(p.id, S.season) : null;
      if (S.opts.realCareers && p.real && !real && S.season <= LAST_REAL && realSeasons(p.id).some((x) => x > S.season) && age(p) < 33) {
        p.inj = 999; p.injType = "sitting out the season"; // she missed this season in real life
      }
      if (real) {
        // Follow the real career: that season's rating, with a little variation.
        const n = Math.round(randn() * 1.5);
        for (const k of ["ovr", ...SKILLS]) p.r[k] = clamp(real[k] + n, 25, 99);
        const peak = realPeakFrom(p.id, S.season);
        p.r.pot = Math.max(p.r.ovr, peak ?? p.r.ovr);
      } else {
        const a = age(p);
        let d = curve(a) + randn() * 2.4;
        if (a <= 26 && p.r.pot > p.r.ovr) d += (p.r.pot - p.r.ovr) * 0.1;
        p.r.ovr = Math.round(clamp(p.r.ovr + d, 30, 99));
        const dd = p.r.ovr - old;
        for (const k of SKILLS) p.r[k] = Math.round(clamp(p.r[k] + dd * (k === "ath" ? (a >= 29 ? 1.5 : 0.8) : 0.6 + rnd() * 0.8) + randn(), 20, 99));
        p.r.pot = a >= 28 ? p.r.ovr : Math.round(clamp(Math.max(p.r.ovr, p.r.pot + randn() * 2), p.r.ovr, 99));
      }
    }
  }
  function retirements() {
    for (const p of Object.values(S.players)) {
      if (p.retired || p.prospect) continue;
      const a = age(p);
      let pr = 0;
      if (p.real && S.opts.realCareers) {
        const ss = realSeasons(p.id), lastS = Math.max(...ss);
        if (S.season > lastS && lastS < LAST_REAL) pr = S.season > lastS + 1 ? 0.9 : 0.7; // retired in real life
        else if (S.season <= LAST_REAL && !realLine(p.id, S.season) && a >= 33) pr = 0.6; // stepped away in real life
        else if (S.season > LAST_REAL) pr = a >= 35 ? 0.35 + (a - 35) * 0.15 : a >= 32 && p.r.ovr < 60 ? 0.3 : 0.03;
      } else {
        if (a >= 35) pr = 0.35 + (a - 35) * 0.15; else if (a >= 32) pr = p.r.ovr < 60 ? 0.3 : 0.05;
        if (!p.team && a >= 29 && p.r.ovr < 50) pr += 0.4;
        if (p.team && p.c.yrs > 0) pr *= 0.4;
      }
      if (!p.team && p.undrafted && rnd() < 0.5) pr = 1;
      if (rnd() < pr) {
        const fid = p.team;
        p.retired = S.season; p.team = null;
        if (p.r.ovr >= 70 || p.awards.length) log(`${p.name} retires${fid ? ` from the ${teamName(fid)}` : ""}.`, fid, "retire");
      }
    }
  }
  function aiFreeAgency(intensity = 1) {
    const fas = freeAgents().sort((a, b) => talent(b) - talent(a));
    for (const t of shuffle(activeTeams().slice())) {
      let n = roster(t.fid).length;
      for (const p of fas) {
        if (p.team || n >= S.rules.rosterMax) continue;
        if (rnd() > intensity && n >= S.rules.rosterMin) break;
        const ask = p.ask || askingContract(p);
        const need = n < S.rules.rosterMin;
        const worst = roster(t.fid).sort((a, b) => a.r.ovr - b.r.ovr)[0];
        if (!need && worst && p.r.ovr < worst.r.ovr + 2) continue;
        if (ask.sal <= capSpace(t.fid) || (need && ask.sal <= econ().min * 1.3)) {
          p.team = t.fid; p.c = { sal: Math.min(ask.sal, Math.max(econ().min, capSpace(t.fid))), yrs: ask.yrs }; p.ask = null; n++;
          p.acq = `Signed ${S.season}`;
          txn(`${teamName(t.fid)} sign ${p.name} (${fmtMoney(p.c.sal)} × ${p.c.yrs}).`, t.fid);
          if (p.r.ovr >= 70) log(`${p.name} signs with the ${teamName(t.fid)}.`, t.fid, "fa");
          if (!need) break;
        }
      }
    }
  }
  function aiRosterFix(fid, initial) {
    let ps = roster(fid).sort((a, b) => a.r.ovr - b.r.ovr);
    while (ps.length > S.rules.rosterMax) { const p = ps.shift(); p.team = null; p.c = { sal: 0, yrs: 0 }; p.ask = askingContract(p); if (!initial) txn(`${teamName(fid)} waive ${p.name}.`, fid); }
    let guard = 0;
    while (roster(fid).length < S.rules.rosterMin && guard++ < 20) {
      const fa = freeAgents().sort((a, b) => b.r.ovr - a.r.ovr)[0];
      if (!fa) { const g = genPlayer({ age: 24, ovrMean: 42, ovrSd: 4, potRoom: 2 }); S.players[g.id] = g; continue; }
      const sal = Math.max(econ().min, Math.min(fa.ask?.sal || econ().min, capSpace(fid)));
      fa.team = fid; fa.c = { sal: Math.round(sal / 1000) * 1000, yrs: 1 }; fa.ask = null;
      if (!initial) txn(`${teamName(fid)} sign ${fa.name}.`, fid);
    }
  }
  // AI-to-AI trades: contenders buy current production from rebuilders who want youth.
  function aiTrades(n) {
    const ts = activeTeams();
    for (let k = 0; k < n * 6 && n > 0; k++) {
      const c = pick(ts.filter((t) => teamMode(t.fid) === "contend")), r = pick(ts.filter((t) => teamMode(t.fid) === "rebuild"));
      if (!c || !r) return;
      const vet = roster(r.fid).filter((p) => age(p) >= 27 && p.r.ovr >= 62 && p.inj < 999).sort((a, b) => b.r.ovr - a.r.ovr)[0];
      if (!vet) continue;
      const young = roster(c.fid).filter((p) => age(p) <= 25 && p.id !== vet.id).sort((a, b) => playerValue(b, r.fid) - playerValue(a, r.fid));
      for (const y of young.slice(0, 4)) {
        const cGain = playerValue(vet, c.fid) - playerValue(y, c.fid), rGain = playerValue(y, r.fid) - playerValue(vet, r.fid);
        const cAfter = payroll(c.fid) - y.c.sal + vet.c.sal, rAfter = payroll(r.fid) - vet.c.sal + y.c.sal;
        if (cGain > 2 && rGain > -1 && cAfter <= S.rules.cap * 1.0001 && rAfter <= S.rules.cap * 1.0001) {
          vet.team = c.fid; y.team = r.fid; vet.acq = `Traded from ${r.abbr} ${S.season}`; y.acq = `Traded from ${c.abbr} ${S.season}`;
          const text = `Trade: the ${teamName(c.fid)} acquire ${vet.name} from the ${teamName(r.fid)} for ${y.name}.`;
          txn(text, c.fid); if (vet.r.ovr >= 70) log(text, c.fid, "trade");
          n--; break;
        }
      }
    }
  }

  // ---------- persistence ----------
  function pruneSave() {
    // Keep saves small: forget generated players who retired without a notable career.
    for (const p of Object.values(S.players)) {
      if (!p.real && p.retired && !p.awards.length && Math.max(0, ...p.career.map((c) => c.ovr || 0)) < 62) delete S.players[p.id];
      else if (!p.team && !p.real && p.undrafted && p.retired) delete S.players[p.id];
    }
    for (const p of Object.values(S.players)) { if (p.retired) { p.stats = {}; p.po = {}; } }
  }
  // Saves live in IndexedDB (hundreds of MB available) with localStorage as a
  // fallback. The in-memory state is authoritative; writes are debounced.
  const KV = {
    db: null,
    open() {
      return new Promise((res) => {
        try {
          if (typeof indexedDB === "undefined") return res(false);
          const r = indexedDB.open("courtside", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("kv");
          r.onsuccess = () => { this.db = r.result; res(true); };
          r.onerror = r.onblocked = () => res(false);
        } catch (e) { res(false); }
      });
    },
    get(k) {
      return new Promise((res) => {
        if (!this.db) return res(undefined);
        try { const q = this.db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); }
      });
    },
    set(k, v) {
      return new Promise((res) => {
        if (!this.db) return res(false);
        try { const tx = this.db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res(false); } catch (e) { res(false); }
      });
    },
    del(k) { return new Promise((res) => { if (!this.db) return res(false); try { const tx = this.db.transaction("kv", "readwrite"); tx.objectStore("kv").delete(k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } }); },
  };
  let saveError = null, saveTimer = null;
  function lsSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); saveError = null; }
    catch (e) { saveError = "Couldn't save in this browser (storage full or blocked). Use Copy save code to keep your league."; }
  }
  function save() {
    if (!S) return;
    if (!KV.db) return lsSave();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      KV.set("league", S).then((ok) => { saveError = ok ? null : "Couldn't save in this browser. Use Copy save code to keep your league."; if (!ok) lsSave(); });
    }, 250);
  }
  function load() { try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return null; S = JSON.parse(raw); rankCache = null; return S; } catch (e) { return null; } }
  // Async start-up: open IndexedDB, migrate any old localStorage save, load the league.
  async function init() {
    const ok = await KV.open();
    // Old GM-mode save from earlier versions: no longer used, free its space.
    try { localStorage.removeItem("wnba-gm-save-v1"); } catch (e) {}
    if (!ok) return load();
    let st = await KV.get("league");
    if (!st) {
      try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { st = JSON.parse(raw); await KV.set("league", st); } } catch (e) {}
    }
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    if (st) { S = st; rankCache = null; }
    return S;
  }
  // Write any pending save immediately (used when the page is hidden or closed).
  function flush() { if (!saveTimer || !S) return; clearTimeout(saveTimer); saveTimer = null; if (KV.db) KV.set("league", S); else lsSave(); }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    window.addEventListener && window.addEventListener("pagehide", flush);
  }
  function importState(o) { S = o; rankCache = null; save(); }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} KV.del("league"); S = null; rankCache = null; }
  const getKV = (k) => KV.get(k), setKV = (k, v) => KV.set(k, v), hasDB = () => !!KV.db;
  function fmtMoney(x) { return Math.abs(x) >= 1e6 ? "$" + (x / 1e6).toFixed(2) + "M" : "$" + Math.round(x / 1000) + "K"; }

  // Preview a starting season for the new-league screen.
  function previewSeason(y) {
    const tl = D.teams[y] || [];
    return tl.map((t) => {
      const ps = D.players.filter((p) => p.s[y] && p.s[y][F.fid] === t.fid).map((p) => ({ name: p.n, ovr: p.s[y][F.ovr] })).sort((a, b) => b.ovr - a.ovr);
      return { ...t, top: ps.slice(0, 3), n: ps.length };
    }).sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l));
  }

  // ---------- schedule archive ----------
  // Every season's results are kept compactly; full box scores only for the
  // current and previous season (they're large).
  function playoffSummary(po) {
    if (!po) return [];
    const out = [];
    for (const br of [...po.brackets, po.final].filter(Boolean)) {
      const R = br.rounds.length;
      br.rounds.forEach((rd, ri) => rd.forEach((s) => {
        if (!s.lo) return;
        const fromEnd = R - 1 - ri + (br.extra || 0);
        const label = br.label === "Finals" || (fromEnd === 0 && br.label === "Playoffs") ? "Finals"
          : fromEnd === 1 ? (br.label === "Playoffs" ? "Semifinals" : `${br.label} final`)
          : br.label === "Playoffs" ? `Round ${ri + 1}` : `${br.label} round ${ri + 1}`;
        out.push({ label, hi: s.hi, lo: s.lo, wh: s.wh, wl: s.wl, winner: s.winner, bestOf: s.bestOf, seedHi: br.seeds.indexOf(s.hi) + 1, seedLo: br.seeds.indexOf(s.lo) + 1,
          games: s.games.map((g) => [g.gid, g.home, g.away, g.hs, g.as]) });
      }));
    }
    return out;
  }
  function teamSnapshot() {
    return Object.fromEntries(S.teams.map((t) => [t.fid, { abbr: t.abbr, city: t.city, name: t.name, color: t.color }]));
  }
  function archiveSeason() {
    S.archive = S.archive || {};
    S.archive[S.season] = {
      teams: teamSnapshot(),
      games: S.schedule.filter((g) => g.played).map((g) => [g.gid, g.day, g.home, g.away, g.hs, g.as, g.ot || 0, g.off ?? null, g.real ? g.real[0] : null, g.real ? g.real[1] : null]),
      info: S.schedInfo || { real: false },
      playoffs: playoffSummary(S.playoffs),
      bracket: S.playoffs ? { brackets: S.playoffs.brackets, final: S.playoffs.final, champion: S.playoffs.champion } : null,
    };
  }
  // The bracket for any season: live, projected (before the playoffs), or archived.
  function seasonBracket(y) {
    if (y === S.season && S.phase !== "offseason") {
      if (S.playoffs) return { po: S.playoffs, teams: teamSnapshot(), live: true };
      if (S.phase === "regular" || S.phase === "preseason") return { po: projectedPlayoffs(), teams: teamSnapshot(), live: true };
    }
    const a = (S.archive || {})[y];
    return a && a.bracket ? { po: a.bracket, teams: a.teams, live: false } : null;
  }
  const bracketSeasons = () => {
    const ys = Object.keys(S.archive || {}).map(Number).filter((y) => S.archive[y].bracket);
    if (S.phase !== "offseason" && !ys.includes(S.season)) ys.push(S.season);
    return ys.sort((a, b) => b - a);
  };
  // Unified view of any season's games for the UI.
  function seasonGames(y) {
    if (y === S.season && S.phase !== "offseason") {
      return { season: y, live: true, teams: teamSnapshot(), boxes: S.boxes,
        info: S.schedInfo || { real: false },
        games: S.schedule.map((g) => ({ gid: g.gid, day: g.day, off: g.off, real: g.real, home: g.home, away: g.away, hs: g.hs, as: g.as, ot: g.ot || 0, played: g.played })),
        playoffs: playoffSummary(S.playoffs) };
    }
    const a = (S.archive || {})[y]; if (!a) return null;
    const boxes = y === S.season ? S.boxes : S.prevBoxes && S.prevBoxes.season === y ? S.prevBoxes.boxes : {};
    return { season: y, live: false, teams: a.teams, boxes,
      info: a.info || { real: false },
      games: a.games.map(([gid, day, home, away, hs, as, ot, off, rh, ra]) => ({ gid, day, home, away, hs, as, ot, off: off ?? undefined, real: rh != null ? [rh, ra] : null, played: true })), playoffs: a.playoffs };
  }
  const archivedSeasons = () => {
    const ys = Object.keys(S.archive || {}).map(Number);
    if (!ys.includes(S.season) && S.phase !== "offseason" && S.schedule.length) ys.push(S.season);
    return ys.sort((a, b) => b - a);
  };

  window.GM = {
    seasonGames, archivedSeasons, seasonBracket, bracketSeasons, init, getKV, setKV, hasDB, realScheduleStatus, flush,
    get S() { return S; }, data: D, F, get saveError() { return saveError; },
    newLeague, load, save, importState, clearSave, previewSeason, eraRules,
    P, T, activeTeams, teamName, roster, freeAgents, payroll, capSpace, econ, age, teamRating, powerRanks, teamMode, rotation,
    startSeason, simDays, lastDay, tradeDeadlineDay, standings, activeConfs, simPlayoffs, toOffseason, advanceToNextSeason,
    pendingEvents, setEventApproval, officeOpen, setRules, addConference, renameConference, removeConference, setTeamConf,
    expandTeam, relocateTeam, foldTeam, perGame, fmtMoney, realLine, realSeasons, fidAbbr,
  };
})();
