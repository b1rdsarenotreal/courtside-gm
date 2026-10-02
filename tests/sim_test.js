// Headless smoke test: run a commissioner league for N seasons from a start year.
// Run: node tests/sim_test.js [startYear] [seasons]
const fs = require("fs"), path = require("path"), vm = require("vm");
const store = {};
const ctx = { console, Math, JSON, setTimeout, clearTimeout, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ["data.js", "names.js", "engine.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx);
const GM = ctx.GM;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
const start = +(process.argv[2] || 1997), n = +(process.argv[3] || 5);
GM.newLeague(start);
for (let i = 0; i < n; i++) {
  const S = GM.S;
  if (i === 1) { const r = GM.expandTeam({ city: "Nashville", name: "Notes", abbr: "NSH", color: "#335" }); assert(r.ok, "expand " + r.msg); }
  if (i === 2) { GM.setRules({ playoffTeams: 6, seeding: "overall", earlyBo: 3, semisBo: 5, finalsBo: 7 }); }
  assert(GM.startSeason().ok, "start");
  GM.simDays(999);
  assert(S.phase === "playoffs", "playoffs");
  GM.simPlayoffs("all");
  assert(S.playoffs.champion, "champion");
  const st = GM.standings();
  const pts = S.schedule.reduce((s, g) => s + g.hs + g.as, 0) / (2 * S.schedule.length);
  const gp = st.map((t) => t.w + t.l);
  const mvp = GM.P(S.awards.mvp);
  console.log(`${S.season}: ${st.length} teams, ${Math.min(...gp)}-${Math.max(...gp)} gp, ${pts.toFixed(1)} ppg | best ${st[0].abbr} ${st[0].w}-${st[0].l}, worst ${st.at(-1).abbr} ${st.at(-1).w}-${st.at(-1).l} | champ ${GM.T(S.playoffs.champion).abbr} | MVP ${mvp?.name} ${JSON.stringify(GM.perGame(mvp))?.slice(0, 60)}`);
  GM.toOffseason();
  const ev = GM.pendingEvents(); if (ev.length) console.log("   events:", ev.map((e) => e.text).join("; "));
  assert(GM.advanceToNextSeason().ok, "advance");
  for (const t of GM.activeTeams()) { const r = GM.roster(t.fid).length; assert(r >= S.rules.rosterMin && r <= S.rules.rosterMax, `roster ${t.abbr} ${r}`); }
  const d = S.lastDraft; if (d && d.picks.length) console.log("   draft top 3:", d.picks.slice(0, 3).map((x) => GM.P(x.pid).name + (GM.P(x.pid).real ? "" : "*")).join(", "));
}
const top = Object.values(GM.S.players).filter((p) => p.team).sort((a, b) => b.r.ovr - a.r.ovr).slice(0, 10);
console.log("Top now:", top.map((p) => `${p.name}${p.real ? "" : "*"} ${p.r.ovr} (${GM.age(p)})`).join("; "));
console.log("save KB", (JSON.stringify(GM.S).length / 1024).toFixed(0), "OK");
