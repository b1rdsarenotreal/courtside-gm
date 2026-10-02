// Headless smoke test: simulate several full seasons with the engine.
// Run: node tests/sim_test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const store = {};
const ctx = { window: {}, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] }, console, Math, JSON };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ["data.js", "names.js", "engine.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx);
const GM = ctx.GM;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
const seasons = +(process.argv[2] || 3);
GM.newGame("IND");
for (let y = 0; y < seasons; y++) {
  const S = GM.S;
  // keep user roster legal
  while (GM.roster("IND").length > S.econ.rosterMax) GM.releasePlayer(GM.roster("IND").sort((a, b) => a.r.ovr - b.r.ovr)[0].id);
  while (GM.roster("IND").length < S.econ.rosterMin) { const fa = GM.freeAgents().sort((a,b)=>a.ask.sal-b.ask.sal)[0]; const r = GM.offerContract(fa.id, fa.ask.sal * 1.05, fa.ask.yrs); if (!r.ok) GM.offerContract(fa.id, S.econ.min, 1); }
  const r = GM.startSeason(); assert(r.ok, "start season: " + r.msg);
  GM.simDays(999);
  assert(S.phase === "playoffs", "phase after regular season");
  const st = GM.standings();
  const games = S.schedule.length;
  const pts = S.schedule.reduce((s, g) => s + g.hs + g.as, 0) / (2 * games);
  console.log(`\n=== ${S.season} === games ${games}, avg pts ${pts.toFixed(1)}`);
  console.log(st.map((t) => `${t.id} ${t.w}-${t.l} (${(t.pf / (t.w + t.l)).toFixed(1)}-${(t.pa / (t.w + t.l)).toFixed(1)}) r${GM.teamRating(t.id).toFixed(1)}`).join("\n"));
  for (const t of S.teams) assert(t.w + t.l === 44, `${t.id} played ${t.w + t.l}`);
  const lead = Object.values(S.players).map((p) => [p, GM.perGame(p)]).filter((x) => x[1] && x[1].gp >= 20).sort((a, b) => b[1].pts - a[1].pts).slice(0, 8);
  console.log("Scoring leaders:", lead.map(([p, s]) => `${p.name} ${s.pts}/${s.reb}/${s.ast} fg${(s.fg*100).toFixed(0)} 3p${(s.tp*100).toFixed(0)}`).join("; "));
  GM.simPlayoffs(true);
  console.log("Champion:", S.playoffs.champion, "Finals MVP:", GM.P(S.playoffs.finalsMvp)?.name, "MVP:", GM.P(S.awards.mvp)?.name);
  GM.advanceToDraft(); assert(S.phase === "draft", "draft phase");
  GM.draftUntilUser(true); assert(S.phase === "resign", "resign phase: " + S.phase);
  GM.advanceToFreeAgency(); assert(S.phase === "freeagency", "fa phase");
  GM.faDays(5);
  const r2 = GM.startNextSeason(); assert(r2.ok, "next season " + r2.msg);
  const cap = S.econ.cap;
  const pays = S.teams.map((t) => [t.id, GM.roster(t.id).length, (GM.payroll(t.id) / 1e6).toFixed(2)]);
  console.log("Rosters/payroll:", pays.map((x) => x.join(":")).join(" "), "cap", (cap / 1e6).toFixed(2));
  for (const t of S.teams) if (t.id !== "IND") assert(GM.roster(t.id).length >= 12 && GM.roster(t.id).length <= 15, "roster size " + t.id + " " + GM.roster(t.id).length);
}
const json = JSON.stringify(GM.S); console.log("\nsave size", (json.length / 1024).toFixed(0), "KB");
console.log("OK");
const top = Object.values(GM.S.players).filter((p) => p.team).sort((a, b) => b.r.ovr - a.r.ovr).slice(0, 15);
console.log("Top players now:", top.map((p) => `${p.name}${p.real ? "" : "*"} ${p.r.ovr}/${p.r.pot} age${p.age}`).join("; "));
