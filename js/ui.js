// Courtside commissioner UI: renders views from GM.S and wires up actions.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (x) => GM.fmtMoney(x);
  const pct = (x) => (x ? (x * 100).toFixed(1) : "–");
  const f1 = (x) => (x == null ? "–" : (+x).toFixed(1));
  const ht = (i) => (i ? `${Math.floor(i / 12)}'${i % 12}"` : "–");
  const D = GM.data, F = GM.F;

  const ui = {
    tab: "office", modal: null, confirm: null, sort: {},
    newsKind: "all", leaders: "pts", players: { q: "", team: "all" }, txTeam: "all",
    setup: { year: 2026, realCareers: true, followHistory: true },
  };

  // ---------- shared bits ----------
  const tier = (o) => (o >= 80 ? "t1" : o >= 70 ? "t2" : o >= 60 ? "t3" : "t4");
  const ovr = (o) => `<span class="ovr ${tier(o)}">${o}</span>`;
  const rt = (v) => `<span class="rt ${v >= 75 ? "hi" : v >= 55 ? "mid" : "lo"}">${v}</span>`;
  const badge = (fid, big) => { const t = GM.S && GM.T(fid); return t ? `<span class="badge${big ? " big" : ""}" style="background:${t.color}">${esc(t.abbr)}</span>` : `<span class="badge" style="background:var(--tier-4)">FA</span>`; };
  const badgeRaw = (abbr, color, big) => `<span class="badge${big ? " big" : ""}" style="background:${color}">${esc(abbr)}</span>`;
  const plink = (p) => `<button class="plink" data-act="player" data-id="${p.id}">${esc(p.name)}</button><span class="pos">${esc(p.pos)}</span>`;
  const tlink = (fid) => { const t = GM.T(fid); return t ? `<button class="plink" data-act="team" data-id="${fid}">${esc(t.city)} ${esc(t.name)}</button>` : "–"; };
  const rec = (t) => `${t.w}-${t.l}`;
  const phaseLabel = { preseason: "Preseason", regular: "Regular season", playoffs: "Playoffs", offseason: "Offseason" };
  function toast(msg, bad) { const el = document.createElement("div"); el.className = "toast" + (bad ? " bad" : ""); el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 4200); }
  function sortRows(rows, key, def) { const s = ui.sort[key] || def; rows.sort((a, b) => { const x = s.get(a), y = s.get(b); return (x < y ? -1 : x > y ? 1 : 0) * (s.dir || -1); }); return rows; }
  function th(label, key, col) { const s = ui.sort[key], on = s && s.col === col; return `<th class="sortable num${on ? " sorted" : ""}" data-act="sort" data-key="${key}" data-col="${col}">${label}${on ? (s.dir > 0 ? " ▲" : " ▼") : ""}</th>`; }
  const getters = { age: (p) => GM.age(p), ovr: (p) => p.r.ovr, pot: (p) => p.r.pot, ins: (p) => p.r.ins, thr: (p) => p.r.thr, ply: (p) => p.r.ply, reb: (p) => p.r.reb, def: (p) => p.r.def, sal: (p) => p.c.sal };
  const bestReal = (y) => { const r = D.teams[y]; return r ? r.slice().sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l))[0] : null; };

  // ---------- top bar ----------
  function renderTop() {
    const S = GM.S;
    if (!S) { $("#top").innerHTML = `<div class="topbar-inner"><span class="brand">Courtside · Commissioner</span></div>`; return; }
    const champ = S.history[0];
    const tabs = [["office", "Office"], ["standings", "Standings"], ["playoffs", "Playoffs"], ["teams", "Teams"], ["players", "Players"], ["leaders", "Leaders"], ["draft", "Draft"], ["moves", "Transactions"], ["history", "History"], ["league", "League office"], ["settings", "Save & info"]];
    const dot = (k) => (k === "league" && GM.officeOpen()) || (k === "playoffs" && S.phase === "playoffs") ? `<span class="dot"></span>` : "";
    $("#top").innerHTML = `
      <div class="topbar-inner">
        <div class="teamline"><div><div class="brand">Courtside · Commissioner</div><div class="tname">${S.season} ${phaseLabel[S.phase]}${S.phase === "regular" ? ` · day ${S.day}/${GM.lastDay()}` : ""}</div></div></div>
        <div class="score">
          <div class="cell"><span class="lab">Teams</span><span class="val">${GM.activeTeams().length}</span></div>
          <div class="cell"><span class="lab">Games</span><span class="val">${S.rules.games}</span></div>
          <div class="cell"><span class="lab">Playoff spots</span><span class="val">${S.rules.playoffTeams}</span></div>
          <div class="cell"><span class="lab">Reigning champ</span><span class="val accent">${champ ? esc(GM.T(champ.champion)?.abbr || "–") : "–"}</span></div>
          ${primaryAction()}
        </div>
      </div>
      <nav class="tabs" aria-label="Sections">${tabs.map(([k, l]) => `<button class="tab" data-act="tab" data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ""}>${l}${dot(k)}</button>`).join("")}</nav>`;
  }
  function primaryAction() {
    const S = GM.S;
    if (S.phase === "preseason") return `<button class="btn primary" data-act="startSeason">Start ${S.season} season</button>`;
    if (S.phase === "regular") return `<div class="row"><button class="btn" data-act="sim" data-n="7">Sim week</button><button class="btn primary" data-act="sim" data-n="999">Sim season</button></div>`;
    if (S.phase === "playoffs") return S.playoffs.champion ? `<button class="btn primary" data-act="toOffseason">Open the offseason</button>` : `<button class="btn primary" data-act="po" data-mode="round">Sim round</button>`;
    return `<button class="btn primary" data-act="advance">Go to ${S.season + 1}</button>`;
  }

  // ---------- new league ----------
  function renderSetup() {
    const y = ui.setup.year;
    const teams = GM.previewSeason(y);
    const r = GM.eraRules(y);
    const confs = [...new Set(teams.map((t) => t.conf).filter(Boolean))];
    $("#view").innerHTML = `
      <section class="hero">
        <span class="eyebrow">Built on ${esc(D.source)} · seasons ${D.first}–${D.last}</span>
        <h1>Run the <em>league</em></h1>
        <p>Pick a season to start from. Every team, roster and rating comes from that real season. From there the league is yours: playoff format, conferences, expansion, relocation and contraction. The sim runs every front office, and real players arrive in their real draft years.</p>
        <p class="sub">Fan-made simulator. Not affiliated with or endorsed by the WNBA or its teams.</p>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Start in ${y}</h2>
          <label class="row">Season <select id="setupYear" data-act="setupYear">${Array.from({ length: D.last - D.first + 1 }, (_, i) => D.first + i).map((x) => `<option ${x === y ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
        <input type="range" id="setupRange" min="${D.first}" max="${D.last}" value="${y}" aria-label="Start season" style="width:100%;accent-color:var(--accent)">
        <div class="row sub"><span>${teams.length} teams</span>·<span>${confs.length ? confs.join(" / ") + " conferences" : "one table"}</span>·<span>${r.games} games</span>·<span>${r.playoffTeams} playoff teams</span>·<span>est. cap ${money(r.cap)}</span></div>
        <div class="row">
          <label class="row"><input type="checkbox" id="optReal" ${ui.setup.realCareers ? "checked" : ""}> Real players follow their real career arcs</label>
          <label class="row"><input type="checkbox" id="optHist" ${ui.setup.followHistory ? "checked" : ""}> Real franchise moves come to me for approval</label>
        </div>
        <div class="row"><button class="btn primary" data-act="newLeague">Start the ${y} league</button></div>
      </section>
      <div class="pickgrid">${teams.map((t) => `
        <div class="tcard" style="--tc:${t.color};cursor:default">
          <div class="tt">${badgeRaw(t.abbr, t.color, true)}<div><b>${esc(t.city)}<br>${esc(t.name)}</b></div></div>
          <div class="meta"><div><span>${y} record</span><span>${t.w}-${t.l}</span></div><div><span>Conf</span><span>${esc(t.conf || "–")}</span></div><div><span>Players</span><span>${t.n}</span></div></div>
          <ul>${t.top.map((p) => `<li><span>${esc(p.name)}</span>${ovr(p.ovr)}</li>`).join("")}</ul>
        </div>`).join("")}</div>`;
  }

  // ---------- office ----------
  function renderOffice() {
    const S = GM.S;
    const kinds = [["all", "All news"], ["office", "League office"], ["title", "Titles"], ["award", "Awards"], ["draft", "Draft"], ["trade", "Trades"], ["fa", "Free agency"], ["retire", "Retirements"], ["injury", "Injuries"]];
    const news = S.news.filter((n) => ui.newsKind === "all" || n.kind === ui.newsKind).slice(0, 60);
    const stars = Object.values(S.players).filter((p) => p.team && !p.retired).sort((a, b) => b.r.ovr - a.r.ovr).slice(0, 8);
    $("#view").innerHTML = `
      ${phasePanel()}
      <div class="grid2">
        <section class="panel">
          <div class="panel-head"><h3>League wire</h3><select id="newsKind" aria-label="Filter news">${kinds.map(([k, l]) => `<option value="${k}" ${ui.newsKind === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="news">${news.map((n) => `<div class="${n.kind === "office" || n.kind === "title" ? "mine" : ""}"><span class="when">${n.season} ${n.phase === "regular" ? "D" + n.day : (phaseLabel[n.phase] || "").slice(0, 3).toUpperCase()}</span>${esc(n.text)}</div>`).join("") || `<div class="empty">Nothing yet.</div>`}</div>
        </section>
        <div style="display:grid;gap:18px">
          <section class="panel"><div class="panel-head"><h3>Standings</h3><button class="btn small" data-act="tab" data-tab="standings">Full tables</button></div>${miniStandings()}</section>
          <section class="panel"><h3>League's best</h3><div class="tablewrap"><table><tbody>${stars.map((p) => { const s = GM.perGame(p); return `<tr><td>${plink(p)}</td><td>${badge(p.team)}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num muted">${s ? `${s.pts} / ${s.reb} / ${s.ast}` : `age ${GM.age(p)}`}</td></tr>`; }).join("")}</tbody></table></div></section>
        </div>
      </div>`;
  }
  function miniStandings() {
    const S = GM.S, confs = GM.activeConfs();
    const conf = S.rules.seeding === "conference" && confs.length > 1;
    const groups = conf ? confs.map((c) => [c, GM.standings(c)]) : [["League", GM.standings()]];
    const cut = conf ? Math.round(S.rules.playoffTeams / confs.length) : S.rules.playoffTeams;
    return groups.map(([c, st]) => `${conf ? `<span class="eyebrow">${esc(c)}</span>` : ""}<div class="tablewrap"><table><tbody>${st.map((t, i) => `<tr class="${i === cut - 1 && i < st.length - 1 ? "cutline" : ""}"><td class="muted">${i + 1}</td><td>${badge(t.fid)} ${tlink(t.fid)}</td><td class="num">${rec(t)}</td></tr>`).join("")}</tbody></table></div>`).join("");
  }
  function phasePanel() {
    const S = GM.S, r = S.rules;
    if (S.phase === "preseason") {
      return `<section class="callout"><h3>Preseason ${S.season}</h3>
        <div class="sub">The commissioner's office is open. Change the playoff format, rules or conferences, add a team, move one or fold one, then start the season.</div>
        <div class="row sub"><span>${GM.activeTeams().length} teams</span>·<span>${r.games} games</span>·<span>${r.playoffTeams} playoff teams seeded ${r.seeding === "conference" ? "by conference" : "league-wide"}</span>·<span>best of ${r.earlyBo} / ${r.semisBo} / ${r.finalsBo}</span>·<span>cap ${money(r.cap)}</span></div>
        <div class="row"><button class="btn primary" data-act="startSeason">Start the season</button><button class="btn" data-act="tab" data-tab="league">League office</button></div></section>`;
    }
    if (S.phase === "regular") return `<section class="callout"><div class="panel-head"><h3>Regular season · day ${S.day} of ${GM.lastDay()}</h3><span class="sub">${S.rulesNext ? "Rule changes queued for next season" : ""}</span></div>
      <div class="row"><button class="btn" data-act="sim" data-n="1">Sim 1 day</button><button class="btn" data-act="sim" data-n="7">Sim 1 week</button><button class="btn primary" data-act="sim" data-n="999">Sim to playoffs</button></div></section>`;
    if (S.phase === "playoffs") {
      const po = S.playoffs;
      return `<section class="callout"><div class="panel-head"><h3>${po.champion ? `The ${esc(GM.teamName(po.champion))} win the ${S.season} title` : `${S.season} playoffs`}</h3>${po.champion ? `<span class="sub">Finals MVP: ${esc(GM.P(po.finalsMvp)?.name || "–")}</span>` : ""}</div>
        ${brackets()}${awardsBlock(S.awards)}
        <div class="row">${po.champion ? `<button class="btn primary" data-act="toOffseason">Open the offseason</button>` : `<button class="btn" data-act="po" data-mode="game">Sim one game</button><button class="btn" data-act="po" data-mode="round">Sim round</button><button class="btn primary" data-act="po" data-mode="all">Sim to champion</button>`}</div></section>`;
    }
    const h = S.history[0], ev = GM.pendingEvents();
    return `<section class="callout"><div class="panel-head"><h3>${S.season} offseason</h3><span class="sub">${h ? `Champion: ${esc(h.champName)}` : ""}</span></div>
      ${awardsBlock(S.awards)}
      ${ev.length ? `<div style="display:grid;gap:6px"><b>Real league history for ${S.season + 1}: approve or veto</b>${ev.map(eventRow).join("")}</div>` : `<div class="sub">No real-life franchise moves are scheduled for ${S.season + 1}.</div>`}
      <div class="sub">When you move on, the sim runs the ${S.season + 1} draft${S.season + 1 <= D.last ? " with the real draft class" : ""}, contract decisions, free agency, player development and retirements. You can still make changes in the preseason.</div>
      <div class="row"><button class="btn primary" data-act="advance">Run the offseason → ${S.season + 1} preseason</button><button class="btn" data-act="tab" data-tab="league">League office</button></div></section>`;
  }
  function eventRow(e) {
    return `<div class="row"><span class="chip ${e.approved ? "good" : "bad"}">${e.approved ? "Approved" : "Vetoed"}</span><span>${esc(e.text)}</span><span class="spacer"></span>
      <button class="btn small" data-act="event" data-id="${esc(e.id)}" data-ok="${e.approved ? 0 : 1}">${e.approved ? "Veto" : "Approve"}</button></div>`;
  }
  function awardsBlock(a) {
    if (!a) return "";
    const item = (lab, id) => id && GM.P(id) ? `<div><span class="eyebrow">${lab}</span><div>${plink(GM.P(id))} <span class="muted">${esc(GM.T(GM.P(id).team)?.abbr || "")}</span></div></div>` : "";
    return `<div class="grid3">${item("MVP", a.mvp)}${item("Defensive POY", a.dpoy)}${item("Rookie of the Year", a.roy)}</div>`;
  }
  function brackets() {
    const po = GM.S.playoffs; if (!po) return "";
    const one = (br) => {
      const rounds = br.rounds;
      return `<div style="display:grid;gap:8px;min-width:0"><span class="eyebrow">${esc(br.label)}</span><div class="bracket" style="grid-template-columns:repeat(${Math.max(1, rounds.length)},minmax(160px,1fr))">
        ${rounds.map((rd) => `<div style="display:grid;gap:8px;align-content:start">${rd.map((s) => s.lo ? `<div class="series"><span class="eyebrow">Best of ${s.bestOf}</span>${[[s.hi, s.wh], [s.lo, s.wl]].map(([id, w]) => `<div class="s ${s.winner ? (s.winner === id ? "win" : "lose") : ""}"><span>${badge(id)} <span class="muted">${br.seeds.indexOf(id) + 1}</span> ${esc(GM.T(id).name)}</span><b>${w}</b></div>`).join("")}</div>`
          : `<div class="series"><div class="s"><span>${badge(s.hi)} <span class="muted">${br.seeds.indexOf(s.hi) + 1}</span> ${esc(GM.T(s.hi).name)}</span><span class="chip">Bye</span></div></div>`).join("")}</div>`).join("") || `<div class="series">${br.champion ? `${badge(br.champion)} advances` : "TBD"}</div>`}
      </div></div>`;
    };
    return `<div style="display:grid;gap:14px">${po.brackets.map(one).join("")}${po.final ? one(po.final) : po.brackets.length > 1 ? `<div class="sub">The conference champions meet in the Finals.</div>` : ""}</div>`;
  }

  // ---------- standings / playoffs ----------
  function renderStandings() {
    const S = GM.S, confs = GM.activeConfs();
    const conf = confs.length > 1;
    const cutConf = S.rules.seeding === "conference" && conf;
    const per = cutConf ? Math.round(S.rules.playoffTeams / confs.length) : S.rules.playoffTeams;
    const table = (title, st, cut) => `<section class="panel"><h2>${esc(title)}</h2><div class="tablewrap"><table><thead><tr><th>#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">PCT</th><th class="num">GB</th><th class="num">Home</th><th class="num">Away</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff</th><th class="num">Strk</th><th class="num">Rating</th></tr></thead><tbody>
      ${st.map((t, i) => { const gp = t.w + t.l, gb = ((st[0].w - t.w) + (t.l - st[0].l)) / 2; return `<tr class="${cut && i === cut - 1 && i < st.length - 1 ? "cutline" : ""}"><td class="muted">${i + 1}</td><td>${badge(t.fid)} ${tlink(t.fid)}</td><td class="num">${t.w}</td><td class="num">${t.l}</td><td class="num">${gp ? (t.w / gp).toFixed(3).replace(/^0/, "") : "–"}</td><td class="num">${gb ? gb.toFixed(1) : "–"}</td><td class="num">${t.hw}-${t.hl}</td><td class="num">${t.w - t.hw}-${t.l - t.hl}</td><td class="num">${gp ? f1(t.pf / gp) : "–"}</td><td class="num">${gp ? f1(t.pa / gp) : "–"}</td><td class="num">${gp ? f1((t.pf - t.pa) / gp) : "–"}</td><td class="num">${t.streak ? (t.streak > 0 ? "W" + t.streak : "L" + -t.streak) : "–"}</td><td class="num">${GM.teamRating(t.fid).toFixed(1)}</td></tr>`; }).join("")}
      </tbody></table></div></section>`;
    const br = bestReal(S.season);
    $("#view").innerHTML = (conf ? confs.map((c) => table(`${c} · ${S.season}`, GM.standings(c), cutConf ? per : 0)).join("") : "")
      + table(conf ? `League table · ${S.season}` : `Standings · ${S.season}`, GM.standings(), cutConf ? 0 : per)
      + `<div class="sub">The dashed line marks the playoff cut (${cutConf ? `top ${per} per conference` : `top ${per} overall`}).${br ? ` In real life, ${S.season}'s best record belonged to ${esc(br.city)} ${esc(br.name)} at ${br.w}-${br.l}.` : ""}</div>`;
  }
  function renderPlayoffs() {
    const S = GM.S, r = S.rules;
    $("#view").innerHTML = S.playoffs ? `<section class="panel"><h2>${S.season} playoffs</h2>${brackets()}${S.phase === "playoffs" && !S.playoffs.champion ? `<div class="row"><button class="btn" data-act="po" data-mode="game">Sim one game</button><button class="btn" data-act="po" data-mode="round">Sim round</button><button class="btn primary" data-act="po" data-mode="all">Sim to champion</button></div>` : ""}</section>`
      : `<section class="panel"><h2>Playoffs</h2><div class="empty">The bracket appears when the regular season ends. Format: ${r.playoffTeams} teams seeded ${r.seeding === "conference" ? "by conference" : "league-wide"}, best of ${r.earlyBo} in early rounds, ${r.semisBo} in the semifinals and ${r.finalsBo} in the Finals.</div></section>`;
  }

  // ---------- teams ----------
  function renderTeams() {
    const S = GM.S;
    const ts = GM.activeTeams().slice().sort((a, b) => GM.teamRating(b.fid) - GM.teamRating(a.fid));
    const gone = S.teams.filter((t) => !t.active);
    const mode = (f) => ({ contend: "Contending", rebuild: "Rebuilding", neutral: "Middle" }[GM.teamMode(f)]);
    $("#view").innerHTML = `<div class="pickgrid">${ts.map((t) => {
      const top = GM.roster(t.fid).sort((a, b) => b.r.ovr - a.r.ovr).slice(0, 3);
      return `<button class="tcard" style="--tc:${t.color}" data-act="team" data-id="${t.fid}">
        <div class="tt">${badge(t.fid, true)}<div><b>${esc(t.city)}<br>${esc(t.name)}</b></div></div>
        <div class="meta"><div><span>Record</span><span>${rec(t)}</span></div><div><span>Rating</span><span>${GM.teamRating(t.fid).toFixed(1)}</span></div><div><span>Titles</span><span>${t.titles}</span></div></div>
        <div class="row sub"><span>${esc(t.conf)}</span>·<span>${mode(t.fid)}</span>·<span>payroll ${money(GM.payroll(t.fid))}</span></div>
        <ul>${top.map((p) => `<li><span>${esc(p.name)}</span>${ovr(p.r.ovr)}</li>`).join("")}</ul></button>`; }).join("")}</div>
      ${gone.length ? `<section class="panel"><h3>Defunct franchises</h3>${gone.map((t) => `<div class="row">${badge(t.fid)} <button class="plink" data-act="team" data-id="${t.fid}">${esc(t.city)} ${esc(t.name)}</button><span class="muted">folded ${t.folded} · ${t.titles} title${t.titles === 1 ? "" : "s"}</span></div>`).join("")}</section>` : ""}`;
  }
  function teamModal(fid) {
    const S = GM.S, t = GM.T(fid); if (!t) return "";
    const ps = GM.roster(fid).sort((a, b) => b.r.ovr - a.r.ovr);
    const open = GM.officeOpen() && t.active;
    const conf = ui.confirm === "fold" + fid;
    return `<div class="modal-bg" data-act="closeModal"><div class="modal" style="--tc:${t.color}" role="dialog" aria-modal="true" aria-label="${esc(t.city)} ${esc(t.name)}" data-stop>
      <div class="modal-head"><div class="row">${badge(fid, true)}<div><h2>${esc(t.city)} ${esc(t.name)}</h2><div class="sub">${t.active ? `${esc(t.conf)} · ${rec(t)} · rating ${GM.teamRating(fid).toFixed(1)} · payroll ${money(GM.payroll(fid))} of ${money(S.rules.cap)}` : `Folded ${t.folded}`} · ${t.titles} title${t.titles === 1 ? "" : "s"}</div></div></div><button class="btn" data-act="closeModal">Close</button></div>
      ${t.active ? `<div class="tablewrap"><table><thead><tr><th>Player</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th><th class="num">GP</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">Salary</th><th class="num">Yrs</th><th></th></tr></thead><tbody>
        ${ps.map((p) => { const s = GM.perGame(p); return `<tr><td>${plink(p)}</td><td class="num">${GM.age(p)}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num">${rt(p.r.pot)}</td><td class="num">${s ? s.gp : "–"}</td><td class="num">${s ? s.pts : "–"}</td><td class="num">${s ? s.reb : "–"}</td><td class="num">${s ? s.ast : "–"}</td><td class="num">${money(p.c.sal)}</td><td class="num">${p.c.yrs}</td><td>${p.inj ? `<span class="chip bad">${p.inj >= 999 ? "Out for season" : "Out " + p.inj + "g"}</span>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>` : ""}
      ${t.hist.length ? `<details><summary class="eyebrow" style="cursor:pointer">Franchise history (${t.hist.length} season${t.hist.length === 1 ? "" : "s"})</summary><div class="tablewrap"><table><tbody>${t.hist.slice().reverse().map((h) => `<tr><td>${h.season}</td><td>${esc(h.name)}</td><td class="num">${h.w}-${h.l}</td><td>${h.res === "Champion" ? '<span class="chip accent">Champion</span>' : esc(h.res)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
      ${open ? `<div class="callout"><b>Commissioner actions</b>
        <div class="row"><label class="row">Conference <select data-act="teamConf" data-id="${fid}" aria-label="Conference">${S.conferences.map((c) => `<option ${c === t.conf ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>
        <div class="row"><input type="text" id="relCity" value="${esc(t.city)}" aria-label="City" placeholder="City"><input type="text" id="relName" value="${esc(t.name)}" aria-label="Nickname" placeholder="Nickname"><input type="text" id="relAbbr" value="${esc(t.abbr)}" maxlength="3" size="4" aria-label="Abbreviation"><input type="color" id="relColor" value="${/^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#666666"}" aria-label="Team color"><button class="btn" data-act="relocate" data-id="${fid}">Relocate / rename</button></div>
        <div class="row">${conf ? `<span>Fold the ${esc(t.name)}? Their players go to a dispersal draft.</span><button class="btn danger" data-act="fold" data-id="${fid}">Fold the franchise</button><button class="btn" data-act="cancel">Keep them</button>` : `<button class="btn danger" data-act="askFold" data-id="${fid}">Fold this franchise…</button>`}</div></div>`
        : t.active ? `<div class="sub">Franchise changes open in the preseason and offseason.</div>` : ""}
    </div></div>`;
  }

  // ---------- players ----------
  function renderPlayers() {
    const S = GM.S, f = ui.players;
    let ps = Object.values(S.players).filter((p) => !p.retired && !p.prospect);
    if (f.team === "FA") ps = ps.filter((p) => !p.team); else if (f.team !== "all") ps = ps.filter((p) => p.team === f.team);
    if (f.q) { const q = f.q.toLowerCase(); ps = ps.filter((p) => p.name.toLowerCase().includes(q)); }
    sortRows(ps, "players", { col: "ovr", dir: -1, get: getters.ovr });
    $("#view").innerHTML = `<section class="panel"><div class="panel-head"><h2>Players</h2>
      <div class="row"><input type="search" id="pq" placeholder="Search by name" value="${esc(f.q)}" aria-label="Search players">
      <select id="pteam" aria-label="Team filter"><option value="all">All teams</option><option value="FA" ${f.team === "FA" ? "selected" : ""}>Free agents</option>${GM.activeTeams().map((t) => `<option value="${t.fid}" ${f.team === t.fid ? "selected" : ""}>${esc(t.city)} ${esc(t.name)}</option>`).join("")}</select></div></div>
      <div class="tablewrap"><table><thead><tr><th>Player</th><th>Team</th>${th("Age", "players", "age")}${th("OVR", "players", "ovr")}${th("POT", "players", "pot")}${th("INS", "players", "ins")}${th("3PT", "players", "thr")}${th("PLY", "players", "ply")}${th("REB", "players", "reb")}${th("DEF", "players", "def")}${th("Salary", "players", "sal")}<th class="num">PTS</th></tr></thead><tbody>
      ${ps.slice(0, 200).map((p) => { const s = GM.perGame(p); return `<tr><td>${plink(p)}${p.real ? "" : ' <span class="chip">gen</span>'}</td><td>${badge(p.team)}</td><td class="num">${GM.age(p)}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num">${rt(p.r.pot)}</td><td class="num">${rt(p.r.ins)}</td><td class="num">${rt(p.r.thr)}</td><td class="num">${rt(p.r.ply)}</td><td class="num">${rt(p.r.reb)}</td><td class="num">${rt(p.r.def)}</td><td class="num">${p.team ? money(p.c.sal) : "–"}</td><td class="num">${s ? s.pts : "–"}</td></tr>`; }).join("")}
      </tbody></table></div><div class="sub">Showing ${Math.min(200, ps.length)} of ${ps.length}. "gen" marks generated players.</div></section>`;
  }
  function playerModal(id) {
    const S = GM.S, p = GM.P(id); if (!p) return "";
    const t = GM.T(p.team);
    const bars = [["OVR", p.r.ovr], ["POT", p.r.pot], ["INS", p.r.ins], ["3PT", p.r.thr], ["FT", p.r.fts], ["PLY", p.r.ply], ["REB", p.r.reb], ["DEF", p.r.def], ["ATH", p.r.ath]];
    const rows = [];
    for (const y of GM.realSeasons(p.id).filter((y) => y < S.startYear).sort((a, b) => a - b)) {
      const l = GM.realLine(p.id, y);
      rows.push({ season: y, team: GM.fidAbbr(l[F.fid], y), gp: l[F.gp], min: l[F.min], pts: l[F.pts], reb: l[F.reb], ast: l[F.ast], stl: l[F.stl], blk: l[F.blk], fg: l[F.fg], tp: l[F.tp], ft: l[F.ft], tag: "real" });
    }
    for (const c of p.career) rows.push({ ...c, team: GM.T(c.team)?.abbr || c.team });
    const s = GM.perGame(p); if (s && S.phase !== "offseason") rows.push({ season: S.season, ...s, team: GM.T(s.team)?.abbr, tag: "now" });
    const realAll = GM.realSeasons(p.id).filter((y) => y >= S.startYear).sort((a, b) => a - b);
    return `<div class="modal-bg" data-act="closeModal"><div class="modal" style="--tc:${t ? t.color : "var(--tier-4)"}" role="dialog" aria-modal="true" aria-label="${esc(p.name)}" data-stop>
      <div class="modal-head"><div class="row">${badge(p.team, true)}<div><h2>${esc(p.name)}</h2><div class="sub">${esc(p.pos)} · ${ht(p.ht)} · age ${GM.age(p)}${p.school ? ` · ${esc(p.school)}` : ""}${p.draft && p.draft.season ? ` · ${p.draft.real ? "real " : ""}${p.draft.season} draft${p.draft.pick ? `, #${p.draft.pick}` : ""}` : ""}</div></div></div><button class="btn" data-act="closeModal">Close</button></div>
      <div class="row">${t ? `<span class="chip">${esc(t.city)} ${esc(t.name)}</span><span class="chip">${money(p.c.sal)} × ${p.c.yrs}</span>` : p.retired ? `<span class="chip">Retired ${p.retired}</span>` : `<span class="chip warn">Free agent</span>`}${p.inj ? `<span class="chip bad">${esc(p.injType)}</span>` : ""}${p.real ? "" : `<span class="chip">Generated player</span>`}${p.awards.map((a) => `<span class="chip accent">${esc(a)}</span>`).join("")}</div>
      <div class="bars">${bars.map(([l, v]) => `<div class="bar"><span class="eyebrow">${l}</span><div class="track"><div class="fill" style="width:${v}%"></div></div><b>${v}</b></div>`).join("")}</div>
      ${rows.length ? `<div class="tablewrap" style="max-height:320px;overflow-y:auto"><table><thead><tr><th>Season</th><th>Team</th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">FG%</th><th class="num">3P%</th><th class="num">FT%</th></tr></thead><tbody>
        ${rows.map((c) => `<tr><td>${c.season}${c.tag === "real" ? ' <span class="chip">real</span>' : c.tag === "now" ? ' <span class="chip accent">now</span>' : ""}</td><td>${esc(c.team)}</td><td class="num">${c.gp}</td><td class="num">${f1(c.min)}</td><td class="num">${f1(c.pts)}</td><td class="num">${f1(c.reb)}</td><td class="num">${f1(c.ast)}</td><td class="num">${f1(c.stl)}</td><td class="num">${f1(c.blk)}</td><td class="num">${pct(c.fg)}</td><td class="num">${pct(c.tp)}</td><td class="num">${pct(c.ft)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No games played yet.</div>`}
      ${realAll.length ? `<details><summary class="eyebrow" style="cursor:pointer">What really happened (${realAll[0]}–${realAll.at(-1)})</summary><div class="tablewrap"><table><tbody>${realAll.map((y) => { const l = GM.realLine(p.id, y); return `<tr><td>${y}</td><td>${esc(GM.fidAbbr(l[F.fid], y))}</td><td class="num">${l[F.gp]} gp</td><td class="num">${f1(l[F.pts])} pts</td><td class="num">${f1(l[F.reb])} reb</td><td class="num">${f1(l[F.ast])} ast</td><td class="num">rating ${l[F.ovr]}</td></tr>`; }).join("")}</tbody></table></div></details>` : ""}
    </div></div>`;
  }

  // ---------- leaders / draft / moves / history ----------
  function renderLeaders() {
    const S = GM.S;
    const cats = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["stl", "Steals"], ["blk", "Blocks"], ["fg", "FG%"], ["tp", "3P%"], ["ts", "True shooting"]];
    const gp = Math.max(0, ...GM.activeTeams().map((t) => t.w + t.l));
    const rows = Object.values(S.players).map((p) => [p, GM.perGame(p)]).filter(([, s]) => s && s.gp >= Math.max(1, Math.floor(gp * 0.5)));
    const c = ui.leaders;
    const q = ["fg", "tp", "ts"].includes(c) ? rows.filter(([p, s]) => (c === "tp" ? p.stats[S.season].tpa >= s.gp * 1.2 : p.stats[S.season].fga >= s.gp * 6)) : rows;
    q.sort((a, b) => b[1][c] - a[1][c]);
    $("#view").innerHTML = `<section class="panel"><div class="panel-head"><h2>Leaders ${S.season}</h2><div class="row">${cats.map(([k, l]) => `<button class="btn small ${k === c ? "primary" : ""}" data-act="leaders" data-c="${k}">${l}</button>`).join("")}</div></div>
      ${q.length ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>Player</th><th>Team</th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">FG%</th><th class="num">3P%</th><th class="num">TS%</th></tr></thead><tbody>
      ${q.slice(0, 30).map(([p, s], i) => `<tr><td class="muted">${i + 1}</td><td>${plink(p)}</td><td>${badge(s.team)}</td><td class="num">${s.gp}</td><td class="num">${s.min}</td><td class="num">${s.pts}</td><td class="num">${s.reb}</td><td class="num">${s.ast}</td><td class="num">${s.stl}</td><td class="num">${s.blk}</td><td class="num">${pct(s.fg)}</td><td class="num">${pct(s.tp)}</td><td class="num">${pct(s.ts)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Leaders appear once games are played.</div>`}</section>`;
  }
  function renderDraft() {
    const S = GM.S, d = S.lastDraft;
    const y = S.season + 1;
    const upcoming = y <= D.last ? D.players.filter((p) => p.s[y] && Math.min(...Object.keys(p.s).map(Number)) === y && p.dy && p.dy >= y - 2 && !S.players[p.id]).sort((a, b) => (a.dn || 99) - (b.dn || 99)) : [];
    $("#view").innerHTML = `<div class="grid2">
      <section class="panel"><h2>${d ? `${d.season} draft` : "Draft"}</h2>
        ${d ? `<div class="tablewrap"><table><thead><tr><th>Pick</th><th>Team</th><th>Player</th><th>From</th><th class="num">OVR</th><th class="num">POT</th></tr></thead><tbody>${d.picks.map((x) => { const p = GM.P(x.pid); return p ? `<tr><td class="muted">${x.pick}${x.round > 1 ? ` <span class="pos">R${x.round}</span>` : ""}</td><td>${badge(x.fid)}</td><td>${plink(p)}${p.real ? "" : ' <span class="chip">gen</span>'}</td><td class="muted">${esc(p.school)}</td><td class="num">${ovr(p.r.ovr)}</td><td class="num">${rt(p.r.pot)}</td></tr>` : ""; }).join("")}</tbody></table></div>` : `<div class="empty">The first draft runs when you finish the ${S.season} offseason.</div>`}
      </section>
      <section class="panel"><h3>${y} class: real players</h3>
        ${upcoming.length ? `<div class="sub">These players were in the real ${y} draft. In your league they're drafted in the order your standings and lottery produce.</div><div class="tablewrap"><table><tbody>${upcoming.slice(0, 40).map((p) => `<tr><td class="muted">${p.dn ? `real #${p.dn}` : ""}</td><td>${esc(p.n)}</td><td class="muted">${esc(p.col && p.col !== "None" ? p.col : p.ctry)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${y > D.last ? "From here on, draft classes are generated." : "No real draftees found for this year."}</div>`}
      </section></div>`;
  }
  function renderMoves() {
    const S = GM.S;
    const list = S.transactions.filter((x) => ui.txTeam === "all" || x.team === ui.txTeam).slice(0, 200);
    $("#view").innerHTML = `<section class="panel"><div class="panel-head"><h2>Transactions</h2><select id="txTeam" aria-label="Team filter"><option value="all">All teams</option>${S.teams.map((t) => `<option value="${t.fid}" ${ui.txTeam === t.fid ? "selected" : ""}>${esc(t.city)} ${esc(t.name)}</option>`).join("")}</select></div>
      <div class="news" style="max-height:none">${list.map((x) => `<div><span class="when">${x.season} ${(phaseLabel[x.phase] || "").slice(0, 3).toUpperCase()}</span>${esc(x.text)}</div>`).join("") || `<div class="empty">No transactions yet.</div>`}</div></section>`;
  }
  function renderHistory() {
    const S = GM.S;
    const nm = (id) => (id && GM.P(id) ? plink(GM.P(id)) : "–");
    const titles = S.teams.filter((t) => t.titles).sort((a, b) => b.titles - a.titles);
    $("#view").innerHTML = `<section class="panel"><h2>League history</h2>
      ${S.history.length ? `<div class="tablewrap"><table><thead><tr><th>Season</th><th>Champion</th><th>Runner-up</th><th>Finals MVP</th><th>MVP</th><th>DPOY</th><th>ROY</th><th>Best record</th><th>Real life best record</th></tr></thead><tbody>
      ${S.history.map((h) => `<tr><td>${h.season}</td><td>${badge(h.champion)} ${esc(h.champName)}</td><td class="muted">${esc(h.runnerName)}</td><td>${nm(h.finalsMvp)}</td><td>${nm(h.mvp)}</td><td>${nm(h.dpoy)}</td><td>${nm(h.roy)}</td><td>${badge(h.best)} ${esc(h.bestRec)}</td><td class="muted">${h.real ? `${esc(h.real.team)} ${esc(h.real.rec)}` : "–"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Finish a season to start the record book.</div>`}</section>
      ${titles.length ? `<section class="panel"><h3>Titles by franchise</h3><div class="tablewrap"><table><tbody>${titles.map((t) => `<tr><td>${badge(t.fid)} ${esc(t.city)} ${esc(t.name)}${t.active ? "" : ' <span class="chip">defunct</span>'}</td><td class="num"><b>${t.titles}</b></td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  }

  // ---------- league office ----------
  function renderLeague() {
    const S = GM.S, open = GM.officeOpen();
    const r = S.rulesNext || S.rules;
    const n = GM.activeTeams().length;
    const bo = (id, v) => `<select id="${id}">${[1, 3, 5, 7].map((x) => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("")}</select>`;
    const num = (id, v, label, attrs = "") => `<label class="field"><span class="eyebrow">${label}</span><input type="number" id="${id}" value="${v}" ${attrs}></label>`;
    $("#view").innerHTML = `
      <section class="callout"><h3>League office · ${open ? "open" : "season in progress"}</h3>
        <div class="sub">${open ? "Changes take effect immediately." : "Rule changes made now are queued for next season. Franchise and conference changes open in the preseason and offseason."}${S.rulesNext ? " The form shows your queued changes." : ""}</div></section>
      <div class="grid2">
        <section class="panel"><h3>Playoff format</h3>
          <div class="formgrid">
            ${num("rPlayoffTeams", r.playoffTeams, `Playoff teams (of ${n})`, `min="2" max="${n}"`)}
            <label class="field"><span class="eyebrow">Seeding</span><select id="rSeeding"><option value="overall" ${r.seeding === "overall" ? "selected" : ""}>League-wide</option><option value="conference" ${r.seeding === "conference" ? "selected" : ""}>By conference</option></select></label>
            <label class="field"><span class="eyebrow">Early rounds, best of</span>${bo("rEarly", r.earlyBo)}</label>
            <label class="field"><span class="eyebrow">Semifinals, best of</span>${bo("rSemis", r.semisBo)}</label>
            <label class="field"><span class="eyebrow">Finals, best of</span>${bo("rFinals", r.finalsBo)}</label>
          </div>
          <div class="sub">If the field doesn't fill a full bracket, the top seeds get byes. With conference seeding, each conference sends ${Math.round(r.playoffTeams / Math.max(1, GM.activeConfs().length))} teams and the conference champions meet in the Finals.</div>
          <h3>Season, money and the draft</h3>
          <div class="formgrid">
            ${num("rGames", r.games, "Games per team", 'min="4" max="100"')}
            ${num("rCap", Math.round(r.cap / 1000), "Salary cap ($K)", 'min="100" step="50"')}
            ${num("rGrowth", Math.round(r.capGrowth * 100), "Cap growth per year (%)", 'min="0" max="30"')}
            ${num("rMaxPct", Math.round(r.maxPct * 100), "Max salary (% of cap)", 'min="5" max="50"')}
            ${num("rRosterMin", r.rosterMin, "Roster minimum", 'min="8" max="20"')}
            ${num("rRosterMax", r.rosterMax, "Roster maximum", 'min="8" max="20"')}
            ${num("rRounds", r.draftRounds, "Draft rounds", 'min="0" max="6"')}
            ${num("rLotTeams", r.lotteryTeams, "Teams in the lottery", `min="0" max="${n}"`)}
            ${num("rLotPicks", r.lotteryPicks, "Picks decided by lottery", `min="0" max="${n}"`)}
            ${num("rProtect", r.expansionProtect, "Expansion draft: protected per team", 'min="0" max="15"')}
            ${num("rDeadline", Math.round(r.tradeDeadline * 100), "Trade deadline (% of season)", 'min="0" max="100"')}
          </div>
          <div class="row"><button class="btn primary" data-act="saveRules">${open ? "Apply rules" : "Queue for next season"}</button></div>
        </section>
        <div style="display:grid;gap:18px;min-width:0">
          <section class="panel"><h3>Conferences</h3>
            ${S.conferences.map((c, i) => `<div class="row"><b style="min-width:7ch">${esc(c)}</b><span class="muted">${GM.activeTeams().filter((t) => t.conf === c).length} teams</span><span class="spacer"></span>${open ? `<input type="text" id="cn-${i}" placeholder="New name" size="10" aria-label="Rename ${esc(c)}"><button class="btn small" data-act="renameConf" data-i="${i}">Rename</button><button class="btn small danger" data-act="removeConf" data-i="${i}">Dissolve</button>` : ""}</div>`).join("")}
            ${open ? `<div class="row"><input type="text" id="newConf" placeholder="Conference name" aria-label="New conference name"><button class="btn" data-act="addConf">Add conference</button></div>
            <div class="tablewrap"><table><tbody>${GM.activeTeams().map((t) => `<tr><td>${badge(t.fid)} ${esc(t.city)} ${esc(t.name)}</td><td><select data-act="teamConf" data-id="${t.fid}" aria-label="Conference for ${esc(t.name)}">${S.conferences.map((c) => `<option ${c === t.conf ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>` : ""}
          </section>
          <section class="panel"><h3>Expansion</h3>
            ${open ? `<div class="sub">The new team gets an expansion draft (every other team protects ${r.expansionProtect} players), the first pick in each round of its first draft, and a shot at free agents.</div>
            <div class="formgrid">
              <label class="field"><span class="eyebrow">City</span><input type="text" id="xCity" placeholder="Nashville"></label>
              <label class="field"><span class="eyebrow">Nickname</span><input type="text" id="xName" placeholder="Notes"></label>
              <label class="field"><span class="eyebrow">Abbreviation</span><input type="text" id="xAbbr" maxlength="3" placeholder="NSH"></label>
              <label class="field"><span class="eyebrow">Color</span><input type="color" id="xColor" value="#2f6f8f"></label>
              <label class="field"><span class="eyebrow">Conference</span><select id="xConf">${S.conferences.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
            </div><div class="row"><button class="btn primary" data-act="expand">Add the team</button></div>` : `<div class="empty">Opens in the preseason and offseason.</div>`}
            <div class="sub">To relocate, rename or fold a team, open it from the Teams tab.</div>
          </section>
          <section class="panel"><h3>Real league history</h3>
            <label class="row" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="optHistory" ${S.opts.followHistory ? "checked" : ""}> Bring real franchise moves (expansions, relocations, folds, schedule changes) to me for approval</label>
            <label class="row" style="flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="optCareers" ${S.opts.realCareers ? "checked" : ""}> Real players follow their real career arcs</label>
            ${GM.pendingEvents().length ? GM.pendingEvents().map(eventRow).join("") : `<div class="sub">Nothing pending right now. Real moves for next season appear here during the offseason.</div>`}
          </section>
        </div>
      </div>`;
  }

  function renderSettings() {
    const S = GM.S;
    $("#view").innerHTML = `<div class="grid2">
      <section class="panel"><h2>Save</h2>
        <div class="prose"><p>The league saves in this browser after every step. To move it to another device or keep a backup, copy the save code${window.top === window ? " or download it" : ""}, then import it later.</p></div>
        ${GM.saveError ? `<div class="chip bad">${esc(GM.saveError)}</div>` : ""}
        <div class="row"><button class="btn" data-act="copySave">Copy save code</button>${window.top === window ? `<button class="btn" data-act="downloadSave">Download save file</button>` : ""}</div>
        <label class="sub" for="importText">Import: paste a save code here, or choose a file</label>
        <textarea id="importText" placeholder="Paste save code"></textarea>
        <div class="row"><button class="btn" data-act="importText">Load pasted save</button><input type="file" id="importFile" accept=".json,application/json" aria-label="Import save file"></div>
        <div class="row">${ui.confirm === "new" ? `<span>This replaces your current league.</span><button class="btn danger" data-act="newGame">Start over</button><button class="btn" data-act="cancel">Keep going</button>` : `<button class="btn danger" data-act="askNew">New league</button>`}</div>
      </section>
      <section class="panel"><h2>How it works</h2><div class="prose">
        <p><b>Data.</b> Every season from ${D.first} to ${D.last} comes from <a href="https://github.com/sportsdataverse/wehoop-wnba-stats-data" target="_blank" rel="noopener">sportsdataverse/wehoop-wnba-stats-data</a> (CC BY 4.0): teams, conferences, records, player bios and season stats.</p>
        <p><b>Ratings.</b> A player's rating for a season uses her whole career up to that point. Each season is graded against that year's league, then averaged by minutes, with each year back counting ${Math.round(D.decay * 100)}% as much as the one after it.</p>
        <p><b>Real careers.</b> With real career arcs on, each season a player's rating follows how she actually played that year. After ${D.last}, or in seasons she didn't play, the sim develops her normally. Real players enter the draft in their real draft years; generated prospects fill the remaining picks and every class after ${D.last}.</p>
        <p><b>Teams.</b> The sim runs every front office: contenders trade youth for veterans, rebuilders do the reverse, and every team drafts, re-signs and signs free agents under your cap.</p>
        <p><b>Money.</b> The data has no salaries. Caps before 2026 are rough estimates, and salaries scale with the cap you set.</p>
        <p class="muted">Courtside is a fan-made simulator and is not affiliated with or endorsed by the WNBA, its teams or its players.</p>
      </div></section></div>`;
  }

  // ---------- render ----------
  function render() {
    renderTop();
    if (!GM.S) { renderSetup(); $("#modal").innerHTML = ""; return; }
    const views = { office: renderOffice, standings: renderStandings, playoffs: renderPlayoffs, teams: renderTeams, players: renderPlayers, leaders: renderLeaders, draft: renderDraft, moves: renderMoves, history: renderHistory, league: renderLeague, settings: renderSettings };
    (views[ui.tab] || renderOffice)();
    const m = ui.modal;
    $("#modal").innerHTML = !m ? "" : m.type === "player" ? playerModal(m.id) : teamModal(m.id);
  }
  const val = (id) => $("#" + id)?.value;
  const numv = (id) => +val(id);

  function act(a, el) {
    const S = GM.S, id = el.dataset.id;
    switch (a) {
      case "tab": ui.tab = el.dataset.tab; ui.modal = null; ui.confirm = null; window.scrollTo(0, 0); break;
      case "newLeague": GM.newLeague(ui.setup.year, { realCareers: $("#optReal").checked, followHistory: $("#optHist").checked }); ui.tab = "office"; window.scrollTo(0, 0); toast(`Welcome, Commissioner. The ${ui.setup.year} season awaits.`); break;
      case "player": ui.modal = { type: "player", id: +id }; break;
      case "team": ui.modal = { type: "team", id }; ui.confirm = null; break;
      case "closeModal": ui.modal = null; ui.confirm = null; break;
      case "sort": { const k = el.dataset.key, c = el.dataset.col, cur = ui.sort[k]; ui.sort[k] = { col: c, dir: cur && cur.col === c ? -cur.dir : -1, get: getters[c] }; break; }
      case "startSeason": { const r = GM.startSeason(); if (!r.ok) toast(r.msg || "Can't start yet.", true); break; }
      case "sim": GM.simDays(+el.dataset.n); if (GM.S.phase === "playoffs") toast("Regular season complete. The playoffs are set."); break;
      case "po": GM.simPlayoffs(el.dataset.mode); break;
      case "toOffseason": GM.toOffseason(); ui.tab = "office"; break;
      case "advance": { const r = GM.advanceToNextSeason(); if (r.ok) { ui.tab = "office"; toast(`${GM.S.season} preseason. The draft, free agency and player development are done.`); } break; }
      case "event": GM.setEventApproval(id, el.dataset.ok === "1"); break;
      case "saveRules":
        GM.setRules({ playoffTeams: numv("rPlayoffTeams"), seeding: val("rSeeding"), earlyBo: numv("rEarly"), semisBo: numv("rSemis"), finalsBo: numv("rFinals"),
          games: numv("rGames"), cap: numv("rCap") * 1000, capGrowth: numv("rGrowth") / 100, maxPct: numv("rMaxPct") / 100, rosterMin: numv("rRosterMin"), rosterMax: numv("rRosterMax"),
          draftRounds: numv("rRounds"), lotteryTeams: numv("rLotTeams"), lotteryPicks: numv("rLotPicks"), expansionProtect: numv("rProtect"), tradeDeadline: numv("rDeadline") / 100 });
        toast(GM.officeOpen() ? "Rules updated." : "Rules queued for next season."); break;
      case "addConf": { const r = GM.addConference(val("newConf")); toast(r.ok ? "Conference added." : r.msg, !r.ok); break; }
      case "renameConf": { const i = +el.dataset.i; const r = GM.renameConference(S.conferences[i], val("cn-" + i)); toast(r.ok ? "Conference renamed." : r.msg, !r.ok); break; }
      case "removeConf": { const r = GM.removeConference(S.conferences[+el.dataset.i]); toast(r.ok ? "Conference dissolved; its teams moved to the smallest conference." : r.msg, !r.ok); break; }
      case "expand": { const r = GM.expandTeam({ city: val("xCity").trim(), name: val("xName").trim(), abbr: val("xAbbr"), color: val("xColor"), conf: val("xConf") }); toast(r.ok ? "Expansion approved. The expansion draft is done." : r.msg, !r.ok); break; }
      case "relocate": { const r = GM.relocateTeam(id, { city: val("relCity").trim(), name: val("relName").trim(), abbr: val("relAbbr"), color: val("relColor") }); toast(r.ok ? "Franchise updated." : r.msg, !r.ok); break; }
      case "askFold": ui.confirm = "fold" + id; break;
      case "fold": { const r = GM.foldTeam(id); ui.confirm = null; toast(r.ok ? "Franchise folded. The dispersal draft is done." : r.msg, !r.ok); break; }
      case "cancel": ui.confirm = null; break;
      case "leaders": ui.leaders = el.dataset.c; break;
      case "copySave": { const txt = JSON.stringify(S); navigator.clipboard.writeText(txt).then(() => toast("Save code copied."), () => { $("#importText").value = txt; $("#importText").select(); toast("Copy was blocked: the code is selected in the box. Copy it manually.", true); }); return; }
      case "downloadSave": { const a2 = document.createElement("a"); a2.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: "application/json" })); a2.download = `courtside-${S.startYear}-${S.season}.json`; a2.click(); return; }
      case "importText": try { const o = JSON.parse(val("importText")); if (!o.teams || !o.players || !o.rules) throw 0; GM.importState(o); ui.tab = "office"; toast("League loaded."); } catch (e) { toast("That isn't a Courtside save code.", true); return; } break;
      case "askNew": ui.confirm = "new"; break;
      case "newGame": ui.confirm = null; GM.clearSave(); break;
      default: return;
    }
    render();
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const a = el.dataset.act;
    if (a === "closeModal" && el.classList.contains("modal-bg") && e.target !== el) return;
    if (["teamConf", "setupYear"].includes(a)) return;
    act(a, el);
  });
  document.addEventListener("change", (e) => {
    const el = e.target, a = el.dataset && el.dataset.act;
    if (a === "teamConf") { GM.setTeamConf(el.dataset.id, el.value); render(); }
    else if (a === "setupYear" || el.id === "setupRange") { ui.setup.year = +el.value; render(); }
    else if (el.id === "optReal") ui.setup.realCareers = el.checked;
    else if (el.id === "optHist") ui.setup.followHistory = el.checked;
    else if (el.id === "optHistory") { GM.S.opts.followHistory = el.checked; GM.save(); render(); }
    else if (el.id === "optCareers") { GM.S.opts.realCareers = el.checked; GM.save(); }
    else if (el.id === "newsKind") { ui.newsKind = el.value; render(); }
    else if (el.id === "pteam") { ui.players.team = el.value; render(); }
    else if (el.id === "txTeam") { ui.txTeam = el.value; render(); }
    else if (el.id === "importFile" && el.files[0]) { const r = new FileReader(); r.onload = () => { try { const o = JSON.parse(r.result); if (!o.rules) throw 0; GM.importState(o); ui.tab = "office"; toast("League loaded."); render(); } catch (err) { toast("That file isn't a Courtside save.", true); } }; r.readAsText(el.files[0]); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "setupRange") { const s = $("#setupYear"); if (s) s.value = e.target.value; }
    if (e.target.id === "pq") { clearTimeout(ui.qT); const v = e.target.value; ui.qT = setTimeout(() => { ui.players.q = v; render(); const el = $("#pq"); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 200); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.modal) { ui.modal = null; render(); } });

  GM.load();
  render();
})();
