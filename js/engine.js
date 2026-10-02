// WNBA GM simulator engine: league state, game simulation, AI front offices,
// trades, free agency, draft and offseason. No DOM access in this file.
(function () {
  "use strict";
  const D = window.LEAGUE_DATA;
  const NP = window.NAME_POOL;

  // ---------- small helpers ----------
  const rnd = Math.random;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const randn = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const round1 = (x) => Math.round(x * 10) / 10;

  const MIN_TEMPLATE = [34, 32, 30, 28, 26, 20, 14, 8, 5, 3]; // 200 minutes
  const SAVE_KEY = "wnba-gm-save-v1";
  const STAT_KEYS = ["gp", "gs", "min", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta"];

  let S = null; // the live game state
  const listeners = [];
  const emit = () => listeners.forEach((f) => f(S));

  // ---------- state creation ----------
  function newGame(userTeam) {
    const econ = D.econ;
    S = {
      version: 1,
      season: D.startSeason,
      phase: "preseason",
      day: 0,
      userTeam,
      econ: { cap: econ.salaryCap, max: econ.maxSalary, min: econ.minSalary, rookieTop: econ.rookieTopSalary, growth: econ.capGrowth, rosterMin: econ.rosterMin, rosterMax: econ.rosterMax },
      sim: { ...D.sim },
      teams: D.teams.map((t) => ({ id: t.id, city: t.city, name: t.name, color: t.color, conf: t.conf, last: t.last, dead: [], rotation: null, w: 0, l: 0, hw: 0, hl: 0, pf: 0, pa: 0, streak: 0 })),
      players: {},
      nextPid: 9000000,
      schedule: [],
      boxes: {},
      playoffs: null,
      picks: [],
      prospects: [],
      draft: null,
      history: [],
      news: [],
      tradeLog: [],
    };
    for (const p of D.players) {
      const pl = {
        id: p.id, name: p.name, team: p.team, pos: p.pos, ht: p.ht, age: p.age, exp: p.exp ?? 0,
        school: p.school, acq: p.acq, r: { ...p.r }, c: { ...p.c }, inj: 0, injType: null,
        stats: {}, po: {}, career: [],
        hist: { ...(p.career || {}) }, last: { ...p.s },
        real: true,
      };
      if (!pl.team) { pl.c = { sal: 0, yrs: 0, rookie: false }; pl.ask = askingContract(pl); }
      S.players[pl.id] = pl;
    }
    // Pad the free-agent pool with generated veterans so there's a market.
    for (let i = 0; i < 24; i++) {
      const p = genPlayer({ age: 25 + Math.floor(rnd() * 8), ovrMean: 46, ovrSd: 5, potRoom: 2 });
      p.ask = askingContract(p);
      S.players[p.id] = p;
    }
    // Draft picks for the next two drafts (rounds 1-3).
    for (const yr of [S.season, S.season + 1]) addPicksFor(yr);
    S.prospects = genProspects(S.season);
    // AI teams trim to roster max; nobody is over the cap.
    for (const t of S.teams) if (t.id !== userTeam) aiRosterFix(t.id, true);
    S.schedule = makeSchedule();
    log(`Welcome to the ${teamName(userTeam)} front office. The ${S.season} season starts when you're ready.`);
    save();
    emit();
    return S;
  }

  function addPicksFor(yr) {
    for (const t of S.teams) for (const rd of [1, 2, 3]) S.picks.push({ season: yr, round: rd, orig: t.id, owner: t.id });
  }

  function genName() { return pick(NP.first) + " " + pick(NP.last); }
  function genPlayer({ age, ovrMean, ovrSd, potRoom, draft }) {
    const ovr = Math.round(clamp(ovrMean + randn() * ovrSd, 32, 82));
    const pos = pick(["G", "G", "G", "F", "F", "F", "C", "G-F", "F-C"]);
    const big = pos.includes("C") ? 1 : pos === "F" || pos === "F-C" ? 0.5 : 0;
    const sk = (base) => Math.round(clamp(base + randn() * 9, 25, 95));
    const r = {
      ovr,
      pot: Math.round(clamp(ovr + Math.max(0, potRoom * (0.6 + 0.6 * rnd())), ovr, 95)),
      ins: sk(ovr - 4 + big * 10), thr: sk(ovr - 2 - big * 14), fts: sk(ovr - 2), ply: sk(ovr - 4 - big * 10),
      reb: sk(ovr - 8 + big * 22), def: sk(ovr - 2 + big * 4), ath: sk(ovr),
    };
    const id = S.nextPid++;
    return {
      id, name: genName(), team: null, pos, ht: Math.round(70 + big * 7 + randn() * 2), age, exp: draft ? 0 : Math.max(0, age - 22),
      school: pick(NP.schools), acq: "", r, c: { sal: 0, yrs: 0, rookie: false }, inj: 0, injType: null,
      stats: {}, po: {}, career: [], hist: {}, real: false,
    };
  }

  function genProspects(yr) {
    const out = [];
    for (let i = 0; i < 60; i++) {
      const age = 20 + Math.floor(rnd() * 4);
      // A few elite prospects at the top, long tail below.
      const tier = i < 3 ? 62 : i < 10 ? 56 : i < 25 ? 49 : 43;
      const p = genPlayer({ age, ovrMean: tier, ovrSd: 4.5, potRoom: Math.max(3, (25 - age) * 3.5 + (i < 10 ? 5 : 0)), draft: true });
      p.prospect = yr;
      // Scouting estimate: what your staff believes (noisy).
      p.scout = { ovr: Math.round(p.r.ovr + randn() * 3), pot: Math.round(p.r.pot + randn() * 5) };
      S.players[p.id] = p;
      out.push(p.id);
    }
    return out;
  }

  // ---------- accessors ----------
  const P = (id) => S.players[id];
  const T = (id) => (S ? S.teams : D.teams).find((t) => t.id === id);
  const teamName = (id) => { const t = T(id); return t ? `${t.city} ${t.name}` : "Free agent"; };
  const roster = (tid) => Object.values(S.players).filter((p) => p.team === tid && !p.retired);
  const freeAgents = () => Object.values(S.players).filter((p) => !p.team && !p.retired && !p.prospect);
  function payroll(tid, season = S.season) {
    let s = sum(roster(tid).map((p) => p.c.sal));
    s += sum(T(tid).dead.filter((d) => d.season === season).map((d) => d.sal));
    return s;
  }
  const capSpace = (tid) => S.econ.cap - payroll(tid);
  function log(text, tid) { S.news.unshift({ season: S.season, day: S.day, phase: S.phase, text, team: tid || null }); if (S.news.length > 300) S.news.length = 300; }

  // ---------- valuation ----------
  function talent(p) {
    const yf = p.age <= 22 ? 0.65 : p.age <= 24 ? 0.5 : p.age <= 26 ? 0.3 : p.age <= 27 ? 0.15 : 0;
    let t = p.r.ovr + (p.r.pot - p.r.ovr) * yf;
    if (p.age >= 31) t -= (p.age - 30) * 1.4;
    return t;
  }
  function marketSalary(p) {
    const e = S.econ;
    const f = clamp((talent(p) - 50) / 44, 0, 1);
    return clamp(e.min + (e.max - e.min) * Math.pow(f, 2.1), e.min, e.max);
  }
  function askingContract(p) {
    const sal = Math.round(marketSalary(p) * (0.95 + rnd() * 0.15) / 5000) * 5000;
    const yrs = p.age >= 32 ? 1 : p.age >= 29 ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 3);
    return { sal: clamp(sal, S.econ.min, S.econ.max), yrs };
  }
  // Trade value of a player to a given team (rebuilding teams prize youth).
  function playerValue(p, forTeam) {
    const mode = forTeam ? teamMode(forTeam) : "neutral";
    let t = mode === "rebuild" ? talent(p) + (p.age <= 24 ? 3 : 0) - (p.age >= 29 ? (p.age - 28) * 2 : 0)
      : mode === "contend" ? p.r.ovr * 0.75 + talent(p) * 0.25 : talent(p);
    let v = Math.pow(Math.max(0, t - 44), 2.2) / 12;
    // Contract surplus: underpaid players are worth more.
    const yrs = Math.max(1, p.c.yrs);
    v += ((marketSalary(p) - p.c.sal) / 100000) * Math.min(yrs, 3) * 0.8;
    if (p.inj > 10) v *= 0.85;
    return Math.max(0, v);
  }
  function pickValue(pk, forTeam) {
    const mode = forTeam ? teamMode(forTeam) : "neutral";
    const proj = projectedRank(pk.orig); // 1 = best team
    const n = S.teams.length;
    const slot = (n - proj + 1) + (pk.round - 1) * n; // approx draft slot
    let v = pk.round === 1 ? 4 + 26 * Math.pow((n - slot + 1) / n, 1.6) : pk.round === 2 ? 2.5 : 0.6;
    if (pk.season > S.season) v *= 0.9;
    if (mode === "rebuild") v *= 1.35; else if (mode === "contend") v *= 0.75;
    return v;
  }
  function teamRating(tid) {
    const rot = rotation(tid, true);
    if (!rot.length) return 40;
    return sum(rot.map((x) => P(x.id).r.ovr * x.min)) / sum(rot.map((x) => x.min));
  }
  let rankCache = null;
  function powerRanks() {
    if (rankCache && rankCache.key === S.day + S.phase + S.season) return rankCache.map;
    const arr = S.teams.map((t) => {
      const gp = t.w + t.l;
      const rec = gp ? (t.w / gp - 0.5) * 30 : 0;
      return { id: t.id, score: teamRating(t.id) + rec * Math.min(1, gp / 20) };
    }).sort((a, b) => b.score - a.score);
    const map = {}; arr.forEach((x, i) => (map[x.id] = i + 1));
    rankCache = { key: S.day + S.phase + S.season, map };
    return map;
  }
  const projectedRank = (tid) => powerRanks()[tid];
  function teamMode(tid) {
    const r = projectedRank(tid);
    return r <= 5 ? "contend" : r >= 11 ? "rebuild" : "neutral";
  }

  // ---------- rotation & minutes ----------
  function rotation(tid, ignoreInj) {
    const t = T(tid);
    let ps = roster(tid).filter((p) => ignoreInj || p.inj === 0);
    let order;
    if (t.rotation && tid === S.userTeam) {
      const ids = new Set(ps.map((p) => p.id));
      order = t.rotation.filter((id) => ids.has(id)).map(P);
      for (const p of ps.sort((a, b) => b.r.ovr - a.r.ovr)) if (!order.includes(p)) order.push(p);
    } else order = ps.sort((a, b) => b.r.ovr - a.r.ovr);
    const n = Math.min(order.length, MIN_TEMPLATE.length);
    const mins = MIN_TEMPLATE.slice(0, n);
    const deficit = 200 - sum(mins);
    if (deficit > 0 && n) for (let i = 0; i < n; i++) mins[i] += deficit / n;
    return order.slice(0, n).map((p, i) => ({ id: p.id, min: mins[i], start: i < 5 }));
  }
  function setRotation(order) { T(S.userTeam).rotation = order.slice(); save(); emit(); }

  // ---------- schedule ----------
  function makeSchedule() {
    const ids = shuffle(S.teams.map((t) => t.id));
    const n = ids.length; // 15
    const arr = ids.concat(n % 2 ? [null] : []);
    const m = arr.length;
    const rounds = [];
    let a = arr.slice();
    for (let r = 0; r < m - 1; r++) {
      const games = [];
      for (let i = 0; i < m / 2; i++) { const x = a[i], y = a[m - 1 - i]; if (x && y) games.push([x, y]); }
      rounds.push(games);
      a = [a[0], a[m - 1], ...a.slice(1, m - 1)];
    }
    let days = [];
    for (let cyc = 0; cyc < 3; cyc++) for (const g of rounds) days.push(g.map(([x, y]) => (cyc % 2 ? [y, x] : [x, y])));
    // Extra games: a random cycle through all teams gives each team 2 more games.
    const target = S.sim.games || 44;
    const extraPer = target - 3 * (n - 1);
    if (extraPer > 0) {
      for (let e = 0; e < Math.floor(extraPer / 2); e++) {
        const cyc = shuffle(ids.slice());
        const edges = cyc.map((x, i) => [x, cyc[(i + 1) % n]]);
        // split the cycle into matchings
        const d1 = [], d2 = [], d3 = [];
        edges.forEach((ed, i) => (i === n - 1 && n % 2 ? d3 : i % 2 ? d2 : d1).push(ed));
        days.push(d1, d2); if (d3.length) days.push(d3);
      }
    }
    days = shuffle(days);
    // Randomize home/away within each game.
    const sched = [];
    let gid = 1;
    days.forEach((games, d) => games.forEach(([x, y]) => {
      const flip = rnd() < 0.5;
      sched.push({ gid: gid++, day: d + 1, home: flip ? x : y, away: flip ? y : x, played: false });
    }));
    return sched;
  }
  const lastDay = () => Math.max(...S.schedule.map((g) => g.day));

  // ---------- game simulation ----------
  function simGame(homeId, awayId, opts = {}) {
    const k = S.sim.marginPerRating, home = opts.neutral ? 0 : S.sim.homeAdv;
    const rh = rotation(homeId), ra = rotation(awayId);
    const trh = rh.length ? sum(rh.map((x) => P(x.id).r.ovr * x.min)) / 200 : 40;
    const tra = ra.length ? sum(ra.map((x) => P(x.id).r.ovr * x.min)) / 200 : 40;
    const base = S.sim.leaguePts;
    const margin = (trh - tra) * k + home;
    let hs = Math.round(base + margin / 2 + randn() * 8.6);
    let as = Math.round(base - margin / 2 + randn() * 8.6);
    let ot = 0;
    while (hs === as) { ot++; hs += Math.round(9 + randn() * 3.5 + (trh - tra) * 0.15); as += Math.round(9 + randn() * 3.5); }
    const box = { gid: opts.gid, home: homeId, away: awayId, hs, as, ot, players: {} };
    box.players[homeId] = distributeBox(rh, hs, as, ot);
    box.players[awayId] = distributeBox(ra, as, hs, ot);
    return box;
  }

  function distributeBox(rot, pts, oppPts, ot) {
    const extra = ot * 5;
    const ps = rot.map((x) => ({ p: P(x.id), min: x.min * (1 + extra / 200) * (0.88 + rnd() * 0.24), start: x.start }));
    const totMin = sum(ps.map((x) => x.min));
    ps.forEach((x) => (x.min = (x.min * (200 + extra)) / totMin));
    const lw = () => Math.exp(randn() * 0.33);
    const alloc = (total, wfn) => {
      const w = ps.map((x) => x.min * wfn(x.p) * lw());
      const W = sum(w) || 1;
      const raw = w.map((v) => (v / W) * total);
      const out = raw.map(Math.floor);
      let rem = Math.round(total) - sum(out);
      const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]);
      for (let i = 0; rem > 0 && i < order.length; i++, rem--) out[order[i][1]]++;
      return out;
    };
    const off = (p) => 0.45 * p.r.ins + 0.35 * p.r.thr + 0.2 * p.r.ovr;
    const ptsA = alloc(pts, (p) => Math.exp((off(p) - 55) / 26));
    const lines = ps.map((x, i) => {
      const p = x.p, pt = ptsA[i];
      const f3 = clamp(0.05 + (p.r.thr - 35) * 0.009, 0, 0.55);
      const fft = clamp(0.13 + (p.r.ath - 50) * 0.003 + (p.r.ins - 50) * 0.002, 0.04, 0.3);
      let tpm = Math.round((pt * f3) / 3 + (rnd() - 0.5));
      tpm = clamp(tpm, 0, Math.floor(pt / 3));
      let ftm = Math.round(pt * fft + (rnd() - 0.5) * 2);
      ftm = clamp(ftm, 0, pt - tpm * 3);
      if ((pt - tpm * 3 - ftm) % 2) ftm += ftm > 0 && rnd() < 0.5 ? -1 : 1;
      ftm = clamp(ftm, 0, pt - tpm * 3);
      const twom = Math.max(0, (pt - tpm * 3 - ftm) / 2);
      const p3 = clamp(0.25 + p.r.thr * 0.0017 + randn() * 0.06, 0.15, 0.6);
      const p2 = clamp(0.41 + p.r.ins * 0.0017 + randn() * 0.06, 0.3, 0.72);
      const pf = clamp(0.58 + p.r.fts * 0.0033, 0.5, 0.96);
      const tpa = tpm + Math.round((tpm || (p.r.thr > 50 && x.min > 12 ? 1 : 0)) * (1 / p3 - 1) + (rnd() - 0.3));
      const twoa = Math.round(twom / p2 + (rnd() - 0.5) * 0.8);
      const fta = ftm + Math.round(ftm * (1 / pf - 1) + rnd() * 0.7);
      return { id: p.id, min: Math.round(x.min), start: x.start, pts: pt, tpm, tpa, fgm: twom + tpm, fga: twoa + tpa, ftm, fta, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
    });
    const fgm = sum(lines.map((l) => l.fgm));
    const teamReb = clamp(Math.round(34 + (pts - oppPts) * 0.08 + randn() * 4), 22, 50);
    const rebA = alloc(teamReb, (p) => Math.exp((p.r.reb - 50) / 22));
    const astA = alloc(Math.round(fgm * (0.58 + randn() * 0.06)), (p) => Math.exp((p.r.ply - 50) / 15));
    const stlA = alloc(clamp(Math.round(7.5 + randn() * 2.5), 1, 16), (p) => Math.exp((p.r.def + p.r.ath - 100) / 24));
    const blkA = alloc(clamp(Math.round(3.8 + randn() * 1.8), 0, 11), (p) => Math.exp((p.r.reb + p.r.def + p.r.ath - 150) / 22));
    const tovA = alloc(clamp(Math.round(13 + randn() * 3), 5, 24), (p) => Math.exp((off(p) - 55) / 30) * Math.exp((p.r.ply - 50) / 60));
    lines.forEach((l, i) => { l.reb = rebA[i]; l.ast = astA[i]; l.stl = stlA[i]; l.blk = blkA[i]; l.tov = tovA[i]; });
    return lines;
  }

  function applyBox(box, playoff) {
    for (const tid of [box.home, box.away]) {
      for (const l of box.players[tid]) {
        const p = P(l.id);
        const bucket = playoff ? p.po : p.stats;
        const st = (bucket[S.season] ||= { team: tid, ...Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) });
        st.team = tid;
        st.gp++; if (l.start) st.gs++;
        for (const k of ["min", "pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta"]) st[k] += l[k];
        // Injury roll
        if (p.inj === 0 && rnd() < 0.0045 * (l.min / 30)) {
          const g = Math.max(1, Math.round(-Math.log(rnd()) * 5));
          p.inj = g; p.injType = pick(["ankle sprain", "knee soreness", "hamstring strain", "back spasms", "concussion protocol", "foot soreness", "illness", "wrist sprain"]);
          if (g >= 5 && (tid === S.userTeam || p.r.ovr >= 75)) log(`${p.name} (${tid}) is out ~${g} games with ${p.injType}.`, tid);
        }
      }
    }
  }
  function healDay(tids) {
    for (const p of Object.values(S.players)) if (p.inj > 0 && p.team && (!tids || tids.has(p.team))) { p.inj--; if (!p.inj) p.injType = null; }
  }

  // ---------- regular season ----------
  function startSeason() {
    const ut = S.userTeam;
    const n = roster(ut).length;
    if (n < S.econ.rosterMin) return { ok: false, msg: `You need at least ${S.econ.rosterMin} players to start the season (you have ${n}). Sign free agents first.` };
    if (n > S.econ.rosterMax) return { ok: false, msg: `Your roster has ${n} players; the limit is ${S.econ.rosterMax}. Release or trade players first.` };
    for (const t of S.teams) if (t.id !== ut) aiRosterFix(t.id);
    S.phase = "regular"; S.day = 0;
    log(`The ${S.season} regular season is underway.`);
    save(); emit();
    return { ok: true };
  }

  function simDays(nDays) {
    if (S.phase !== "regular") return;
    const end = lastDay();
    for (let i = 0; i < nDays && S.day < end; i++) {
      S.day++;
      const games = S.schedule.filter((g) => g.day === S.day && !g.played);
      for (const g of games) {
        const box = simGame(g.home, g.away, { gid: g.gid });
        g.played = true; g.hs = box.hs; g.as = box.as; g.ot = box.ot;
        S.boxes[g.gid] = box;
        applyBox(box, false);
        const h = T(g.home), a = T(g.away);
        h.pf += box.hs; h.pa += box.as; a.pf += box.as; a.pa += box.hs;
        if (box.hs > box.as) { h.w++; h.hw++; a.l++; h.streak = h.streak > 0 ? h.streak + 1 : 1; a.streak = a.streak < 0 ? a.streak - 1 : -1; }
        else { a.w++; h.l++; h.hl++; a.streak = a.streak > 0 ? a.streak + 1 : 1; h.streak = h.streak < 0 ? h.streak - 1 : -1; }
      }
      healDay();
      if (S.day % 4 === 0) aiDaily();
    }
    if (S.day >= end) endRegularSeason();
    save(); emit();
  }
  const tradeDeadlineDay = () => Math.round(lastDay() * 0.65);
  const tradesOpen = () => S.phase !== "playoffs" && !(S.phase === "regular" && S.day > tradeDeadlineDay()) && S.phase !== "draft";

  function standings() {
    return S.teams.slice().sort((a, b) => {
      const pa = a.w / Math.max(1, a.w + a.l), pb = b.w / Math.max(1, b.w + b.l);
      if (pb !== pa) return pb - pa;
      return (b.pf - b.pa) - (a.pf - a.pa);
    });
  }

  // ---------- playoffs ----------
  function endRegularSeason() {
    const st = standings();
    const seeds = st.slice(0, 8).map((t) => t.id);
    S.seasonSeeds = st.map((t) => t.id);
    log(`Regular season complete. ${teamName(st[0].id)} finish first at ${st[0].w}-${st[0].l}.`);
    const mk = (a, b, bestOf) => ({ hi: a, lo: b, bestOf, wh: 0, wl: 0, games: [], winner: null });
    S.playoffs = {
      seeds,
      rounds: [[mk(seeds[0], seeds[7], 3), mk(seeds[3], seeds[4], 3), mk(seeds[1], seeds[6], 3), mk(seeds[2], seeds[5], 3)]],
      bestOf: [3, 5, 7], champion: null,
    };
    S.awards = computeAwards();
    S.phase = "playoffs";
    const ut = S.userTeam;
    log(seeds.includes(ut) ? `You're in: the ${teamName(ut)} are the #${seeds.indexOf(ut) + 1} seed.` : `The ${teamName(ut)} missed the playoffs.`, ut);
  }

  function simPlayoffGame() {
    const po = S.playoffs; if (!po || po.champion) return false;
    const round = po.rounds[po.rounds.length - 1];
    const active = round.filter((s) => !s.winner);
    if (!active.length) { advancePlayoffRound(); return true; }
    for (const s of active) {
      const gnum = s.games.length;
      // 2-2-1-1-1 style: higher seed hosts games 1,2,5,7 (bo3: 1,3)
      const hiHome = s.bestOf === 3 ? gnum !== 1 : [0, 1, 4, 6].includes(gnum);
      const home = hiHome ? s.hi : s.lo, away = hiHome ? s.lo : s.hi;
      const box = simGame(home, away, { gid: `po${S.season}-${s.hi}-${s.lo}-${gnum + 1}` });
      S.boxes[box.gid] = box;
      applyBox(box, true);
      const hiWon = (home === s.hi) === (box.hs > box.as);
      if (hiWon) s.wh++; else s.wl++;
      s.games.push({ home, away, hs: box.hs, as: box.as, gid: box.gid });
      const need = Math.ceil(s.bestOf / 2);
      if (s.wh === need || s.wl === need) {
        s.winner = s.wh === need ? s.hi : s.lo;
        const loser = s.winner === s.hi ? s.lo : s.hi;
        log(`${teamName(s.winner)} beat the ${teamName(loser)} ${Math.max(s.wh, s.wl)}-${Math.min(s.wh, s.wl)}.`, s.winner);
      }
    }
    healDay(new Set(active.flatMap((s) => [s.hi, s.lo])));
    if (!round.some((s) => !s.winner)) advancePlayoffRound();
    return true;
  }
  function advancePlayoffRound() {
    const po = S.playoffs;
    const round = po.rounds[po.rounds.length - 1];
    const winners = round.map((s) => s.winner);
    if (winners.length === 1) {
      po.champion = winners[0];
      const fin = round[0];
      po.runnerUp = fin.winner === fin.hi ? fin.lo : fin.hi;
      po.finalsMvp = finalsMvp(po.champion);
      log(`🏆 The ${teamName(po.champion)} are the ${S.season} WNBA champions! Finals MVP: ${P(po.finalsMvp)?.name}.`, po.champion);
      return;
    }
    const seedOf = (id) => po.seeds.indexOf(id);
    const next = [];
    for (let i = 0; i < winners.length; i += 2) {
      let [a, b] = [winners[i], winners[i + 1]];
      if (seedOf(b) < seedOf(a)) [a, b] = [b, a];
      next.push({ hi: a, lo: b, bestOf: po.bestOf[po.rounds.length], wh: 0, wl: 0, games: [], winner: null });
    }
    po.rounds.push(next);
  }
  function simPlayoffs(untilEnd) {
    if (S.phase !== "playoffs") return;
    if (untilEnd) { let guard = 0; while (!S.playoffs.champion && guard++ < 50) simPlayoffGame(); }
    else {
      const startRounds = S.playoffs.rounds.length;
      let guard = 0;
      while (!S.playoffs.champion && S.playoffs.rounds.length === startRounds && guard++ < 10) simPlayoffGame();
    }
    save(); emit();
  }
  function simPlayoffDay() { if (S.phase === "playoffs") { simPlayoffGame(); save(); emit(); } }

  // ---------- awards ----------
  function perGame(p, season = S.season, po = false) {
    const st = (po ? p.po : p.stats)[season];
    if (!st || !st.gp) return null;
    const g = st.gp;
    return {
      team: st.team, gp: g, gs: st.gs, min: round1(st.min / g), pts: round1(st.pts / g), reb: round1(st.reb / g), ast: round1(st.ast / g),
      stl: round1(st.stl / g), blk: round1(st.blk / g), tov: round1(st.tov / g),
      fg: st.fga ? st.fgm / st.fga : 0, tp: st.tpa ? st.tpm / st.tpa : 0, ft: st.fta ? st.ftm / st.fta : 0,
      ts: st.fga + st.fta ? st.pts / (2 * (st.fga + 0.44 * st.fta)) : 0,
    };
  }
  function awardScore(p) {
    const s = perGame(p); if (!s || s.gp < 20) return -1;
    const t = T(s.team); const wp = t.w / Math.max(1, t.w + t.l);
    return s.pts + 1.1 * s.reb + 1.4 * s.ast + 2 * (s.stl + s.blk) - s.tov + (s.ts - 0.54) * 40 + wp * 12;
  }
  function computeAwards() {
    const ps = Object.values(S.players).filter((p) => p.team && perGame(p));
    const by = (f) => ps.filter((p) => f(p) > -1).sort((a, b) => f(b) - f(a));
    const mvp = by(awardScore);
    const roy = by((p) => (p.exp === 0 ? awardScore(p) : -1));
    const dpoy = by((p) => { const s = perGame(p); if (!s || s.gp < 20) return -1; return 3 * (s.stl + s.blk) + 0.4 * s.reb + p.r.def * 0.12 + s.min * 0.05; });
    const a = { mvp: mvp[0]?.id, roy: roy[0]?.id, dpoy: dpoy[0]?.id, allFirst: mvp.slice(0, 5).map((p) => p.id), allSecond: mvp.slice(5, 10).map((p) => p.id) };
    if (a.mvp) log(`${P(a.mvp).name} is the ${S.season} MVP.`, P(a.mvp).team);
    if (a.roy) log(`${P(a.roy).name} is the ${S.season} Rookie of the Year.`, P(a.roy).team);
    if (a.dpoy) log(`${P(a.dpoy).name} is the ${S.season} Defensive Player of the Year.`, P(a.dpoy).team);
    return a;
  }
  function finalsMvp(tid) {
    const ps = roster(tid).filter((p) => p.po[S.season]);
    ps.sort((a, b) => { const x = a.po[S.season], y = b.po[S.season]; return (y.pts + y.reb + y.ast) - (x.pts + x.reb + x.ast); });
    return ps[0]?.id;
  }

  // ---------- offseason ----------
  // Phases: playoffs(done) -> draft -> resign -> freeagency -> preseason(next season)
  function advanceToDraft() {
    if (S.phase !== "playoffs" || !S.playoffs?.champion) return;
    const po = S.playoffs;
    const st = standings();
    S.history.unshift({
      season: S.season, champion: po.champion, runnerUp: po.runnerUp, finalsMvp: po.finalsMvp, ...S.awards,
      standings: st.map((t) => ({ id: t.id, w: t.w, l: t.l })),
      userRecord: { w: T(S.userTeam).w, l: T(S.userTeam).l, seed: po.seeds.indexOf(S.userTeam) + 1 },
    });
    // Archive season lines into careers.
    for (const p of Object.values(S.players)) {
      const s = perGame(p);
      if (s) p.career.push({ season: S.season, ...s, ovr: p.r.ovr });
    }
    // Draft order: lottery among non-playoff teams, then playoff teams by record (worst first).
    const nonPO = S.seasonSeeds.slice(8).reverse(); // worst first
    const weights = [30, 22, 16, 12, 9, 6, 5];
    const lottery = [];
    const pool = nonPO.map((id, i) => ({ id, w: weights[i] ?? 3 }));
    for (let k = 0; k < Math.min(4, pool.length); k++) {
      const W = sum(pool.map((x) => x.w)); let r = rnd() * W; let idx = 0;
      while (r > pool[idx].w) { r -= pool[idx].w; idx++; }
      lottery.push(pool.splice(idx, 1)[0].id);
    }
    const order1 = lottery.concat(pool.map((x) => x.id), S.seasonSeeds.slice(0, 8).reverse());
    const slots = [];
    for (const rd of [1, 2, 3]) {
      const ord = rd === 1 ? order1 : S.seasonSeeds.slice().reverse();
      ord.forEach((orig) => {
        const pk = S.picks.find((x) => x.season === S.season && x.round === rd && x.orig === orig);
        slots.push({ round: rd, orig, owner: pk ? pk.owner : orig, player: null });
      });
    }
    slots.forEach((s, i) => (s.pick = i + 1));
    S.draft = { season: S.season, slots, cur: 0, lottery };
    log(`Draft lottery: ${teamName(lottery[0])} win the #1 pick.`, lottery[0]);
    S.phase = "draft";
    save(); emit();
  }
  const draftOnClock = () => S.draft && S.draft.slots[S.draft.cur];
  const availableProspects = () => S.prospects.map(P).filter((p) => p && !p.team && p.prospect === S.season);

  function rookieContract(slot) {
    const e = S.econ;
    if (slot.round === 1) {
      const sal = e.rookieTop - ((slot.pick - 1) * (e.rookieTop - e.min * 1.16)) / 14;
      return { sal: Math.round(sal / 1000) * 1000, yrs: 4, rookie: true };
    }
    return { sal: e.min, yrs: 2, rookie: true, nonGuaranteed: true };
  }
  function draftPlayer(pid) {
    const slot = draftOnClock(); if (!slot) return;
    const p = P(pid);
    p.team = slot.owner; p.c = rookieContract(slot); p.prospect = null; p.exp = 0;
    p.acq = `#${slot.pick} pick in ${S.season} draft`;
    p.draftInfo = { season: S.season, pick: slot.pick, round: slot.round, team: slot.owner };
    slot.player = pid;
    if (slot.round === 1 || slot.owner === S.userTeam) log(`Pick ${slot.pick}: ${teamName(slot.owner)} select ${p.name} (${p.school}).`, slot.owner);
    S.draft.cur++;
    if (S.draft.cur >= S.draft.slots.length) finishDraft();
  }
  function aiDraftChoice(tid) {
    const mode = teamMode(tid);
    const av = availableProspects();
    av.sort((a, b) => {
      const va = a.r.ovr * (mode === "contend" ? 0.65 : 0.45) + a.r.pot * (mode === "contend" ? 0.35 : 0.55) + randn() * 2;
      const vb = b.r.ovr * (mode === "contend" ? 0.65 : 0.45) + b.r.pot * (mode === "contend" ? 0.35 : 0.55) + randn() * 2;
      return vb - va;
    });
    return av[0]?.id;
  }
  // Auto-pick until it's the user's turn (or the draft ends).
  function draftUntilUser(includeUser) {
    let guard = 0;
    while (S.phase === "draft" && draftOnClock() && guard++ < 100) {
      const slot = draftOnClock();
      if (slot.owner === S.userTeam && !includeUser) break;
      const pid = aiDraftChoice(slot.owner);
      if (!pid) { S.draft.cur++; continue; }
      draftPlayer(pid);
    }
    save(); emit();
  }
  function userDraft(pid) {
    const slot = draftOnClock();
    if (!slot || slot.owner !== S.userTeam) return;
    draftPlayer(pid); save(); emit();
  }
  function finishDraft() {
    // Undrafted prospects become free agents.
    for (const p of availableProspects()) { p.prospect = null; p.ask = { sal: S.econ.min, yrs: 1 }; }
    S.picks = S.picks.filter((x) => x.season !== S.season);
    addPicksFor(S.season + 2);
    S.phase = "resign";
    // Expiring contracts: yrs counts seasons remaining including the one just played.
    for (const p of Object.values(S.players)) if (p.team && !p.retired) {
      if (p.c.yrs <= 1 && !(p.draftInfo && p.draftInfo.season === S.season)) {
        p.expiring = true; p.ask = askingContract(p); p.mood = 0.85 + rnd() * 0.3;
      }
    }
    log(`The ${S.season} draft is complete. Teams now decide on their expiring contracts.`);
  }

  function resignPlayer(pid) {
    const p = P(pid);
    if (!p.expiring || p.team !== S.userTeam) return { ok: false };
    p.resign = true; p.expiring = false;
    p.c = { sal: p.ask.sal, yrs: p.ask.yrs + 1, rookie: false }; // +1 because the old season rolls off at advance
    log(`${teamName(S.userTeam)} re-sign ${p.name}: ${fmtMoney(p.ask.sal)} x ${p.ask.yrs}.`, S.userTeam);
    save(); emit();
    return { ok: true };
  }
  function letGo(pid) { const p = P(pid); if (p.team === S.userTeam && p.expiring) { p.declined = true; save(); emit(); } }

  function advanceToFreeAgency() {
    if (S.phase !== "resign") return;
    // AI decisions on expiring players.
    for (const p of Object.values(S.players)) {
      if (!p.team || !p.expiring) continue;
      if (p.team === S.userTeam) {
        if (!p.resign) toFreeAgency(p);
        continue;
      }
      const keep = (p.r.ovr >= 60 || (p.age <= 25 && p.r.pot >= 65)) && rnd() < 0.7 && p.age <= 33;
      if (keep) { p.c = { sal: p.ask.sal, yrs: p.ask.yrs + 1, rookie: false }; p.expiring = false; }
      else toFreeAgency(p);
    }
    // Season rolls: contracts tick down, players age and develop, some retire.
    for (const p of Object.values(S.players)) {
      if (p.retired) continue;
      const justDrafted = p.draftInfo && p.draftInfo.season === S.season;
      if (p.team && !justDrafted) p.c.yrs = Math.max(0, p.c.yrs - 1);
      p.expiring = false; p.resign = false; p.declined = false;
    }
    progressPlayers();
    retirements();
    S.season++;
    for (const k of ["cap", "max", "min", "rookieTop"]) S.econ[k] = Math.round((S.econ[k] * (1 + S.econ.growth)) / 5000) * 5000;
    for (const t of S.teams) { t.dead = t.dead.filter((d) => d.season >= S.season); }
    S.prospects = genProspects(S.season);
    S.phase = "freeagency"; S.faDay = 0;
    for (const p of freeAgents()) p.ask = askingContract(p);
    log(`Free agency is open. The ${S.season} salary cap is ${fmtMoney(S.econ.cap)}.`);
    save(); emit();
  }
  function toFreeAgency(p) {
    const from = p.team;
    p.team = null; p.c = { sal: 0, yrs: 0, rookie: false }; p.expiring = false;
    p.ask = askingContract(p);
    if (p.r.ovr >= 68) log(`${p.name} hits free agency after leaving the ${teamName(from)}.`, from);
  }
  function progressPlayers() {
    const curve = (age) => age <= 21 ? 3 : age <= 22 ? 2.6 : age <= 23 ? 2.2 : age <= 24 ? 1.6 : age <= 25 ? 1.0 : age <= 26 ? 0.6 : age <= 27 ? 0.3 : age <= 28 ? 0 : age <= 29 ? -0.6 : age <= 30 ? -1.1 : age <= 31 ? -1.7 : age <= 32 ? -2.4 : age <= 33 ? -3 : -4;
    for (const p of Object.values(S.players)) {
      if (p.retired) continue;
      p.age++;
      if (p.stats[S.season]) p.exp = (p.exp || 0) + 1;
      let d = curve(p.age) + randn() * 2.4;
      if (p.age <= 26 && p.r.pot > p.r.ovr) d += (p.r.pot - p.r.ovr) * 0.1;
      const old = p.r.ovr;
      p.r.ovr = Math.round(clamp(p.r.ovr + d, 30, 99));
      const dd = p.r.ovr - old;
      for (const k of ["ins", "thr", "fts", "ply", "reb", "def", "ath"]) {
        const f = k === "ath" ? (p.age >= 29 ? 1.5 : 0.8) : 0.6 + rnd() * 0.8;
        p.r[k] = Math.round(clamp(p.r[k] + dd * f + randn(), 20, 99));
      }
      p.r.pot = p.age >= 28 ? p.r.ovr : Math.round(clamp(Math.max(p.r.ovr, p.r.pot + randn() * 2), p.r.ovr, 99));
      if (p.team === S.userTeam && Math.abs(dd) >= 4) log(`${p.name} ${dd > 0 ? "improved" : "declined"} ${dd > 0 ? "+" : ""}${dd} over the offseason (now ${p.r.ovr}).`, S.userTeam);
    }
  }
  function retirements() {
    for (const p of Object.values(S.players)) {
      if (p.retired || p.prospect) continue;
      let pr = 0;
      if (p.age >= 35) pr = 0.35 + (p.age - 35) * 0.15;
      else if (p.age >= 32) pr = p.r.ovr < 60 ? 0.3 : 0.05;
      if (!p.team && p.age >= 29 && p.r.ovr < 50) pr += 0.4;
      if (p.team && p.c.yrs > 0) pr *= 0.3; // under contract: usually plays it out
      if (rnd() < pr) {
        p.retired = S.season;
        if (p.r.ovr >= 65 || p.team === S.userTeam) log(`${p.name} has retired after ${p.exp} seasons.`, p.team);
        p.team = null;
      }
    }
  }

  // ---------- free agency ----------
  function offerContract(pid, sal, yrs) {
    const p = P(pid), ut = S.userTeam;
    if (!p || p.team) return { ok: false, msg: "That player is no longer available." };
    if (roster(ut).length >= S.econ.rosterMax) return { ok: false, msg: `Your roster is full (${S.econ.rosterMax}). Release someone first.` };
    sal = Math.round(clamp(sal, S.econ.min, S.econ.max));
    const minException = sal <= S.econ.min && roster(ut).length < S.econ.rosterMin;
    if (payroll(ut) + sal > S.econ.cap && !minException) return { ok: false, msg: `That offer puts you ${fmtMoney(payroll(ut) + sal - S.econ.cap)} over the hard cap.` };
    const ask = p.ask || askingContract(p);
    // Players weigh salary most, but like contenders and years that match their ask.
    const contender = 1 + (8 - projectedRank(ut)) * 0.006;
    const yrsFit = 1 - Math.abs(yrs - ask.yrs) * 0.03;
    const score = (sal / ask.sal) * contender * yrsFit;
    if (score < 0.97) {
      return { ok: false, msg: `${p.name} turned it down. She's looking for about ${fmtMoney(ask.sal)} over ${ask.yrs} year${ask.yrs > 1 ? "s" : ""}.` };
    }
    p.team = ut; p.c = { sal, yrs, rookie: false }; p.ask = null;
    p.acq = `Signed in ${S.phase === "freeagency" ? "free agency" : "season"} ${S.season}`;
    log(`${teamName(ut)} sign ${p.name}: ${fmtMoney(sal)} x ${yrs}.`, ut);
    save(); emit();
    return { ok: true, msg: `${p.name} signed: ${fmtMoney(sal)} for ${yrs} year${yrs > 1 ? "s" : ""}.` };
  }
  function releasePlayer(pid) {
    const p = P(pid), ut = S.userTeam;
    if (!p || p.team !== ut) return { ok: false };
    if (!p.c.nonGuaranteed && p.c.sal > 0 && S.phase !== "freeagency") T(ut).dead.push({ name: p.name, sal: p.c.sal, season: S.season });
    else if (!p.c.nonGuaranteed && p.c.sal > 0) T(ut).dead.push({ name: p.name, sal: Math.round(p.c.sal / 2), season: S.season });
    p.team = null; p.c = { sal: 0, yrs: 0, rookie: false }; p.ask = askingContract(p);
    const t = T(ut); if (t.rotation) t.rotation = t.rotation.filter((x) => x !== pid);
    log(`${teamName(ut)} release ${p.name}.`, ut);
    save(); emit();
    return { ok: true };
  }
  function faDays(n) {
    if (S.phase !== "freeagency") return;
    for (let i = 0; i < n; i++) { S.faDay++; aiFreeAgency(0.4); }
    save(); emit();
  }
  // AI teams sign the best free agents they can afford.
  function aiFreeAgency(intensity = 1, fillOnly = false) {
    const fas = freeAgents().sort((a, b) => talent(b) - talent(a));
    for (const t of shuffle(S.teams.slice())) {
      if (t.id === S.userTeam) continue;
      const n = roster(t.id).length;
      if (n >= S.econ.rosterMax) continue;
      if (fillOnly && n >= S.econ.rosterMin) continue;
      if (!fillOnly && rnd() > intensity && n >= S.econ.rosterMin) continue;
      const space = capSpace(t.id);
      const worst = roster(t.id).sort((a, b) => a.r.ovr - b.r.ovr)[0];
      for (const p of fas) {
        if (p.team) continue;
        const ask = p.ask || askingContract(p);
        const need = n < S.econ.rosterMin;
        if (ask.sal <= space || (need && ask.sal <= S.econ.min * 1.0001)) {
          if (!need && worst && p.r.ovr < worst.r.ovr + 2) continue;
          p.team = t.id; p.c = { sal: ask.sal, yrs: ask.yrs, rookie: false }; p.ask = null;
          p.acq = `Signed ${S.season}`;
          if (p.r.ovr >= 65) log(`${p.name} signs with the ${teamName(t.id)} (${fmtMoney(ask.sal)} x ${ask.yrs}).`, t.id);
          break;
        }
        if (need) {
          // Desperate: take the best min-salary guy available.
          const cheap = fas.find((x) => !x.team && (x.ask?.sal || 0) <= S.econ.min * 1.3);
          if (cheap) { cheap.team = t.id; cheap.c = { sal: S.econ.min, yrs: 1, rookie: false }; cheap.ask = null; }
          break;
        }
      }
    }
  }
  function aiRosterFix(tid, initial) {
    // Trim to max by releasing the lowest-rated players; fill to min with cheap FAs.
    let ps = roster(tid).sort((a, b) => a.r.ovr - b.r.ovr);
    while (ps.length > S.econ.rosterMax) {
      const p = ps.shift(); p.team = null; p.c = { sal: 0, yrs: 0, rookie: false }; p.ask = askingContract(p);
      if (!initial) log(`${teamName(tid)} waive ${p.name}.`, tid);
    }
    let guard = 0;
    while (roster(tid).length < S.econ.rosterMin && guard++ < 10) {
      const fa = freeAgents().sort((a, b) => b.r.ovr - a.r.ovr)[0];
      if (!fa) break;
      const sal = Math.max(S.econ.min, Math.min(fa.ask?.sal || S.econ.min, capSpace(tid)));
      fa.team = tid; fa.c = { sal, yrs: 1, rookie: false }; fa.ask = null;
    }
  }
  function aiDaily() {
    // In-season: teams with injuries or short rosters patch them.
    for (const t of S.teams) if (t.id !== S.userTeam) {
      const healthy = roster(t.id).filter((p) => !p.inj).length;
      if (healthy < 9 && roster(t.id).length < S.econ.rosterMax) aiRosterFix(t.id);
    }
  }
  function startNextSeason() {
    if (S.phase !== "freeagency") return { ok: false };
    const ut = S.userTeam;
    const n = roster(ut).length;
    if (n > S.econ.rosterMax) return { ok: false, msg: `Your roster has ${n} players; the limit is ${S.econ.rosterMax}.` };
    for (let i = 0; i < 4; i++) aiFreeAgency(0.6);
    for (const t of S.teams) if (t.id !== ut) aiRosterFix(t.id);
    // Unsigned old free agents retire.
    for (const p of freeAgents()) if (p.age >= 31 && rnd() < 0.5) p.retired = S.season;
    // Reset season state.
    for (const t of S.teams) Object.assign(t, { w: 0, l: 0, hw: 0, hl: 0, pf: 0, pa: 0, streak: 0 });
    for (const p of Object.values(S.players)) p.inj = 0;
    S.boxes = {}; S.playoffs = null; S.draft = null; S.awards = null; S.day = 0;
    S.schedule = makeSchedule();
    S.phase = "preseason";
    log(`Preseason ${S.season}. Set your roster: you need ${S.econ.rosterMin}-${S.econ.rosterMax} players.`);
    save(); emit();
    return { ok: true };
  }

  // ---------- trades ----------
  function evaluateTrade(partner, give, get, givePicks = [], getPicks = []) {
    // give/get = arrays of player ids from the user's perspective.
    const ut = S.userTeam;
    const valIn = sum(give.map((id) => playerValue(P(id), partner))) + sum(givePicks.map((k) => pickValue(S.picks[k], partner)));
    const valOut = sum(get.map((id) => playerValue(P(id), partner))) + sum(getPicks.map((k) => pickValue(S.picks[k], partner)));
    const salIn = sum(give.map((id) => P(id).c.sal)), salOut = sum(get.map((id) => P(id).c.sal));
    const issues = [];
    if (!tradesOpen()) issues.push(S.phase === "regular" ? "The trade deadline has passed." : "Trades are closed right now.");
    if (!give.length && !get.length && !givePicks.length && !getPicks.length) issues.push("Add players or picks to the deal.");
    const userAfter = payroll(ut) - salIn + salOut, partnerAfter = payroll(partner) - salOut + salIn;
    if (userAfter > S.econ.cap && salOut > salIn) issues.push(`You'd be ${fmtMoney(userAfter - S.econ.cap)} over the hard cap.`);
    if (partnerAfter > S.econ.cap && salIn > salOut) issues.push(`The ${T(partner).name} would be over the hard cap.`);
    const uN = roster(ut).length - give.length + get.length, pN = roster(partner).length - get.length + give.length;
    if (uN > S.econ.rosterMax) issues.push(`You'd have ${uN} players (max ${S.econ.rosterMax}).`);
    if (pN > S.econ.rosterMax) issues.push(`They'd have ${pN} players (max ${S.econ.rosterMax}).`);
    // AI wants a margin; untouchable stars are expensive.
    const need = valOut * 1.08 + 1.5;
    const ratio = need > 0 ? valIn / need : 1;
    return { valIn, valOut, need, ratio, accept: ratio >= 1 && !issues.length, issues };
  }
  function proposeTrade(partner, give, get, givePicks = [], getPicks = []) {
    const ev = evaluateTrade(partner, give, get, givePicks, getPicks);
    if (!ev.accept) return { ok: false, ev };
    const ut = S.userTeam;
    give.forEach((id) => { const p = P(id); p.team = partner; p.acq = `Traded from ${ut} ${S.season}`; });
    get.forEach((id) => { const p = P(id); p.team = ut; p.acq = `Traded from ${partner} ${S.season}`; });
    givePicks.forEach((k) => (S.picks[k].owner = partner));
    getPicks.forEach((k) => (S.picks[k].owner = ut));
    const pkName = (k) => pickLabel(S.picks[k]);
    const desc = `${teamName(ut)} trade ${[...give.map((id) => P(id).name), ...givePicks.map(pkName)].join(", ") || "nothing"} to the ${teamName(partner)} for ${[...get.map((id) => P(id).name), ...getPicks.map(pkName)].join(", ") || "nothing"}.`;
    log(desc, ut);
    S.tradeLog.unshift({ season: S.season, text: desc });
    const t = T(ut); if (t.rotation) t.rotation = t.rotation.filter((x) => !give.includes(x));
    aiRosterFix(partner);
    save(); emit();
    return { ok: true, ev, desc };
  }
  // Ask the AI what it would take: greedily add the user's assets that close
  // the gap most efficiently (up to 4 additions).
  function suggestBalance(partner, give, get, givePicks, getPicks) {
    give = give.slice(); givePicks = givePicks.slice();
    let ev = evaluateTrade(partner, give, get, givePicks, getPicks);
    if (ev.ratio >= 1 && !ev.issues.length) return { type: "ok" };
    const added = [], addedPicks = [];
    for (let step = 0; step < 4; step++) {
      const opts = [];
      for (const p of roster(S.userTeam)) if (!give.includes(p.id) && playerValue(p, partner) > 0.5)
        opts.push({ kind: "p", id: p.id, ev: evaluateTrade(partner, [...give, p.id], get, givePicks, getPicks) });
      S.picks.forEach((pk, k) => { if (pk.owner === S.userTeam && !givePicks.includes(k))
        opts.push({ kind: "k", id: k, ev: evaluateTrade(partner, give, get, [...givePicks, k], getPicks) }); });
      if (!opts.length) break;
      // Prefer the cheapest single addition that completes the deal; otherwise the biggest step.
      const done = opts.filter((o) => o.ev.ratio >= 1 && !o.ev.issues.length).sort((a, b) => a.ev.ratio - b.ev.ratio);
      const choice = done[0] || opts.sort((a, b) => b.ev.ratio - a.ev.ratio)[0];
      if (choice.kind === "p") { give.push(choice.id); added.push(choice.id); } else { givePicks.push(choice.id); addedPicks.push(choice.id); }
      if (done.length) return { type: "add", pids: added, picks: addedPicks };
    }
    return { type: "none" };
  }
  function pickLabel(pk) {
    const rd = ["", "1st", "2nd", "3rd"][pk.round];
    return `${pk.season} ${rd}-round pick${pk.orig !== pk.owner ? ` (via ${pk.orig})` : ""}`;
  }

  // ---------- money ----------
  function fmtMoney(x) {
    if (Math.abs(x) >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
    return "$" + Math.round(x / 1000) + "K";
  }

  // ---------- persistence ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      S = JSON.parse(raw); rankCache = null; emit(); return S;
    } catch (e) { return null; }
  }
  function importState(obj) { S = obj; rankCache = null; save(); emit(); }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} S = null; rankCache = null; }
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }

  // Preview team ratings before a game exists (team picker).
  function previewTeams() {
    const tmp = S; // may be null
    S = { players: {}, teams: D.teams.map((t) => ({ ...t, dead: [] })), userTeam: null, econ: { rosterMax: 99 } };
    for (const p of D.players) S.players[p.id] = { ...p, inj: 0 };
    const out = D.teams.map((t) => {
      const ps = roster(t.id).sort((a, b) => b.r.ovr - a.r.ovr);
      return { ...t, rating: teamRating(t.id), payroll: sum(ps.map((p) => p.c.sal)), top: ps.slice(0, 3).map((p) => ({ name: p.name, ovr: p.r.ovr })), n: ps.length };
    });
    S = tmp;
    return out;
  }

  window.GM = {
    get S() { return S; }, data: D,
    newGame, load, save, importState, clearSave, hasSave, previewTeams, onChange: (f) => listeners.push(f),
    P, T, teamName, roster, freeAgents, payroll, capSpace, teamRating, rotation, setRotation, powerRanks, teamMode,
    playerValue, pickValue, pickLabel, marketSalary, talent,
    startSeason, simDays, lastDay, tradeDeadlineDay, tradesOpen, standings, simPlayoffs, simPlayoffDay,
    advanceToDraft, draftOnClock, availableProspects, draftUntilUser, userDraft,
    resignPlayer, letGo, advanceToFreeAgency, faDays, startNextSeason,
    offerContract, releasePlayer, evaluateTrade, proposeTrade, suggestBalance,
    perGame, fmtMoney, STAT_KEYS,
  };
})();
