/* Supply Desk: the planner's monthly cycle on one page.
 * All packet data comes from data.js (pipeline/build_data.py). The planner's own
 * change requests and published versions are kept in this browser (localStorage)
 * and can be exported. */
"use strict";
const D = window.DATA;
const START = "2026-09-08", END = D.cutoff;            // the September cycle
const ITEMS = Object.fromEntries(D.items.map(i => [i.sku, i]));
const REGIONS = Object.fromEntries(D.regions.map(r => [r.code, r]));
const CATS = [...new Set(D.items.map(i => i.category))];
const TABS = [["intake", "Intake"], ["plan", "Plan"], ["changes", "Changes"], ["history", "History"], ["ask", "Ask"]];
const SWING = 0.15, SWING_MIN = 10;                    // flag: >15% and >=10 cases
const REQ_GAP = 0.10;                                  // flag: request vs plan >10%

/* ------------------------------------------------------------ storage */
function load(k, d) { try { const v = localStorage.getItem("sd." + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem("sd." + k, JSON.stringify(v)); } catch { } }

const S = {
  tab: load("tab", "plan"), date: load("date", "2026-09-11"), showLater: load("showLater", false),
  region: "all", cat: "all", view: "flagged", sel: null,
  changes: load("changes", []), published: load("published", []),
  diffA: null, diffB: null, form: null, intakeCycle: null, allFlags: false, scenario: false,
};
const TOP_FLAGS = 12;
/* deep links for the demo: ?tab=plan&date=2026-09-17&example=1&sel=R06|S014|2026-10 */
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get("tab")) S.tab = q.get("tab");
  if (q.get("date") && q.get("date") >= START && q.get("date") <= END) S.date = q.get("date");
  if (q.get("sel")) S.sel = q.get("sel");
  if (q.get("later")) S.showLater = q.get("later") === "1";
  if (q.get("example") === "1" && !S.changes.length) setTimeout(() => { S.changes = workedExample(); save("changes", S.changes); render(); });
})();

/* ------------------------------------------------------------ helpers */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = id => document.getElementById(id);
const fmt = v => v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mlabel = m => { const [y, mm] = m.split("-"); return MON[+mm - 1] + (y !== "2026" ? " ’" + y.slice(2) : ""); };
const dlabel = d => { const [, m, dd] = d.split("-"); return MON[+m - 1] + " " + (+dd); };
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const DAYS = (() => { const a = []; for (let d = START; d <= END; d = addDays(d, 1)) a.push(d); return a; })();
const itemName = sku => ITEMS[sku] ? ITEMS[sku].name : sku;
const regName = r => REGIONS[r] ? `${r} ${REGIONS[r].name}` : r;
const uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pct = (a, b) => b ? (a - b) / b : 0;
const sign = v => (v > 0 ? "+" : "") + fmt(v);

/* ------------------------------------------------------------ the record as of a date */
function releasesAt(date) { return D.releases.filter(r => r.logged <= date); }
function postedAt(date) { const p = releasesAt(date).filter(r => r.disposition === "Posted"); return p[p.length - 1]; }
function prevPosted(rel) { const p = D.releases.filter(r => r.disposition === "Posted" && r.logged < rel.logged); return p[p.length - 1]; }
function cycleAt(date) { const r = D.intake_log.filter(e => e.received <= date).map(e => e.cycle); return r.sort().pop(); }
function intakeAt(date, cycle) { return D.submissions.filter(s => s.cycle === cycle && s.received <= date); }
function acceptedAt(date, region, cycle) {
  // the latest file received for the cycle by that date; a file that the log later
  // marks Replaced is still the one in hand until its replacement arrives
  const fs = intakeAt(date, cycle).filter(s => s.region === region).sort((a, b) => a.received.localeCompare(b.received));
  return fs[fs.length - 1];
}
function known(c, date) { return c.known_on <= date; }
function activeChanges(date, opts = {}) {
  const live = S.changes.filter(c => known(c, date));
  const superseded = new Set(live.filter(c => c.supersedes && c.status === "approved" && (c.approved_on || c.known_on) <= date).map(c => c.supersedes));
  return live.filter(c => {
    if (superseded.has(c.id)) return false;
    if (c.status !== "approved" || (c.approved_on || c.known_on) > date) return false;
    if (c.action === "scenario") return !!opts.scenario;
    return c.action === "add" || c.action === "move" || c.action === "scenario";
  });
}
function changeState(c, date) {
  if (!known(c, date)) return "later";
  const live = S.changes.filter(x => known(x, date));
  if (live.some(x => x.supersedes === c.id && x.status === "approved" && (x.approved_on || x.known_on) <= date)) return "superseded";
  if (c.status === "approved" && (c.approved_on || c.known_on) > date) return "proposed";
  if (c.status === "approved" && c.action === "scenario") return "scenario";
  return c.status;
}
/* working plan = latest posted release + approved changes known by that date */
function workingPlan(date, opts = {}) {
  const base = postedAt(date);
  const grid = {}, applied = {};
  for (const [k, row] of Object.entries(base.grid)) grid[k] = { ...row };
  const touch = (r, sku, m, dv, c) => {
    const k = r + "|" + sku; if (!grid[k] || grid[k][m] == null) return;
    grid[k][m] += dv; (applied[k + "|" + m] = applied[k + "|" + m] || []).push({ c, dv });
  };
  for (const c of activeChanges(date, opts)) {
    if (c.action === "add" || c.action === "scenario") touch(c.region, c.sku, c.month, c.qty_cs, c);
    if (c.action === "move") { touch(c.region, c.sku, c.month, -c.qty_cs, c); touch(c.region, c.sku, c.to_month, c.qty_cs, c); }
  }
  return { base, grid, applied, months: base.months };
}
function requestAt(date, key) {           // key R|SKU|month -> manager cell in hand on that date
  const [r] = key.split("|"); const cyc = cycleAt(date); if (!cyc) return null;
  const f = acceptedAt(date, r, cyc); return f ? { file: f, cell: f.cells[key] } : null;
}

/* ------------------------------------------------------------ flags */
function flags(date) {
  const wp = workingPlan(date), out = [];
  const prev = prevPosted(wp.base);
  for (const [k, row] of Object.entries(wp.grid)) {
    const [r, sku] = k.split("|");
    for (const m of wp.months) {
      const key = k + "|" + m, v = row[m];
      if (wp.applied[key]) out.push({ kind: "changed", key, r, sku, m, v, was: wp.base.grid[k][m], why: wp.applied[key].map(a => a.c.ref || a.c.reason).join(", ") });
      if (prev && prev.grid[k] && prev.grid[k][m] != null && !wp.applied[key]) {
        const p = prev.grid[k][m], d = v - p;
        if (Math.abs(d) >= SWING_MIN && Math.abs(pct(v, p)) > SWING) out.push({ kind: "swing", key, r, sku, m, v, was: p, why: `vs ${prev.file.split("/").pop().replace(".xlsx", "")}` });
      }
      const req = requestAt(date, key);
      if (req && req.cell && req.cell.cs != null && req.file.received > wp.base.logged) {
        const gap = pct(v, req.cell.cs);
        if (Math.abs(req.cell.cs - v) >= SWING_MIN && Math.abs(gap) > REQ_GAP) out.push({ kind: "request", key, r, sku, m, v, was: req.cell.cs, why: `${REGIONS[r].manager}'s ${dlabel(req.file.received)} sheet asks ${fmt(req.cell.cs)}` });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ shell */
function render() {
  save("tab", S.tab); save("date", S.date); save("showLater", S.showLater);
  $("tabs").innerHTML = TABS.map(([id, n]) => `<button class="tab ${S.tab === id ? "on" : ""}" data-tab="${id}">${n}</button>`).join("");
  $("meta").innerHTML = `<span>Packet cutoff ${dlabel(END)} 2026</span><span>${D.regions.length} regions · ${D.items.length} SKUs</span>`;
  renderTimeband();
  ({ intake: pageIntake, plan: pagePlan, changes: pageChanges, history: pageHistory, ask: pageAsk })[S.tab]();
  renderBottom();
}
function renderTimeband() {
  const i = DAYS.indexOf(S.date), pos = d => (DAYS.indexOf(d) / (DAYS.length - 1) * 100) + "%";
  const marks = [];
  for (const e of D.emails) if (e.date >= START && e.date <= END) marks.push(`<span class="mark email" style="left:${pos(e.date)}" title="${esc(dlabel(e.date) + " email: " + e.subject)}"></span>`);
  for (const r of D.releases) if (r.logged >= START) marks.push(`<span class="mark release" style="left:${pos(r.logged)};top:0" title="${esc(dlabel(r.logged) + " plan " + r.disposition + ": " + r.file)}"></span>`);
  for (const e of D.intake_log) if (e.received >= START && e.received <= END) marks.push(`<span class="mark" style="left:${pos(e.received)}" title="${esc(dlabel(e.received) + " sheet from " + e.hub)}"></span>`);
  const wp = postedAt(S.date);
  $("timeband").innerHTML = `
    <div class="now">${new Date(S.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
      <small>Plan in force: ${esc(wp.file.split("/").pop().replace(".xlsx", ""))}</small></div>
    <div class="track">
      <div class="marks">${marks.join("")}</div>
      <input type="range" id="slider" min="0" max="${DAYS.length - 1}" value="${i}" aria-label="Date">
      <div class="ticks">${DAYS.map(d => `<span class="tick" style="left:${pos(d)}"><i></i>${dlabel(d)}</span>`).join("")}</div>
    </div>
    <label class="toggle" title="Also show what arrives after this date, dimmed"><input type="checkbox" id="later" ${S.showLater ? "checked" : ""}> Show what came later</label>`;
  $("slider").oninput = e => { S.date = DAYS[+e.target.value]; render(); };
  $("later").onchange = e => { S.showLater = e.target.checked; render(); };
}
function renderBottom() {
  const wp = workingPlan(S.date);
  const nApplied = activeChanges(S.date).length;
  const open = S.changes.filter(c => known(c, S.date) && ["proposed", "open"].includes(changeState(c, S.date))).length;
  $("bottombar").innerHTML = `
    <button class="btn primary" id="publish">Publish version</button>
    <button class="btn" id="export">Export buy review</button>
    <div class="status">Baseline ${esc(wp.base.file.split("/").pop().replace(".xlsx", ""))} (posted ${dlabel(wp.base.logged)}) · ${nApplied} approved change${nApplied === 1 ? "" : "s"} · ${open} open item${open === 1 ? "" : "s"} · as of ${dlabel(S.date)}</div>`;
  $("publish").onclick = publish;
  $("export").onclick = exportBuyReview;
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tab]"); if (t) { S.tab = t.dataset.tab; render(); }
});

/* ------------------------------------------------------------ Intake */
function pageIntake() {
  const cycles = [...new Set(D.intake_log.map(e => e.cycle))].sort();
  const cyc = S.intakeCycle || cycleAt(S.date) || cycles[cycles.length - 1];
  const files = D.submissions.filter(s => s.cycle === cyc);
  const cards = D.regions.map(reg => {
    const fs = files.filter(f => f.region === reg.code).sort((a, b) => a.received.localeCompare(b.received));
    const inHand = fs.filter(f => f.received <= S.date);
    if (!inHand.length) return `<div class="card wait"><div class="title">${esc(regName(reg.code))}</div>${esc(reg.hub)} · ${esc(reg.manager)}<div class="big">Waiting for sheet</div>${fs.length && S.showLater ? `<div class="hint">Arrives ${dlabel(fs[0].received)}</div>` : ""}</div>`;
    const cur = inHand[inHand.length - 1], replaced = inHand.slice(0, -1);
    const prob = cur.problems.length;
    return `<div class="card ${prob ? "warn" : "ok"}">
      <div class="title">${esc(regName(reg.code))}</div>
      <div class="hint">${esc(reg.hub)} · ${esc(cur.author || reg.manager)} · layout “${esc(cur.layout)}”</div>
      <div class="big">${esc(cur.file.split("/").pop())}</div>
      <div>Received ${dlabel(cur.received)} ${replaced.length ? `<span class="pill Accepted">replaces ${replaced.length} earlier file</span>` : ""}</div>
      <div class="hint" style="margin-top:4px">${cur.counts.cells} cells read · ${cur.counts.ea} converted from EA · ${cur.counts.carried} blanks carried forward · ${cur.counts.cancelled} zero (cancelled)</div>
      ${cur.note ? `<div style="margin-top:4px">Desk note: ${esc(cur.note)}</div>` : ""}
      ${prob ? `<div style="color:var(--err);margin-top:4px">${prob} problem(s): ${esc(cur.problems[0])}</div>` : `<div class="hint" style="color:var(--ok)">No problems found</div>`}
    </div>`;
  }).join("");
  // corrections: replaced vs replacement, cell by cell
  const rows = [];
  for (const f of files.filter(f => f.disposition === "Replaced" && f.received <= S.date)) {
    const rep = files.find(x => x.file === f.replaced_by);
    if (!rep || rep.received > S.date) { rows.push(`<tr><td>${esc(regName(f.region))}</td><td colspan="4">${esc(f.file.split("/").pop())} is in hand; the correction arrives ${rep ? dlabel(rep.received) : "later"}</td></tr>`); continue; }
    for (const [k, c] of Object.entries(rep.cells)) {
      const o = f.cells[k]; if (o && o.cs === c.cs) continue;
      const [, sku, m] = k.split("|");
      rows.push(`<tr><td>${esc(regName(f.region))}</td><td>${esc(itemName(sku))} · ${mlabel(m)}</td><td class="n">${fmt(o && o.cs)}</td><td class="n">${fmt(c.cs)}</td><td>${esc(rep.note || "")}</td></tr>`);
    }
  }
  const eaRows = [];
  for (const f of files.filter(f => f.received <= S.date && f.disposition === "Accepted")) {
    const byLocal = {};
    for (const c of Object.values(f.cells)) if (c.unit === "EA" && c.orig != null) byLocal[c.local] = c;
    for (const c of Object.values(byLocal)) eaRows.push(`<tr><td>${esc(regName(f.region))}</td><td>${esc(c.local)}</td><td>${esc(itemName(c.sku))}</td><td>${esc(c.rule.join("; "))} = ${fmt(c.cs)} CS <span class="hint">(${mlabel(c.month)})</span></td></tr>`);
  }
  $("page").innerHTML = `
    <h1>Intake</h1>
    <div class="hint">Each region's six-month request, read from its own layout and converted to planning cases. Only the latest file for a cycle counts; replaced files stay for comparison.</div>
    <div class="subtabs">${cycles.map(c => `<button class="subtab ${c === cyc ? "on" : ""}" data-cyc="${c}">${mlabel(c)} cycle</button>`).join("")}</div>
    <div class="cards">${cards}</div>
    <h2>Corrections between files</h2>
    ${rows.length ? `<table class="plain"><tr><th>Region</th><th>Line</th><th>First file (CS)</th><th>Correction (CS)</th><th>Desk note</th></tr>${rows.join("")}</table>` : `<div class="empty">No corrected files in hand for this cycle by ${dlabel(S.date)}.</div>`}
    <h2>Unit conversions in this cycle (one example per item)</h2>
    ${eaRows.length ? `<table class="plain"><tr><th>Region</th><th>Local code</th><th>Item</th><th>Rule</th></tr>${eaRows.slice(0, 40).join("")}</table>` : `<div class="empty">No sheets in hand yet.</div>`}`;
  document.querySelectorAll("[data-cyc]").forEach(b => b.onclick = () => { S.intakeCycle = b.dataset.cyc; render(); });
}

/* ------------------------------------------------------------ Plan */
function pagePlan() {
  const wp = workingPlan(S.date, { scenario: S.scenario });
  const fl = flags(S.date).sort((a, b) => (a.kind === "changed" ? 0 : 1) - (b.kind === "changed" ? 0 : 1) || Math.abs(b.v - b.was) - Math.abs(a.v - a.was));
  const later = S.showLater ? workingPlan(END, { scenario: S.scenario }) : null;
  const flagKeys = new Set(fl.filter(f => f.kind !== "changed").map(f => f.key));
  const kinds = { changed: "Changed since posting", request: "New request differs from plan", swing: "Big swing since last plan" };
  const card = f => `<div class="card click ${f.kind === "changed" ? "info" : "warn"}" data-key="${f.key}">
      <div class="overline">${kinds[f.kind]}</div>
      <div class="title">${esc(regName(f.r))} · ${esc(itemName(f.sku))}</div>
      <div class="big">${f.kind === "request"
        ? `${mlabel(f.m)}: plan ${fmt(f.v)}, asked ${fmt(f.was)} <span class="hint">(${sign(f.was - f.v)} CS)</span>`
        : `${mlabel(f.m)}: ${fmt(f.was)} → ${fmt(f.v)} <span class="hint">(${sign(f.v - f.was)} CS)</span>`}</div>
      <div class="hint">${esc(f.why)}</div></div>`;
  const pending = S.changes.filter(c => ["proposed", "open"].includes(changeState(c, S.date)));
  const pendCards = pending.map(c => `<div class="card warn click" data-goto="changes"><div class="overline">${c.status === "open" ? "Open question" : "Waiting for approval"}</div><div class="title">${esc(c.ref || "Change")} · ${esc(c.region ? regName(c.region) : "")}</div><div>${esc(c.reason || "")}</div></div>`).join("");
  const shown = S.view === "flagged" ? (S.allFlags ? fl : fl.slice(0, TOP_FLAGS)) : [];
  const more = S.view === "flagged" && fl.length > TOP_FLAGS
    ? `<div class="hint" style="margin:-8px 0 12px">${S.allFlags ? `Showing all ${fl.length}.` : `Showing the ${TOP_FLAGS} largest of ${fl.length}, by cases.`} <button class="btn small" id="allFlags">${S.allFlags ? "Show the largest only" : "Show all"}</button> Every flagged cell is outlined in the grid.</div>` : "";
  const regions = S.region === "all" ? D.regions.map(r => r.code) : [S.region];
  const skus = D.items.filter(i => S.cat === "all" || i.category === S.cat).map(i => i.sku);
  let body = "";
  for (const r of regions) {
    body += `<tr class="group"><td colspan="${wp.months.length + 1}">${esc(regName(r))} <span class="hint">· ${esc(REGIONS[r].hub)} · ${esc(REGIONS[r].manager)} · ${esc(REGIONS[r].cadence)}</span></td></tr>`;
    for (const sku of skus) {
      const k = r + "|" + sku, row = wp.grid[k]; if (!row) continue;
      body += `<tr><td class="l">${esc(itemName(sku))} <span class="sku">${sku}</span></td>` + wp.months.map(m => {
        const key = k + "|" + m, cls = ["cell"];
        if (wp.applied[key]) cls.push("changed");
        if (flagKeys.has(key)) cls.push("flag");
        if (later && later.grid[k] && later.grid[k][m] !== row[m]) cls.push("laterchg");
        if (S.sel === key) cls.push("sel");
        const tip = later && later.grid[k] && later.grid[k][m] !== row[m] ? ` title="Changes later: ${fmt(row[m])} → ${fmt(later.grid[k][m])}"` : "";
        return `<td class="${cls.join(" ")}" data-key="${key}"${tip}>${fmt(row[m])}</td>`;
      }).join("") + "</tr>";
    }
  }
  $("page").innerHTML = `
    <h1>Plan</h1>
    <div class="hint">Cases per month. Starts from the plan posted ${dlabel(wp.base.logged)}, plus the changes approved by ${dlabel(S.date)}. Click any number to see where it came from.</div>
    <div class="subtabs">
      <button class="subtab ${S.view === "flagged" ? "on" : ""}" data-view="flagged">Needs attention (${fl.length + pending.length})</button>
      <button class="subtab ${S.view === "all" ? "on" : ""}" data-view="all">All lines</button>
      <span class="sep"></span>
      <select id="fRegion"><option value="all">All regions</option>${D.regions.map(r => `<option value="${r.code}" ${S.region === r.code ? "selected" : ""}>${esc(regName(r.code))}</option>`).join("")}</select>
      <select id="fCat"><option value="all">All categories</option>${CATS.map(c => `<option ${S.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <span class="sep"></span>
      <label class="toggle"><input type="checkbox" id="scen" ${S.scenario ? "checked" : ""}> Include scenarios</label>
    </div>
    ${S.view === "flagged" ? (shown.length || pending.length ? `<div class="cards">${pendCards}${shown.map(card).join("")}</div>${more}` : `<div class="empty">Nothing needs attention on ${dlabel(S.date)}. Requests match the plan within ${REQ_GAP * 100}%, and no line moved more than ${SWING * 100}% since the last posting.</div>`) : ""}
    <div class="layout ${S.sel ? "" : "nodetail"}">
      <div><table class="grid"><tr><th class="l">Item</th>${wp.months.map(m => `<th>${mlabel(m)}</th>`).join("")}</tr>${body}</table></div>
      ${S.sel ? `<div class="detail" id="detail">${detailHtml(S.sel, wp)}</div>` : ""}
    </div>`;
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); });
  document.querySelectorAll("[data-key]").forEach(el => el.onclick = () => { S.sel = el.dataset.key; render(); });
  document.querySelectorAll("[data-goto]").forEach(el => el.onclick = () => { S.tab = el.dataset.goto; render(); });
  $("fRegion").onchange = e => { S.region = e.target.value; render(); };
  $("fCat").onchange = e => { S.cat = e.target.value; render(); };
  $("scen").onchange = e => { S.scenario = e.target.checked; render(); };
  const af = $("allFlags"); if (af) af.onclick = () => { S.allFlags = !S.allFlags; render(); };
  const x = $("closeDetail"); if (x) x.onclick = () => { S.sel = null; render(); };
  const lg = $("logHere"); if (lg) lg.onclick = () => { const [r, sku, m] = S.sel.split("|"); S.form = { region: r, sku, month: m, known_on: S.date }; S.tab = "changes"; render(); };
}
function detailHtml(key, wp) {
  const [r, sku, m] = key.split("|"), k = r + "|" + sku;
  const v = wp.grid[k] && wp.grid[k][m], base = wp.base.grid[k] && wp.base.grid[k][m];
  const req = requestAt(S.date, key);
  const hist = releasesAt(S.date).filter(rel => rel.grid[k] && rel.grid[k][m] != null);
  const applied = wp.applied[key] || [];
  const item = ITEMS[sku];
  let reqHtml = `<div class="hint">No sheet for this cycle in hand yet.</div>`;
  if (req && req.cell) {
    const c = req.cell;
    reqHtml = `<div class="kv"><div>Asked</div><div><b>${fmt(c.cs)} CS</b> ${c.orig != null ? `(sheet says ${fmt(c.orig)} ${esc(c.unit)})` : ""}</div>
      ${c.rule.length ? `<div>Rule</div><div>${esc(c.rule.join("; "))}</div>` : ""}
      <div>Planner adjustment</div><div>${base != null && c.cs != null ? sign(base - c.cs) + " CS vs posted" : "—"}</div>
      ${c.note ? `<div>Note</div><div>${esc(c.note)}</div>` : ""}</div>
      <div class="src">${esc(req.file.file)} row ${c.row} · ${esc(c.local)}</div>`;
  }
  const sales = D.sales_use[k];
  let salesHtml = "";
  if (sales) {
    const ms = Object.keys(sales).sort().slice(-14), mx = Math.max(...ms.map(x => sales[x]));
    const drink = D.sales_drinks.find(d => d.sku === sku);
    salesHtml = `<h3 style="margin-top:12px">Sales-implied use</h3>
      <div class="hint">${esc(drink ? drink.name : "")} only, sold + complimentary servings × portion standard. A partial measure: other drinks also use ${esc(item.name.toLowerCase())}.</div>
      <div class="bars">${ms.map(x => `<div title="${mlabel(x)} ${x.slice(0, 4)}: ${fmt(sales[x])} CS" style="height:${sales[x] / mx * 100}%" class="${x.slice(5) === m.slice(5) ? "hl" : ""}"></div>`).join("")}</div>
      <div class="hint">${mlabel(ms[0])} ${ms[0].slice(0, 4)} → ${mlabel(ms[ms.length - 1])} ${ms[ms.length - 1].slice(0, 4)}. Same calendar month highlighted. Last month is partial (to Sep 18).</div>`;
  }
  return `<div style="display:flex;justify-content:space-between"><div class="overline">${esc(regName(r))}</div><button class="btn small" id="closeDetail">Close</button></div>
    <h3>${esc(item.name)} · ${mlabel(m)} ${m.slice(0, 4)}</h3>
    <div class="kv"><div>Working plan</div><div><b>${fmt(v)} CS</b></div>
      <div>Posted ${dlabel(wp.base.logged)}</div><div>${fmt(base)} CS</div>
      <div>Case</div><div>${esc(item.case_pack)} · lead time ${item.lead_days} days</div></div>
    ${applied.length ? `<h3 style="margin-top:12px">Changes applied</h3>${applied.map(a => `<div>${sign(a.dv)} CS · <b>${esc(a.c.ref || "")}</b> ${esc(a.c.reason || "")}</div><div class="src">${esc(a.c.source || "")}</div>`).join("")}` : ""}
    <h3 style="margin-top:12px">Manager's request</h3>${reqHtml}
    <h3 style="margin-top:12px">This line in every plan file</h3>
    <table class="plain" style="width:100%">${hist.map(rel => `<tr><td>${dlabel(rel.logged)}</td><td>${esc(rel.file.split("/").pop().replace(".xlsx", ""))}</td><td><span class="pill ${rel.disposition}">${rel.disposition}</span></td><td class="n">${fmt(rel.grid[k][m])}</td></tr>`).join("")}</table>
    ${salesHtml}
    <div style="margin-top:12px"><button class="btn" id="logHere">Log a change to this line</button></div>`;
}

/* ------------------------------------------------------------ Changes */
const ACTIONS = { add: "Add to month", move: "Move to another month", hold: "Open question (no numbers)", note: "Note: already in plan", scenario: "Scenario (never merges)" };
function inboxItems() {
  const items = [];
  for (const e of D.emails) items.push({ date: e.date, kind: "Email", title: e.subject, who: e.sender.replace(/<.*>/, "").trim(), body: e.body, src: e.file, time: e.time });
  for (const e of D.events) items.push({ date: e.known_on, kind: "Calendar", title: `${e.id} · ${e.type} · ${e.status}`, who: regName(e.region), body: `Event date ${e.event_date}. ${e.detail}`, src: "Planning/Control/Planning reference.xlsx › Event calendar › " + e.id, ref: e.id, region: e.region });
  for (const r of D.release_log) items.push({ date: r.logged, kind: "Plan file", title: `${r.disposition}: ${r.file.split("/").pop()}`, who: r.circulation, body: r.note, src: "Planning/Control/Planning desk registers.xlsx › Release log" });
  return items.filter(i => i.date >= "2026-08-17").sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
}
function pageChanges() {
  const inbox = inboxItems().filter(i => S.showLater || i.date <= S.date);
  const ch = S.changes.slice().sort((a, b) => a.known_on.localeCompare(b.known_on));
  const visible = ch.filter(c => S.showLater || known(c, S.date));
  $("page").innerHTML = `
    <h1>Changes</h1>
    <div class="hint">Late news arrives on the left. Log each piece as a change on the right: add, move, open question, note or scenario. Approved changes update the working plan from their date; nothing is overwritten.</div>
    <div class="subtabs"><button class="btn" id="newChange">New change</button>
      <button class="btn" id="seed">Load September worked example</button>
      <button class="btn" id="exportJson">Export changes (JSON)</button>
      <label class="btn">Import JSON<input type="file" id="importJson" accept=".json" hidden></label>
      <button class="btn" id="clear">Clear all</button></div>
    <div class="cols">
      <div><h2>Inbox to ${dlabel(S.date)}</h2><div class="list">${inbox.map((i, n) => `<div class="item ${i.date > S.date ? "later" : ""}">
        <div class="head"><span class="pill">${i.kind}</span><b>${esc(i.title)}</b><span class="hint">${dlabel(i.date)} ${i.time || ""}</span></div>
        <div class="hint">${esc(i.who)}</div><pre>${esc(i.body)}</pre>
        <div class="acts"><button class="btn small" data-log="${n}">Log as change</button><span class="src hint">${esc(i.src)}</span></div></div>`).join("")}</div></div>
      <div><h2>Change register</h2>${S.form ? formHtml() : ""}
        <div class="list">${visible.length ? visible.map(changeHtml).join("") : `<div class="empty">No changes logged yet. Log one from the inbox, or load the September worked example.</div>`}</div></div>
    </div>`;
  $("newChange").onclick = () => { S.form = { known_on: S.date }; render(); };
  $("seed").onclick = () => { if (!S.changes.length || confirm("Replace the current change register with the worked example?")) { S.changes = workedExample(); save("changes", S.changes); render(); } };
  $("clear").onclick = () => { if (confirm("Delete every logged change in this browser?")) { S.changes = []; save("changes", S.changes); render(); } };
  $("exportJson").onclick = () => download("supply-desk-changes.json", JSON.stringify(S.changes, null, 2), "application/json");
  $("importJson").onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const v = JSON.parse(t); if (!Array.isArray(v)) throw 0; S.changes = v; save("changes", v); render(); } catch { alert("That file is not a change register export."); } }); };
  document.querySelectorAll("[data-log]").forEach(b => b.onclick = () => { const i = inbox[+b.dataset.log]; S.form = { known_on: i.date <= S.date ? S.date : i.date, source: i.src, ref: i.ref || "", region: i.region || "", reason: "" }; render(); });
  document.querySelectorAll("[data-act]").forEach(b => b.onclick = () => changeAction(b.dataset.id, b.dataset.act));
  if (S.form) bindForm();
}
function changeHtml(c) {
  const st = changeState(c, S.date);
  const qty = c.action === "hold" || c.action === "note" ? "" : `${c.action === "move" ? "" : (c.qty_cs > 0 ? "+" : "")}${fmt(c.qty_cs)} CS${c.unit === "EA" ? ` (${fmt(c.qty)} EA)` : ""}`;
  const where = c.sku ? `${esc(itemName(c.sku))} · ${c.month ? mlabel(c.month) : ""}${c.action === "move" ? " → " + mlabel(c.to_month) : ""}` : "";
  const sup = c.supersedes && S.changes.find(x => x.id === c.supersedes);
  return `<div class="item ${st === "later" ? "later" : ""}">
    <div class="head"><span class="pill ${st === "scenario" ? "Scenario" : st}">${st}</span><b>${esc(c.ref || "Change")} · ${esc(c.region ? regName(c.region) : "network")}</b><span class="hint">known ${dlabel(c.known_on)}</span></div>
    <div>${esc(ACTIONS[c.action])}${where ? " · " + where : ""} ${qty ? "· <b>" + qty + "</b>" : ""}</div>
    ${sup ? `<div class="hint">Replaces the ${dlabel(sup.known_on)} entry (${sup.qty_cs != null ? fmt(sup.qty_cs) + " CS" : ""})</div>` : ""}
    <div>${esc(c.reason || "")}</div><div class="src hint">${esc(c.source || "")}</div>
    ${st !== "later" && st !== "superseded" ? `<div class="acts">
      ${c.status !== "approved" && c.action !== "hold" && c.action !== "note" ? `<button class="btn small" data-act="approve" data-id="${c.id}">Approve</button>` : ""}
      ${c.status !== "open" ? `<button class="btn small" data-act="open" data-id="${c.id}">Mark open question</button>` : ""}
      ${c.status !== "rejected" ? `<button class="btn small" data-act="reject" data-id="${c.id}">Reject</button>` : ""}
      <button class="btn small" data-act="replace" data-id="${c.id}">Replace with new figure</button>
      <button class="btn small" data-act="delete" data-id="${c.id}">Delete</button></div>` : ""}</div>`;
}
function changeAction(id, act) {
  const c = S.changes.find(x => x.id === id); if (!c) return;
  if (act === "approve") { c.status = "approved"; c.approved_on = S.date; }
  if (act === "open") c.status = "open";
  if (act === "reject") c.status = "rejected";
  if (act === "delete") { if (!confirm("Delete this change? The register is meant to keep history; reject it instead to keep the record.")) return; S.changes = S.changes.filter(x => x.id !== id); }
  if (act === "replace") { S.form = { ...c, id: undefined, supersedes: c.id, known_on: S.date, status: "proposed", approved_on: undefined, reason: "", source: "", qty: null }; }
  save("changes", S.changes); render();
}
function formHtml() {
  const f = S.form;
  const opt = (arr, v) => arr.map(([k, n]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(n)}</option>`).join("");
  const months = workingPlan(S.date).months.map(m => [m, MON[+m.slice(5) - 1] + " " + m.slice(0, 4)]);
  return `<form class="change" id="cform">
    <label>Reference</label><input type="text" name="ref" value="${esc(f.ref || "")}" placeholder="e.g. GC-PROMO-01">
    <label>Known on</label><input type="date" name="known_on" value="${esc(f.known_on)}">
    <label>Action</label><select name="action">${opt(Object.entries(ACTIONS), f.action || "add")}</select>
    <label>Status</label><select name="status">${opt([["proposed", "Proposed"], ["approved", "Approved"], ["open", "Open question"]], f.status || "proposed")}</select>
    <label>Region</label><select name="region"><option value="">—</option>${opt(D.regions.map(r => [r.code, regName(r.code)]), f.region)}</select>
    <label>Item</label><select name="sku"><option value="">—</option>${opt(D.items.map(i => [i.sku, i.sku + " " + i.name]), f.sku)}</select>
    <label>Month</label><select name="month"><option value="">—</option>${opt(months, f.month)}</select>
    <label>Move to</label><select name="to_month"><option value="">—</option>${opt(months, f.to_month)}</select>
    <label>Quantity</label><input type="number" name="qty" step="any" value="${f.qty ?? ""}">
    <label>Unit</label><select name="unit">${opt([["CS", "Cases (CS)"], ["EA", "Each (bottle, bag, carton, sleeve)"]], f.unit || "CS")}</select>
    <label>In cases</label><div class="wide" id="cs">—</div>
    <label>Reason</label><input class="wide" type="text" name="reason" value="${esc(f.reason || "")}" placeholder="Why this changes the plan, in words purchasing and finance can read">
    <label>Source</label><input class="wide" type="text" name="source" value="${esc(f.source || "")}" placeholder="Email or file this came from">
    <div class="full">${f.supersedes ? `<span class="hint">Replaces an earlier entry; the earlier figure stops counting once this one is approved.</span>` : ""}<button type="button" class="btn" id="cancelForm">Cancel</button><button class="btn primary">Save change</button></div>
  </form>`;
}
function bindForm() {
  const form = $("cform");
  const calc = () => {
    const fd = Object.fromEntries(new FormData(form)); const q = parseFloat(fd.qty);
    const ea = ITEMS[fd.sku] ? ITEMS[fd.sku].ea_per_case : null;
    $("cs").textContent = isNaN(q) ? "—" : fd.unit === "EA" ? (ea ? `${fmt(q / ea)} CS (${fmt(q)} ÷ ${ea} per case)` : "pick an item to convert") : `${fmt(q)} CS`;
  };
  form.oninput = calc; calc();
  form.scrollIntoView({ block: "nearest" });
  $("cancelForm").onclick = () => { S.form = null; render(); };
  form.onsubmit = e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form)); const q = parseFloat(fd.qty);
    const needQty = ["add", "move", "scenario"].includes(fd.action);
    if (needQty && (!fd.region || !fd.sku || !fd.month || isNaN(q))) return alert("Add, move and scenario need a region, item, month and quantity.");
    if (fd.action === "move" && !fd.to_month) return alert("Pick the month to move to.");
    const ea = ITEMS[fd.sku] ? ITEMS[fd.sku].ea_per_case : 1;
    const c = { id: uid(), ...fd, qty: isNaN(q) ? null : q, qty_cs: isNaN(q) ? null : (fd.unit === "EA" ? q / ea : q), supersedes: S.form.supersedes || null };
    if (c.status === "approved") c.approved_on = c.known_on > S.date ? c.known_on : S.date;
    S.changes.push(c); save("changes", S.changes); S.form = null; render();
  };
}
function workedExample() {
  const E = "Correspondence/Planning_inbox/";
  const c = (o) => ({ id: uid(), unit: "CS", status: "approved", ...o, qty_cs: o.unit === "EA" ? o.qty / ITEMS[o.sku].ea_per_case : o.qty });
  const promoA = c({ ref: "GC-PROMO-01", known_on: "2026-09-14", region: "R06", sku: "S014", month: "2026-10", action: "add", qty: 720, unit: "EA", status: "proposed", reason: "Gulf Coast October mango feature, first estimate. Harbor's sheet has regular service only, so this is extra.", source: E + "0914_0907_october_mango_request.eml" });
  return [
    c({ ref: "HD-PULL-01", known_on: "2026-09-08", region: "R02", sku: "S005", month: "2026-09", action: "note", qty: 96, status: "reflected", reason: "96 CS vanilla shipped early on Aug 27 (TR-HD-0827-P). Juniper's corrected sheet and the Sep 11 plan already net it (188 → 92). Do not deduct again.", source: E + "0827_1610_re_room_on_high_desert_load.eml; Intake log 2026-09 R02" }),
    c({ ref: "CA-TEST-03", known_on: "2026-09-08", region: "R01", action: "hold", qty: null, status: "open", reason: "Winter menu trial awaiting sign-off. No site list or quantities. Keep existing holiday assumptions.", source: E + "0918_1150_re_winter_menu_test.eml; Event calendar CA-TEST-03" }),
    c({ ref: "FIN-CUP-BUFFER", known_on: "2026-09-15", region: "R05", sku: "S022", month: "2026-11", action: "scenario", qty: 30, reason: "Finance's November cup buffer sensitivity. Scenario only, never published.", source: "Central releases/September/September network plan Finance copy.xlsx" }),
    promoA,
    c({ ref: "OP-FR-02", known_on: "2026-09-16", region: "R04", sku: "S001", month: "2026-10", to_month: "2026-11", action: "move", qty: 24, reason: "Second opening moved to Nov 9; opening kit ships Nov 2 instead of Oct 5. Same quantities.", source: E + "0916_1042_second_opening_new_dock_week.eml" }),
    c({ ref: "OP-FR-02", known_on: "2026-09-16", region: "R04", sku: "S005", month: "2026-10", to_month: "2026-11", action: "move", qty: 18, reason: "Opening kit vanilla, moved with the opening.", source: E + "0916_1042_second_opening_new_dock_week.eml" }),
    c({ ref: "OP-FR-02", known_on: "2026-09-16", region: "R04", sku: "S014", month: "2026-10", to_month: "2026-11", action: "move", qty: 12, reason: "Opening kit mango, moved with the opening.", source: E + "0916_1042_second_opening_new_dock_week.eml" }),
    c({ ref: "GC-PROMO-01", known_on: "2026-09-17", region: "R06", sku: "S014", month: "2026-10", action: "add", qty: 480, unit: "EA", supersedes: promoA.id, reason: "Final shop list: 480 bottles total for the feature. Two shops dropped out. Replaces the 720-bottle estimate.", source: E + "0917_1526_re_october_mango_request.eml" }),
  ];
}

/* ------------------------------------------------------------ History */
function versions() {
  const v = D.releases.map(r => ({ id: r.id, date: r.logged, name: r.file.split("/").pop().replace(".xlsx", ""), status: r.disposition, note: r.note, grid: r.grid, months: r.months }));
  for (const p of S.published) v.push({ id: p.id, date: p.date, name: p.name, status: "Published here", note: p.note, grid: p.grid, months: p.months });
  return v.sort((a, b) => a.date.localeCompare(b.date));
}
function pageHistory() {
  const vs = versions().filter(v => S.showLater || v.date <= S.date);
  const byId = Object.fromEntries(vs.map(v => [v.id, v]));
  if (!byId[S.diffA] || !byId[S.diffB]) {
    const sepW = vs.find(v => v.name === "September network plan FINAL"), sepP = vs.find(v => v.name === "Network supply plan - Sep post");
    [S.diffA, S.diffB] = sepW && sepP ? [sepW.id, sepP.id] : [vs[Math.max(0, vs.length - 2)].id, vs[vs.length - 1].id];
  }
  const A = byId[S.diffA], B = byId[S.diffB];
  const rows = [];
  for (const k of Object.keys(B.grid)) for (const m of B.months) {
    const a = A.grid[k] && A.grid[k][m], b = B.grid[k][m];
    if (a != null && b != null && a !== b) { const [r, sku] = k.split("|"); rows.push(`<tr><td>${esc(regName(r))}</td><td>${esc(itemName(sku))}</td><td>${mlabel(m)}</td><td class="n">${fmt(a)}</td><td class="n">${fmt(b)}</td><td class="n ${b > a ? "up" : "down"}">${sign(b - a)}</td></tr>`); }
  }
  const opt = sel => vs.map(v => `<option value="${v.id}" ${v.id === sel ? "selected" : ""}>${dlabel(v.date)} · ${esc(v.name)} (${v.status})</option>`).join("");
  $("page").innerHTML = `
    <h1>History</h1>
    <div class="hint">Every plan file the desk saved, and every version published here. Compare any two to see exactly which lines moved.</div>
    <h2>Versions</h2>
    <table class="plain"><tr><th>Date</th><th>File</th><th>Status</th><th>Desk record</th></tr>
      ${vs.map(v => `<tr style="${v.date > S.date ? "opacity:.45" : ""}"><td>${dlabel(v.date)}</td><td>${esc(v.name)}</td><td><span class="pill ${v.status.split(" ")[0]}">${esc(v.status)}</span></td><td>${esc(v.note || "")}</td></tr>`).join("")}</table>
    <h2>Compare</h2>
    <div class="subtabs"><select id="dA">${opt(S.diffA)}</select><span>→</span><select id="dB">${opt(S.diffB)}</select></div>
    ${rows.length ? `<table class="plain"><tr><th>Region</th><th>Item</th><th>Month</th><th>${esc(A.name)}</th><th>${esc(B.name)}</th><th>Change</th></tr>${rows.join("")}</table>` : `<div class="empty">No line differs between these two versions.</div>`}
    <div class="hint" style="margin-top:6px">${rows.length} line${rows.length === 1 ? "" : "s"} differ. Desk record for the later file: ${esc(B.note || "—")}</div>`;
  $("dA").onchange = e => { S.diffA = e.target.value; render(); };
  $("dB").onchange = e => { S.diffB = e.target.value; render(); };
}

/* ------------------------------------------------------------ Ask */
function pageAsk() {
  $("page").innerHTML = `<h1>Ask</h1>
    <div class="hint">The assistant answers from this plan's records only, and names the change, file or email behind each answer.</div>
    <div class="empty" style="margin-top:12px">Not connected in the local build. It goes live with the Cloudflare deploy, where the API key stays on the server.<br><br>
    Questions it will answer: “What changed since the Sep 11 plan, and why?” · “Why is Gulf Coast mango 259 in October?” · “Which lines are still open questions for Monday's buy review?”</div>`;
}

/* ------------------------------------------------------------ outputs */
function download(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function publish() {
  const wp = workingPlan(S.date); const n = S.published.length + 2;
  const note = prompt(`Publish the working plan as of ${dlabel(S.date)} as version ${n}? Add a note for purchasing and finance:`, `Sep 11 plan plus ${activeChanges(S.date).length} approved changes`);
  if (note == null) return;
  S.published.push({ id: "pub" + Date.now(), date: S.date, name: `Version ${n} (${dlabel(S.date)})`, note, grid: wp.grid, months: wp.months });
  save("published", S.published); S.tab = "history"; S.diffA = wp.base.id; S.diffB = S.published[S.published.length - 1].id; render();
}
function exportBuyReview() { download(`buy-review-${S.date}.csv`, buyReviewLines(S.date).join("\r\n"), "text/csv"); }
function buyReviewLines(date) {
  const wp = workingPlan(date), q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Region", "SKU", "Item", "Month", "Released qty (CS)", "Proposed qty (CS)", "Difference", "Reason", "Source", "Open question"].join(",")];
  for (const [key, list] of Object.entries(wp.applied)) {
    const [r, sku, m] = key.split("|"), k = r + "|" + sku;
    lines.push([r, sku, q(itemName(sku)), m, wp.base.grid[k][m], wp.grid[k][m], wp.grid[k][m] - wp.base.grid[k][m], q(list.map(a => `${a.c.ref}: ${a.c.reason}`).join(" | ")), q(list.map(a => a.c.source).join(" | ")), ""].join(","));
  }
  for (const c of S.changes.filter(c => ["proposed", "open"].includes(changeState(c, date))))
    lines.push([c.region || "", c.sku || "", q(c.sku ? itemName(c.sku) : ""), c.month || "", c.sku && c.month && wp.base.grid[c.region + "|" + c.sku] ? wp.base.grid[c.region + "|" + c.sku][c.month] : "", "", "", q(c.reason), q(c.source), q(c.status === "open" ? "Open question" : "Awaiting approval")].join(","));
  return lines;
}

render();
