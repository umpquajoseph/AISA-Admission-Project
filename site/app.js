/* Supply Desk page. One record, three views:
 *   Inbox    what arrived and what needs a decision; add sheets and emails here
 *   Plan     one month at a time; click a number to see its source, type to change it
 *   History  the log of everything that arrived or changed, trends, and version compare
 *   Ask      questions about the record (placeholder until the assistant is connected)
 * The time slider sets the desk's date. Anything you add or change is dated to it.
 * Reading and plan logic live in core.js; this file only draws and records. */
"use strict";
const D = window.DATA, C = window.Core;
const START = D.releases.filter(r => r.disposition === "Posted").map(r => r.logged).sort()[0], END = D.cutoff;
const ITEMS = Object.fromEntries(D.items.map(i => [i.sku, i]));
const REGIONS = Object.fromEntries(D.regions.map(r => [r.code, r]));
const CATS = [...new Set(D.items.map(i => i.category))];
const TABS = [["inbox", "Inbox"], ["plan", "Plan"], ["history", "History"], ["ask", "Ask"]];

/* ------------------------------------------------------------ storage */
const KEY = "supplydesk.v2.";
function load(k, d) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { alert("This browser would not save the desk record: " + e.message); } }
const emptyRecord = () => ({ inputs: [], edits: [], decisions: [], versions: [] });
let R = load("record", emptyRecord());
let desk = C.Desk(D, R);
function commit() { save("record", R); desk = C.Desk(D, R); render(); }

const S = {
  tab: load("tab", "inbox"), date: load("date", END), zoom: load("zoom", "month"),
  planMonth: null, sel: null, working: null, open: {}, hist: "log", histKind: "all",
  trend: { sku: "S014", region: "R06" }, diffA: null, diffB: null, sheetView: null, preview: null, publishing: false, pending: null, folder: null,
};
(() => {                                                  // demo links: ?tab=plan&date=2026-09-17&example=1
  const q = new URLSearchParams(location.search);
  if (q.get("tab")) S.tab = q.get("tab");
  if (q.get("date") >= START && q.get("date") <= END) S.date = q.get("date");
  if (q.get("example") === "1" && !R.edits.length && !R.decisions.length) { R = workedExample(); save("record", R); desk = C.Desk(D, R); }
})();

/* ------------------------------------------------------------ helpers */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = id => document.getElementById(id);
const fmt = desk.fmt, sign = desk.sign;
const MON = C.MON;
const mlabel = m => MON[+m.slice(5) - 1] + (m.slice(0, 4) !== "2026" ? " ’" + m.slice(2, 4) : "");
const mlong = m => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][+m.slice(5) - 1] + " " + m.slice(0, 4);
const dlabel = d => d ? MON[+d.slice(5, 7) - 1] + " " + (+d.slice(8)) : "";
const dlong = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const itemName = sku => ITEMS[sku] ? ITEMS[sku].name : sku;
const regName = r => REGIONS[r] ? REGIONS[r].name : (r || "Network");
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const short = f => String(f || "").split("/").pop();
const who = x => x.kind === "email" ? x.mail.sender.replace(/<.*>/, "").replace(/"/g, "").trim() : x.kind === "calendar" ? "Event calendar" : x.kind === "sheet" ? (x.author || regName(x.region)) : "Central planning";
const nextMonth = d => { const [y, m] = d.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

/* ------------------------------------------------------------ the clock */
const ALLDAYS = (() => { const a = []; for (let d = START; d <= END; d = addDays(d, 1)) a.push(d); return a; })();
const ARRIVALS = {};                                      // date -> inputs that arrived that day
function indexArrivals() { for (const k in ARRIVALS) delete ARRIVALS[k]; for (const x of desk.inputs) if (x.date >= START && x.date <= END) (ARRIVALS[x.date] = ARRIVALS[x.date] || []).push(x); }
function sliderDays() { return S.zoom === "all" ? ALLDAYS : ALLDAYS.filter(d => d.slice(0, 7) === S.date.slice(0, 7)); }
function dayText(d) {
  const a = ARRIVALS[d] || []; if (!a.length) return "Nothing arrived";
  const n = k => a.filter(x => x.kind === k).length, parts = [];
  const sh = a.filter(x => x.kind === "sheet"); if (sh.length) parts.push(sh.length === 1 ? `${regName(sh[0].region)} sheet` : `${sh.length} sheets`);
  const pl = a.filter(x => x.kind === "plan"); for (const p of pl) parts.push(`plan ${p.release.disposition.toLowerCase()}`);
  if (n("email")) parts.push(`${n("email")} email${n("email") > 1 ? "s" : ""}`);
  if (n("calendar")) parts.push(`${n("calendar")} calendar entr${n("calendar") > 1 ? "ies" : "y"}`);
  return parts.join(" · ");
}
function renderClock() {
  const days = sliderDays(), i = Math.max(0, days.indexOf(S.date));
  const pos = d => (days.length > 1 ? days.indexOf(d) / (days.length - 1) * 100 : 50) + "%";
  const marks = days.filter(d => ARRIVALS[d]).map(d => {
    const k = ARRIVALS[d].some(x => x.kind === "plan") ? "plan" : ARRIVALS[d].some(x => x.kind === "sheet") ? "sheet" : "msg";
    return `<span class="mark ${k}" style="left:${pos(d)}" title="${esc(dlabel(d) + ": " + dayText(d))}"></span>`;
  }).join("");
  const ticks = S.zoom === "all"
    ? days.filter(d => d.endsWith("-01") || d === days[0]).map(d => `<span class="tick" style="left:${pos(d)}"><i></i>${MON[+d.slice(5, 7) - 1]}</span>`)
    : days.filter((d, j) => j % 2 === 0 || days.length < 20).map(d => `<span class="tick" style="left:${pos(d)}"><i></i>${+d.slice(8)}</span>`);
  const months = [...new Set(ALLDAYS.map(d => d.slice(0, 7)))];
  $("clock").innerHTML = `
    <div class="now"><b id="nowDate"></b><small id="nowText"></small></div>
    <button class="btn icon" id="prevDay" title="Previous day with an arrival">◀</button>
    <div class="track">
      <div class="marks">${marks}</div>
      <input type="range" id="slider" min="0" max="${days.length - 1}" value="${i}" aria-label="Desk date">
      <div class="ticks">${ticks.join("")}</div>
    </div>
    <button class="btn icon" id="nextDay" title="Next day with an arrival">▶</button>
    <div class="zoom">
      <div class="seg"><button class="${S.zoom === "all" ? "on" : ""}" data-zoom="all">All months</button>${months.map(m => `<button class="${S.zoom === "month" && S.date.slice(0, 7) === m ? "on" : ""}" data-zoom="${m}">${MON[+m.slice(5) - 1]}</button>`).join("")}</div>
    </div>`;
  updateNow();
  const sl = $("slider");
  let raf = 0;
  sl.oninput = () => { S.date = days[+sl.value]; updateNow(); cancelAnimationFrame(raf); raf = requestAnimationFrame(renderPage); };
  sl.onchange = () => save("date", S.date);
  $("prevDay").onclick = () => jump(-1);
  $("nextDay").onclick = () => jump(1);
  document.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => {
    const z = b.dataset.zoom;
    if (z === "all") S.zoom = "all";
    else { S.zoom = "month"; if (S.date.slice(0, 7) !== z) S.date = ALLDAYS.filter(d => d.slice(0, 7) === z).pop(); }
    save("zoom", S.zoom); save("date", S.date); renderClock(); renderPage();
  });
}
function updateNow() {
  $("nowDate").textContent = dlong(S.date);
  $("nowText").textContent = dayText(S.date);
}
function jump(dir) {
  const ds = Object.keys(ARRIVALS).sort();
  const t = dir < 0 ? ds.filter(d => d < S.date).pop() : ds.find(d => d > S.date);
  if (!t) return;
  S.date = t; save("date", S.date);
  renderClock(); renderPage();
}

/* ------------------------------------------------------------ shell */
function render() { indexArrivals(); renderClock(); renderPage(); }
function renderPage() {
  save("tab", S.tab);
  $("tabs").innerHTML = TABS.map(([id, n]) => {
    const c = id === "inbox" ? countNeeds() : 0;
    return `<button class="tab ${S.tab === id ? "on" : ""}" data-tab="${id}">${n}${c ? ` <span class="count">${c}</span>` : ""}</button>`;
  }).join("");
  const p = desk.planAt(S.date);
  const ne = p ? desk.editsAt(S.date).length : 0;
  $("meta").innerHTML = p ? `Plan in force: <b>${esc(p.base.name)}</b> (posted ${dlabel(p.base.date)})${ne ? ` + ${ne} change${ne > 1 ? "s" : ""}` : ""}` : "No plan posted yet";
  ({ inbox: pageInbox, plan: pagePlan, history: pageHistory, ask: pageAsk })[S.tab]();
}
function countNeeds() { const n = desk.needs(S.date); return n.sheets.length + n.inputs.length; }
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tab]"); if (t) { S.tab = t.dataset.tab; renderPage(); return; }
  const g = e.target.closest("[data-goto]"); if (g) { goto(g.dataset.goto); }
});
function goto(spec) {                                     // "plan:R06|S014|2026-10" or "history:trend:S014:R06" or "sheet:<id>"
  const [tab, ...rest] = spec.split(":"), v = rest.join(":");
  if (tab === "plan") { S.tab = "plan"; if (v) { S.sel = v; S.planMonth = v.split("|")[2]; } }
  if (tab === "trend") { const [sku, region] = v.split("|"); S.tab = "history"; S.hist = "trend"; S.trend = { sku, region }; }
  if (tab === "sheet") { S.tab = "inbox"; S.sheetView = v; }
  renderPage();
  if (tab === "sheet") setTimeout(() => { const el = $("sheetView"); if (el) el.scrollIntoView({ block: "start" }); });
}

/* ------------------------------------------------------------ Inbox */
function pageInbox() {
  const n = desk.needs(S.date), plan = desk.planAt(S.date);
  const cyc = desk.cycleAt(S.date);
  const total = n.sheets.length + n.inputs.length;
  const sheetCards = n.sheets.map(({ sheet: s, lines }) => {
    const id = "sh:" + s.id, open = S.open[id];
    return `<div class="item">
      <div class="head"><span class="pill sheet">Sheet</span><b>${esc(regName(s.region))} · ${mlong(s.cycle)} request</b><span class="hint">${dlabel(s.date)} · ${esc(s.author || "")}</span></div>
      <div>${lines.length} line${lines.length > 1 ? "s" : ""} differ from the plan by more than 10% (and 10 cases). Largest: ${esc(itemName(lines[0].cell.sku))} ${mlabel(lines[0].cell.month)}, plan ${fmt(lines[0].plan)}, asks ${fmt(lines[0].asked)}.</div>
      <div class="acts"><button class="btn small" data-toggle="${id}">${open ? "Hide lines" : "Review lines"}</button>
        <button class="btn small" data-useall="${esc(s.id)}">${lines.length > 1 ? `Use all ${lines.length} requests` : "Use the request"}</button>
        <button class="btn small" data-keepall="${esc(s.id)}">${lines.length > 1 ? "Keep the plan for all" : "Keep the plan"}</button>
        <button class="btn small link" data-goto="sheet:${esc(s.id)}">See the sheet</button></div>
      ${open ? `<table class="plain lines"><tr><th>Item</th><th>Month</th><th class="n">Plan</th><th class="n">Asks</th><th class="n">Diff</th><th>Sheet says</th><th></th></tr>
        ${lines.map(l => `<tr><td><a data-goto="plan:${l.key}">${esc(itemName(l.cell.sku))}</a></td><td>${mlabel(l.cell.month)}</td><td class="n">${fmt(l.plan)}</td><td class="n"><b>${fmt(l.asked)}</b></td><td class="n ${l.d > 0 ? "up" : "down"}">${sign(l.d)}</td><td class="hint">${l.cell.rule.length ? esc(l.cell.rule.join("; ")) : `${fmt(l.cell.orig)} ${esc(l.cell.unit)}`}${l.cell.note ? " · " + esc(l.cell.note) : ""}</td>
          <td class="nowrap"><button class="btn small" data-useline="${esc(s.id)}|${l.key}">Use</button> <button class="btn small" data-keepline="${esc(s.id)}|${l.key}">Keep plan</button></td></tr>`).join("")}</table>` : ""}
    </div>`;
  }).join("");
  const threadCard = (t, waiting) => {
    const id = t.thread.id, th = t.thread, open = S.open[id], last = th.items[th.items.length - 1];
    const dec = waiting && t.decision;
    return `<div class="item">
      <div class="head"><span class="pill ${th.kind}">${th.kind === "email" ? "Email" : "Calendar"}</span><b>${esc(th.title)}</b>${th.region ? `<span class="pill">${esc(regName(th.region))}</span>` : ""}<span class="hint">${th.items.length > 1 ? th.items.length + " messages · " : ""}latest ${dlabel(last.date)} ${last.time || ""}</span></div>
      ${dec ? `<div class="hint">Waiting since ${dlabel(dec.date)}: ${esc(dec.note || "")}</div>` : t.reopened ? `<div class="hint warn-text">New message since your last decision.</div>` : ""}
      <div class="msgs">${(open ? th.items : th.items.slice(-1)).map(x => msgHtml(x, open)).join("")}</div>
      <div class="acts">
        ${th.items.length > 1 || (last.mail && last.mail.body.length > 220) ? `<button class="btn small" data-toggle="${esc(id)}">${open ? "Show less" : th.items.length > 1 ? `Read all ${th.items.length}` : "Read all"}</button>` : ""}
        <button class="btn small primary" data-work="${esc(id)}">Change the plan</button>
        <button class="btn small" data-decide="${esc(id)}|no-change">No change needed</button>
        ${waiting ? "" : `<button class="btn small" data-decide="${esc(id)}|waiting">Waiting on someone</button>`}
      </div>
      ${S.pending && S.pending.target === id ? `<form class="inline" id="decForm"><input type="text" id="decNote" placeholder="${S.pending.outcome === "waiting" ? "Who or what are you waiting on?" : "Why no change? e.g. already in the Sep 11 plan"}" autofocus><button class="btn small primary">Save</button><button type="button" class="btn small" id="decCancel">Cancel</button></form>` : ""}
    </div>`;
  };
  const chips = cyc ? D.regions.map(r => {
    const s = desk.latestSheet(S.date, r.code, cyc);
    if (!s) return `<span class="chip wait" title="No ${mlong(cyc)} sheet yet">${esc(r.name)} · waiting</span>`;
    const corr = s.replaces ? " · corrected" : "", prob = s.problems.length ? ` · ${s.problems.length} problem${s.problems.length > 1 ? "s" : ""}` : "";
    return `<button class="chip ${s.problems.length ? "bad" : "ok"} ${S.sheetView === s.id ? "on" : ""}" data-sheet="${esc(s.id)}">${esc(r.name)} · ${dlabel(s.date)}${corr}${prob}</button>`;
  }).join("") : "";
  $("page").innerHTML = `
    <div class="cols">
      <div>
        <h1>Needs your decision</h1>
        <div class="hint">As of ${dlong(S.date)}. Sheets and messages nobody has acted on. Anything that arrived before the last plan posted from the packet is taken as already in it.</div>
        ${total ? "" : `<div class="empty">Nothing needs you as of ${dlabel(S.date)}.</div>`}
        ${n.sheets.length ? `<h2>Requests that differ from the plan</h2><div class="list">${sheetCards}</div>` : ""}
        ${n.inputs.length ? `<h2>Messages and calendar entries</h2><div class="list">${n.inputs.map(t => threadCard(t, false)).join("")}</div>` : ""}
        ${n.waiting.length ? `<h2>Waiting on someone</h2><div class="list">${n.waiting.map(t => threadCard(t, true)).join("")}</div>` : ""}
        ${cyc ? `<h2>${mlong(cyc)} sheets</h2><div class="chips">${chips}</div>` : ""}
        ${S.sheetView ? sheetViewHtml(S.sheetView) : ""}
      </div>
      <div>${addBoxHtml()}</div>
    </div>`;
  bindInbox();
}
function msgHtml(x, full) {
  if (x.kind === "calendar") return `<div class="msg"><div class="hint">${dlabel(x.date)} · ${esc(x.event.status)} · event date ${esc(x.event.event_date || "")}</div><div>${esc(x.event.detail)}</div></div>`;
  const b = x.mail.body;
  return `<div class="msg"><div class="hint">${dlabel(x.date)} ${x.time || ""} · ${esc(who(x))}${x.mail.attachments.length ? " · attached: " + esc(x.mail.attachments.join(", ")) : ""}${x.origin === "added" ? " · added here" : ""}</div><pre>${esc(full || b.length <= 220 ? b : b.slice(0, 220) + "…")}</pre></div>`;
}
function bindInbox() {
  document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { S.open[b.dataset.toggle] = !S.open[b.dataset.toggle]; renderPage(); });
  document.querySelectorAll("[data-sheet]").forEach(b => b.onclick = () => { S.sheetView = S.sheetView === b.dataset.sheet ? null : b.dataset.sheet; renderPage(); });
  document.querySelectorAll("[data-work]").forEach(b => b.onclick = () => { S.working = b.dataset.work; S.tab = "plan"; const th = desk.threadsAt(S.date).find(t => t.id === S.working); if (th) { const m = guessMonth(th); if (m) S.planMonth = m; } renderPage(); });
  document.querySelectorAll("[data-decide]").forEach(b => b.onclick = () => { const [target, outcome] = b.dataset.decide.split("|"); S.pending = { target, outcome }; renderPage(); setTimeout(() => $("decNote") && $("decNote").focus()); });
  const df = $("decForm");
  if (df) {
    df.onsubmit = e => { e.preventDefault(); R.decisions.push({ id: uid("d"), date: S.date, target: S.pending.target, outcome: S.pending.outcome, note: $("decNote").value.trim() }); S.pending = null; commit(); };
    $("decCancel").onclick = () => { S.pending = null; renderPage(); };
  }
  const line = (v, outcome) => { const i = v.indexOf("|"); return { sid: v.slice(0, i), key: v.slice(i + 1) }; };
  document.querySelectorAll("[data-useline]").forEach(b => b.onclick = () => { const { sid, key } = line(b.dataset.useline); useRequests(sid, [key]); });
  document.querySelectorAll("[data-keepline]").forEach(b => b.onclick = () => { const { sid, key } = line(b.dataset.keepline); keepPlan(sid, [key]); });
  document.querySelectorAll("[data-useall]").forEach(b => b.onclick = () => { const s = desk.needs(S.date).sheets.find(x => x.sheet.id === b.dataset.useall); useRequests(s.sheet.id, s.lines.map(l => l.key)); });
  document.querySelectorAll("[data-keepall]").forEach(b => b.onclick = () => { const s = desk.needs(S.date).sheets.find(x => x.sheet.id === b.dataset.keepall); keepPlan(s.sheet.id, s.lines.map(l => l.key)); });
  bindAddBox();
}
function guessMonth(th) {
  const t = th.items.map(x => x.kind === "email" ? x.mail.subject + " " + x.mail.body : x.event.detail).join(" ");
  const plan = desk.planAt(S.date); if (!plan) return null;
  return plan.months.find(m => new RegExp("\\b" + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][+m.slice(5) - 1] + "\\b", "i").test(t)) || null;
}
function useRequests(sid, keys) {
  const s = desk.byId[sid], plan = desk.planAt(S.date);
  for (const key of keys) {
    const [r, sku, m] = key.split("|"), cur = plan.grid[r + "|" + sku][m], c = s.cells[key];
    if (c.cs == null || c.cs === cur) continue;
    R.edits.push({ id: uid("e"), date: S.date, key, dv: c.cs - cur, qty: c.cs - cur, unit: "CS", base: plan.base.id, src: sid, reason: `Use ${regName(r)}'s ${dlabel(s.date)} request: ${fmt(c.cs)} CS${c.rule.length ? " (" + c.rule.join("; ") + ")" : ""}` });
  }
  commit();
}
function keepPlan(sid, keys) {
  const note = keys.length > 1 ? "Kept the plan for every differing line" : "Kept the plan";
  for (const key of keys) R.decisions.push({ id: uid("d"), date: S.date, target: "line:" + sid + "|" + key, outcome: "keep", note });
  commit();
}
function sheetViewHtml(id) {
  const s = desk.byId[id]; if (!s || !s.cells) return "";
  const prev = s.replaces ? desk.byId[s.replaces] : null;
  const months = [...new Set(Object.values(s.cells).map(c => c.month))].sort();
  const bySku = {};
  for (const c of Object.values(s.cells)) (bySku[c.sku] = bySku[c.sku] || {})[c.month] = c;
  let changed = 0;
  const rows = D.items.filter(i => bySku[i.sku]).map(i => {
    const any = Object.values(bySku[i.sku])[0];
    return `<tr><td class="l">${esc(i.name)} <span class="sku">${esc(any.local)}</span></td><td>${esc(any.unit)}</td>${months.map(m => {
      const c = bySku[i.sku][m]; if (!c) return "<td></td>";
      const p = prev && prev.cells[`${s.region}|${i.sku}|${m}`], diff = prev && (!p || p.cs !== c.cs);
      if (diff) changed++;
      const tip = [c.rule.join("; "), c.orig != null && c.unit !== "CS" ? `sheet says ${c.orig} ${c.unit}` : "", diff ? `earlier file: ${p ? fmt(p.cs) : "—"}` : "", c.note].filter(Boolean).join(" · ");
      return `<td class="n ${diff ? "changed" : ""} ${c.carried_from ? "carried" : ""}" title="${esc(tip)}">${fmt(c.cs)}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<div class="sheetview" id="sheetView">
    <div class="head"><b>${esc(regName(s.region))} · ${mlong(s.cycle)} sheet</b> <span class="hint">${esc(short(s.src))} · received ${dlabel(s.date)} · ${esc(s.author || "")} · layout “${esc(s.layout)}”</span> <button class="btn small" data-sheet="${esc(id)}">Close</button></div>
    <div class="hint">${s.counts.cells} lines read · ${s.counts.ea} converted from EA · ${s.counts.carried} blanks carried from the cycle before (grey) · ${s.counts.cancelled} zeros (month cancelled)${prev ? ` · replaces the ${dlabel(prev.date)} file: ${changed} line${changed === 1 ? "" : "s"} changed (blue)` : ""}${s.note || (s.meta && s.meta.note) ? ` · desk note: ${esc(s.note || s.meta.note)}` : ""}</div>
    ${s.problems.length ? `<div class="problems">${s.problems.map(esc).join("<br>")}</div>` : ""}
    <table class="grid compact"><tr><th class="l">Item</th><th>Unit</th>${months.map(m => `<th>${mlabel(m)}</th>`).join("")}</tr>${rows}</table>
    <div class="hint">Cases. Hover a number for the sheet's own figure and the rule applied.</div></div>`;
}

/* ------------------------------------------------------------ Add to the desk: paste, drop, folder */
function addBoxHtml() {
  const p = S.preview;
  return `<div class="addbox" id="addbox">
    <h2>Add to the desk</h2>
    <div class="hint">Paste cells copied from a manager's sheet, or the text of an email. Or drop a file here: .xlsx, .csv, .eml or .txt. It is dated ${dlabel(S.date)}, the desk's date.</div>
    <textarea id="pasteBox" placeholder="Paste here">${esc(S.pasteText || "")}</textarea>
    <div class="acts"><button class="btn primary" id="readPaste">Read it</button>
      <label class="btn">Choose file<input type="file" id="fileIn" accept=".xlsx,.xls,.csv,.eml,.txt" multiple hidden></label>
      <button class="btn" id="watch">${S.folder ? "Check folder now" : "Watch a folder"}</button></div>
    ${S.folder ? `<div class="hint">Watching “${esc(S.folder.name)}”. New files are added as they appear (checked every 30 s). ${esc(S.folder.status || "")}</div>` : `<div class="hint">A watched folder can be a shared drive synced to this computer. Edge or Chrome only.</div>`}
    ${p ? previewHtml(p) : ""}
  </div>`;
}
function previewHtml(p) {
  if (p.error) return `<div class="preview bad"><b>Could not read ${esc(p.name)}.</b><div>${esc(p.error)}</div><div class="acts"><button class="btn small" id="pvCancel">Dismiss</button></div></div>`;
  if (p.kind === "sheet") {
    const r = p.res, cyc = p.cycle;
    const plan = desk.planAt(S.date);
    let diff = 0; if (plan) for (const [k, c] of Object.entries(r.cells)) { const [rg, sku, m] = k.split("|"); const v = plan.grid[rg + "|" + sku] && plan.grid[rg + "|" + sku][m]; if (v != null && c.cs != null && Math.abs(c.cs - v) >= 10 && Math.abs(c.cs - v) > 0.1 * Math.max(v, 1)) diff++; }
    const cycles = [...new Set(p.read.entries.map(e => e.month).filter(Boolean))].sort();
    return `<div class="preview">
      <div class="overline">Read as a manager's sheet</div>
      <div class="kv"><div>Region</div><div><select id="pvRegion">${D.regions.map(g => `<option value="${g.code}" ${g.code === p.region ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>
      <div>Cycle</div><div><select id="pvCycle">${cycles.map(m => `<option value="${m}" ${m === cyc ? "selected" : ""}>${mlong(m)}</option>`).join("")}</select></div>
      <div>Layout</div><div>${esc(p.read.layout)}${p.read.author ? ` · ${esc(p.read.author)}` : ""}</div>
      <div>Lines</div><div>${r.counts.cells} read · ${r.counts.ea} converted from EA · ${r.counts.carried} carried · ${r.counts.cancelled} zero</div>
      <div>Against the plan</div><div>${diff} line${diff === 1 ? "" : "s"} differ by more than 10%</div></div>
      ${r.problems.length ? `<div class="problems">${r.problems.slice(0, 8).map(esc).join("<br>")}${r.problems.length > 8 ? `<br>and ${r.problems.length - 8} more` : ""}</div>` : `<div class="hint ok-text">No problems found.</div>`}
      <div class="acts"><button class="btn primary" id="pvAdd">Add to the desk</button><button class="btn" id="pvCancel">Cancel</button></div></div>`;
  }
  const m = p.mail;
  return `<div class="preview">
    <div class="overline">Read as a message</div>
    <div class="kv"><div>Subject</div><div><input type="text" id="pvSubject" value="${esc(m.subject)}"></div>
    <div>From</div><div>${esc(m.sender || "—")}${m.date ? ` · written ${dlabel(m.date)}` : ""}</div>
    <div>Region</div><div><select id="pvRegion"><option value="">Network or unknown</option>${D.regions.map(g => `<option value="${g.code}" ${g.code === p.region ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div></div>
    <pre>${esc(m.body.slice(0, 400))}${m.body.length > 400 ? "…" : ""}</pre>
    <div class="acts"><button class="btn primary" id="pvAdd">Add to the desk</button><button class="btn" id="pvCancel">Cancel</button></div></div>`;
}
/* one reader for every way in: pasted text, a dropped or chosen file, a folder */
async function readInput(name, payload) {
  try {
    let rows = null, text = null;
    if (/\.(xlsx|xls)$/i.test(name)) rows = await xlsxRows(payload);
    else if (typeof payload === "string") text = payload; else text = await payload.text();
    if (text != null && /\.csv$/i.test(name)) rows = C.parseDelimited(text, ",");
    else if (text != null && C.looksTabular(text)) rows = C.parseDelimited(text, "\t");
    if (rows) {
      if (!C.isSheet(rows)) return { name, error: C.readSheet(rows).error };
      const read = C.readSheet(rows);
      const region = C.guessRegion(read, D), cycle = C.guessCycle(read);
      return resolvePreview({ kind: "sheet", name, rows, read, region, cycle });
    }
    const mail = /\.eml$/i.test(name) ? C.readEmail(text) : C.readPastedText(text);
    if (!mail.body && !mail.subject) return { name, error: "There was no text in it." };
    return { kind: "email", name, mail, region: C.guessRegionFromText(mail.sender + " " + mail.subject + " " + mail.body, D) };
  } catch (e) { return { name, error: String(e.message || e) }; }
}
function resolvePreview(p) {
  const earlier = desk.sheets.filter(s => s.region === p.region && s.cycle < p.cycle).sort((a, b) => a.cycle.localeCompare(b.cycle) || a.date.localeCompare(b.date)).pop();
  p.res = C.resolveSheet(p.read, p.region, p.cycle, earlier ? earlier.cells : null, D);
  return p;
}
function addPreview(p) {
  const base = { id: uid("in"), date: S.date, time: new Date().toTimeString().slice(0, 5), src: p.name };
  if (p.kind === "sheet") R.inputs.push({ ...base, kind: "sheet", rows: p.rows, region: p.region, cycle: p.cycle, title: p.read.layout });
  else R.inputs.push({ ...base, kind: "email", mail: p.mail, region: p.region || null });
  return base.id;
}
let XLSXP = null;
function xlsxRows(file) {
  XLSXP = XLSXP || new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error("Could not load the spreadsheet reader (needs internet). Copy the cells and paste them instead.")); document.head.appendChild(s); });
  return XLSXP.then(async X => {
    const wb = X.read(await file.arrayBuffer(), { cellDates: true });
    const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    return rows.map(r => r.map(v => v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v));
  });
}
function bindAddBox() {
  const box = $("addbox"); if (!box) return;
  $("pasteBox").oninput = e => { S.pasteText = e.target.value; };
  $("readPaste").onclick = async () => { const t = $("pasteBox").value; if (!t.trim()) return; S.preview = await readInput("pasted text", t); renderPage(); };
  $("fileIn").onchange = async e => { for (const f of e.target.files) { S.preview = await readInput(f.name, f); if (e.target.files.length > 1 && !S.preview.error) { addPreview(S.preview); S.preview = null; } } if (!S.preview) commit(); else renderPage(); };
  box.ondragover = e => { e.preventDefault(); box.classList.add("drop"); };
  box.ondragleave = () => box.classList.remove("drop");
  box.ondrop = async e => {
    e.preventDefault(); box.classList.remove("drop");
    const fs = [...e.dataTransfer.files];
    if (!fs.length) { const t = e.dataTransfer.getData("text/plain"); if (t) { S.preview = await readInput("dropped text", t); renderPage(); } return; }
    if (fs.length === 1) { S.preview = await readInput(fs[0].name, fs[0]); renderPage(); return; }
    let bad = []; for (const f of fs) { const p = await readInput(f.name, f); if (p.error) bad.push(f.name); else addPreview(p); }
    if (bad.length) alert("Not read: " + bad.join(", ")); commit();
  };
  $("watch").onclick = watchFolder;
  const pv = S.preview;
  if (pv) {
    const c = $("pvCancel"); if (c) c.onclick = () => { S.preview = null; renderPage(); };
    const a = $("pvAdd"); if (a) a.onclick = () => { if (pv.kind === "email") pv.mail.subject = $("pvSubject").value; addPreview(pv); S.preview = null; S.pasteText = ""; commit(); };
    const rg = $("pvRegion"); if (rg) rg.onchange = () => { pv.region = rg.value || null; if (pv.kind === "sheet") resolvePreview(pv); renderPage(); };
    const cy = $("pvCycle"); if (cy) cy.onchange = () => { pv.cycle = cy.value; resolvePreview(pv); renderPage(); };
  }
}
async function watchFolder() {
  if (!S.folder) {
    if (!window.showDirectoryPicker) return alert("This browser cannot watch a folder. Use Edge or Chrome, or drop the files in.");
    try { S.folder = { handle: await window.showDirectoryPicker(), seen: new Set(load("seenFiles", [])) }; S.folder.name = S.folder.handle.name; } catch { return; }
    setInterval(scanFolder, 30000);
  }
  scanFolder();
}
async function scanFolder() {
  const F = S.folder; if (!F) return;
  const packet = new Set([...D.submissions.map(s => short(s.file)), ...D.emails.map(e => short(e.file))]);
  let added = 0, skipped = 0;
  async function walk(dir, path) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === "directory") { await walk(h, path + name + "/"); continue; }
      if (!/\.(xlsx|xls|csv|eml|txt)$/i.test(name)) continue;
      const f = await h.getFile(), key = path + name + "|" + f.size + "|" + f.lastModified;
      if (F.seen.has(key)) continue;
      F.seen.add(key);
      if (packet.has(name)) { skipped++; continue; }
      const p = await readInput(name, f);
      if (!p.error) { addPreview(p); added++; }
    }
  }
  try { await walk(F.handle, ""); } catch (e) { F.status = "Could not read the folder: " + e.message; }
  save("seenFiles", [...F.seen]);
  F.status = `Last checked ${new Date().toTimeString().slice(0, 5)}: ${added} new file${added === 1 ? "" : "s"} added${skipped ? `, ${skipped} already in the packet` : ""}.`;
  if (added) commit(); else renderPage();
}

/* ------------------------------------------------------------ Plan */
function pagePlan() {
  const plan = desk.planAt(S.date);
  if (!plan) { $("page").innerHTML = `<div class="empty">No plan was posted by ${dlabel(S.date)}.</div>`; return; }
  if (!plan.months.includes(S.planMonth)) { const nm = nextMonth(S.date.slice(0, 7)); S.planMonth = plan.months.includes(nm) ? nm : plan.months[0]; }
  const m = S.planMonth, regs = D.regions.map(r => r.code);
  const edits = desk.editsAt(S.date);
  const th = S.working && desk.threadsAt(S.date).find(t => t.id === S.working);
  let body = "", colTot = Object.fromEntries(regs.map(r => [r, 0])), net = 0, flagged = 0;
  for (const cat of CATS) {
    body += `<tr class="group"><td colspan="${regs.length + 2}">${esc(cat)}</td></tr>`;
    for (const it of D.items.filter(i => i.category === cat)) {
      let rowTot = 0;
      const cells = regs.map(r => {
        const key = `${r}|${it.sku}|${m}`, v = plan.grid[r + "|" + it.sku] && plan.grid[r + "|" + it.sku][m];
        if (v == null) return `<td class="cell na"></td>`;
        rowTot += v; colTot[r] += v;
        const bad = desk.checks(S.date, plan, key).some(c => !c.ok); if (bad) flagged++;
        const staged = S.draft && S.draft.key === key && S.draft.mode === "add" && S.draft.unit === "CS" && S.draft.qty !== "" ? v + Number(S.draft.qty) : null;
        const cls = ["cell", plan.applied[key] ? "changed" : "", bad ? "flag" : "", S.sel === key ? "sel" : "", staged != null ? "staged" : ""].join(" ");
        return `<td class="${cls}" data-key="${key}" tabindex="-1"${staged != null ? ` title="Was ${fmt(v)}; give a reason to save"` : ""}>${fmt(staged != null ? staged : v)}</td>`;
      }).join("");
      net += rowTot;
      body += `<tr><td class="l" title="${esc(it.case_pack)} · lead ${it.lead_days} days">${esc(it.name)} <span class="sku">${it.sku}</span></td>${cells}<td class="tot"><a data-goto="trend:${it.sku}|">${fmt(rowTot)}</a></td></tr>`;
    }
  }
  body += `<tr class="total"><td class="l">Total cases</td>${regs.map(r => `<td>${fmt(colTot[r])}</td>`).join("")}<td>${fmt(net)}</td></tr>`;
  const mEdits = edits.filter(e => e.key.endsWith("|" + m)).length;
  $("page").innerHTML = `
    <div class="planhead">
      <h1>${mlong(m)}</h1>
      <div class="seg">${plan.months.map(x => `<button class="${x === m ? "on" : ""}" data-month="${x}">${mlabel(x)}</button>`).join("")}</div>
      <div class="spacer"></div>
      <button class="btn" id="exportBuy">Export buy review</button>
      <button class="btn primary" id="publish">Publish version</button>
    </div>
    <div class="hint">Cases per region. Starts from ${esc(plan.base.name)} (posted ${dlabel(plan.base.date)})${mEdits ? `, with ${mEdits} change${mEdits > 1 ? "s" : ""} this month (blue)` : ""}. ${flagged} number${flagged === 1 ? "" : "s"} fail a check (amber corner). Click a number to see where it came from. Type to change it.</div>
    ${S.publishing ? publishHtml(plan, edits) : ""}
    ${th ? `<div class="banner">Working on <b>${esc(th.title)}</b>${th.region ? ` (${esc(regName(th.region))})` : ""}. Changes you save now are linked to it. <button class="btn small" id="doneWork">Done</button></div>` : ""}
    <div class="layout ${S.sel ? "" : "nodetail"}">
      <div class="gridwrap"><table class="grid" id="grid"><tr><th class="l">Item</th>${regs.map(r => `<th title="${esc(REGIONS[r].hub)} · ${esc(REGIONS[r].manager)}">${esc(REGIONS[r].name)}</th>`).join("")}<th>Network</th></tr>${body}</table></div>
      ${S.sel ? `<div class="detail" id="detail">${detailHtml(S.sel, plan)}</div>` : ""}
    </div>`;
  bindPlan(plan);
}
function bindPlan(plan) {
  document.querySelectorAll("[data-month]").forEach(b => b.onclick = () => { S.planMonth = b.dataset.month; if (S.sel) S.sel = S.sel.split("|").slice(0, 2).join("|") + "|" + S.planMonth; renderPage(); });
  document.querySelectorAll("td.cell[data-key]").forEach(td => {
    td.onclick = () => { if (S.sel !== td.dataset.key) { S.sel = td.dataset.key; renderPage(); focusSel(); } };
    td.ondblclick = () => startCellEdit(td.dataset.key, "");
  });
  $("exportBuy").onclick = exportBuyReview;
  $("publish").onclick = () => { S.publishing = !S.publishing; renderPage(); };
  const dw = $("doneWork"); if (dw) dw.onclick = () => { S.working = null; renderPage(); };
  const x = $("closeDetail"); if (x) x.onclick = () => { S.sel = null; renderPage(); };
  if (S.publishing) bindPublish(plan);
  if (S.sel) bindDetail(plan);
}
function focusSel() { const td = document.querySelector(`td.cell[data-key="${CSS.escape(S.sel)}"]`); if (td) td.focus({ preventScroll: false }); }
/* spreadsheet keys on the grid: arrows move, a digit or Enter starts typing */
document.addEventListener("keydown", e => {
  if (S.tab !== "plan" || !S.sel || e.target.closest("input,textarea,select")) return;
  const [r, sku, m] = S.sel.split("|");
  const regs = D.regions.map(x => x.code), skus = D.items.map(i => i.sku);
  const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (mv) {
    e.preventDefault();
    const ri = Math.min(regs.length - 1, Math.max(0, regs.indexOf(r) + mv[0])), si = Math.min(skus.length - 1, Math.max(0, skus.indexOf(sku) + mv[1]));
    S.sel = `${regs[ri]}|${skus[si]}|${m}`; renderPage(); focusSel(); return;
  }
  if (e.key === "Escape") { S.sel = null; renderPage(); return; }
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); startCellEdit(S.sel, e.key); }
  else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startCellEdit(S.sel, null); }
});
function startCellEdit(key, initial) {
  const td = document.querySelector(`td.cell[data-key="${CSS.escape(key)}"]`); if (!td) return;
  const plan = desk.planAt(S.date), [r, sku, m] = key.split("|"), cur = plan.grid[r + "|" + sku][m];
  td.innerHTML = `<input class="cellin" value="${initial == null ? cur : initial}">`;
  const inp = td.querySelector("input"); inp.focus(); if (initial == null) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = parseFloat(inp.value.replace(/,/g, ""));
    if (!ok || isNaN(v) || v === cur) { renderPage(); focusSel(); return; }
    S.sel = key; S.draft = { key, mode: "add", qty: Math.round((v - cur) * 1000) / 1000, unit: "CS" };
    renderPage(); const rs = $("dReason"); if (rs) { rs.focus(); rs.select(); }
  };
  inp.onkeydown = e => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); finish(true); } if (e.key === "Escape") finish(false); e.stopPropagation(); };
  inp.onblur = () => finish(true);
}
function detailHtml(key, plan) {
  const [r, sku, m] = key.split("|"), k = r + "|" + sku, it = ITEMS[sku];
  const v = plan.grid[k] && plan.grid[k][m], base = plan.base.grid[k] && plan.base.grid[k][m];
  if (v == null) return `<div class="hint">No line for this item in ${esc(regName(r))}.</div>`;
  const applied = plan.applied[key] || [];
  const req = desk.requestAt(S.date, key);
  const checks = desk.checks(S.date, plan, key);
  const hist = desk.versionsAll.filter(x => x.date <= S.date && x.grid[k] && x.grid[k][m] != null);
  const dr = S.draft && S.draft.key === key ? S.draft : { key, mode: "add", qty: "", unit: "CS" };
  const th = S.working && desk.threadsAt(S.date).find(t => t.id === S.working);
  const lineDec = req && desk.decisionAt(S.date, "line:" + req.sheet.id + "|" + key);
  const allEdits = R.edits.filter(e => e.key === key && e.date <= S.date && e.base === plan.base.id);
  const reqDiff = req && req.cell.cs != null && req.cell.cs !== v;
  return `<div class="dhead"><div class="overline">${esc(regName(r))} · ${mlong(m)}</div><button class="btn small" id="closeDetail">Close</button></div>
    <h3>${esc(it.name)}</h3>
    <div class="bignum">${fmt(v)} <small>cases</small></div>
    <div class="hint">${applied.length ? `Posted ${fmt(base)} · ${applied.length} change${applied.length > 1 ? "s" : ""} since` : `As posted ${dlabel(plan.base.date)}`} · ${esc(it.case_pack)} · lead ${it.lead_days} days</div>

    <form class="dform" id="dForm">
      <div class="seg small"><button type="button" class="${dr.mode === "add" ? "on" : ""}" data-mode="add">Add or remove</button><button type="button" class="${dr.mode === "move" ? "on" : ""}" data-mode="move">Move to another month</button></div>
      <div class="row"><input type="number" step="any" id="dQty" value="${dr.qty}" placeholder="${dr.mode === "add" ? "+ or −" : "cases"}">
        ${dr.mode === "add" ? `<select id="dUnit"><option value="CS" ${dr.unit === "CS" ? "selected" : ""}>cases</option><option value="EA" ${dr.unit === "EA" ? "selected" : ""}>${esc(it.ea_unit)}s (${it.ea_per_case} per case)</option></select>`
        : `<span>cases to</span><select id="dTo">${plan.months.filter(x => x !== m).map(x => `<option value="${x}" ${dr.to === x ? "selected" : ""}>${mlong(x)}</option>`).join("")}</select>`}</div>
      <div class="hint" id="dCalc"></div>
      <input type="text" id="dReason" placeholder="Why? Purchasing and finance will read this" value="${esc(dr.reason || (th ? th.title : ""))}">
      ${th ? `<div class="hint">Linked to: ${esc(th.title)}</div>` : ""}
      <div class="row"><button class="btn primary">Save change</button>${S.draft ? `<button type="button" class="btn" id="dCancel">Cancel</button>` : ""}</div>
    </form>

    ${allEdits.length ? `<h4>Changes to this number</h4>${allEdits.map(e => `<div class="edit ${desk.editLive(e, S.date) ? "" : "undone"}"><div><b>${sign(e.dv)}</b> ${e.unit === "EA" ? `(${fmt(e.qty)} ${esc(it.ea_unit)}s) ` : ""}· ${dlabel(e.date)}${e.group ? " · moved with " + mlabel(R.edits.find(x => x.group === e.group && x.id !== e.id).key.split("|")[2]) : ""}${desk.editLive(e, S.date) ? ` <button class="btn small link" data-undo="${e.id}">Undo</button>` : ` · undone ${dlabel(e.removed_on)}`}</div><div>${esc(e.reason)}</div>${e.src ? `<div class="src">${esc(srcName(e.src))}</div>` : ""}</div>`).join("")}` : ""}

    <h4>What ${esc(regName(r))} asked</h4>
    ${req ? `<div><b>${fmt(req.cell.cs)} cases</b> ${req.cell.rule.length ? `<span class="hint">(${esc(req.cell.rule.join("; "))})</span>` : ""}</div>
      <div class="src">${esc(short(req.sheet.src))} · row ${req.cell.row} · ${esc(req.cell.local)} · received ${dlabel(req.sheet.date)}${req.cell.note ? " · note: " + esc(req.cell.note) : ""}</div>
      ${reqDiff ? `<div class="row"><button class="btn small" id="useReq">Use ${fmt(req.cell.cs)}</button>${lineDec ? `<span class="hint">You kept the plan on ${dlabel(lineDec.date)}.</span>` : `<button class="btn small" id="keepReq">Keep the plan</button>`}</div>` : ""}`
    : `<div class="hint">No ${mlong(desk.cycleAt(S.date) || m)} sheet from ${esc(regName(r))} yet.</div>`}

    <h4>Checks</h4>
    ${checks.map(c => `<div class="check ${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "!"} ${esc(c.text)}</div>`).join("") || `<div class="hint">Nothing to check against.</div>`}

    <h4>In every plan file</h4>
    <table class="plain mini">${hist.map(x => `<tr><td>${dlabel(x.date)}</td><td>${esc(x.name)}</td><td><span class="pill ${x.status.split(" ")[0]}">${esc(x.status)}</span></td><td class="n">${fmt(x.grid[k][m])}</td></tr>`).join("")}</table>
    <div style="margin-top:8px"><button class="btn small link" data-goto="trend:${sku}|${r}">See the trend for ${esc(it.name.toLowerCase())}</button></div>`;
}
function srcName(id) {
  const x = desk.byId[id]; if (x) return x.kind === "sheet" ? `${regName(x.region)} sheet, ${dlabel(x.date)}` : x.mail ? x.mail.subject : id;
  const th = desk.threadsAt(END).find(t => t.id === id); return th ? th.title : id;
}
function bindDetail(plan) {
  const key = S.sel, [r, sku, m] = key.split("|"), it = ITEMS[sku], f = $("dForm"); if (!f) return;
  const cur = plan.grid[r + "|" + sku][m];
  S.draft = S.draft && S.draft.key === key ? S.draft : null;
  const state = () => ({ key, mode: f.querySelector(".seg .on").dataset.mode, qty: $("dQty").value, unit: $("dUnit") ? $("dUnit").value : "CS", to: $("dTo") ? $("dTo").value : null, reason: $("dReason").value });
  const calc = () => {
    const s = state(), q = parseFloat(s.qty);
    if (isNaN(q)) { $("dCalc").textContent = ""; return; }
    const cs = s.mode === "add" && s.unit === "EA" ? q / it.ea_per_case : q;
    $("dCalc").textContent = s.mode === "add" ? `${s.unit === "EA" ? `${fmt(q)} ÷ ${it.ea_per_case} = ${fmt(cs)} cases. ` : ""}${fmt(cur)} → ${fmt(cur + cs)} cases` : `${mlabel(m)} ${fmt(cur)} → ${fmt(cur - q)} · ${mlabel(s.to)} ${fmt(plan.grid[r + "|" + sku][s.to])} → ${fmt(plan.grid[r + "|" + sku][s.to] + q)}`;
  };
  f.oninput = calc; calc();
  f.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { S.draft = { ...state(), mode: b.dataset.mode }; renderPage(); });
  const dc = $("dCancel"); if (dc) dc.onclick = () => { S.draft = null; renderPage(); focusSel(); };
  f.onsubmit = e => {
    e.preventDefault();
    const s = state(), q = parseFloat(s.qty);
    if (isNaN(q) || q === 0) return $("dQty").focus();
    if (!s.reason.trim()) { $("dReason").focus(); $("dReason").classList.add("need"); return; }
    const common = { date: S.date, base: plan.base.id, reason: s.reason.trim(), src: S.working || null };
    if (s.mode === "add") R.edits.push({ id: uid("e"), key, dv: s.unit === "EA" ? q / it.ea_per_case : q, qty: q, unit: s.unit, ...common });
    else { const g = uid("g"); R.edits.push({ id: uid("e"), key, dv: -q, qty: -q, unit: "CS", group: g, ...common }, { id: uid("e"), key: `${r}|${sku}|${s.to}`, dv: q, qty: q, unit: "CS", group: g, ...common }); }
    S.draft = null; commit(); focusSel();
  };
  document.querySelectorAll("[data-undo]").forEach(b => b.onclick = () => {
    const e = R.edits.find(x => x.id === b.dataset.undo);
    for (const x of R.edits.filter(x => x.id === e.id || (e.group && x.group === e.group))) x.removed_on = S.date;
    commit();
  });
  const req = desk.requestAt(S.date, key);
  const ur = $("useReq"); if (ur) ur.onclick = () => useRequests(req.sheet.id, [key]);
  const kr = $("keepReq"); if (kr) kr.onclick = () => keepPlan(req.sheet.id, [key]);
}
function publishHtml(plan, edits) {
  const n = R.versions.length + 1, open = countNeeds();
  return `<form class="publish" id="pubForm">
    <b>Publish the ${dlabel(S.date)} plan</b>
    <div class="hint">${esc(plan.base.name)} plus ${edits.length} change${edits.length === 1 ? "" : "s"}. It becomes the plan in force from ${dlabel(S.date)}; later changes start from it.${open ? ` ${open} item${open > 1 ? "s" : ""} in the inbox still need a decision.` : ""}</div>
    <div class="row"><input type="text" id="pubName" value="Version ${n} · ${dlabel(S.date)}"><input type="text" id="pubNote" class="grow" placeholder="Note for purchasing and finance" value="${esc(plan.base.name)} plus ${edits.length} changes">
    <button class="btn primary">Publish</button><button type="button" class="btn" id="pubCancel">Cancel</button></div></form>`;
}
function bindPublish(plan) {
  $("pubCancel").onclick = () => { S.publishing = false; renderPage(); };
  $("pubForm").onsubmit = e => {
    e.preventDefault();
    R.versions.push({ id: uid("v"), date: S.date, name: $("pubName").value.trim() || "Published version", note: $("pubNote").value.trim(), grid: plan.grid, months: plan.months, from: plan.base.id, edits: desk.editsAt(S.date).map(x => x.id) });
    S.publishing = false; commit();
  };
}

/* ------------------------------------------------------------ History */
function pageHistory() {
  $("page").innerHTML = `
    <div class="planhead"><h1>History</h1>
      <div class="seg">${[["log", "What happened"], ["trend", "Trends"], ["compare", "Compare versions"]].map(([k, n]) => `<button class="${S.hist === k ? "on" : ""}" data-hist="${k}">${n}</button>`).join("")}</div>
      <div class="spacer"></div>
      <span class="hint">Desk record:</span>
      <button class="btn small" id="recExport">Export</button>
      <label class="btn small">Import<input type="file" id="recImport" accept=".json" hidden></label>
      <button class="btn small" id="recExample">Load September example</button>
      <button class="btn small" id="recClear">Clear</button>
    </div>
    <div id="histBody"></div>`;
  ({ log: histLog, trend: histTrend, compare: histCompare })[S.hist]();
  document.querySelectorAll("[data-hist]").forEach(b => b.onclick = () => { S.hist = b.dataset.hist; renderPage(); });
  $("recExport").onclick = () => download(`supply-desk-record-${S.date}.json`, JSON.stringify(R, null, 1), "application/json");
  $("recImport").onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const v = JSON.parse(t); if (!v.edits || !v.inputs) throw 0; R = { ...emptyRecord(), ...v }; commit(); } catch { alert("That file is not a desk record export."); } }); };
  $("recExample").onclick = () => { if ((!R.edits.length && !R.decisions.length && !R.inputs.length) || confirm("Replace this browser's desk record with the September worked example?")) { R = workedExample(); S.date = "2026-09-18"; save("date", S.date); commit(); } };
  $("recClear").onclick = () => { if (confirm("Delete everything added, changed, decided and published in this browser? Export it first to keep a copy.")) { R = emptyRecord(); commit(); } };
}
function logEntries(T) {
  const out = [];
  for (const x of desk.inputsAt(T)) {
    if (x.kind === "sheet") {
      if (x.error) { out.push({ date: x.date, kind: "sheet", text: `Could not read ${esc(short(x.src))}: ${esc(x.error)}` }); continue; }
      const prev = x.replaces && desk.byId[x.replaces];
      let changed = 0; if (prev) for (const [k, c] of Object.entries(x.cells)) if (!prev.cells[k] || prev.cells[k].cs !== c.cs) changed++;
      out.push({ date: x.date, kind: "sheet", text: `<b>${esc(regName(x.region))}</b> sent its ${mlong(x.cycle)} sheet${prev ? `, replacing the ${dlabel(prev.date)} file (${changed} line${changed === 1 ? "" : "s"} changed)` : ""}. ${x.counts.cells} lines, ${x.counts.ea} converted from EA, ${x.counts.carried} carried forward${x.problems.length ? `, <span class="warn-text">${x.problems.length} problems</span>` : ""}.${x.origin === "added" ? " Added here." : ""} <a data-goto="sheet:${esc(x.id)}">See the sheet</a>`, why: x.meta && x.meta.note });
    } else if (x.kind === "plan") {
      const r = x.release, verb = { Posted: "posted; it became the plan in force", Withdrawn: "saved, then withdrawn", Working: "saved as a working draft", Scenario: "saved as a scenario; never the plan in force" }[r.disposition] || r.disposition;
      out.push({ date: x.date, kind: "plan", text: `Plan file <b>${esc(short(r.file).replace(/\.xlsx$/, ""))}</b> ${verb}.`, why: r.note });
    } else if (x.kind === "email") out.push({ date: x.date, time: x.time, kind: "msg", text: `Email from ${esc(who(x))}: <b>${esc(x.mail.subject)}</b>${x.origin === "added" ? " (added here)" : ""}`, body: x.mail.body });
    else if (x.kind === "calendar") out.push({ date: x.date, kind: "msg", text: `Calendar: <b>${esc(x.event.id)}</b> ${esc(x.event.type)}, ${esc(x.event.status.toLowerCase())}`, why: x.event.detail });
  }
  const groups = {};
  for (const e of R.edits.filter(e => e.date <= T)) {
    if (e.group) { if (groups[e.group]) continue; groups[e.group] = 1; }
    const [r, sku, m] = e.key.split("|"), pair = e.group && R.edits.find(x => x.group === e.group && x.id !== e.id);
    const what = pair ? `moved ${fmt(Math.abs(e.dv))} cases of ${esc(itemName(sku))} for ${esc(regName(r))} from ${mlabel(e.dv < 0 ? m : pair.key.split("|")[2])} to ${mlabel(e.dv < 0 ? pair.key.split("|")[2] : m)}`
      : `changed ${esc(regName(r))} · ${esc(itemName(sku))} · ${mlabel(m)} by <b>${sign(e.dv)}</b> cases${e.unit === "EA" ? ` (${fmt(e.qty)} ${esc(ITEMS[sku].ea_unit)}s)` : ""}`;
    const v = desk.versionsAll.find(x => x.id === e.base);
    out.push({ date: e.date, kind: "you", text: `You ${what}, on ${esc(v ? v.name : "the plan")}.${e.src ? ` From: ${esc(srcName(e.src))}.` : ""} <a data-goto="plan:${e.key}">Open</a>`, why: e.reason });
    if (e.removed_on && e.removed_on <= T) out.push({ date: e.removed_on, kind: "you", text: `You undid the ${dlabel(e.date)} change to ${esc(regName(r))} · ${esc(itemName(sku))} · ${mlabel(m)} (${sign(e.dv)}).` });
  }
  const keepN = {};
  for (const d of R.decisions.filter(d => d.date <= T)) {
    if (d.outcome === "keep") { const k = d.date + "|" + d.target.split("|")[0]; keepN[k] = (keepN[k] || 0) + 1; continue; }
    out.push({ date: d.date, kind: "you", text: `You marked <b>${esc(srcName(d.target))}</b> as ${d.outcome === "waiting" ? "waiting on someone" : "no change needed"}.`, why: d.note });
  }
  for (const [k, n] of Object.entries(keepN)) { const [date, t] = k.split("|"); const s = desk.byId[t.slice(5)]; out.push({ date, kind: "you", text: `You kept the plan on ${n} line${n > 1 ? "s" : ""} where ${esc(s ? regName(s.region) : "a")}'s sheet asked for something different.` }); }
  for (const v of R.versions.filter(v => v.date <= T)) out.push({ date: v.date, kind: "plan", text: `You published <b>${esc(v.name)}</b>: ${v.edits ? v.edits.length : 0} changes on top of ${esc((desk.versionsAll.find(x => x.id === v.from) || {}).name || "the plan in force")}. It became the plan in force.`, why: v.note });
  const rank = e => ({ you: 0, plan: 1 })[e.kind] ?? 2;          // within a day: your actions, then plan files, then arrivals by time
  return out.sort((a, b) => b.date.localeCompare(a.date) || rank(a) - rank(b) || (b.time || "").localeCompare(a.time || ""));
}
function histLog() {
  const kinds = [["all", "Everything"], ["plan", "Plan versions"], ["sheet", "Sheets"], ["msg", "Messages"], ["you", "Your changes and decisions"]];
  const all = logEntries(S.date), es = all.filter(e => S.histKind === "all" || e.kind === S.histKind);
  let last = "";
  const rows = es.map((e, i) => { const d = e.date !== last ? `<div class="day">${dlong(e.date)}</div>` : ""; last = e.date; const id = "log" + i;
    return d + `<div class="logrow ${e.kind}"><span class="pill ${e.kind}">${{ plan: "Plan", sheet: "Sheet", msg: "Message", you: "You" }[e.kind]}</span><div><div>${e.text}${e.body ? ` <button class="btn small link" data-logopen="${id}">${S.open[id] ? "Hide" : "Read"}</button>` : ""}</div>${e.why ? `<div class="hint">${esc(e.why)}</div>` : ""}${e.body && S.open[id] ? `<pre>${esc(e.body)}</pre>` : ""}</div></div>`; }).join("");
  $("histBody").innerHTML = `
    <div class="hint">Everything that reached the desk or changed on it, newest first, up to ${dlong(S.date)}. Move the slider to see the record as it stood on any day.</div>
    <div class="seg" style="margin:10px 0">${kinds.map(([k, n]) => `<button class="${S.histKind === k ? "on" : ""}" data-kind="${k}">${n} (${k === "all" ? all.length : all.filter(e => e.kind === k).length})</button>`).join("")}</div>
    <div class="log">${rows || `<div class="empty">Nothing yet.</div>`}</div>`;
  document.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => { S.histKind = b.dataset.kind; renderPage(); });
  document.querySelectorAll("[data-logopen]").forEach(b => b.onclick = () => { S.open[b.dataset.logopen] = !S.open[b.dataset.logopen]; renderPage(); });
}
function histTrend() {
  const { sku, region } = S.trend, T = S.date;
  const regs = region ? [region] : D.regions.map(r => r.code);
  const sum = f => { let t = 0, any = false; for (const r of regs) { const v = f(r); if (v != null) { t += v; any = true; } } return any ? t : null; };
  const plan = desk.planAt(T);
  const posted = desk.versionsAll.filter(v => v.date <= T && (v.status === "Posted" || v.status === "Published here"));
  const series = [];
  posted.forEach((v, i) => { if (plan && v.id === plan.base.id) return; series.push({ name: v.name, cls: "old", pts: v.months.map(m => [m, sum(r => v.grid[r + "|" + sku] && v.grid[r + "|" + sku][m])]) }); });
  if (plan) series.push({ name: `Plan now (${plan.base.name}${desk.editsAt(T).length ? " + changes" : ""})`, cls: "now", pts: plan.months.map(m => [m, sum(r => plan.grid[r + "|" + sku] && plan.grid[r + "|" + sku][m])]) });
  const reqMonths = {};
  for (const s of desk.sheetsAt(T)) for (const c of Object.values(s.cells)) if (c.sku === sku && regs.includes(s.region) && c.cs != null) (reqMonths[c.month] = reqMonths[c.month] || {})[s.region] = c.cs;   // later sheets overwrite earlier
  const rm = Object.keys(reqMonths).sort();
  series.push({ name: "Latest request from the sheets", cls: "req", pts: rm.map(m => [m, regs.every(r => reqMonths[m][r] != null) ? regs.reduce((t, r) => t + reqMonths[m][r], 0) : null]) });
  const hasSales = regs.some(r => D.sales_use[r + "|" + sku]);
  if (hasSales) {
    const ms = [...new Set(regs.flatMap(r => Object.keys(D.sales_use[r + "|" + sku] || {})))].sort().filter(m => m <= T.slice(0, 7));
    series.push({ name: "Used, from sales (one drink only)", cls: "sales", pts: ms.map(m => [m, sum(r => (D.sales_use[r + "|" + sku] || {})[m])]) });
  }
  const months = [...new Set(series.flatMap(s => s.pts.map(p => p[0])))].sort();
  const from = months.findIndex(m => m >= "2025-09");
  const X = months.slice(Math.max(0, from));
  const W = 860, H = 280, L = 48, B = 26, top = 10;
  const ys = series.flatMap(s => s.pts.filter(p => X.includes(p[0]) && p[1] != null).map(p => p[1]));
  const ymax = Math.max(10, ...ys) * 1.08;
  const x = m => L + (X.indexOf(m) / Math.max(1, X.length - 1)) * (W - L - 10), y = v => top + (1 - v / ymax) * (H - top - B);
  const path = s => { let d = "", pen = false; for (const [m, v] of s.pts) { if (!X.includes(m) || v == null) { pen = false; continue; } d += (pen ? "L" : "M") + x(m).toFixed(1) + "," + y(v).toFixed(1); pen = true; } return d; };
  const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${L}" x2="${W - 10}" y1="${y(ymax * f)}" y2="${y(ymax * f)}" class="gl"/><text x="${L - 6}" y="${y(ymax * f) + 4}" text-anchor="end">${fmt(Math.round(ymax * f))}</text>`).join("");
  const now = T.slice(0, 7);
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart">${grid}
    ${X.includes(now) ? `<line x1="${x(now)}" x2="${x(now)}" y1="${top}" y2="${H - B}" class="nowline"/><text x="${x(now) + 4}" y="${top + 10}" class="nowlbl">${dlabel(T)}</text>` : ""}
    ${X.map((m, i) => i % (X.length > 14 ? 2 : 1) === 0 ? `<text x="${x(m)}" y="${H - 8}" text-anchor="middle">${mlabel(m)}${m.endsWith("-01") || i === 0 ? " " + m.slice(2, 4) : ""}</text>` : "").join("")}
    ${series.map(s => `<path d="${path(s)}" class="ln ${s.cls}"><title>${esc(s.name)}</title></path>${s.pts.filter(p => X.includes(p[0]) && p[1] != null).map(p => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="${s.cls === "now" ? 3.5 : 2.5}" class="pt ${s.cls}"><title>${esc(s.name)} · ${mlabel(p[0])} ${p[0].slice(0, 4)}: ${fmt(p[1])} cases</title></circle>`).join("")}`).join("")}
  </svg>`;
  $("histBody").innerHTML = `
    <div class="row">
      <select id="tSku">${D.items.map(i => `<option value="${i.sku}" ${i.sku === sku ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select>
      <select id="tReg"><option value="">Whole network</option>${D.regions.map(r => `<option value="${r.code}" ${r.code === region ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
      <span class="hint">Cases per month as of ${dlabel(T)}. Hover a point for its value.</span>
    </div>
    ${svg}
    <div class="legend">${series.map(s => `<span><i class="sw ${s.cls}"></i>${esc(s.name)}</span>`).join("")}</div>
    ${hasSales ? `<div class="hint">Sales-implied use counts one drink's servings × its portion standard (${esc((D.sales_drinks.find(d => d.sku === sku) || {}).name || "")}). Other drinks use this item too, so real use is at least this line. September is partial, to Sep 18.</div>` : `<div class="hint">No portion standard links sales to this item, so there is no sales line. The packet has standards for three items only.</div>`}`;
  $("tSku").onchange = e => { S.trend.sku = e.target.value; renderPage(); };
  $("tReg").onchange = e => { S.trend.region = e.target.value; renderPage(); };
}
function histCompare() {
  const vs = desk.versionsAll.filter(v => v.date <= S.date);
  const byId = Object.fromEntries(vs.map(v => [v.id, v]));
  if (!byId[S.diffA] || !byId[S.diffB]) { const p = vs.filter(v => v.status === "Posted" || v.status === "Published here"); [S.diffA, S.diffB] = [(p[p.length - 2] || vs[0]).id, (p[p.length - 1] || vs[vs.length - 1]).id]; }
  const A = byId[S.diffA], B = byId[S.diffB], rows = [];
  for (const k of Object.keys(B.grid)) for (const m of B.months) {
    const a = A.grid[k] && A.grid[k][m], b = B.grid[k][m];
    if (a != null && b != null && a !== b) { const [r, sku] = k.split("|"); rows.push(`<tr><td>${esc(regName(r))}</td><td>${esc(itemName(sku))}</td><td>${mlabel(m)}</td><td class="n">${fmt(a)}</td><td class="n">${fmt(b)}</td><td class="n ${b > a ? "up" : "down"}">${sign(b - a)}</td></tr>`); }
  }
  const opt = sel => vs.map(v => `<option value="${v.id}" ${v.id === sel ? "selected" : ""}>${dlabel(v.date)} · ${esc(v.name)} (${esc(v.status)})</option>`).join("");
  $("histBody").innerHTML = `
    <div class="hint">Every plan file the desk saved, and every version published here. Pick two to see which lines moved.</div>
    <div class="row" style="margin:10px 0"><select id="dA">${opt(S.diffA)}</select><span>→</span><select id="dB">${opt(S.diffB)}</select></div>
    ${rows.length ? `<table class="plain"><tr><th>Region</th><th>Item</th><th>Month</th><th class="n">${esc(A.name)}</th><th class="n">${esc(B.name)}</th><th class="n">Change</th></tr>${rows.join("")}</table>` : `<div class="empty">No line differs between these two.</div>`}
    <div class="hint" style="margin-top:6px">${rows.length} line${rows.length === 1 ? "" : "s"} differ. Desk note on the later file: ${esc(B.note || "—")}</div>`;
  $("dA").onchange = e => { S.diffA = e.target.value; renderPage(); };
  $("dB").onchange = e => { S.diffB = e.target.value; renderPage(); };
}

/* ------------------------------------------------------------ Ask (placeholder until the assistant is connected) */
function pageAsk() {
  const examples = ["What changed since the Sep 11 plan, and why?", "Why is Gulf Coast mango 259 in October?", "Which messages still need a decision before Monday's buy review?", "Draft the changes this email asks for."];
  $("page").innerHTML = `
    <h1>Ask</h1>
    <div class="hint">Questions about the desk as of ${dlong(S.date)}. The assistant answers from this desk's record only and names the sheet, email or change behind each answer. It can also draft changes from an email or a pasted dump; drafts wait in the Inbox for you to approve.</div>
    <div class="askbox"><textarea disabled placeholder="Ask about the plan, a sheet, an email or a change"></textarea><button class="btn primary" disabled>Ask</button></div>
    <div class="empty">Not connected yet. It goes live once the assistant is wired to the Claude API, with the key kept on a server and never in this page.</div>
    <h2>Questions it will answer</h2>
    <div class="list">${examples.map(q => `<div class="item">${esc(q)}</div>`).join("")}</div>`;
}

/* ------------------------------------------------------------ outputs */
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportBuyReview() {
  const plan = desk.planAt(S.date), q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Region", "SKU", "Item", "Month", "Posted (CS)", "Working (CS)", "Difference", "Reasons", "Sources"].join(",")];
  for (const [key, list] of Object.entries(plan.applied)) {
    const [r, sku, m] = key.split("|"), k = r + "|" + sku;
    lines.push([r, sku, q(itemName(sku)), m, plan.base.grid[k][m], plan.grid[k][m], Math.round((plan.grid[k][m] - plan.base.grid[k][m]) * 1000) / 1000, q(list.map(e => e.reason).join(" | ")), q(list.map(e => e.src ? srcName(e.src) : "").filter(Boolean).join(" | "))].join(","));
  }
  const n = desk.needs(S.date);
  for (const w of n.waiting) lines.push(["", "", q(w.thread.title), "", "", "", "", q("Open question: " + (w.decision.note || "")), ""].join(","));
  download(`buy-review-${S.date}.csv`, lines.join("\r\n"), "text/csv");
}

/* ------------------------------------------------------------ the September worked example */
function workedExample() {
  const base = "2026-09:Network supply plan - Sep post", E = "email:Correspondence/Planning_inbox/";
  const rec = emptyRecord();
  const ed = (date, key, dv, reason, src, extra = {}) => rec.edits.push({ id: uid("e"), date, key, dv, qty: dv, unit: "CS", base, reason, src, ...extra });
  ed("2026-09-14", "R06|S014|2026-10", 90, "October mango feature, first estimate of 720 bottles. Harbor's sheet has regular service only, so this is extra.", "thread:october mango request", { qty: 720, unit: "EA" });
  ed("2026-09-17", "R06|S014|2026-10", -10, "Final shop list: 480 bottles in total; two shops dropped out. Brings the feature from 720 to 480 bottles.", "thread:october mango request", { qty: -60, unit: "EA" });
  for (const [sku, q] of [["S001", 24], ["S005", 18], ["S014", 12]]) {
    const g = uid("g"), why = "Second opening moved to Nov 9, so the opening kit ships Nov 2 instead of Oct 5. Same quantities.";
    ed("2026-09-16", `R04|${sku}|2026-10`, -q, why, "thread:second opening / new dock week", { group: g });
    ed("2026-09-16", `R04|${sku}|2026-11`, q, why, "thread:second opening / new dock week", { group: g });
  }
  rec.decisions.push({ id: uid("d"), date: "2026-09-16", target: "cal:OP-FR-02", outcome: "no-change", note: "Kit move logged from the Front Range email." });
  rec.decisions.push({ id: uid("d"), date: "2026-09-17", target: "cal:GC-PROMO-01", outcome: "no-change", note: "Mango feature logged from Remy Ellis's emails." });
  rec.decisions.push({ id: uid("d"), date: "2026-09-18", target: "thread:cascadia menu test / field count", outcome: "waiting", note: "Winter menu trial (CA-TEST-03) has no site list or quantities yet. Keep the holiday assumptions." });
  return rec;
}

render();
