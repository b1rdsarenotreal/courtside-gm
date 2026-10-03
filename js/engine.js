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
    updateGenCap();
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
    const p = {
      id, name: pick(NP.first) + " " + pick(NP.last), pos, ht: Math.round(70 + big * 7 + randn() * 2), born: S.season - age,
      school: pick(NP.schools), real: false, team: null,
      r: { ovr, pot: Math.round(clamp(ovr + Math.max(0, potRoom * (0.6 + 0.6 * rnd())), ovr, 95)),
        ins: sk(ovr - 4 + big * 10), thr: sk(ovr - 2 - big * 14), fts: sk(ovr - 2), ply: sk(ovr - 4 - big * 10), reb: sk(ovr - 8 + big * 22), def: sk(ovr - 2 + big * 4), ath: sk(ovr) },
      c: { sal: 0, yrs: 0 }, inj: 0, injType: null, stats: {}, po: {}, career: [], awards: [], draft: null,
    };
    capGen(p);
    return p;
  }

  // Generated players are filler. While real players make up the league they never rate
  // above the bottom third of real rostered players (S.genCap). Once the real players
  // have all but retired (well after 2026) the cap lifts slowly so the league can go on.
  const realRostered = () => Object.values(S.players).filter((p) => p.real && p.team && !p.retired);
  function updateGenCap() {
    const o = realRostered().map((p) => p.r.ovr).sort((a, b) => a - b);
    const prev = S.genCap;
    if (o.length >= 60) {
      const c = o[Math.floor(o.length * 0.3)];
      S.genCap = S.season > LAST_REAL && prev != null ? Math.max(prev, c) : c; // after the real era it never sinks
    } else if (prev != null) S.genCap = o.length < 15 ? null : Math.min(99, prev + 2);
    else if (S.season <= LAST_REAL) S.genCap = 52;
  }
  const genCapOn = () => S.genCap != null;
  function capGen(p) {
    const cap = S.genCap;
    if (p.real || cap == null) return;
    const cut = p.r.ovr - cap;
    if (cut > 0) { p.r.ovr = cap; for (const k of SKILLS) p.r[k] = Math.max(20, p.r[k] - cut); }
    p.r.pot = Math.min(p.r.pot, cap);
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
  // Transactions are stored as structured entries (type, teams, players with a
  // snapshot of rating/age) so the Transactions page can draw them as cards.
  // Last team a player belonged to (for free-agent signings): tracked by the
  // sim, or for real players who start the league unsigned, their last real team.
  function prevTeam(p) {
    if (p.lastTeam) return p.lastTeam;
    if (!p.real) return null;
    const ys = realSeasons(p.id).filter((y) => y < S.season).sort((a, b) => b - a);
    for (const y of ys) { const f = realLine(p.id, y)[F.fid]; if (T(f)) return f; }
    return null;
  }
  const pSnap = (p) => ({ id: p.id, n: p.name, o: p.r.ovr, a: age(p), pos: p.pos, c: p.c && p.c.sal ? { sal: p.c.sal, yrs: p.c.yrs } : null });
  const tSnap = (fid) => { const t = T(fid); return t ? { abbr: t.abbr, name: `${t.city} ${t.name}`, color: t.color } : null; };
  function txn(text, fid, d = {}) {
    const inv = [...new Set([fid, ...(d.involved || [])].filter(Boolean))];
    const tm = {}; for (const f of inv) tm[f] = tSnap(f);
    const { involved, ...rest } = d;
    S.transactions.unshift({ season: S.season, phase: S.phase, day: S.day, text, team: fid, involved: inv, tm, ...rest });
    if (S.transactions.length > 1500) S.transactions.length = 1500;
  }

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
  // Positions: which lineup slots a player can fill.
  const canG = (p) => /^G|-G$/.test(p.pos);                 // G, G-F, F-G
  const canF = (p) => p.pos.includes("F");                  // F, G-F, F-G, F-C, C-F
  const canC = (p) => p.pos.includes("C");                  // C, C-F, F-C
  // Starting five by position: a center (or a big forward), two guards, two forwards,
  // best available in each slot. One small-ball/big swap is allowed when a bench
  // player is clearly better (7+ OVR) than the weakest starter.
  function startingFive(pool) {
    const left = pool.slice(), five = [];
    const take = (ok) => { const i = left.findIndex(ok); if (i < 0) return false; five.push(left.splice(i, 1)[0]); return true; };
    take(canC) || take((p) => p.pos === "F") || take(canF) || take(() => true);
    for (let k = 0; k < 2; k++) take(canG) || take(() => true);
    for (let k = 0; k < 2; k++) take(canF) || take(canC) || take(() => true);
    if (five.length === 5 && left.length) {
      const w = five.slice().sort((a, b) => a.r.ovr - b.r.ovr)[0];
      if (left[0].r.ovr >= w.r.ovr + 7) { five[five.indexOf(w)] = left[0]; left.splice(0, 1, w); }
    }
    return { five, bench: left.sort((a, b) => b.r.ovr - a.r.ovr) };
  }
  function rotation(fid, ignoreInj) {
    const healthy = roster(fid).filter((p) => ignoreInj ? p.inj < 999 : p.inj === 0).sort((a, b) => b.r.ovr - a.r.ovr);
    const sf = startingFive(healthy);
    const order = sf.five.sort((a, b) => b.r.ovr - a.r.ovr).concat(sf.bench);
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
  // ---------- possession-by-possession game engine ----------
  // Each game is played possession by possession: lineups and substitutions
  // follow each team's minutes plan (with foul trouble and garbage time),
  // shots are chosen by player tendencies, and makes depend on the shooter,
  // the five defenders and overall team strength. Scoring is calibrated so the
  // league average tracks each real season's points per game.
  const QK = 0.0035;          // efficiency gained per point of team-rating edge
  const HOME = 0.012;         // home-court efficiency bump
  const ERA3 = () => (S.season < 2006 ? 0.72 : S.season < 2012 ? 0.8 : S.season < 2018 ? 0.88 : 1);
  function calib() {
    S.cal = S.cal || { m: 0.92, avg: null };
    if (S.cal.avg == null) S.cal.avg = leaguePts();
    return S.cal;
  }
  const offScore = (p) => 0.45 * p.r.ins + 0.35 * p.r.thr + 0.2 * p.r.ovr;
  function pickW(arr, wf) {
    let tot = 0; const w = arr.map((x) => { const v = Math.max(1e-6, wf(x)); tot += v; return v; });
    let r = rnd() * tot;
    for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  const avgR = (ps, k) => (ps.length ? sum(ps.map((p) => p.r[k])) / ps.length : 50);

  function simGame(h, a, opts = {}) {
    const lp = leaguePts(), cal = calib();
    const pace = 70 + (lp - 69) * 0.8; // possessions per team per 40 minutes
    const mk = (fid) => {
      const rot = rotation(fid);
      const avail = roster(fid).filter((p) => p.inj === 0);
      const target = new Map(avail.map((p) => [p.id, 0]));
      rot.forEach((x) => target.set(x.id, x.min * 60));
      const tr = rot.length ? sum(rot.map((x) => P(x.id).r.ovr * x.min)) / 200 : 40;
      return { fid, avail, target, tr, starters: rot.slice(0, 5).map((x) => x.id), on: [], lines: new Map(), pts: 0, q: [], tf: 0, sinceSub: 0, lead: 0, bench: 0 };
    };
    const T2 = [mk(h), mk(a)];
    const qual = [1 + QK * (T2[0].tr - T2[1].tr) + (opts.neutral ? 0 : HOME), 1 + QK * (T2[1].tr - T2[0].tr) - (opts.neutral ? 0 : HOME)];
    const L = (t, p) => {
      let l = t.lines.get(p.id);
      if (!l) { l = { id: p.id, sec: 0, start: false, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 }; t.lines.set(p.id, l); }
      return l;
    };
    let elapsed = 0, period = 0, leadChanges = 0, ties = 0, lastLeader = 0;
    const fouledOut = (t, p) => (t.lines.get(p.id)?.pf || 0) >= 6;
    function lineup(t, mode) {
      let elig = t.avail.filter((p) => !fouledOut(t, p));
      if (!elig.length) elig = t.avail.slice();
      let five;
      if (mode === "starters") five = t.starters.map(P).filter((p) => elig.includes(p));
      else if (mode === "garbage") five = elig.slice().sort((x, y) => t.target.get(x.id) - t.target.get(y.id) || x.r.ovr - y.r.ovr).slice(0, 5);
      else {
        const horizon = elapsed + 240, full = Math.max(2400, elapsed + 1);
        const need = (p) => {
          const tg = t.target.get(p.id) || 0, played = t.lines.get(p.id)?.sec || 0;
          let n = (tg / 2400) * Math.min(horizon, full + 300) - played;
          const pf = t.lines.get(p.id)?.pf || 0;
          if (period < 3 && pf >= period + 2) n -= 600; // foul trouble: sit
          if (tg === 0) n -= 900;
          return n;
        };
        five = elig.slice().sort((x, y) => need(y) - need(x)).slice(0, 5);
      }
      for (const p of elig) if (five.length < 5 && !five.includes(p)) five.push(p);
      t.on = five; t.sinceSub = 0;
      for (const p of five) L(t, p);
    }
    function score(oi, shooter, n) {
      const o = T2[oi], d = T2[1 - oi];
      o.pts += n; o.q[period] = (o.q[period] || 0) + n;
      L(o, shooter).pts += n;
      if (!o.starters.includes(shooter.id)) o.bench += n;
      for (const p of o.on) L(o, p).pm += n;
      for (const p of d.on) L(d, p).pm -= n;
      const diff = T2[0].pts - T2[1].pts, leader = Math.sign(diff);
      if (leader !== lastLeader) { if (leader === 0) ties++; else if (lastLeader !== 0) leadChanges++; lastLeader = leader || lastLeader; if (leader !== 0) lastLeader = leader; }
      T2[0].lead = Math.max(T2[0].lead, diff); T2[1].lead = Math.max(T2[1].lead, -diff);
    }
    function freeThrows(oi, shooter, n) {
      const o = T2[oi];
      const pct = clamp(0.58 + shooter.r.fts * 0.0033, 0.45, 0.95);
      let lastMade = true;
      for (let i = 0; i < n; i++) { L(o, shooter).fta++; lastMade = rnd() < pct; if (lastMade) { L(o, shooter).ftm++; score(oi, shooter, 1); } }
      return lastMade;
    }
    function rebound(oi, offRate) {
      const o = T2[oi], d = T2[1 - oi];
      const rate = clamp(offRate + (avgR(o.on, "reb") - avgR(d.on, "reb")) * 0.004, 0.08, 0.45);
      if (rnd() < rate) { const r = pickW(o.on, (p) => Math.exp((p.r.reb - 50) / 24)); L(o, r).oreb++; return true; }
      const r = pickW(d.on, (p) => Math.exp((p.r.reb - 50) / 24)); L(d, r).dreb++; return false;
    }
    function personalFoul(t, p) {
      L(t, p).pf++; t.tf++;
      if (fouledOut(t, p)) t.mustSub = true;
    }
    function possession(oi, heave) {
      const o = T2[oi], d = T2[1 - oi];
      const q = qual[oi] * cal.m;
      const defAdj = (avgR(d.on, "def") - 55) * 0.0016;
      const usage = (p) => Math.exp((offScore(p) - 55) / 30);
      for (let tries = 0; tries < 5; tries++) {
        // Turnover
        const tovP = clamp(0.155 * (1 - (avgR(o.on, "ply") - 55) * 0.007) * (tries ? 0.55 : 1) / Math.sqrt(qual[oi]), 0.06, 0.3);
        if (!heave && rnd() < tovP) {
          const hnd = pickW(o.on, (p) => usage(p) * Math.exp((p.r.ply - 50) / 40));
          L(o, hnd).tov++;
          if (rnd() < 0.53) L(d, pickW(d.on, (p) => Math.exp((p.r.def + p.r.ath - 100) / 18))).stl++;
          return;
        }
        // Non-shooting foul on the defense
        if (!heave && rnd() < 0.1) {
          personalFoul(d, pickW(d.on, (p) => Math.exp((55 - p.r.def) / 30) * (p.pos.includes("C") ? 1.3 : 1)));
          if (d.tf >= 5) { freeThrows(oi, pickW(o.on, usage), 2); return; }
          continue;
        }
        const sh = pickW(o.on, usage);
        const three = Math.max(0.01, Math.min(0.65, (0.06 + (sh.r.thr - 40) * 0.011) * ERA3()));
        const rimShare = clamp(0.5 + (sh.r.ins - 50) * 0.006 + (sh.r.ath - 50) * 0.004 - (sh.r.thr - 50) * 0.003, 0.2, 0.85);
        const type = heave ? (rnd() < 0.5 ? "3" : "mid") : rnd() < three ? "3" : rnd() < rimShare ? "rim" : "mid";
        let base = type === "rim" ? 0.52 + (sh.r.ins - 50) * 0.0045 + (sh.r.ath - 50) * 0.0012
          : type === "mid" ? 0.345 + (sh.r.ins - 50) * 0.002 + (sh.r.fts - 50) * 0.0012
          : 0.322 + (sh.r.thr - 50) * 0.0028;
        let pMake = clamp((base - defAdj) * q * (heave ? 0.55 : 1), 0.04, 0.88);
        const fouled = !heave && rnd() < (type === "rim" ? 0.2 : type === "mid" ? 0.075 : 0.025);
        const val = type === "3" ? 3 : 2;
        if (fouled) {
          personalFoul(d, pickW(d.on, (p) => Math.exp((55 - p.r.def) / 30) * (p.pos.includes("C") || p.pos.includes("F") ? 1.25 : 1)));
          if (rnd() < pMake * 0.42) {
            const l = L(o, sh); l.fga++; l.fgm++; if (val === 3) { l.tpa++; l.tpm++; }
            score(oi, sh, val);
            if (rnd() < 0.62) { const others = o.on.filter((p) => p !== sh); if (others.length) L(o, pickW(others, (p) => Math.exp((p.r.ply - 50) / 12))).ast++; }
            freeThrows(oi, sh, 1);
            return;
          }
          const made = freeThrows(oi, sh, val);
          if (!made && rebound(oi, 0.14)) continue;
          return;
        }
        const l = L(o, sh); l.fga++; if (val === 3) l.tpa++;
        if (rnd() < pMake) {
          l.fgm++; if (val === 3) l.tpm++;
          score(oi, sh, val);
          const astP = type === "3" ? 0.82 : type === "rim" ? 0.52 : 0.5;
          if (rnd() < astP) { const others = o.on.filter((p) => p !== sh); if (others.length) L(o, pickW(others, (p) => Math.exp((p.r.ply - 50) / 11))).ast++; }
          return;
        }
        if (type !== "3" && rnd() < (type === "rim" ? 0.2 : 0.08) * Math.exp((avgR(d.on, "def") - 55) / 40))
          L(d, pickW(d.on, (p) => Math.exp((p.r.reb + p.r.def + p.r.ath - 150) / 16))).blk++;
        if (heave) return;
        if (!rebound(oi, type === "3" ? 0.25 : 0.28)) return;
      }
    }
    // Play the game
    let off = rnd() < 0.5 ? 0 : 1;
    const avgPoss = 2400 / (2 * pace);
    for (period = 0; ; period++) {
      const len = period < 4 ? 600 : 300;
      if (period >= 4 && T2[0].pts !== T2[1].pts) break;
      for (const t of T2) { t.tf = 0; t.q[period] = 0; }
      for (const t of T2) lineup(t, period === 0 || period === 2 ? "starters" : "need");
      let clock = len;
      while (clock > 0) {
        const margin = Math.abs(T2[0].pts - T2[1].pts);
        const garbage = period === 3 && clock < 300 && margin >= 22;
        for (const t of T2) if (t.mustSub || t.sinceSub >= 100 || (garbage && !t.garbage)) { t.mustSub = false; t.garbage = garbage; lineup(t, garbage ? "garbage" : "need"); }
        let dur = clamp(avgPoss * (0.45 + rnd() * 1.1), 4, 24);
        const heave = dur >= clock;
        if (heave) dur = clock;
        for (const t of T2) { for (const p of t.on) L(t, p).sec += dur; t.sinceSub += dur; }
        elapsed += dur; clock -= dur;
        possession(off, heave && rnd() < 0.6);
        off = 1 - off;
      }
      if (period >= 3 && T2[0].pts !== T2[1].pts) break;
      if (period > 12) { T2[0].pts++; T2[0].q[period]++; break; }
    }
    for (const t of T2) for (const id of t.starters) if (t.lines.has(id)) t.lines.get(id).start = true;
    // Calibrate league scoring toward the real era average.
    cal.avg = cal.avg * 0.985 + ((T2[0].pts + T2[1].pts) / 2) * 0.015;
    cal.m = clamp(cal.m * Math.pow(lp / cal.avg, 0.04), 0.75, 1.35);
    const out = (t) => [...t.lines.values()].filter((l) => l.sec > 0).sort((x, y) => (y.start - x.start) || (y.sec - x.sec)).map((l) => ({
      id: l.id, start: l.start, min: Math.round(l.sec / 60), pts: l.pts, fgm: l.fgm, fga: l.fga, tpm: l.tpm, tpa: l.tpa, ftm: l.ftm, fta: l.fta,
      oreb: l.oreb, dreb: l.dreb, reb: l.oreb + l.dreb, ast: l.ast, stl: l.stl, blk: l.blk, tov: l.tov, pf: l.pf, pm: l.pm }));
    const ot = Math.max(0, period - 3);
    const box = { gid: opts.gid, home: h, away: a, hs: T2[0].pts, as: T2[1].pts, ot, players: {}, q: { [h]: T2[0].q, [a]: T2[1].q },
      extra: { lead: { [h]: T2[0].lead, [a]: T2[1].lead }, bench: { [h]: T2[0].bench, [a]: T2[1].bench }, leadChanges, ties } };
    box.players[h] = out(T2[0]); box.players[a] = out(T2[1]);
    return box;
  }
  function applyBox(box, playoff) {
    for (const fid of [box.home, box.away]) for (const l of box.players[fid]) {
      const p = P(l.id), bucket = playoff ? p.po : p.stats;
      const st = (bucket[S.season] ||= { team: fid, gp: 0, gs: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, pf: 0, pm: 0 });
      st.team = fid; st.gp++; if (l.start) st.gs++;
      for (const k of ["min", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "pf", "pm"]) st[k] = (st[k] || 0) + (l[k] || 0);
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
        S.boxes[g.gid] = b; applyBox(b, false); trackRecords(b, false);
        const h = T(g.home), a = T(g.away);
        h.pf += b.hs; h.pa += b.as; a.pf += b.as; a.pa += b.hs;
        if (b.hs > b.as) { h.w++; h.hw++; a.l++; h.streak = h.streak > 0 ? h.streak + 1 : 1; a.streak = a.streak < 0 ? a.streak - 1 : -1; }
        else { a.w++; h.l++; h.hl++; a.streak = a.streak > 0 ? a.streak + 1 : 1; h.streak = h.streak < 0 ? h.streak - 1 : -1; }
        h.maxStreak = Math.max(h.maxStreak || 0, h.streak); a.maxStreak = Math.max(a.maxStreak || 0, a.streak);
      }
      healDay();
      if (S.day % 4 === 0) for (const t of activeTeams()) if (roster(t.fid).filter((p) => !p.inj).length < 9) aiRosterFix(t.fid);
      if (S.day % 9 === 0 && S.day <= tradeDeadlineDay()) aiTrades(1);
    }
    if (S.day >= end) endRegularSeason();
    save();
  }
  // Standings with WNBA-style tiebreakers. Teams tied on winning percentage are
  // separated, as a group, by: (1) head-to-head record among the tied teams,
  // (2) record against teams at .500 or better, (3) point differential,
  // (4) a coin flip. When a step separates some teams, any still tied start over
  // at step 1 among themselves, as multi-team ties work in the real league.
  const pct = (w, l) => (w + l ? w / (w + l) : 0);
  function h2hTable() {
    const h = {};
    for (const g of S.schedule) {
      if (!g.played) continue;
      const [win, lose] = g.hs > g.as ? [g.home, g.away] : [g.away, g.home];
      ((h[win] ||= {})[lose] ||= [0, 0])[0]++;
      ((h[lose] ||= {})[win] ||= [0, 0])[1]++;
    }
    return h;
  }
  function coin(fid) { let x = 0; const s = `${S.season}:${fid}`; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
  function breakTies(group, ctx, depth = 0) {
    if (group.length < 2) return group;
    const steps = [
      ["head-to-head", (t) => { let w = 0, l = 0; for (const o of group) if (o !== t) { const r = ctx.h2h[t.fid]?.[o.fid]; if (r) { w += r[0]; l += r[1]; } } return w + l ? pct(w, l) : 0.5; }],
      ["record vs .500+ teams", (t) => { const r = ctx.vsGood[t.fid] || [0, 0]; return r[0] + r[1] ? pct(r[0], r[1]) : 0.5; }],
      ["point differential", (t) => t.pf - t.pa],
    ];
    for (const [name, f] of steps) {
      const vals = new Map(group.map((t) => [t, f(t)]));
      const distinct = [...new Set(vals.values())];
      if (distinct.length < 2) continue;
      distinct.sort((a, b) => b - a);
      const out = [];
      for (const v of distinct) {
        const sub = group.filter((t) => vals.get(t) === v);
        if (sub.length === 1) { ctx.notes[sub[0].fid] = name; out.push(sub[0]); }
        else out.push(...breakTies(sub, ctx, depth + 1));
      }
      return out;
    }
    const out = group.slice().sort((a, b) => coin(a.fid) - coin(b.fid));
    out.forEach((t) => (ctx.notes[t.fid] = "coin flip"));
    return out;
  }
  function standings(conf) {
    const all = activeTeams();
    const ts = all.filter((t) => !conf || t.conf === conf);
    if (!S.schedule.some((g) => g.played)) return ts.slice().sort((a, b) => a.city.localeCompare(b.city));
    const good = new Set(all.filter((t) => pct(t.w, t.l) >= 0.5).map((t) => t.fid));
    const h2h = h2hTable(), vsGood = {};
    for (const g of S.schedule) {
      if (!g.played) continue;
      for (const [me, op, won] of [[g.home, g.away, g.hs > g.as], [g.away, g.home, g.as > g.hs]])
        if (good.has(op)) (vsGood[me] ||= [0, 0])[won ? 0 : 1]++;
    }
    const ctx = { h2h, vsGood, notes: {} };
    const byPct = new Map();
    for (const t of ts) { const p = pct(t.w, t.l); if (!byPct.has(p)) byPct.set(p, []); byPct.get(p).push(t); }
    const out = [];
    for (const p of [...byPct.keys()].sort((a, b) => b - a)) out.push(...breakTies(byPct.get(p), ctx));
    out.notes = ctx.notes; // fid -> tiebreaker that ordered a tied team
    return out;
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
    if (po.finalsMvp) P(po.finalsMvp).awards.push(`${S.season} Finals MVP`);
    for (const p of roster(po.champion)) if (p.po[S.season]) p.awards.push(`${S.season} Champion`);
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
      S.boxes[b.gid] = b; applyBox(b, true); trackRecords(b, true);
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
      ft: st.fta ? st.ftm / st.fta : 0, ts: st.fga + st.fta ? st.pts / (2 * (st.fga + 0.44 * st.fta)) : 0,
      oreb: round1((st.oreb || 0) / g), dreb: round1((st.dreb || 0) / g), pf: round1((st.pf || 0) / g), pm: round1((st.pm || 0) / g) };
  }
  // Individual production per game, scaled to the era's scoring level.
  function indScore(s) {
    if (!s) return 0;
    const sc = 87 / leaguePts();
    return s.pts * sc + 1.1 * s.reb + 1.5 * s.ast + 2 * (s.stl + s.blk) - 1.2 * s.tov + (s.ts - 0.54) * 40 + (s.pm || 0) * 0.1;
  }
  const minGames = () => S.rules.games * 0.55;
  const teamWp = (fid) => { const t = T(fid); return t ? t.w / Math.max(1, t.w + t.l) : 0.5; };
  function defScore(p, s) {
    const tm = T(s.team), gp = Math.max(1, tm.w + tm.l), oppPpg = tm.pa / gp;
    return 3.2 * (s.stl + s.blk) + 0.45 * (s.dreb ?? s.reb * 0.75) + p.r.def * 0.15 + s.min * 0.05 + (leaguePts() - oppPpg) * 0.35;
  }
  function computeAwards() {
    const y = S.season;
    // While real players make up the league, awards go only to them (generated players
    // are filler). If no real player qualifies for an award (e.g. no real rookies after 2026),
    // generated players are considered for it.
    const allRows = Object.values(S.players).filter((p) => p.team && !p.retired).map((p) => ({ p, s: perGame(p) })).filter((x) => x.s);
    const realRows = genCapOn() ? allRows.filter((x) => x.p.real) : allRows;
    const rows = realRows;
    const elig = rows.filter((x) => x.s.gp >= minGames());
    for (const x of allRows) { x.ind = indScore(x.s); x.wp = teamWp(x.s.team); }
    const sortBy = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a));
    // MVP: production plus team success. A player on a losing team needs a
    // season well clear of everyone else to win.
    const indRank = sortBy(elig, (x) => x.ind);
    const bestInd = indRank[0]?.ind || 0, secondInd = indRank[1]?.ind || 0;
    const mvpScore = (x) => {
      let v = x.ind + 26 * (x.wp - 0.5);
      if (x.wp <= 0.5 && !(x === indRank[0] && bestInd >= secondInd * 1.15)) v -= 10 + 40 * (0.5 - x.wp);
      return v;
    };
    const mvpList = sortBy(elig.filter((x) => x.s.min >= 28), mvpScore);
    const allWnba = sortBy(elig.filter((x) => x.s.min >= 22), (x) => x.ind + 10 * (x.wp - 0.5));
    const rk = (arr) => arr.filter((x) => isRookie(x.p) && x.s.gp >= S.rules.games * 0.4);
    const rookies = rk(rows).length ? rk(rows) : rk(allRows);
    const royList = sortBy(rookies, (x) => x.ind);
    const defList = sortBy(elig, (x) => defScore(x.p, x.s));
    const sixth = sortBy(elig.filter((x) => x.s.gs <= x.s.gp * 0.35), (x) => x.ind);
    // Most improved: biggest jump over last season (not rookies or the MVP).
    const prevInd = (p) => { const c = p.career.find((e) => e.season === y - 1); if (c && c.gp >= 12) return indScore(c);
      const l = p.real ? realLine(p.id, y - 1) : null; return l && l[F.gp] >= 12 ? indScore({ pts: l[F.pts], reb: l[F.reb], ast: l[F.ast], stl: l[F.stl], blk: l[F.blk], tov: 1.5, ts: 0.54 }) : null; };
    const mipList = sortBy(elig.filter((x) => !isRookie(x.p) && prevInd(x.p) != null && x.p.id !== mvpList[0]?.p.id), (x) => x.ind - prevInd(x.p));
    const ids = (arr, n) => arr.slice(0, n).map((x) => x.p.id);
    const a = {
      mvp: mvpList[0]?.p.id, dpoy: defList[0]?.p.id, roy: royList[0]?.p.id, smoy: sixth[0]?.p.id, mip: mipList[0]?.p.id,
      allFirst: ids(allWnba, 5), allSecond: allWnba.slice(5, 10).map((x) => x.p.id), allDef: ids(defList, 5), allRookie: ids(royList, 5),
    };
    const tag = (id, name, news) => { if (!id) return; P(id).awards.push(`${y} ${name}`); if (news) log(`${P(id).name} (${T(P(id).team).abbr}) wins ${y} ${name}.`, P(id).team, "award"); };
    tag(a.mvp, "MVP", 1); tag(a.dpoy, "Defensive Player of the Year", 1); tag(a.roy, "Rookie of the Year", 1);
    tag(a.smoy, "Sixth Player of the Year", 1); tag(a.mip, "Most Improved Player", 1);
    a.allFirst.forEach((id) => tag(id, "All-WNBA First Team")); a.allSecond.forEach((id) => tag(id, "All-WNBA Second Team"));
    a.allDef.forEach((id) => tag(id, "All-Defensive Team")); a.allRookie.forEach((id) => tag(id, "All-Rookie Team"));
    return a;
  }
  const isRookie = (p) => p.firstSeason === S.season || (S.season === S.startYear && p.real && Math.min(...realSeasons(p.id)) === S.season);
  function finalsMvp(fid) {
    let ps = roster(fid).filter((p) => p.po[S.season]);
    if (genCapOn() && ps.some((p) => p.real)) ps = ps.filter((p) => p.real);
    const sc = (p) => { const x = p.po[S.season]; return (x.pts + 1.1 * x.reb + 1.5 * x.ast + 2 * (x.stl + x.blk) - x.tov) / Math.max(1, x.gp); };
    ps.sort((a, b) => sc(b) - sc(a));
    return ps[0]?.id;
  }

  // ---------- records ----------
  // Single-game records are tracked as games are played (top 10 per stat).
  const REC_STATS = ["pts", "reb", "ast", "stl", "blk", "tpm"];
  function recPush(list, entry, asc) {
    list.push(entry);
    list.sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
    if (list.length > 10) list.length = 10;
  }
  function trackRecords(box, playoff) {
    const R = (S.records ||= { game: {}, team: { high: [], low: [], margin: [] } });
    for (const k of REC_STATS) R.game[k] ||= [];
    for (const fid of [box.home, box.away]) {
      const opp = fid === box.home ? box.away : box.home;
      for (const l of box.players[fid]) for (const k of REC_STATS) {
        const list = R.game[k];
        if (l[k] > 0 && (list.length < 10 || l[k] > list[list.length - 1].v))
          recPush(list, { v: l[k], pid: l.id, name: P(l.id)?.name, fid, abbr: T(fid).abbr, opp: T(opp).abbr, season: S.season, gid: box.gid, po: !!playoff });
      }
      const pts = fid === box.home ? box.hs : box.as;
      const e = { v: pts, fid, abbr: T(fid).abbr, opp: T(opp).abbr, season: S.season, gid: box.gid, po: !!playoff };
      if (R.team.high.length < 10 || pts > R.team.high[R.team.high.length - 1].v) recPush(R.team.high, { ...e });
      if (R.team.low.length < 10 || pts < R.team.low[R.team.low.length - 1].v) recPush(R.team.low, { ...e }, true);
    }
    const m = Math.abs(box.hs - box.as), w = box.hs > box.as ? box.home : box.away, lz = w === box.home ? box.away : box.home;
    if (R.team.margin.length < 10 || m > R.team.margin[R.team.margin.length - 1].v)
      recPush(R.team.margin, { v: m, fid: w, abbr: T(w).abbr, opp: T(lz).abbr, score: `${Math.max(box.hs, box.as)}-${Math.min(box.hs, box.as)}`, season: S.season, gid: box.gid, po: !!playoff });
  }
  // Season and career leaderboards: real seasons before the league's start
  // year plus every season played in this league.
  function seasonLines() {
    const out = [];
    for (const rp of D.players) for (const ys in rp.s) {
      const y = +ys; if (y >= S.startYear) continue;
      const l = rp.s[ys];
      out.push({ pid: rp.id, name: rp.n, season: y, team: fidAbbr(l[F.fid], y), gp: l[F.gp], pts: l[F.pts], reb: l[F.reb], ast: l[F.ast], stl: l[F.stl], blk: l[F.blk], real: true });
    }
    for (const p of Object.values(S.players)) for (const c of p.career)
      out.push({ pid: p.id, name: p.name, season: c.season, team: T(c.team)?.abbr || c.team, gp: c.gp, pts: c.pts, reb: c.reb, ast: c.ast, stl: c.stl, blk: c.blk, real: false });
    return out;
  }
  function recordBook() {
    const lines = seasonLines();
    const gamesIn = {};
    for (const y in D.league) gamesIn[y] = D.league[y].games;
    for (const h of S.history) gamesIn[h.season] = gamesIn[h.season] || 34;
    const qualified = lines.filter((l) => l.gp >= (gamesIn[l.season] || 34) * 0.5);
    const top = (arr, k, n = 10) => arr.slice().sort((a, b) => b[k] - a[k]).slice(0, n);
    const season = {}; for (const k of ["pts", "reb", "ast", "stl", "blk"]) season[k] = top(qualified, k);
    const car = {};
    for (const l of lines) {
      const c = (car[l.pid] ||= { pid: l.pid, name: l.name, gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, first: l.season, last: l.season });
      c.gp += l.gp; for (const k of ["pts", "reb", "ast", "stl", "blk"]) c[k] += Math.round(l[k] * l.gp);
      c.first = Math.min(c.first, l.season); c.last = Math.max(c.last, l.season);
    }
    const career = {}; for (const k of ["pts", "reb", "ast", "stl", "blk", "gp"]) career[k] = top(Object.values(car), k);
    // Team seasons
    const teamSeasons = [];
    for (const y in D.teams) if (+y < S.startYear) for (const t of D.teams[y]) teamSeasons.push({ season: +y, name: `${t.city} ${t.name}`, fid: t.fid, w: t.w, l: t.l, real: true });
    for (const t of S.teams) for (const h of t.hist) teamSeasons.push({ season: h.season, name: h.name, fid: t.fid, w: h.w, l: h.l, streak: h.maxStreak || 0 });
    teamSeasons.forEach((t) => (t.pct = t.w / Math.max(1, t.w + t.l)));
    const titles = S.teams.filter((t) => t.titles).sort((a, b) => b.titles - a.titles).map((t) => ({ fid: t.fid, name: `${t.city} ${t.name}`, titles: t.titles, active: t.active }));
    return {
      game: (S.records || {}).game || {}, teamGame: (S.records || {}).team || { high: [], low: [], margin: [] },
      season, career,
      bestTeams: teamSeasons.slice().sort((a, b) => b.pct - a.pct || b.w - a.w).slice(0, 10),
      worstTeams: teamSeasons.slice().sort((a, b) => a.pct - b.pct || a.w - b.w).slice(0, 10),
      streaks: teamSeasons.filter((t) => t.streak).sort((a, b) => b.streak - a.streak).slice(0, 10),
      titles,
    };
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
      txn(`Expansion draft: ${teamName(fid)} select ${p.name} from the ${teamName(p.team)}.`, fid, { type: "expansion", from: p.team, involved: [p.team], p: pSnap(p), c: { ...p.c } });
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
    pool.forEach((p) => { p.lastTeam = p.team; p.team = null; });
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
          txn(`Dispersal draft: ${teamName(tf)} take ${best.name}.`, tf, { type: "dispersal", from: fid, involved: [fid], p: pSnap(best), c: { ...best.c } });
        }
      }
    }
    pool.filter((p) => !p.team).forEach((p) => { p.c = { sal: 0, yrs: 0 }; p.ask = askingContract(p); });
    rankCache = null; save(); return { ok: true };
  }
  function releaseToFA(p, fid) { txn(`${teamName(fid)} waive ${p.name}.`, fid, { type: "waive", p: pSnap(p) }); p.lastTeam = p.team; p.team = null; p.c = { sal: 0, yrs: 0 }; p.ask = askingContract(p); }

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
      t.hist.push({ season: S.season, name: `${t.city} ${t.name}`, abbr: t.abbr, w: t.w, l: t.l, res, conf: t.conf, maxStreak: t.maxStreak || 0 });
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
    S.phase = "preseason"; // moves from here on belong to the new season's preseason
    if (S.rulesNext) { S.rules = S.rulesNext; S.rulesNext = null; }
    S.rules.cap = Math.round(S.rules.cap * (1 + S.rules.capGrowth) / 5000) * 5000;
    if (S.opts.followHistory && S.season === 2026 && S.rules.cap < 7e6) { S.rules.cap = 7e6; log("The 2026 CBA resets the salary cap to $7.0M.", null, "office"); }
    for (const p of Object.values(S.players)) if (p.inj) { p.inj = 0; p.injType = null; }
    develop();
    retirements();
    for (const p of freeAgents()) p.ask = askingContract(p);
    aiFreeAgency(1); aiFreeAgency(1);
    aiTrades(3);
    for (const t of activeTeams()) { Object.assign(t, { w: 0, l: 0, hw: 0, hl: 0, pf: 0, pa: 0, streak: 0, maxStreak: 0 }); aiRosterFix(t.fid); t.dead = t.dead.filter((d) => d.season >= S.season); }
    for (const p of Object.values(S.players)) if (!p.retired && !p.prospect) p.unsigned = p.team ? 0 : (p.unsigned || 0) + 1;
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
      const realEra = y <= LAST_REAL;
      const p = genPlayer({ age: a, ovrMean: tier, ovrSd: realEra ? 3.5 : 4.5, potRoom: realEra ? Math.max(2, (24 - a) * 2) : Math.max(3, (25 - a) * 3.5 + (i < 10 ? 5 : 0)), draft: true });
      if (realEra) { p.r.pot = Math.min(p.r.pot, 62); p.potCap = 64; } // depth players while real classes exist
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
    const recOrder = standings().slice().reverse().map((t) => t.fid); // worst first, tiebreakers applied
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
      const val = (p) => (p.r.ovr * (mode === "contend" ? 0.6 : 0.45) + p.r.pot * (mode === "contend" ? 0.4 : 0.55)) + posNeed(s.fid, p) * 0.4 + randn() * 3;
      const ch = av.map((p) => [p, val(p)]).sort((a, b) => b[1] - a[1])[0][0];
      ch.prospect = null; ch.team = s.fid; ch.draft = { season: y, round: s.round, pick: i + 1, team: s.fid };
      ch.c = rookieContract(i + 1, s.round); ch.acq = `#${i + 1} pick, ${y} draft`;
      picks.push({ pick: i + 1, round: s.round, fid: s.fid, pid: ch.id });
      txn(`${teamName(s.fid)} draft ${ch.name} with pick ${i + 1}.`, s.fid, { type: "draft", pick: i + 1, round: s.round, draftYear: y, p: { ...pSnap(ch), school: ch.school, real: !!ch.real }, c: { ...ch.c } });
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
      const fid = p.team, keep = rnd() < keepChance(p, fid);
      if (keep) { const a = askingContract(p); p.c = { sal: a.sal, yrs: a.yrs }; txn(`${teamName(fid)} re-sign ${p.name}.`, fid, { type: "resign", p: pSnap(p), c: { sal: a.sal, yrs: a.yrs } }); }
      else { txn(`${p.name} leaves the ${teamName(fid)} in free agency.`, fid, { type: "leave", p: pSnap(p) }); p.lastTeam = p.team; p.team = null; p.c = { sal: 0, yrs: 0 }; if (p.r.ovr >= 70) log(`${p.name} becomes a free agent, leaving the ${teamName(fid)}.`, fid, "fa"); }
    }
  }
  // How likely a team re-signs an expiring player: rotation players and young talent
  // usually stay; end-of-bench and older players move on more often. While real data
  // exists, what she really did next season (stayed or switched teams) weighs in.
  function keepChance(p, fid) {
    const a = age(p), rank = roster(fid).filter((x) => x.r.ovr > p.r.ovr).length; // 0 = team's best
    let k = rank < 5 ? 0.8 : rank < 8 ? 0.62 : rank < 10 ? 0.42 : 0.25;
    if (a <= 25 && p.r.pot >= 62) k = Math.max(k, 0.75);
    if (p.r.ovr < 45) k *= 0.6;
    if (a >= 35) k *= 0.45; else if (a >= 33) k *= 0.75;
    if (p.real && S.opts.realCareers && S.season < LAST_REAL) {
      const nx = realLine(p.id, S.season + 1);
      if (nx) k = nx[F.fid] === fid ? Math.max(k, 0.82) : Math.min(k, 0.35);
    }
    return k;
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
        if (p.potCap) { p.r.pot = Math.min(p.r.pot, p.potCap); p.r.ovr = Math.min(p.r.ovr, p.potCap); }
      }
    }
    updateGenCap();
    for (const p of Object.values(S.players)) if (!p.real && !p.retired) capGen(p);
  }
  // Age-based retirement odds for generated players, and for real players once past the real data.
  function agePr(p, a) {
    let pr = 0;
    if (a >= 35) pr = 0.35 + (a - 35) * 0.15;
    else if (a >= 32) pr = p.r.ovr < 60 ? 0.3 : 0.05;
    else if (a >= 30 && p.r.ovr < 48) pr = 0.15;
    if (!p.team && a >= 29 && p.r.ovr < 50) pr += 0.4;
    if (p.team && p.c.yrs > 0) pr *= 0.4; // under contract: usually plays it out
    return pr;
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
        else if (S.season > LAST_REAL) pr = agePr(p, a); // past the real data: she ages like anyone else
      } else pr = agePr(p, a);
      // Nobody signs you for two straight seasons: most players call it a career.
      const futureReal = p.real && S.opts.realCareers && S.season <= LAST_REAL && realSeasons(p.id).some((x) => x > S.season);
      if (!p.team && (p.unsigned || 0) >= 2 && !futureReal) pr = Math.max(pr, a >= 27 ? 0.85 : 0.55);
      if (a >= 41 && !futureReal) pr = 1;
      if (!p.team && p.undrafted && rnd() < 0.5) pr = 1;
      if (rnd() < pr) {
        const fid = p.team;
        if (fid || p.r.ovr >= 60 || p.awards.length) txn(`${p.name} retires.`, fid, { type: "retire", p: pSnap(p), seasons: (p.career || []).length + realSeasons(p.id).filter((x) => x < S.startYear).length, awards: p.awards.length });
        p.retired = S.season; p.team = null;
        if (p.r.ovr >= 70 || p.awards.length) log(`${p.name} retires${fid ? ` from the ${teamName(fid)}` : ""}.`, fid, "retire");
      }
    }
  }
  // Roster balance: how much a team needs a player's position (guards, forwards, bigs).
  const POS_TARGET = { G: 4, F: 4, C: 2 }, POS_MIN = { G: 3, F: 3, C: 1 };
  function posCounts(list) { return { G: list.filter(canG).length, F: list.filter(canF).length, C: list.filter(canC).length }; }
  function posNeed(fid, p, list = roster(fid)) {
    const n = posCounts(list); let b = 0;
    if (canC(p) && n.C < POS_TARGET.C) b += n.C === 0 ? 10 : 5;
    if (canG(p) && n.G < POS_TARGET.G) b += n.G < POS_MIN.G ? 8 : 4;
    if (canF(p) && n.F < POS_TARGET.F) b += n.F < POS_MIN.F ? 8 : 4;
    return Math.min(b, 12);
  }
  // Cutting this player would leave the team short at a position.
  function posProtected(list, p) {
    const n = posCounts(list.filter((x) => x !== p));
    return (canC(p) && n.C < POS_MIN.C) || (canG(p) && n.G < POS_MIN.G) || (canF(p) && n.F < POS_MIN.F);
  }
  function aiFreeAgency(intensity = 1) {
    const all = freeAgents().sort((a, b) => talent(b) - talent(a)).slice(0, 80);
    for (const t of shuffle(activeTeams().slice())) {
      let n = roster(t.fid).length;
      const fas = all.filter((p) => !p.team).map((p) => [p, talent(p) + posNeed(t.fid, p)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      for (const p of fas) {
        // A full roster with no true big can still add one (the worst player is cut later).
        const bigNeed = canC(p) && posCounts(roster(t.fid)).C === 0 && n <= S.rules.rosterMax;
        if (p.team || (n >= S.rules.rosterMax && !bigNeed)) continue;
        if (rnd() > intensity && n >= S.rules.rosterMin && !bigNeed) break;
        const ask = p.ask || askingContract(p);
        const need = n < S.rules.rosterMin;
        const worst = roster(t.fid).sort((a, b) => a.r.ovr - b.r.ovr)[0];
        if (!need && worst && p.r.ovr + posNeed(t.fid, p) * 0.6 < worst.r.ovr + 2) continue;
        if (ask.sal <= capSpace(t.fid) || (need && ask.sal <= econ().min * 1.3)) {
          p.team = t.fid; p.c = { sal: Math.min(ask.sal, Math.max(econ().min, capSpace(t.fid))), yrs: ask.yrs }; p.ask = null; n++;
          p.acq = `Signed ${S.season}`;
          txn(`${teamName(t.fid)} sign ${p.name} (${fmtMoney(p.c.sal)} × ${p.c.yrs}).`, t.fid, { type: "sign", from: prevTeam(p), involved: [prevTeam(p)].filter(Boolean), p: pSnap(p), c: { sal: p.c.sal, yrs: p.c.yrs } });
          if (p.r.ovr >= 70) log(`${p.name} signs with the ${teamName(t.fid)}.`, t.fid, "fa");
          if (!need) break;
        }
      }
    }
  }
  function aiRosterFix(fid, initial) {
    let ps = roster(fid).sort((a, b) => a.r.ovr - b.r.ovr);
    while (ps.length > S.rules.rosterMax) { const p = ps.find((x) => !posProtected(ps, x)) || ps[0]; ps = ps.filter((x) => x !== p); if (!initial) txn(`${teamName(fid)} waive ${p.name}.`, fid, { type: "waive", p: pSnap(p) }); p.lastTeam = p.team; p.team = null; p.c = { sal: 0, yrs: 0 }; p.ask = askingContract(p); }
    let guard = 0;
    while (roster(fid).length < S.rules.rosterMin && guard++ < 20) {
      const fa = freeAgents().map((x) => [x, x.r.ovr + posNeed(fid, x)]).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!fa) { const g = genPlayer({ age: 24, ovrMean: 42, ovrSd: 4, potRoom: 2 }); S.players[g.id] = g; continue; }
      const sal = Math.max(econ().min, Math.min(fa.ask?.sal || econ().min, capSpace(fid)));
      fa.team = fid; fa.c = { sal: Math.round(sal / 1000) * 1000, yrs: 1 }; fa.ask = null;
      if (!initial) txn(`${teamName(fid)} sign ${fa.name}.`, fid, { type: "sign", from: prevTeam(fa), involved: [prevTeam(fa)].filter(Boolean), p: pSnap(fa), c: { sal: fa.c.sal, yrs: fa.c.yrs } });
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
          txn(text, c.fid, { type: "trade", a: c.fid, b: r.fid, involved: [r.fid], aGets: [pSnap(vet)], bGets: [pSnap(y)] }); if (vet.r.ovr >= 70) log(text, c.fid, "trade");
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
  function load() { try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return null; S = JSON.parse(raw); rankCache = null; migrate(); return S; } catch (e) { return null; } }
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
    if (st) { S = st; rankCache = null; migrate(); }
    return S;
  }
  // Write any pending save immediately (used when the page is hidden or closed).
  function flush() { if (!saveTimer || !S) return; clearTimeout(saveTimer); saveTimer = null; if (KV.db) KV.set("league", S); else lsSave(); }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    window.addEventListener && window.addEventListener("pagehide", flush);
  }
  function importState(o) { S = o; rankCache = null; migrate(); save(); }
  // Older saves: bring generated players under the cap right away.
  function migrate() {
    if (!S || !S.players || S.genCap !== undefined) return;
    updateGenCap();
    for (const p of Object.values(S.players)) if (!p.real && !p.retired) capGen(p);
  }
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
        out.push({ label, conf: br.label, round: ri, final: label === "Finals", hi: s.hi, lo: s.lo, wh: s.wh, wl: s.wl, winner: s.winner, bestOf: s.bestOf, seedHi: br.seeds.indexOf(s.hi) + 1, seedLo: br.seeds.indexOf(s.lo) + 1,
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

  // The team a player was on in a given season (awards, history): the season's stat line,
  // not where she plays now.
  function teamAt(pid, y) {
    const p = P(pid);
    if (p) {
      const c = p.career.find((e) => e.season === y);
      if (c && c.team) return c.team;
      if (p.stats[y] && p.stats[y].team) return p.stats[y].team;
    }
    const l = realLine(pid, y);
    if (l) return l[F.fid];
    return p && y === S.season ? p.team : null;
  }

  // Everything about one franchise: every season (real ones before the league began, then
  // simulated ones), playoff series, all-time leaders, award winners and best seasons.
  function franchiseHistory(fid) {
    const t = T(fid); if (!t) return null;
    const pname = (pid) => (P(pid) ? P(pid).name : (REAL[pid] && REAL[pid].n) || "Unknown");
    const seasons = [];
    // Real seasons before the league started.
    for (const y of Object.keys(D.teams).map(Number).filter((y) => y < S.startYear).sort((a, b) => a - b)) {
      const rt = D.teams[y].find((x) => x.fid === fid); if (!rt) continue;
      const rs = ((D.playoffs || {})[y] || []);
      const mine = rs.filter((x) => x[0] === fid || x[1] === fid).map(([ta, tb, wa, wb, , lab]) => {
        const me = ta === fid, opp = me ? tb : ta, ot = D.teams[y].find((x) => x.fid === opp) || {};
        const wins = me ? wa : wb, losses = me ? wb : wa;
        return { label: lab, opp, oppAbbr: ot.abbr || opp, oppName: ot.city ? `${ot.city} ${ot.name}` : opp, wins, losses, done: true, won: wins > losses, final: lab === "Finals" };
      });
      const fin = mine.find((x) => x.final);
      const res = !rs.length ? null : fin ? (fin.won ? "Champion" : "Finals") : mine.length ? "Playoffs" : "–";
      seasons.push({ season: y, real: true, name: `${rt.city} ${rt.name}`, abbr: rt.abbr, w: rt.w, l: rt.l, conf: rt.conf, res, series: mine });
    }
    // Simulated seasons.
    const done = new Set();
    for (const h of t.hist) {
      done.add(h.season);
      const ser = ((S.archive || {})[h.season]?.playoffs || []).filter((x) => x.hi === fid || x.lo === fid);
      seasons.push({ season: h.season, real: false, name: h.name, abbr: h.abbr, w: h.w, l: h.l, conf: h.conf, res: h.res, series: ser.map((x) => serInfo(x, fid, h.season)) });
    }
    if (t.active && !done.has(S.season) && (S.phase === "regular" || S.phase === "playoffs")) {
      const ser = (S.playoffs ? playoffSummary(S.playoffs) : []).filter((x) => x.hi === fid || x.lo === fid);
      seasons.push({ season: S.season, real: false, live: true, name: `${t.city} ${t.name}`, abbr: t.abbr, w: t.w, l: t.l, conf: t.conf, res: null, series: ser.map((x) => serInfo(x, fid, S.season)) });
    }
    // Player-seasons for this franchise.
    const lines = [];
    for (const rp of D.players) for (const y in rp.s) {
      if (+y >= S.startYear) continue;
      const l = rp.s[y]; if (l[F.fid] !== fid) continue;
      lines.push({ pid: rp.id, season: +y, gp: l[F.gp], pts: l[F.pts], reb: l[F.reb], ast: l[F.ast], stl: l[F.stl], blk: l[F.blk], real: true });
    }
    for (const p of Object.values(S.players)) {
      for (const c of p.career) if (c.team === fid) lines.push({ pid: p.id, season: c.season, gp: c.gp, pts: c.pts, reb: c.reb, ast: c.ast, stl: c.stl, blk: c.blk });
      if (!p.career.some((c) => c.season === S.season)) { const g = perGame(p); if (g && g.team === fid) lines.push({ pid: p.id, season: S.season, gp: g.gp, pts: g.pts, reb: g.reb, ast: g.ast, stl: g.stl, blk: g.blk, live: true }); }
    }
    // Totals per player.
    const tot = {};
    for (const l of lines) {
      const x = (tot[l.pid] ||= { pid: l.pid, name: pname(l.pid), gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, seasons: 0, from: l.season, to: l.season });
      x.gp += l.gp; x.seasons++; x.from = Math.min(x.from, l.season); x.to = Math.max(x.to, l.season);
      for (const k of ["pts", "reb", "ast", "stl", "blk"]) x[k] += l[k] * l.gp;
    }
    const all = Object.values(tot);
    const top = (k, n = 10) => all.filter((x) => x[k] > 0).sort((a, b) => b[k] - a[k]).slice(0, n).map((x) => ({ ...x, v: Math.round(x[k]) }));
    const leaders = { pts: top("pts"), reb: top("reb"), ast: top("ast"), stl: top("stl"), blk: top("blk"), gp: top("gp"),
      ppg: all.filter((x) => x.gp >= 60).map((x) => ({ ...x, v: Math.round((x.pts / x.gp) * 10) / 10 })).sort((a, b) => b.v - a.v).slice(0, 10) };
    // Each season's leading scorer, and the best scoring seasons.
    const bySeason = {};
    for (const l of lines) if (l.gp >= 8 && (!bySeason[l.season] || l.pts > bySeason[l.season].pts)) bySeason[l.season] = l;
    for (const s of seasons) { const b = bySeason[s.season]; s.top = b ? { pid: b.pid, name: pname(b.pid), pts: b.pts } : null; }
    const bestSeasons = lines.filter((l) => l.gp >= 15).sort((a, b) => b.pts - a.pts).slice(0, 10).map((l) => ({ ...l, name: pname(l.pid) }));
    // Award winners while with the franchise.
    const awards = [];
    const NAMES = { mvp: "MVP", finalsMvp: "Finals MVP", dpoy: "Defensive Player of the Year", roy: "Rookie of the Year", smoy: "Sixth Player of the Year", mip: "Most Improved Player" };
    const TEAMS = { allFirst: "All-WNBA First Team", allSecond: "All-WNBA Second Team", allDef: "All-Defensive Team", allRookie: "All-Rookie Team" };
    for (const h of S.history) {
      for (const k in NAMES) if (h[k] && teamAt(h[k], h.season) === fid) awards.push({ season: h.season, award: NAMES[k], pid: h[k], name: pname(h[k]), major: true });
      for (const k in TEAMS) for (const id of h[k] || (k === "allFirst" ? h.allLeague || [] : [])) if (teamAt(id, h.season) === fid) awards.push({ season: h.season, award: TEAMS[k], pid: id, name: pname(id) });
    }
    awards.sort((a, b) => b.season - a.season);
    // Summary.
    const sim = seasons.filter((s) => !s.real && !s.live);
    const done2 = seasons.filter((s) => !s.live && s.res);
    const W = sum(seasons.filter((s) => !s.live).map((s) => s.w)), L = sum(seasons.filter((s) => !s.live).map((s) => s.l));
    const serAll = seasons.flatMap((s) => s.series.map((x) => ({ ...x, season: s.season })));
    const best = seasons.filter((s) => !s.live && s.w + s.l).sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l))[0] || null;
    const summary = {
      seasons: seasons.filter((s) => !s.live).length, realSeasons: seasons.filter((s) => s.real).length, w: W, l: L,
      titles: done2.filter((s) => s.res === "Champion").length, finals: done2.filter((s) => s.res === "Champion" || s.res === "Finals").length,
      playoffs: done2.filter((s) => s.res && s.res !== "–").length, simSeasons: sim.length, simTitles: sim.filter((s) => s.res === "Champion").length,
      champYears: done2.filter((s) => s.res === "Champion").map((s) => s.season).sort((a, b) => a - b),
      seriesW: serAll.filter((x) => x.done && x.won).length, seriesL: serAll.filter((x) => x.done && !x.won).length,
      gW: sum(serAll.map((x) => x.wins)), gL: sum(serAll.map((x) => x.losses)),
      best: best ? { season: best.season, w: best.w, l: best.l } : null,
      names: [...new Set(seasons.map((s) => s.name))],
    };
    return { fid, seasons: seasons.reverse(), series: serAll.reverse(), leaders, bestSeasons, awards, summary };
  }
  function serInfo(x, fid, season) {
    const isHi = x.hi === fid, opp = isHi ? x.lo : x.hi;
    const snap = (S.archive || {})[season]?.teams || {};
    const ot = snap[opp] || T(opp) || {};
    return { label: x.label, opp, oppAbbr: ot.abbr || opp, oppName: ot.name ? `${ot.city ? ot.city + " " : ""}${ot.name}` : teamName(opp),
      seed: isHi ? x.seedHi : x.seedLo, oppSeed: isHi ? x.seedLo : x.seedHi,
      wins: isHi ? x.wh : x.wl, losses: isHi ? x.wl : x.wh, done: !!x.winner, won: x.winner === fid, bestOf: x.bestOf, final: x.label === "Finals" };
  }

  window.GM = {
    recordBook, franchiseHistory, teamAt, seasonGames, archivedSeasons, seasonBracket, bracketSeasons, init, getKV, setKV, hasDB, realScheduleStatus, flush,
    get S() { return S; }, data: D, F, get saveError() { return saveError; },
    newLeague, load, save, importState, clearSave, previewSeason, eraRules,
    P, T, activeTeams, teamName, roster, freeAgents, payroll, capSpace, econ, age, teamRating, powerRanks, teamMode, rotation,
    startSeason, simDays, lastDay, tradeDeadlineDay, standings, activeConfs, simPlayoffs, toOffseason, advanceToNextSeason,
    pendingEvents, setEventApproval, officeOpen, setRules, addConference, renameConference, removeConference, setTeamConf,
    expandTeam, relocateTeam, foldTeam, perGame, fmtMoney, realLine, realSeasons, fidAbbr,
  };
})();
