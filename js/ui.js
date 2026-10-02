// WNBA GM simulator UI: renders views from GM.S and wires up actions.
(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (x) => GM.fmtMoney(x);
  const pct = (x) => (x ? (x * 100).toFixed(1) : "–");
  const f1 = (x) => (x == null ? "–" : (+x).toFixed(1));
  const ht = (i) => (i ? `${Math.floor(i / 12)}'${i % 12}"` : "–");

  const ui = {
    tab: "dashboard",
    sort: {},
    trade: { partner: null, give: new Set(), get: new Set(), givePicks: new Set(), getPicks: new Set(), msg: null },
    offer: null,
    modal: null,
    newsMine: false,
    leaders: "pts",
    players: { q: "", team: "all", sort: "ovr" },
    confirm: null,
  };

  // ---------- shared bits ----------
  const tier = (o) => (o >= 80 ? "t1" : o >= 70 ? "t2" : o >= 60 ? "t3" : "t4");
  const ovr = (o) => `<span class="ovr ${tier(o)}">${o}</span>`;
  const rt = (v) => `<span class="rt ${v >= 75 ? "hi" : v >= 55 ? "mid" : "lo"}">${v}</span>`;
  const badge = (tid, big) => { const t = GM.T(tid); return t ? `<span class="badge${big ? " big" : ""}" style="background:${t.color}">${tid}</span>` : `<span class="badge" style="background:var(--tier-4)">FA</span>`; };
  const plink = (p) => `<button class="plink" data-act="player" data-id="${p.id}">${esc(p.name)}</button><span class="pos">${esc(p.pos)}</span>`;
  const rec = (t) => `${t.w}-${t.l}`;
  const phaseLabel = { preseason: "Preseason", regular: "Regular season", playoffs: "Playoffs", draft: "Draft", resign: "Re-signings", freeagency: "Free agency" };

  function toast(msg, bad) {
    const el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function sortRows(rows, key, defs) {
    const s = ui.sort[key] || defs;
    const get = s.get;
    rows.sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * (s.dir || -1); });
    return rows;
  }
  function th(label, key, col, numeric = true) {
    const s = ui.sort[key];
    const on = s && s.col === col;
    return `<th class="sortable${numeric ? " num" : ""}${on ? " sorted" : ""}" data-act="sort" data-key="${key}" data-col="${col}">${label}${on ? (s.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  }

  // ---------- top bar ----------
  function renderTop() {
    const S = GM.S;
    if (!S) { $("#top").innerHTML = `<div class="topbar-inner"><span class="brand">Courtside GM</span></div>`; return; }
    const ut = GM.T(S.userTeam);
    const ranks = GM.powerRanks();
    const space = GM.capSpace(S.userTeam);
    const tabs = [
      ["dashboard", "Front office"], ["roster", "Roster"], ["trade", "Trade"], ["fa", "Free agents"], ["draft", "Draft"],
      ["standings", "Standings"], ["schedule", "Schedule"], ["leaders", "Leaders"], ["players", "Players"], ["history", "History"], ["settings", "Save & info"],
    ];
    const dot = (k) => (k === "draft" && S.phase === "draft") || (k === "fa" && S.phase === "freeagency") || (k === "roster" && S.phase === "resign") ? `<span class="dot"></span>` : "";
    $("#top").innerHTML = `
      <div class="topbar-inner">
        <div class="teamline">${badge(ut.id, true)}<div><div class="brand">${S.season} · ${phaseLabel[S.phase]}${S.phase === "regular" ? ` · day ${S.day}/${GM.lastDay()}` : ""}</div><div class="tname">${esc(ut.city)} ${esc(ut.name)}</div></div></div>
        <div class="score">
          <div class="cell"><span class="lab">Record</span><span class="val accent">${rec(ut)}</span></div>
          <div class="cell"><span class="lab">Power rank</span><span class="val">${ranks[ut.id]}<small style="font-size:.8rem;opacity:.6">/15</small></span></div>
          <div class="cell"><span class="lab">Cap space</span><span class="val" style="color:${space < 0 ? "var(--bad)" : "inherit"}">${money(space)}</span></div>
          <div class="cell"><span class="lab">Roster</span><span class="val">${GM.roster(ut.id).length}</span></div>
          ${primaryAction()}
        </div>
      </div>
      <nav class="tabs" aria-label="Sections">${tabs.map(([k, l]) => `<button class="tab" data-act="tab" data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ""}>${l}${dot(k)}</button>`).join("")}</nav>`;
  }
  function primaryAction() {
    const S = GM.S;
    switch (S.phase) {
      case "preseason": return `<button class="btn primary" data-act="startSeason">Start ${S.season} season</button>`;
      case "regular": return `<div class="row"><button class="btn" data-act="sim" data-n="1">Sim day</button><button class="btn primary" data-act="sim" data-n="7">Sim week</button></div>`;
      case "playoffs": return S.playoffs.champion ? `<button class="btn primary" data-act="toDraft">Go to the draft</button>` : `<button class="btn primary" data-act="poRound">Sim round</button>`;
      case "draft": return `<button class="btn primary" data-act="tab" data-tab="draft">Draft room</button>`;
      case "resign": return `<button class="btn primary" data-act="toFA">Open free agency</button>`;
      case "freeagency": return `<button class="btn primary" data-act="nextSeason">Start ${S.season} preseason</button>`;
    }
    return "";
  }

  // ---------- team picker ----------
  function renderPicker() {
    const teams = GM.previewTeams().sort((a, b) => b.rating - a.rating);
    const cap = GM.data.econ.salaryCap;
    $("#view").innerHTML = `
      <section class="hero">
        <span class="eyebrow">Built on ${esc(GM.data.source)} · ${GM.data.baseSeason} season data</span>
        <h1>Take over a <em>WNBA</em> franchise</h1>
        <p>Every roster, rating and stat line starts from the real ${GM.data.baseSeason} season. Pick a team, then run it: trades, free agency, the draft, and ${GM.data.sim.games}-game seasons through the Finals. Teams are sorted by roster strength.</p>
        <p class="sub">Fan-made simulator. Not affiliated with or endorsed by the WNBA or its teams.</p>
      </section>
      <div class="pickgrid">
        ${teams.map((t) => `
          <button class="tcard" style="--tc:${t.color}" data-act="pickTeam" data-id="${t.id}">
            <div class="tt">${badge(t.id, true)}<div><b>${esc(t.city)}<br>${esc(t.name)}</b></div></div>
            <div class="meta">
              <div><span>${GM.data.baseSeason}</span><span>${t.last.w}-${t.last.l}</span></div>
              <div><span>Rating</span><span>${t.rating.toFixed(1)}</span></div>
              <div><span>Cap room</span><span>${money(cap - t.payroll)}</span></div>
            </div>
            <ul>${t.top.map((p) => `<li><span>${esc(p.name)}</span>${ovr(p.ovr)}</li>`).join("")}</ul>
          </button>`).join("")}
      </div>`;
  }

  // ---------- dashboard ----------
  function renderDashboard() {
    const S = GM.S, ut = S.userTeam, t = GM.T(ut);
    const st = GM.standings();
    const seed = st.findIndex((x) => x.id === ut) + 1;
    const rating = GM.teamRating(ut);
    const myGames = S.schedule.filter((g) => g.home === ut || g.away === ut);
    const next = myGames.find((g) => !g.played);
    const recent = myGames.filter((g) => g.played).slice(-6).reverse();
    const news = S.news.filter((n) => !ui.newsMine || n.team === ut).slice(0, 40);
    const top = GM.roster(ut).sort((a, b) => b.r.ovr - a.r.ovr).slice(0, 5);
    const pf = t.w + t.l ? (t.pf / (t.w + t.l)).toFixed(1) : "–", pa = t.w + t.l ? (t.pa / (t.w + t.l)).toFixed(1) : "–";

    $("#view").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="eyebrow">Standing</span><span class="v">${S.phase === "preseason" ? "–" : ordinal(seed)}</span><span class="n">${S.phase === "preseason" ? `${t.last && S.season === GM.data.startSeason ? `${GM.data.baseSeason}: ${t.last.w}-${t.last.l}` : "Season not started"}` : `${rec(t)} · top 8 make the playoffs`}</span></div>
        <div class="kpi"><span class="eyebrow">Team rating</span><span class="v">${rating.toFixed(1)}</span><span class="n">Minutes-weighted OVR · ${GM.teamMode(ut) === "contend" ? "contender" : GM.teamMode(ut) === "rebuild" ? "rebuilding" : "middle of the pack"}</span></div>
        <div class="kpi"><span class="eyebrow">Payroll</span><span class="v">${money(GM.payroll(ut))}</span><span class="n">Hard cap ${money(S.econ.cap)}</span></div>
        <div class="kpi"><span class="eyebrow">Points for / against</span><span class="v">${pf}<span class="muted" style="font-size:1.1rem"> / ${pa}</span></span><span class="n">Per game</span></div>
      </div>
      ${phasePanel(next)}
      <div class="grid2">
        <section class="panel">
          <div class="panel-head"><h3>League wire</h3><label class="row sub"><input type="checkbox" id="newsMine" data-act="newsMine" ${ui.newsMine ? "checked" : ""}> Only my team</label></div>
          <div class="news">${news.map((n) => `<div class="${n.team === ut ? "mine" : ""}"><span class="when">${n.season} ${n.phase === "regular" ? "D" + n.day : (phaseLabel[n.phase] || "").slice(0, 4).toUpperCase()}</span>${esc(n.text)}</div>`).join("") || `<div class="empty">Nothing yet.</div>`}</div>
        </section>
        <div style="display:grid;gap:18px">
          <section class="panel">
            <div class="panel-head"><h3>Standings</h3><button class="btn small" data-act="tab" data-tab="standings">Full table</button></div>
            ${miniStandings(st)}
          </section>
          <section class="panel">
            <div class="panel-head"><h3>Best players</h3><button class="btn small" data-act="tab" data-tab="roster">Roster</button></div>
            <div class="tablewrap"><table><tbody>${top.map((p) => { const s = GM.perGame(p); return `<tr><td>${plink(p)}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num muted">${s ? `${s.pts} / ${s.reb} / ${s.ast}` : lastLine(p)}</td></tr>`; }).join("")}</tbody></table></div>
          </section>
          ${recent.length ? `<section class="panel"><h3>Recent results</h3><div class="tablewrap"><table><tbody>${recent.map(gameRow).join("")}</tbody></table></div></section>` : ""}
        </div>
      </div>`;
  }
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 >> 3 ^ 1) && n % 10] || "th");
  function lastLine(p) { const h = p.hist && p.hist[GM.data.baseSeason]; return h && h.gp ? `${GM.data.baseSeason}: ${f1(h.pts)} / ${f1(h.reb)} / ${f1(h.ast)}` : "–"; }
  function gameRow(g) {
    const ut = GM.S.userTeam, home = g.home === ut, opp = home ? g.away : g.home;
    if (!g.played) return `<tr><td class="muted">Day ${g.day}</td><td>${home ? "vs" : "@"} ${badge(opp)} ${esc(GM.T(opp).name)}</td><td></td></tr>`;
    const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
    return `<tr><td class="muted">Day ${g.day}</td><td>${home ? "vs" : "@"} ${badge(opp)} ${esc(GM.T(opp).name)}</td><td class="num"><span class="${us > them ? "w" : "l"}">${us > them ? "W" : "L"}</span> ${us}-${them}${g.ot ? " OT" : ""} <button class="btn small" data-act="box" data-gid="${g.gid}">Box</button></td></tr>`;
  }
  function miniStandings(st) {
    const ut = GM.S.userTeam;
    return `<div class="tablewrap"><table><thead><tr><th>#</th><th>Team</th><th class="num">W-L</th><th class="num">Diff</th></tr></thead><tbody>${st.map((t, i) => {
      const gp = t.w + t.l;
      return `<tr class="${t.id === ut ? "me" : ""}${i === 7 ? " cutline" : ""}"><td class="muted">${i + 1}</td><td>${badge(t.id)} ${esc(t.name)}</td><td class="num">${rec(t)}</td><td class="num">${gp ? f1((t.pf - t.pa) / gp) : "–"}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function phasePanel(next) {
    const S = GM.S, ut = S.userTeam;
    const n = GM.roster(ut).length;
    if (S.phase === "preseason") {
      const issues = [];
      if (n < S.econ.rosterMin) issues.push(`Sign ${S.econ.rosterMin - n} more player${S.econ.rosterMin - n > 1 ? "s" : ""} (minimum ${S.econ.rosterMin}).`);
      if (n > S.econ.rosterMax) issues.push(`Cut ${n - S.econ.rosterMax} player${n - S.econ.rosterMax > 1 ? "s" : ""} (maximum ${S.econ.rosterMax}).`);
      return `<section class="callout"><h3>Preseason ${S.season}</h3>
        <div class="sub">Shape the roster before opening night: trade, sign free agents, and set your rotation on the Roster tab. ${issues.length ? "" : "Your roster is legal."}</div>
        ${issues.map((x) => `<div class="chip bad">${x}</div>`).join(" ")}
        <div class="row"><button class="btn primary" data-act="startSeason">Start the season</button><button class="btn" data-act="tab" data-tab="trade">Make a trade</button><button class="btn" data-act="tab" data-tab="fa">Free agents</button></div></section>`;
    }
    if (S.phase === "regular") {
      const dl = GM.tradeDeadlineDay();
      return `<section class="callout"><div class="panel-head"><h3>Regular season · day ${S.day} of ${GM.lastDay()}</h3><span class="sub">${S.day <= dl ? `Trade deadline after day ${dl}` : "Trade deadline has passed"}</span></div>
        ${next ? `<div>Next: ${next.home === ut ? "vs" : "@"} ${badge(next.home === ut ? next.away : next.home)} <b>${esc(GM.teamName(next.home === ut ? next.away : next.home))}</b> on day ${next.day}</div>` : ""}
        <div class="row"><button class="btn" data-act="sim" data-n="1">Sim 1 day</button><button class="btn" data-act="sim" data-n="7">Sim 1 week</button>${S.day < dl ? `<button class="btn" data-act="sim" data-n="${dl - S.day}">Sim to trade deadline</button>` : ""}<button class="btn primary" data-act="sim" data-n="999">Sim to end of season</button></div></section>`;
    }
    if (S.phase === "playoffs") {
      const po = S.playoffs;
      return `<section class="callout"><div class="panel-head"><h3>${po.champion ? `${esc(GM.teamName(po.champion))} win the title` : "Playoffs"}</h3>
        ${po.champion ? `<span class="sub">Finals MVP: ${esc(GM.P(po.finalsMvp)?.name || "–")}</span>` : ""}</div>
        ${bracket()}
        ${awardsBlock(S.awards)}
        <div class="row">${po.champion ? `<button class="btn primary" data-act="toDraft">Continue to the ${S.season} draft</button>` : `<button class="btn" data-act="poGame">Sim one game</button><button class="btn" data-act="poRound">Sim round</button><button class="btn primary" data-act="poAll">Sim to champion</button>`}</div></section>`;
    }
    if (S.phase === "draft") {
      const slot = GM.draftOnClock();
      const mine = S.draft.slots.filter((s) => s.owner === ut && !s.player).map((s) => `#${s.pick}`);
      return `<section class="callout"><h3>${S.season} draft</h3><div class="sub">${slot ? `Pick ${slot.pick} on the clock: ${esc(GM.teamName(slot.owner))}.` : ""} Your remaining picks: ${mine.join(", ") || "none"}.</div>
        <div class="row"><button class="btn primary" data-act="tab" data-tab="draft">Go to the draft room</button></div></section>`;
    }
    if (S.phase === "resign") {
      const exp = GM.roster(ut).filter((p) => p.expiring || p.resign);
      return `<section class="callout"><h3>Expiring contracts</h3>
        <div class="sub">These players' deals are up. Re-sign them at their asking price or let them walk into free agency. Re-signed salaries count against next season's cap of about ${money(S.econ.cap * (1 + S.econ.growth))}.</div>
        ${exp.length ? `<div class="tablewrap"><table><thead><tr><th>Player</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th><th class="num">Asking</th><th></th></tr></thead><tbody>
          ${exp.map((p) => `<tr><td>${plink(p)}</td><td class="num">${p.age}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num">${rt(p.r.pot)}</td><td class="num">${money(p.ask.sal)} × ${p.ask.yrs}</td><td class="num">${p.resign ? `<span class="chip good">Re-signed</span>` : p.declined ? `<span class="chip">Leaving</span>` : `<button class="btn small primary" data-act="resign" data-id="${p.id}">Re-sign</button> <button class="btn small" data-act="letgo" data-id="${p.id}">Let go</button>`}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No expiring contracts on your roster.</div>`}
        <div class="row"><button class="btn primary" data-act="toFA">Open free agency</button></div></section>`;
    }
    if (S.phase === "freeagency") {
      return `<section class="callout"><h3>Free agency · day ${S.faDay}</h3>
        <div class="sub">Make offers on the Free agents tab. Each day you advance, other teams sign players too. Cap for ${S.season}: ${money(S.econ.cap)}. You have ${n} players under contract.</div>
        <div class="row"><button class="btn" data-act="tab" data-tab="fa">Free agents</button><button class="btn" data-act="faDay">Advance one day</button><button class="btn primary" data-act="nextSeason">Start ${S.season} preseason</button></div></section>`;
    }
    return "";
  }
  function awardsBlock(a) {
    if (!a) return "";
    const item = (lab, id) => id ? `<div><span class="eyebrow">${lab}</span><div>${plink(GM.P(id))} <span class="muted">${GM.P(id).team || ""}</span></div></div>` : "";
    return `<div class="grid3">${item("MVP", a.mvp)}${item("Defensive POY", a.dpoy)}${item("Rookie of the Year", a.roy)}</div>`;
  }
  function bracket() {
    const po = GM.S.playoffs; if (!po) return "";
    const names = ["First round · best of 3", "Semifinals · best of 5", "Finals · best of 7"];
    const seed = (id) => po.seeds.indexOf(id) + 1;
    return `<div class="bracket">${[0, 1, 2].map((r) => `<div style="display:grid;gap:8px;align-content:start"><span class="eyebrow">${names[r]}</span>${(po.rounds[r] || []).map((s) => `
      <div class="series">${[[s.hi, s.wh], [s.lo, s.wl]].map(([id, w]) => `<div class="s ${s.winner ? (s.winner === id ? "win" : "lose") : ""}"><span>${badge(id)} <span class="muted">${seed(id)}</span> ${esc(GM.T(id).name)}</span><b>${w}</b></div>`).join("")}</div>`).join("") || `<div class="series muted">TBD</div>`}</div>`).join("")}</div>`;
  }

  // ---------- roster ----------
  function renderRoster() {
    const S = GM.S, ut = S.userTeam;
    const rot = GM.rotation(ut, true);
    const order = rot.map((x) => x.id);
    const mins = Object.fromEntries(rot.map((x) => [x.id, x.min]));
    const ps = GM.roster(ut);
    const all = [...order.map(GM.P), ...ps.filter((p) => !order.includes(p.id)).sort((a, b) => b.r.ovr - a.r.ovr)];
    const custom = !!GM.T(ut).rotation;
    const dead = GM.T(ut).dead.filter((d) => d.season === S.season);
    $("#view").innerHTML = `
      <section class="panel">
        <div class="panel-head"><div><h2>Roster</h2><div class="sub">${ps.length} players · payroll ${money(GM.payroll(ut))} of ${money(S.econ.cap)} · rotation is ${custom ? "custom" : "automatic (best OVR plays most)"}</div></div>
          <div class="row">${custom ? `<button class="btn" data-act="autoRot">Reset to automatic</button>` : ""}</div></div>
        <div class="sub">Use the arrows to set the rotation: the top five start, and minutes follow the order (${[34, 32, 30, 28, 26, 20, 14, 8, 5, 3].join(", ")}). Injured players sit automatically.</div>
        <div class="tablewrap"><table>
          <thead><tr><th></th><th>Player</th><th class="num">Min</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th><th class="num">INS</th><th class="num">3PT</th><th class="num">PLY</th><th class="num">REB</th><th class="num">DEF</th><th class="num">GP</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">Salary</th><th class="num">Yrs</th><th>Status</th><th></th></tr></thead>
          <tbody>${all.map((p, i) => {
            const s = GM.perGame(p);
            const inRot = i < order.length;
            return `<tr>
              <td><button class="btn small" data-act="rotUp" data-id="${p.id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button><button class="btn small" data-act="rotDown" data-id="${p.id}" ${i === all.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button></td>
              <td>${i < 5 ? `<span class="chip accent">S</span> ` : ""}${plink(p)}</td>
              <td class="num">${inRot ? Math.round(mins[p.id]) : `<span class="muted">–</span>`}</td>
              <td class="num">${p.age}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num">${rt(p.r.pot)}</td>
              <td class="num">${rt(p.r.ins)}</td><td class="num">${rt(p.r.thr)}</td><td class="num">${rt(p.r.ply)}</td><td class="num">${rt(p.r.reb)}</td><td class="num">${rt(p.r.def)}</td>
              <td class="num">${s ? s.gp : "–"}</td><td class="num">${s ? s.pts : "–"}</td><td class="num">${s ? s.reb : "–"}</td><td class="num">${s ? s.ast : "–"}</td>
              <td class="num">${money(p.c.sal)}</td><td class="num">${p.c.yrs}</td>
              <td>${p.inj ? `<span class="chip bad">Out ${p.inj}g</span>` : ""}${p.expiring ? `<span class="chip warn">Expiring</span>` : ""}${p.c.rookie ? `<span class="chip">Rookie deal</span>` : ""}</td>
              <td>${ui.confirm === "rel" + p.id ? `<button class="btn small danger" data-act="release" data-id="${p.id}">Confirm release</button> <button class="btn small" data-act="cancel">Keep</button>` : `<button class="btn small" data-act="askRelease" data-id="${p.id}">Release</button>`}</td>
            </tr>`; }).join("")}</tbody>
        </table></div>
        <div class="sub">Releasing a player keeps this season's salary on your cap as dead money (half in the offseason; second- and third-round rookie deals are non-guaranteed).${dead.length ? ` Dead money this season: ${dead.map((d) => `${esc(d.name)} ${money(d.sal)}`).join(", ")}.` : ""}</div>
      </section>`;
  }
  function moveRot(id, dir) {
    const ut = GM.S.userTeam;
    const rot = GM.rotation(ut, true).map((x) => x.id);
    const rest = GM.roster(ut).filter((p) => !rot.includes(p.id)).sort((a, b) => b.r.ovr - a.r.ovr).map((p) => p.id);
    const all = rot.concat(rest);
    const i = all.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    GM.setRotation(all);
  }

  // ---------- player modal ----------
  function playerModal(id) {
    const S = GM.S, p = GM.P(id); if (!p) return "";
    const t = GM.T(p.team);
    const s = GM.perGame(p);
    const bars = [["OVR", p.r.ovr, "Overall"], ["POT", p.r.pot, "Potential"], ["INS", p.r.ins, "Inside scoring"], ["3PT", p.r.thr, "3-point shooting"], ["FT", p.r.fts, "Free throws"], ["PLY", p.r.ply, "Playmaking"], ["REB", p.r.reb, "Rebounding"], ["DEF", p.r.def, "Defense"], ["ATH", p.r.ath, "Athleticism"]];
    const base = p.hist && p.hist[GM.data.baseSeason];
    const career = [];
    if (base && base.gp) career.push({ season: GM.data.baseSeason, team: base.team || "–", gp: base.gp, min: base.min, pts: base.pts, reb: base.reb, ast: base.ast, stl: base.stl, blk: base.blk, fg: base.fg_pct, tp: base.fg3_pct, ft: base.ft_pct, real: true });
    for (const c of p.career) career.push(c);
    if (s) career.push({ season: S.season, ...s, cur: true });
    const isMine = p.team === S.userTeam;
    const scouted = p.prospect && p.scout;
    let actions = "";
    if (isMine) actions = `<button class="btn" data-act="tab" data-tab="roster">Manage on roster</button>`;
    else if (p.team && GM.tradesOpen()) actions = `<button class="btn primary" data-act="tradeFor" data-id="${p.id}">Trade for her</button>`;
    else if (!p.team && !p.prospect && !p.retired) actions = `<button class="btn primary" data-act="offerFrom" data-id="${p.id}">Make an offer</button>`;
    return `<div class="modal-bg" data-act="closeModal"><div class="modal" style="--tc:${t ? t.color : "var(--tier-4)"}" role="dialog" aria-modal="true" aria-label="${esc(p.name)}" data-stop>
      <div class="modal-head"><div class="row">${badge(p.team, true)}<div><h2>${esc(p.name)}</h2><div class="sub">${esc(p.pos)} · ${ht(p.ht)} · age ${p.age} · ${p.exp ? `${p.exp} yrs exp` : "rookie"}${p.school ? ` · ${esc(p.school)}` : ""}</div></div></div><button class="btn" data-act="closeModal">Close</button></div>
      <div class="row">${t ? `<span class="chip">${esc(t.city)} ${esc(t.name)}</span>` : p.retired ? `<span class="chip">Retired ${p.retired}</span>` : p.prospect ? `<span class="chip accent">${p.prospect} draft prospect</span>` : `<span class="chip warn">Free agent${p.ask ? ` · asking ${money(p.ask.sal)} × ${p.ask.yrs}` : ""}</span>`}
        ${p.team ? `<span class="chip">${money(p.c.sal)} × ${p.c.yrs} yr${p.c.yrs === 1 ? "" : "s"}</span>` : ""}${p.inj ? `<span class="chip bad">${esc(p.injType)} · out ${p.inj} games</span>` : ""}${p.acq ? `<span class="chip">${esc(p.acq)}</span>` : ""}${p.real ? "" : `<span class="chip">Generated player</span>`}</div>
      ${scouted ? `<div class="callout"><b>Scouting report</b><div>Your scouts project her at ${ovr(p.scout.ovr)} now with a ceiling around ${rt(p.scout.pot)}. Estimates carry a few points of error either way.</div></div>`
        : `<div class="bars">${bars.map(([l, v, full]) => `<div class="bar" title="${full}"><span class="eyebrow">${l}</span><div class="track"><div class="fill" style="width:${v}%"></div></div><b>${v}</b></div>`).join("")}</div>`}
      ${career.length ? `<div class="tablewrap"><table><thead><tr><th>Season</th><th>Team</th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">FG%</th><th class="num">3P%</th><th class="num">FT%</th></tr></thead><tbody>
        ${career.map((c) => `<tr><td>${c.season}${c.real ? ' <span class="chip">real</span>' : c.cur ? ' <span class="chip accent">now</span>' : ""}</td><td>${esc(c.team)}</td><td class="num">${c.gp}</td><td class="num">${f1(c.min)}</td><td class="num">${f1(c.pts)}</td><td class="num">${f1(c.reb)}</td><td class="num">${f1(c.ast)}</td><td class="num">${f1(c.stl)}</td><td class="num">${f1(c.blk)}</td><td class="num">${pct(c.fg)}</td><td class="num">${pct(c.tp)}</td><td class="num">${pct(c.ft)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No WNBA stats yet.</div>`}
      ${base && base.bpm != null ? `<div class="sub">${GM.data.baseSeason} impact: BPM ${f1(base.bpm)} · WAR ${base.war ?? "–"} · TS% ${pct(base.ts)}</div>` : ""}
      <div class="row">${actions}</div>
    </div></div>`;
  }

  function boxModal(gid) {
    const b = GM.S.boxes[gid]; if (!b) return "";
    const tbl = (tid) => `<h3>${badge(tid)} ${esc(GM.teamName(tid))} · ${tid === b.home ? b.hs : b.as}</h3><div class="tablewrap"><table><thead><tr><th>Player</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">TO</th><th class="num">FG</th><th class="num">3PT</th><th class="num">FT</th></tr></thead><tbody>
      ${b.players[tid].map((l) => { const p = GM.P(l.id); return `<tr><td>${l.start ? "" : '<span class="muted">· </span>'}${p ? plink(p) : "–"}</td><td class="num">${l.min}</td><td class="num"><b>${l.pts}</b></td><td class="num">${l.reb}</td><td class="num">${l.ast}</td><td class="num">${l.stl}</td><td class="num">${l.blk}</td><td class="num">${l.tov}</td><td class="num">${l.fgm}-${l.fga}</td><td class="num">${l.tpm}-${l.tpa}</td><td class="num">${l.ftm}-${l.fta}</td></tr>`; }).join("")}</tbody></table></div>`;
    return `<div class="modal-bg" data-act="closeModal"><div class="modal" role="dialog" aria-modal="true" aria-label="Box score" data-stop>
      <div class="modal-head"><h2>${esc(GM.T(b.away).name)} ${b.as} @ ${esc(GM.T(b.home).name)} ${b.hs}${b.ot ? ` (${b.ot > 1 ? b.ot : ""}OT)` : ""}</h2><button class="btn" data-act="closeModal">Close</button></div>
      ${tbl(b.away)}${tbl(b.home)}</div></div>`;
  }

  // ---------- trade ----------
  function renderTrade() {
    const S = GM.S, ut = S.userTeam, tr = ui.trade;
    const others = S.teams.filter((t) => t.id !== ut);
    if (!tr.partner) tr.partner = others[0].id;
    const partner = tr.partner;
    const mode = GM.teamMode(partner);
    const ev = GM.evaluateTrade(partner, [...tr.give], [...tr.get], [...tr.givePicks], [...tr.getPicks]);
    const sal = (ids) => [...ids].reduce((s, id) => s + GM.P(id).c.sal, 0);
    const pickList = (owner, set, side) => S.picks.map((pk, k) => ({ pk, k })).filter((x) => x.pk.owner === owner)
      .map(({ pk, k }) => `<label class="pickrow ${set.has(k) ? "on" : ""}"><input type="checkbox" data-act="tpick" data-side="${side}" data-k="${k}" ${set.has(k) ? "checked" : ""}><span class="grow">${esc(GM.pickLabel(pk))}</span></label>`).join("");
    const playerList = (tid, set, side) => GM.roster(tid).sort((a, b) => b.r.ovr - a.r.ovr).map((p) => `
      <label class="pickrow ${set.has(p.id) ? "on" : ""}"><input type="checkbox" data-act="tsel" data-side="${side}" data-id="${p.id}" ${set.has(p.id) ? "checked" : ""}>
      ${ovr(p.r.ovr)}<span class="grow"><b>${esc(p.name)}</b> <span class="pos">${esc(p.pos)} · ${p.age}y · pot ${p.r.pot}${p.inj ? " · injured" : ""}</span></span><span class="muted">${money(p.c.sal)}×${p.c.yrs}</span></label>`).join("");
    const ratio = Math.min(1.5, ev.ratio);
    const color = ev.ratio >= 1 ? "var(--good)" : ev.ratio >= 0.8 ? "var(--warn)" : "var(--bad)";
    const verdict = ev.ratio >= 1 ? "They'd take this deal." : ev.ratio >= 0.85 ? "Close. They want a bit more." : ev.ratio >= 0.6 ? "Not enough value for them." : "They'd hang up on this.";
    $("#view").innerHTML = `
      <section class="panel">
        <div class="panel-head"><div><h2>Trade</h2><div class="sub">${GM.tradesOpen() ? (S.phase === "regular" ? `Deadline after day ${GM.tradeDeadlineDay()}.` : "Trades are open.") : "Trades are closed right now."} Hard cap: both teams must stay under ${money(S.econ.cap)} unless the deal lowers their payroll.</div></div>
          <label class="row">Trade partner <select id="partner" data-act="partner">${others.map((t) => `<option value="${t.id}" ${t.id === partner ? "selected" : ""}>${esc(t.city)} ${esc(t.name)} (${rec(t)})</option>`).join("")}</select></label></div>
        <div class="callout">
          <div class="panel-head"><b>${verdict}</b><span class="sub">${esc(GM.T(partner).name)} are ${mode === "contend" ? "contending: they value current production" : mode === "rebuild" ? "rebuilding: they value youth, potential and picks" : "in the middle: they value overall talent"}</span></div>
          <div class="meter" aria-label="Trade value meter"><div class="fill" style="width:${(ratio / 1.5) * 100}%;background:${color}"></div><div class="mark" title="Acceptance line"></div></div>
          <div class="row sub"><span>You send ${money(sal(tr.give))}</span>·<span>You take back ${money(sal(tr.get))}</span>·<span>Your payroll after: ${money(GM.payroll(ut) - sal(tr.give) + sal(tr.get))}</span></div>
          ${ev.issues.map((x) => `<div class="chip bad">${esc(x)}</div>`).join(" ")}
          ${tr.msg ? `<div>${esc(tr.msg)}</div>` : ""}
          <div class="row"><button class="btn primary" data-act="propose" ${ev.issues.length ? "disabled" : ""}>Propose trade</button><button class="btn" data-act="balance">What would make this work?</button><button class="btn" data-act="clearTrade">Clear</button></div>
        </div>
        <div class="tradecols">
          <div style="display:grid;gap:6px;min-width:0"><h3>You give · ${esc(GM.T(ut).name)}</h3>${playerList(ut, tr.give, "give")}<span class="eyebrow" style="margin-top:8px">Draft picks</span>${pickList(ut, tr.givePicks, "give") || `<div class="empty">No picks.</div>`}</div>
          <div style="display:grid;gap:6px;min-width:0"><h3>You get · ${esc(GM.T(partner).name)}</h3>${playerList(partner, tr.get, "get")}<span class="eyebrow" style="margin-top:8px">Draft picks</span>${pickList(partner, tr.getPicks, "get") || `<div class="empty">No picks.</div>`}</div>
        </div>
      </section>
      ${S.tradeLog.length ? `<section class="panel"><h3>Your trade history</h3>${S.tradeLog.slice(0, 15).map((x) => `<div class="sub">${x.season}: ${esc(x.text)}</div>`).join("")}</section>` : ""}`;
  }

  // ---------- free agents ----------
  function renderFA() {
    const S = GM.S, ut = S.userTeam;
    const fas = GM.freeAgents();
    sortRows(fas, "fa", { col: "ovr", dir: -1, get: (p) => p.r.ovr });
    const space = GM.capSpace(ut), n = GM.roster(ut).length;
    $("#view").innerHTML = `
      <section class="panel">
        <div class="panel-head"><div><h2>Free agents</h2><div class="sub">${fas.length} available · your cap space ${money(space)} · roster ${n}/${S.econ.rosterMax}. Minimum deals (${money(S.econ.min)}) are allowed over the cap while you're below ${S.econ.rosterMin} players.</div></div>
          ${S.phase === "freeagency" ? `<button class="btn" data-act="faDay">Advance one day</button>` : ""}</div>
        <div class="tablewrap"><table>
          <thead><tr><th>Player</th>${th("Age", "fa", "age")}${th("OVR", "fa", "ovr")}${th("POT", "fa", "pot")}<th class="num">INS</th><th class="num">3PT</th><th class="num">PLY</th><th class="num">REB</th><th class="num">DEF</th>${th("Asking", "fa", "ask")}<th></th></tr></thead>
          <tbody>${fas.slice(0, 120).map((p) => {
            const ask = p.ask || { sal: S.econ.min, yrs: 1 };
            const open = ui.offer === p.id;
            return `<tr><td>${plink(p)}${p.real ? "" : ' <span class="chip">gen</span>'}</td><td class="num">${p.age}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num">${rt(p.r.pot)}</td>
              <td class="num">${rt(p.r.ins)}</td><td class="num">${rt(p.r.thr)}</td><td class="num">${rt(p.r.ply)}</td><td class="num">${rt(p.r.reb)}</td><td class="num">${rt(p.r.def)}</td>
              <td class="num">${money(ask.sal)} × ${ask.yrs}</td>
              <td>${open ? `<span class="row"><input type="number" id="offerSal" min="${S.econ.min / 1000}" max="${S.econ.max / 1000}" step="5" value="${Math.round(ask.sal / 1000)}" aria-label="Salary in thousands"> K
                <select id="offerYrs" aria-label="Years">${[1, 2, 3, 4, 5].map((y) => `<option ${y === ask.yrs ? "selected" : ""}>${y}</option>`).join("")}</select>
                <button class="btn small primary" data-act="offer" data-id="${p.id}">Offer</button><button class="btn small" data-act="cancel">Cancel</button></span>`
                : `<button class="btn small" data-act="openOffer" data-id="${p.id}">Offer contract</button>`}</td></tr>`;
          }).join("") || `<tr><td colspan="11" class="empty">No free agents right now.</td></tr>`}</tbody>
        </table></div>
      </section>`;
  }

  // ---------- draft ----------
  function renderDraft() {
    const S = GM.S, ut = S.userTeam;
    const live = S.phase === "draft";
    const slot = live && GM.draftOnClock();
    const myTurn = slot && slot.owner === ut;
    const pros = (live ? GM.availableProspects() : S.prospects.map(GM.P).filter((p) => p && p.prospect))
      .sort((a, b) => (b.scout.ovr * 0.5 + b.scout.pot * 0.5) - (a.scout.ovr * 0.5 + a.scout.pot * 0.5));
    const myPicks = S.picks.filter((pk) => pk.owner === ut && pk.season === S.season);
    $("#view").innerHTML = `
      <div class="grid2">
        <section class="panel">
          <div class="panel-head"><div><h2>${live ? `${S.season} draft room` : `${S.season} draft class`}</h2>
            <div class="sub">${live ? (slot ? `Pick ${slot.pick} (round ${slot.round}) · on the clock: <b>${esc(GM.teamName(slot.owner))}</b>` : "Draft complete.") : `Scouting board. The draft opens after the playoffs. You own: ${myPicks.map((pk) => GM.pickLabel(pk)).join(", ") || "no picks this year"}.`}</div></div>
            ${live && slot ? `<div class="row">${myTurn ? "" : `<button class="btn primary" data-act="draftToMe">Sim to my pick</button>`}<button class="btn" data-act="draftAuto">Auto-draft the rest</button></div>` : ""}</div>
          ${myTurn ? `<div class="callout"><b>You're on the clock.</b> Pick a prospect below.</div>` : ""}
          <div class="tablewrap"><table><thead><tr><th>#</th><th>Prospect</th><th class="num">Age</th><th>From</th><th class="num">Est. OVR</th><th class="num">Est. POT</th><th></th></tr></thead><tbody>
            ${pros.map((p, i) => `<tr><td class="muted">${i + 1}</td><td>${plink(p)}</td><td class="num">${p.age}</td><td>${esc(p.school)}</td><td class="num">${ovr(p.scout.ovr)}</td><td class="num">${rt(p.scout.pot)}</td><td>${myTurn ? `<button class="btn small primary" data-act="draftPick" data-id="${p.id}">Draft</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No prospects left.</td></tr>`}
          </tbody></table></div>
          <div class="sub">Prospects are generated players. Ratings shown are your scouts' estimates and can miss by several points.</div>
        </section>
        <section class="panel">
          <h3>${live ? "Draft board" : `Real ${GM.data.baseSeason} draft`}</h3>
          ${live ? `${S.draft.lottery ? `<div class="sub">Lottery winners: ${S.draft.lottery.map((id, i) => `#${i + 1} ${id}`).join(", ")}</div>` : ""}
            <div class="tablewrap"><table><tbody>${S.draft.slots.map((s, i) => `<tr class="${s.owner === ut ? "me" : ""}"><td class="muted">${s.pick}</td><td>${badge(s.owner)}${s.orig !== s.owner ? ` <span class="muted">via ${s.orig}</span>` : ""}</td><td>${s.player ? plink(GM.P(s.player)) : i === S.draft.cur ? `<span class="chip accent">On the clock</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`
          : `<div class="tablewrap"><table><tbody>${GM.data.draft.slice(0, 15).map((d) => `<tr><td class="muted">${d.pick}</td><td>${badge(d.team)}</td><td>${esc(d.name)}</td><td class="muted">${esc(d.school)}</td></tr>`).join("")}</tbody></table></div>`}
        </section>
      </div>`;
  }

  // ---------- standings / schedule / leaders / players / history ----------
  function renderStandings() {
    const S = GM.S, st = GM.standings(), lead = st[0];
    const r = GM.powerRanks();
    $("#view").innerHTML = `
      ${S.playoffs ? `<section class="panel"><h3>${S.season} playoffs</h3>${bracket()}</section>` : ""}
      <section class="panel"><div class="panel-head"><h2>Standings ${S.season}</h2><span class="sub">Top 8 overall make the playoffs. Dashed line marks the cut.</span></div>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">PCT</th><th class="num">GB</th><th class="num">Home</th><th class="num">Away</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff</th><th class="num">Streak</th><th class="num">Rating</th><th class="num">Power</th></tr></thead><tbody>
      ${st.map((t, i) => { const gp = t.w + t.l; const gb = ((lead.w - t.w) + (t.l - lead.l)) / 2;
        return `<tr class="${t.id === S.userTeam ? "me" : ""}${i === 7 ? " cutline" : ""}"><td class="muted">${i + 1}</td><td>${badge(t.id)} ${esc(t.city)} ${esc(t.name)}</td><td class="num">${t.w}</td><td class="num">${t.l}</td><td class="num">${gp ? (t.w / gp).toFixed(3).replace(/^0/, "") : "–"}</td><td class="num">${gb ? gb.toFixed(1) : "–"}</td><td class="num">${t.hw}-${t.hl}</td><td class="num">${t.w - t.hw}-${t.l - t.hl}</td><td class="num">${gp ? f1(t.pf / gp) : "–"}</td><td class="num">${gp ? f1(t.pa / gp) : "–"}</td><td class="num">${gp ? f1((t.pf - t.pa) / gp) : "–"}</td><td class="num">${t.streak ? (t.streak > 0 ? "W" + t.streak : "L" + -t.streak) : "–"}</td><td class="num">${GM.teamRating(t.id).toFixed(1)}</td><td class="num">${r[t.id]}</td></tr>`; }).join("")}
      </tbody></table></div></section>`;
  }
  function renderSchedule() {
    const S = GM.S, ut = S.userTeam;
    const mine = S.schedule.filter((g) => g.home === ut || g.away === ut);
    const lastPlayed = Math.max(0, ...S.schedule.filter((g) => g.played).map((g) => g.day));
    const today = S.schedule.filter((g) => g.day === lastPlayed && g.played);
    const myPO = S.playoffs ? S.playoffs.rounds.flat().filter((s) => s.hi === ut || s.lo === ut) : [];
    $("#view").innerHTML = `<div class="grid2">
      <section class="panel"><h2>${esc(GM.T(ut).name)} schedule</h2><div class="tablewrap"><table><tbody>${mine.map(gameRow).join("")}</tbody></table></div></section>
      <div style="display:grid;gap:18px">
        ${myPO.length ? `<section class="panel"><h3>Your playoff games</h3><table><tbody>${myPO.flatMap((s) => s.games).map((g) => { const home = g.home === ut; const us = home ? g.hs : g.as, them = home ? g.as : g.hs; const opp = home ? g.away : g.home; return `<tr><td>${home ? "vs" : "@"} ${badge(opp)}</td><td class="num"><span class="${us > them ? "w" : "l"}">${us > them ? "W" : "L"}</span> ${us}-${them} <button class="btn small" data-act="box" data-gid="${g.gid}">Box</button></td></tr>`; }).join("")}</tbody></table></section>` : ""}
        <section class="panel"><h3>${lastPlayed ? `Around the league · day ${lastPlayed}` : "Around the league"}</h3>${today.length ? `<table><tbody>${today.map((g) => `<tr><td>${badge(g.away)} ${g.as}</td><td>@ ${badge(g.home)} ${g.hs}${g.ot ? " OT" : ""}</td><td class="num"><button class="btn small" data-act="box" data-gid="${g.gid}">Box</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">No games played yet.</div>`}</section>
      </div></div>`;
  }
  function renderLeaders() {
    const S = GM.S;
    const cats = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["stl", "Steals"], ["blk", "Blocks"], ["fg", "FG%"], ["tp", "3P%"], ["ts", "True shooting"]];
    const rows = Object.values(S.players).map((p) => [p, GM.perGame(p)]).filter(([p, s]) => s && s.gp >= Math.max(1, Math.floor(gamesPlayed() * 0.5)));
    const c = ui.leaders;
    const qual = ["fg", "tp", "ts"].includes(c) ? rows.filter(([p, s]) => c === "tp" ? (p.stats[S.season].tpa >= s.gp * 1.5) : (p.stats[S.season].fga >= s.gp * 6)) : rows;
    qual.sort((a, b) => b[1][c] - a[1][c]);
    $("#view").innerHTML = `<section class="panel"><div class="panel-head"><h2>League leaders ${S.season}</h2>
      <div class="row">${cats.map(([k, l]) => `<button class="btn small ${k === c ? "primary" : ""}" data-act="leaders" data-c="${k}">${l}</button>`).join("")}</div></div>
      ${qual.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Player</th><th>Team</th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">FG%</th><th class="num">3P%</th><th class="num">TS%</th></tr></thead><tbody>
      ${qual.slice(0, 30).map(([p, s], i) => `<tr class="${s.team === S.userTeam ? "me" : ""}"><td class="muted">${i + 1}</td><td>${plink(p)}</td><td>${badge(s.team)}</td><td class="num">${s.gp}</td><td class="num">${s.min}</td><td class="num">${s.pts}</td><td class="num">${s.reb}</td><td class="num">${s.ast}</td><td class="num">${s.stl}</td><td class="num">${s.blk}</td><td class="num">${pct(s.fg)}</td><td class="num">${pct(s.tp)}</td><td class="num">${pct(s.ts)}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Leaders appear once games are played. Last season's real numbers are on each player's card.</div>`}</section>`;
  }
  const gamesPlayed = () => Math.max(0, ...GM.S.teams.map((t) => t.w + t.l));
  function renderPlayers() {
    const S = GM.S, f = ui.players;
    let ps = Object.values(S.players).filter((p) => !p.retired && !p.prospect);
    if (f.team === "FA") ps = ps.filter((p) => !p.team); else if (f.team !== "all") ps = ps.filter((p) => p.team === f.team);
    if (f.q) { const q = f.q.toLowerCase(); ps = ps.filter((p) => p.name.toLowerCase().includes(q)); }
    sortRows(ps, "players", { col: "ovr", dir: -1, get: (p) => p.r.ovr });
    $("#view").innerHTML = `<section class="panel"><div class="panel-head"><h2>Players</h2>
      <div class="row"><input type="search" id="pq" placeholder="Search by name" value="${esc(f.q)}" aria-label="Search players">
      <select id="pteam" aria-label="Team filter"><option value="all">All teams</option><option value="FA" ${f.team === "FA" ? "selected" : ""}>Free agents</option>${S.teams.map((t) => `<option value="${t.id}" ${f.team === t.id ? "selected" : ""}>${esc(t.city)} ${esc(t.name)}</option>`).join("")}</select></div></div>
      <div class="tablewrap"><table><thead><tr><th>Player</th><th>Team</th>${th("Age", "players", "age")}${th("OVR", "players", "ovr")}${th("POT", "players", "pot")}${th("INS", "players", "ins")}${th("3PT", "players", "thr")}${th("PLY", "players", "ply")}${th("REB", "players", "reb")}${th("DEF", "players", "def")}${th("Salary", "players", "sal")}<th class="num">Yrs</th><th class="num">PTS</th></tr></thead><tbody>
      ${ps.slice(0, 200).map((p) => { const s = GM.perGame(p); const h = p.hist && p.hist[GM.data.baseSeason]; return `<tr class="${p.team === S.userTeam ? "me" : ""}"><td>${plink(p)}</td><td>${badge(p.team)}</td><td class="num">${p.age}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num">${rt(p.r.pot)}</td><td class="num">${rt(p.r.ins)}</td><td class="num">${rt(p.r.thr)}</td><td class="num">${rt(p.r.ply)}</td><td class="num">${rt(p.r.reb)}</td><td class="num">${rt(p.r.def)}</td><td class="num">${p.team ? money(p.c.sal) : "–"}</td><td class="num">${p.team ? p.c.yrs : "–"}</td><td class="num">${s ? s.pts : h && h.gp ? `<span class="muted">${f1(h.pts)}</span>` : "–"}</td></tr>`; }).join("")}
      </tbody></table></div><div class="sub">Grey points are from the real ${GM.data.baseSeason} season.</div></section>`;
  }
  function renderHistory() {
    const S = GM.S;
    const nm = (id) => (id && GM.P(id) ? plink(GM.P(id)) : "–");
    $("#view").innerHTML = `<section class="panel"><h2>League history</h2>
      ${S.history.length ? `<div class="tablewrap"><table><thead><tr><th>Season</th><th>Champion</th><th>Runner-up</th><th>Finals MVP</th><th>MVP</th><th>DPOY</th><th>ROY</th><th>Your team</th></tr></thead><tbody>
      ${S.history.map((h) => `<tr><td>${h.season}</td><td>${badge(h.champion)} ${esc(GM.T(h.champion).name)}</td><td>${badge(h.runnerUp)}</td><td>${nm(h.finalsMvp)}</td><td>${nm(h.mvp)}</td><td>${nm(h.dpoy)}</td><td>${nm(h.roy)}</td><td>${h.userRecord.w}-${h.userRecord.l}${h.userRecord.seed ? ` · #${h.userRecord.seed} seed` : " · missed playoffs"}${h.champion === S.userTeam ? ' <span class="chip accent">Champions</span>' : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Finish a season to start the record book. The real ${GM.data.baseSeason} standings are the starting point: ${GM.data.teams.slice(0, 3).map((t) => `${esc(t.name)} ${t.last.w}-${t.last.l}`).join(", ")}…</div>`}</section>`;
  }

  function renderSettings() {
    const S = GM.S;
    $("#view").innerHTML = `<div class="grid2">
      <section class="panel"><h2>Save game</h2>
        <div class="prose"><p>Your league saves automatically in this browser after every action. To move it to another device or keep a backup, copy the save code or download it, then import it later.</p></div>
        <div class="row"><button class="btn" data-act="copySave">Copy save code</button>${window.top === window ? `<button class="btn" data-act="downloadSave">Download save file</button>` : ""}</div>
        <label class="sub" for="importText">Import: paste a save code here, or choose a file</label>
        <textarea id="importText" placeholder="Paste save code"></textarea>
        <div class="row"><button class="btn" data-act="importText">Load pasted save</button><input type="file" id="importFile" accept=".json,application/json" aria-label="Import save file"></div>
        <hr style="border:0;border-top:1px solid var(--line);width:100%">
        <div class="row">${ui.confirm === "new" ? `<span>This replaces your current league.</span><button class="btn danger" data-act="newGame">Start over</button><button class="btn" data-act="cancel">Keep playing</button>` : `<button class="btn danger" data-act="askNew">New game</button>`}</div>
      </section>
      <section class="panel"><h2>How it works</h2><div class="prose">
        <p><b>Data.</b> Rosters, stats and impact metrics come from <a href="https://github.com/sportsdataverse/wehoop-wnba-stats-data" target="_blank" rel="noopener">sportsdataverse/wehoop-wnba-stats-data</a> (CC BY 4.0), using the ${GM.data.baseSeason} regular season.</p>
        <p><b>Ratings.</b> OVR blends Game Score per 36 minutes, Box Plus/Minus, adjusted RAPM and minutes per game, shrunk toward replacement level for players with few minutes, then scaled so the league average sits near 58. Skill ratings come from per-36 rates and shooting percentages.</p>
        <p><b>Games.</b> Each team's strength is the minutes-weighted OVR of its rotation. Strength gaps convert to point margins at ${S.sim.marginPerRating} points per rating point, fitted to the real ${GM.data.baseSeason} point differentials, plus ${S.sim.homeAdv} points of home court and game-to-game randomness.</p>
        <p><b>Money.</b> The data has no salaries, so contracts are estimates scaled to the 2026 CBA: a hard cap of ${money(S.econ.cap)} this season, max ${money(S.econ.max)}, minimum ${money(S.econ.min)}, growing about ${Math.round(S.econ.growth * 100)}% a year.</p>
        <p><b>Draft classes and filler free agents</b> are generated with invented names; everyone else is a real player.</p>
        <p class="muted">Courtside GM is a fan-made simulator and is not affiliated with or endorsed by the WNBA, its teams or its players.</p>
      </div></section></div>`;
  }

  // ---------- main render ----------
  function render() {
    renderTop();
    if (!GM.S) { renderPicker(); renderModal(); return; }
    const views = { dashboard: renderDashboard, roster: renderRoster, trade: renderTrade, fa: renderFA, draft: renderDraft, standings: renderStandings, schedule: renderSchedule, leaders: renderLeaders, players: renderPlayers, history: renderHistory, settings: renderSettings };
    (views[ui.tab] || renderDashboard)();
    renderModal();
  }
  function renderModal() {
    const m = $("#modal");
    if (!ui.modal || !GM.S) { m.innerHTML = ""; return; }
    m.innerHTML = ui.modal.type === "player" ? playerModal(ui.modal.id) : boxModal(ui.modal.id);
  }

  // ---------- actions ----------
  function act(a, el, ev) {
    const id = el.dataset.id ? +el.dataset.id : null;
    const S = GM.S;
    switch (a) {
      case "pickTeam": GM.newGame(el.dataset.id); ui.tab = "dashboard"; window.scrollTo(0, 0); break;
      case "tab": ui.tab = el.dataset.tab; ui.modal = null; ui.confirm = null; window.scrollTo(0, 0); break;
      case "player": ui.modal = { type: "player", id }; break;
      case "box": ui.modal = { type: "box", id: el.dataset.gid }; break;
      case "closeModal": if (ev.target.closest("[data-stop]") && !el.matches("button")) return; ui.modal = null; break;
      case "sort": {
        const key = el.dataset.key, col = el.dataset.col, cur = ui.sort[key];
        const getters = { age: (p) => p.age, ovr: (p) => p.r.ovr, pot: (p) => p.r.pot, ins: (p) => p.r.ins, thr: (p) => p.r.thr, ply: (p) => p.r.ply, reb: (p) => p.r.reb, def: (p) => p.r.def, sal: (p) => p.c.sal, ask: (p) => (p.ask ? p.ask.sal : 0) };
        ui.sort[key] = { col, dir: cur && cur.col === col ? -cur.dir : -1, get: getters[col] };
        break;
      }
      case "startSeason": { const r = GM.startSeason(); if (!r.ok) toast(r.msg, true); else toast(`The ${S.season} season has started.`); break; }
      case "sim": { const before = S.phase; GM.simDays(+el.dataset.n); if (before === "regular" && GM.S.phase === "playoffs") { toast("Regular season complete. Playoffs are set."); ui.tab = "dashboard"; } break; }
      case "poGame": GM.simPlayoffDay(); break;
      case "poRound": GM.simPlayoffs(false); break;
      case "poAll": GM.simPlayoffs(true); break;
      case "toDraft": GM.advanceToDraft(); ui.tab = "draft"; break;
      case "draftToMe": GM.draftUntilUser(false); break;
      case "draftAuto": GM.draftUntilUser(true); if (GM.S.phase === "resign") { ui.tab = "dashboard"; toast("Draft complete. Decide on your expiring contracts."); } break;
      case "draftPick": GM.userDraft(id); GM.draftUntilUser(false); if (GM.S.phase === "resign") { ui.tab = "dashboard"; toast("Draft complete. Decide on your expiring contracts."); } break;
      case "resign": GM.resignPlayer(id); break;
      case "letgo": GM.letGo(id); break;
      case "toFA": GM.advanceToFreeAgency(); ui.tab = "fa"; toast("Free agency is open."); break;
      case "faDay": GM.faDays(1); toast("A day passes. Other teams made their moves."); break;
      case "nextSeason": { const r = GM.startNextSeason(); if (!r.ok) toast(r.msg, true); else { ui.tab = "dashboard"; toast(`Welcome to the ${GM.S.season} preseason.`); } break; }
      case "rotUp": moveRot(id, -1); break;
      case "rotDown": moveRot(id, 1); break;
      case "autoRot": GM.T(S.userTeam).rotation = null; GM.save(); break;
      case "askRelease": ui.confirm = "rel" + id; break;
      case "release": ui.confirm = null; GM.releasePlayer(id); toast("Player released."); break;
      case "cancel": ui.confirm = null; ui.offer = null; break;
      case "openOffer": ui.offer = id; break;
      case "offerFrom": ui.modal = null; ui.tab = "fa"; ui.offer = id; break;
      case "offer": {
        const sal = +$("#offerSal").value * 1000, yrs = +$("#offerYrs").value;
        const r = GM.offerContract(id, sal, yrs); toast(r.msg, !r.ok); if (r.ok) ui.offer = null; break;
      }
      case "tradeFor": { const p = GM.P(id); resetTrade(p.team); ui.trade.get.add(id); ui.modal = null; ui.tab = "trade"; break; }
      case "tsel": case "tpick": return; // handled on change
      case "propose": {
        const t = ui.trade;
        const r = GM.proposeTrade(t.partner, [...t.give], [...t.get], [...t.givePicks], [...t.getPicks]);
        if (r.ok) { toast("Trade accepted."); resetTrade(t.partner); t.msg = r.desc; }
        else { t.msg = r.ev.issues[0] || "They turned it down. Add value or ask what would make it work."; toast(t.msg, true); }
        break;
      }
      case "balance": {
        const t = ui.trade;
        const s = GM.suggestBalance(t.partner, [...t.give], [...t.get], [...t.givePicks], [...t.getPicks]);
        if (s.type === "ok") t.msg = "They'd already accept this as is.";
        else if (s.type === "add") {
          s.pids.forEach((x) => t.give.add(x)); s.picks.forEach((k) => t.givePicks.add(k));
          const names = [...s.pids.map((x) => GM.P(x).name), ...s.picks.map((k) => "your " + GM.pickLabel(GM.S.picks[k]))];
          t.msg = `They'd do it if you add ${names.join(" and ")}. Added to your side.`;
        }
        else t.msg = "Nothing you could add makes this work. Ask for less.";
        break;
      }
      case "clearTrade": resetTrade(ui.trade.partner); break;
      case "leaders": ui.leaders = el.dataset.c; break;
      case "copySave": {
        const txt = JSON.stringify(GM.S);
        navigator.clipboard.writeText(txt).then(() => toast("Save code copied."), () => { $("#importText").value = txt; $("#importText").select(); toast("Copy blocked here: the code is in the box, selected. Copy it manually.", true); });
        return;
      }
      case "downloadSave": {
        try {
          const blob = new Blob([JSON.stringify(GM.S)], { type: "application/json" });
          const a2 = document.createElement("a"); a2.href = URL.createObjectURL(blob); a2.download = `wnba-gm-${GM.S.userTeam}-${GM.S.season}.json`; a2.click();
          toast("If no download started, use Copy save code instead.");
        } catch (e) { toast("Download isn't available here. Use Copy save code.", true); }
        return;
      }
      case "importText": {
        try { const obj = JSON.parse($("#importText").value); if (!obj.teams || !obj.players) throw 0; GM.importState(obj); ui.tab = "dashboard"; toast("Save loaded."); }
        catch (e) { toast("That doesn't look like a save code. Paste the full text you copied.", true); return; }
        break;
      }
      case "askNew": ui.confirm = "new"; break;
      case "newGame": ui.confirm = null; GM.clearSave(); ui.tab = "dashboard"; break;
      default: return;
    }
    render();
  }
  function resetTrade(partner) { ui.trade = { partner, give: new Set(), get: new Set(), givePicks: new Set(), getPicks: new Set(), msg: null }; }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const a = el.dataset.act;
    if (a === "closeModal" && el.classList.contains("modal-bg") && e.target !== el) return; // click inside modal
    if (["tsel", "tpick", "partner", "newsMine"].includes(a)) return;
    act(a, el, e);
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    const a = el.dataset && el.dataset.act;
    if (a === "tsel") { const set = el.dataset.side === "give" ? ui.trade.give : ui.trade.get; const id = +el.dataset.id; el.checked ? set.add(id) : set.delete(id); ui.trade.msg = null; render(); }
    else if (a === "tpick") { const set = el.dataset.side === "give" ? ui.trade.givePicks : ui.trade.getPicks; const k = +el.dataset.k; el.checked ? set.add(k) : set.delete(k); ui.trade.msg = null; render(); }
    else if (a === "partner") { resetTrade(el.value); render(); }
    else if (a === "newsMine") { ui.newsMine = el.checked; render(); }
    else if (el.id === "pteam") { ui.players.team = el.value; render(); }
    else if (el.id === "importFile" && el.files[0]) {
      const r = new FileReader();
      r.onload = () => { try { const obj = JSON.parse(r.result); if (!obj.teams || !obj.players) throw 0; GM.importState(obj); ui.tab = "dashboard"; toast("Save loaded."); render(); } catch (err) { toast("That file isn't a valid save.", true); } };
      r.readAsText(el.files[0]);
    }
  });
  let qTimer;
  document.addEventListener("input", (e) => {
    if (e.target.id === "pq") {
      clearTimeout(qTimer);
      const v = e.target.value;
      qTimer = setTimeout(() => { ui.players.q = v; render(); const el = $("#pq"); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 200);
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.modal) { ui.modal = null; render(); } });

  // boot
  GM.load();
  render();
})();
