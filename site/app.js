/* Supply Desk page. One record, three views:
 *   Inbox    what arrived and what needs a decision; add sheets and emails here
 *   Plan     one month at a time; click a number to see its source, type to change it
 *   History  the log of everything that arrived or changed, trends, and version compare
 *   Ask      questions about the record (placeholder until the assistant is connected)
 * The time slider sets the desk's date. Anything you add or change is dated to it.
 * Reading and plan logic live in core.js; this file only draws and records. */
"use strict";
const D = window.DATA, C = window.Core;
const START = D.releases.filter(r => r.disposition === "Posted").map(r => r.logged).sort()[0];
const END = [D.cutoff, ...((D.synthetic || {}).submissions || []).map(x => x.received), ...((D.synthetic || {}).events || []).map(x => x.known_on), ...((D.synthetic || {}).emails || []).map(x => (x.raw.match(/^Date: .*?(\d{1,2}) (\w{3}) (\d{4})/m) || []).slice(1).join(" ")).map(t => t && new Date(t + " 12:00 UTC").toISOString().slice(0, 10))].filter(Boolean).sort().pop();
const ITEMS = Object.fromEntries(D.items.map(i => [i.sku, i]));
const REGIONS = Object.fromEntries(D.regions.map(r => [r.code, r]));
const CATS = [...new Set(D.items.map(i => i.category))];
const TABS = [["inbox", "Inbox"], ["review", "Review"], ["plan", "Plan"], ["release", "Release"], ["history", "History"], ["ask", "Ask"]];

/* ------------------------------------------------------------ storage */
const KEY = "supplydesk.v3.";
function load(k, d) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { alert("This browser would not save the desk record: " + e.message); } }
const emptyRecord = () => ({ inputs: [], edits: [], decisions: [], versions: [], changes: [] });
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let R = { ...emptyRecord(), ...load("record", {}) };
let desk = C.Desk(D, R);
function commit() { save("record", R); desk = C.Desk(D, R); render(); }

const S = {
  tab: load("tab", "inbox"), date: load("date", null), zoom: load("zoom", "month"),
  planMonth: null, sel: null, working: null, open: {}, hist: "log", histKind: "all",
  trend: { sku: "S014", region: "R06" }, diffA: null, diffB: null, sheetView: null, preview: null, publishing: false, pending: null, folder: null,
};
(() => {                                                  // demo links: ?tab=plan&date=2026-09-17&example=1
  const q = new URLSearchParams(location.search);
  if (q.get("tab")) S.tab = q.get("tab");
  if (q.get("date") >= START && q.get("date") <= END) { S.date = q.get("date"); save("date", S.date); }
  if (!S.date) S.date = desk.sheets.filter(s => s.cycle === "2026-09").map(s => s.date).sort()[0] || END;
  if (q.get("example") === "1" && !R.changes.length && !R.versions.length) { R = workedExample(); save("record", R); desk = C.Desk(D, R); }
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
const short = f => String(f || "").split("/").pop();
const who = x => x.kind === "email" ? x.mail.sender.replace(/<.*>/, "").replace(/"/g, "").trim() : x.kind === "calendar" ? "Event calendar" : x.kind === "sheet" ? (x.author || regName(x.region)) : "Central planning";
const nextMonth = d => { const [y, m] = d.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

/* ------------------------------------------------------------ the clock: one "Today" in the header */
const ALLDAYS = (() => { const a = []; for (let d = START; d <= END; d = addDays(d, 1)) a.push(d); return a; })();
const ARRIVALS = {};                                      // date -> inputs that arrived that day
function indexArrivals() { for (const k in ARRIVALS) delete ARRIVALS[k]; for (const x of desk.inputs) if (x.date >= START && x.date <= END) (ARRIVALS[x.date] = ARRIVALS[x.date] || []).push(x); }
function dayText(d) {
  const a = ARRIVALS[d] || []; if (!a.length) return "";
  const n = k => a.filter(x => x.kind === k).length, parts = [];
  const sh = a.filter(x => x.kind === "sheet"); if (sh.length) parts.push(sh.length === 1 ? `${regName(sh[0].region)} sheet` : `${sh.length} sheets`);
  const m = n("email") + n("calendar"); if (m) parts.push(`${m} message${m > 1 ? "s" : ""}`);
  return parts.join(", ");
}
const cycles = () => [...new Set(desk.sheets.map(s => s.cycle))].sort().filter(c => c >= "2026-09");
const cycleStart = c => desk.sheets.filter(s => s.cycle === c).map(s => s.date).sort()[0];
const isSynthetic = c => desk.sheets.some(s => s.cycle === c && s.synthetic);
function renderClock() {
  const days = [...new Set([...Object.keys(ARRIVALS), S.date])].filter(d => d >= "2026-08-15").sort();
  const cyc = desk.cycleAt(S.date);
  $("clock").innerHTML = `
    <div class="seg small">${cycles().map(c => `<button class="${cyc === c ? "on" : ""}" data-cycle="${c}">${MON[+c.slice(5) - 1]}${isSynthetic(c) ? " · synthetic" : ""}</button>`).join("")}</div>
    <button class="btn icon" id="prevDay" title="Previous arrival">◀</button>
    <select id="daySel" title="Today, for the desk">${days.map(d => `<option value="${d}" ${d === S.date ? "selected" : ""}>${dlong(d).replace(/, 2026$/, "")}${dayText(d) ? " · " + dayText(d) : ""}</option>`).join("")}</select>
    <button class="btn icon" id="nextDay" title="Next arrival">▶</button>`;
  $("prevDay").onclick = () => jump(-1);
  $("nextDay").onclick = () => jump(1);
  $("daySel").onchange = e => setDate(e.target.value);
  document.querySelectorAll("[data-cycle]").forEach(b => b.onclick = () => setDate(cycleStart(b.dataset.cycle)));
}
function setDate(d) { S.date = d; save("date", d); renderClock(); renderPage(); }
function jump(dir) {
  const ds = Object.keys(ARRIVALS).sort();
  const t = dir < 0 ? ds.filter(d => d < S.date).pop() : ds.find(d => d > S.date);
  if (t) setDate(t);
}

/* ------------------------------------------------------------ shell */
const ROLE = new URLSearchParams(location.search).get("role") === "manager" ? "manager" : "planner";
function render() { indexArrivals(); if (ROLE === "manager") return renderManager(); renderClock(); renderPage(); }
window.addEventListener("storage", e => {                  // another tab (the manager page) changed the record
  if (e.key === KEY + "record") { R = { ...emptyRecord(), ...load("record", {}) }; desk = C.Desk(D, R); render(); }
  if (e.key === KEY + "date" && ROLE === "manager") { S.date = load("date", S.date); render(); }
});
function renderPage() {
  save("tab", S.tab);
  $("tabs").innerHTML = TABS.map(([id, n]) => {
    const c = id === "inbox" || id === "review" ? countNeeds(id) : 0;
    return `<button class="tab ${S.tab === id ? "on" : ""}" data-tab="${id}">${n}${c ? ` <span class="count">${c}</span>` : ""}</button>`;
  }).join("");
  const p = desk.planAt(S.date);
  const ne = p ? desk.editsAt(S.date).length : 0;
  $("meta").innerHTML = p ? `<span class="overline">Current plan</span> <b>${esc(p.base.name)}</b>${ne ? ` <span class="pill you">+${ne}</span>` : ""}` : "No plan yet";
  (PAGES[S.tab] || pageInbox)();
}
const PAGES = { inbox: pageInbox, review: pageReview, plan: pagePlan, release: pageRelease, history: pageHistory, ask: pageAsk };
function countNeeds(id) {
  if (id === "review") return desk.review(S.date).lines.filter(l => !l.settled).length;
  const pub = R.versions.filter(v => v.date <= S.date).map(v => v.date).sort().pop(), base = desk.baseAt(S.date), since = pub || (base ? base.date : "");
  return desk.needs(S.date).inputs.filter(t => isPlanThread(t.thread) && t.thread.items[t.thread.items.length - 1].date > since).length;
}
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
const isPlanThread = th => th.kind === "calendar" || th.items.some(x => x.kind === "email" && !/Buyer_and_dock\//.test(x.src || ""));
function pageInbox() {
  const n = desk.needs(S.date), cyc = desk.cycleAt(S.date);
  const review = {}; for (const l of desk.review(S.date).lines) if (!l.settled) review[l.region] = (review[l.region] || 0) + 1;
  const tiles = cyc ? D.regions.map(r => {
    const s = desk.latestSheet(S.date, r.code, cyc);
    if (!s) return `<div class="tile wait" data-region="${r.code}"><b>${esc(r.name)}</b><span>not yet received</span></div>`;
    const st = s.problems.length ? `<span class="bad">${s.problems.length} problem${s.problems.length > 1 ? "s" : ""}</span>` : s.replaces ? `<span>corrected</span>` : `<span class="ok">✓</span>`;
    return `<button class="tile ${S.sheetView === s.id ? "on" : ""}" data-sheet="${esc(s.id)}" data-region="${r.code}"><b>${esc(r.name)}</b><span>received ${dlabel(s.date)}</span>${st}${review[r.code] ? `<a class="rv" data-tab="review">${review[r.code]} to review</a>` : ""}</button>`;
  }).join("") : "";
  const pub = R.versions.filter(v => v.date <= S.date).map(v => v.date).sort().pop(), base = desk.baseAt(S.date), since = pub || (base ? base.date : "");
  const lastDate = t => t.thread.items[t.thread.items.length - 1].date;
  const planAll = n.inputs.filter(t => isPlanThread(t.thread)), other = n.inputs.filter(t => !isPlanThread(t.thread));
  const plan = planAll.filter(t => lastDate(t) > since), older = planAll.filter(t => lastDate(t) <= since);
  const row = (t, waiting) => {
    const th = t.thread, id = th.id, open = S.open[id], last = th.items[th.items.length - 1];
    return `<div class="mrow ${open ? "open" : ""} ${t.reopened ? "new" : ""}">
      <div class="mhead" data-toggle="${esc(id)}"><span class="pill ${th.kind}">${th.kind === "email" ? "Email" : "Calendar"}</span><b>${esc(th.title)}</b>${th.region ? `<span class="reg">${esc(regName(th.region))}</span>` : ""}${th.items.length > 1 ? `<span class="hint">${th.items.length}</span>` : ""}<span class="hint">${dlabel(last.date)}</span>${waiting ? `<span class="pill Scenario" title="${esc(t.decision.note || "")}">waiting</span>` : ""}</div>
      ${open ? `<div class="mbody">${th.items.map((x, i) => msgHtml(x, i === th.items.length - 1 || S.open[id + ":all"])).join("")}
        <div class="acts"><button class="btn small primary" data-work="${esc(id)}">Log a change</button><button class="btn small" data-decide="${esc(id)}|no-change">No change</button>${waiting ? "" : `<button class="btn small" data-decide="${esc(id)}|waiting">Waiting on…</button>`}</div>
        ${S.pending && S.pending.target === id ? `<form class="inline" id="decForm"><input type="text" id="decNote" placeholder="${S.pending.outcome === "waiting" ? "Waiting on whom?" : "Why? (optional)"}" autofocus><button class="btn small primary">Save</button><button type="button" class="btn small" id="decCancel">Cancel</button></form>` : ""}</div>` : ""}
    </div>`;
  };
  $("page").innerHTML = `
    <div class="cols">
      <div>
        ${cyc ? `<h2 class="first">${mlong(cyc)} sheets ${isSynthetic(cyc) ? `<span class="pill Scenario">synthetic</span>` : ""}</h2><div class="tiles">${tiles}</div>` : ""}
        ${S.sheetView ? sheetViewHtml(S.sheetView) : ""}
        <h2>Messages ${plan.length ? `<span class="count">${plan.length}</span>` : ""}</h2>
        <div class="mlist">${plan.map(t => row(t, false)).join("") || `<div class="empty">Nothing new.</div>`}</div>
        ${n.waiting.length ? `<h2>Waiting <span class="count grey">${n.waiting.length}</span></h2><div class="mlist">${n.waiting.map(t => row(t, true)).join("")}</div>` : ""}
        ${older.length ? `<h2 class="toggle" data-toggle="older">${S.open.older ? "▾" : "▸"} Before the current plan <span class="count grey">${older.length}</span></h2>${S.open.older ? `<div class="mlist">${older.map(t => row(t, false)).join("")}</div>` : ""}` : ""}
        ${other.length ? `<h2 class="toggle" data-toggle="other">${S.open.other ? "▾" : "▸"} Dock and orders <span class="count grey">${other.length}</span></h2>${S.open.other ? `<div class="mlist">${other.map(t => row(t, false)).join("")}</div>` : ""}` : ""}
      </div>
      <div>${addBoxHtml()}</div>
    </div>`;
  bindInbox();
  document.querySelectorAll(".tile[data-region], .tile[data-sheet]").forEach(t => {
    t.ondragover = e => { e.preventDefault(); e.stopPropagation(); t.classList.add("drop"); };
    t.ondragleave = () => t.classList.remove("drop");
    t.ondrop = async e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (!f) return; const p = await readInput(f.name, f); if (p.kind === "sheet") { p.region = t.dataset.region; resolvePreview(p); } S.preview = p; renderPage(); };
  });
}
function msgHtml(x, full) {
  if (x.kind === "calendar") return `<div class="msg"><div class="hint">${dlabel(x.date)} · ${esc(x.event.status)} · event date ${esc(x.event.event_date || "")}</div><div>${esc(x.event.detail)}</div></div>`;
  const b = x.mail.body;
  return `<div class="msg"><div class="hint">${dlabel(x.date)} ${x.time || ""} · ${esc(who(x))}${x.mail.attachments.length ? " · 📎 " + esc(x.mail.attachments.join(", ")) : ""}</div><pre>${esc(full ? b : b.split(/\n/)[0].slice(0, 140) + "…")}</pre></div>`;
}
function bindInbox() {
  document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { S.open[b.dataset.toggle] = !S.open[b.dataset.toggle]; renderPage(); });
  document.querySelectorAll("[data-sheet]").forEach(b => b.onclick = () => { S.sheetView = S.sheetView === b.dataset.sheet ? null : b.dataset.sheet; renderPage(); });
  document.querySelectorAll("[data-work]").forEach(b => b.onclick = () => { S.working = b.dataset.work; S.tab = "plan"; const th = desk.threadsAt(S.date).find(t => t.id === S.working); if (th) { const m = guessMonth(th); if (m) S.planMonth = m; if (th.region) { const k = S.sel && S.sel.split("|"); if (!k || k[0] !== th.region) S.sel = null; } } renderPage(); });
  document.querySelectorAll("[data-decide]").forEach(b => b.onclick = () => { const [target, outcome] = b.dataset.decide.split("|"); S.pending = { target, outcome }; renderPage(); setTimeout(() => $("decNote") && $("decNote").focus()); });
  const df = $("decForm");
  if (df) {
    df.onsubmit = e => { e.preventDefault(); const note = $("decNote").value.trim(); R.decisions.push({ id: uid("d"), date: S.date, target: S.pending.target, outcome: S.pending.outcome, note });
      if (S.pending.outcome === "waiting") R.changes.push({ id: uid("c"), date: S.date, type: "hold", ref: S.pending.target, key: "", reason: note || threadTitle(S.pending.target), source: S.pending.target });
      S.pending = null; commit(); };
    $("decCancel").onclick = () => { S.pending = null; renderPage(); };
  }
  const line = (v, outcome) => { const i = v.indexOf("|"); return { sid: v.slice(0, i), key: v.slice(i + 1) }; };
  document.querySelectorAll("[data-useline]").forEach(b => b.onclick = () => { const { sid, key } = line(b.dataset.useline); useRequests(sid, [key]); });
  document.querySelectorAll("[data-keepline]").forEach(b => b.onclick = () => { const { sid, key } = line(b.dataset.keepline); keepPlan(sid, [key]); });
  document.querySelectorAll("[data-useall]").forEach(b => b.onclick = () => { const s = desk.needs(S.date).sheets.find(x => x.sheet.id === b.dataset.useall); useRequests(s.sheet.id, s.lines.map(l => l.key)); });
  document.querySelectorAll("[data-keepall]").forEach(b => b.onclick = () => { const s = desk.needs(S.date).sheets.find(x => x.sheet.id === b.dataset.keepall); keepPlan(s.sheet.id, s.lines.map(l => l.key)); });
  bindAddBox();
}
function threadTitle(id) { const t = desk.threadsAt(S.date).find(x => x.id === id); return t ? t.title : id; }
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

/* ------------------------------------------------------------ Review: only the lines that need the planner */
function reviewLines() { return desk.review(S.date); }
function decide(key, outcome, value) {
  const cyc = desk.cycleAt(S.date);
  R.decisions = R.decisions.filter(d => d.target !== `draft:${cyc}|${key}`);
  if (outcome) R.decisions.push({ id: uid("d"), date: S.date, target: `draft:${cyc}|${key}`, outcome, value });
  commit();
}
function pageReview() {
  const cyc = desk.cycleAt(S.date), rv = reviewLines(), L = rv.lines.filter(l => !l.settled), done = rv.lines.filter(l => l.settled);
  const got = cyc ? D.regions.filter(r => desk.latestSheet(S.date, r.code, cyc)).length : 0;
  const tile = (n, label, cls = "") => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
  const outcome = l => ({ request: "used ask", keep: "kept plan", set: `set ${fmt(l.value)}`, question: "open question" })[l.decision && l.decision.outcome] || "";
  const groups = []; const gi = {};
  for (const l of L) { const g = l.region + "|" + l.sku; if (!gi[g]) groups.push(gi[g] = { id: g, region: l.region, sku: l.sku, lines: [] }); gi[g].lines.push(l); }
  for (const g of groups) g.lines.sort((a, b) => a.month.localeCompare(b.month));
  const lineRow = (l, sub) => `<tr class="${sub ? "sub" : ""} ${l.settled ? "done" : ""}"><td>${sub ? "" : esc(regName(l.region))}</td><td>${sub ? "" : `<a data-goto="plan:${l.key}">${esc(itemName(l.sku))}</a>`}</td><td>${mlabel(l.month)}</td>
    <td class="n">${fmt(l.last)}</td><td class="n"><b>${fmt(l.ask)}</b></td><td class="n">${l.expected != null ? fmt(l.expected) : "—"}</td>
    <td class="why" title="${esc(l.detail || "")}">${esc(l.why)}</td>
    <td class="nowrap acts">${l.settled ? `<span class="hint">${esc(outcome(l))}</span> <button class="btn small link" data-dec="${l.key}|">Undo</button>`
      : S.setting === l.key ? `<form class="inline" data-setform="${l.key}"><input type="number" id="setVal" value="${l.expected ?? l.ask}" style="width:70px"><button class="btn small primary">Set</button></form>`
      : `<button class="btn small" data-dec="${l.key}|request">Use ask</button><button class="btn small" data-dec="${l.key}|keep">Keep plan</button><button class="btn small" data-set="${l.key}">Set…</button><button class="btn small" data-dec="${l.key}|question" title="Open question">?</button>`}</td></tr>`;
  const groupRow = g => {
    if (g.lines.length === 1) return lineRow(g.lines[0], false);
    const top = [...g.lines].sort((a, b) => Math.abs(b.ask - (b.expected ?? b.last)) - Math.abs(a.ask - (a.expected ?? a.last)))[0], open = S.open["g:" + g.id];
    const keys = g.lines.map(l => l.key).join(",");
    return `<tr class="grp"><td>${esc(regName(g.region))}</td><td><a data-goto="plan:${top.key}">${esc(itemName(g.sku))}</a></td><td><span class="toggle" data-toggle="g:${g.id}">${open ? "▾" : "▸"} ${g.lines.length} months</span></td>
      <td class="n">${fmt(top.last)}</td><td class="n"><b>${fmt(top.ask)}</b></td><td class="n">${top.expected != null ? fmt(top.expected) : "—"}</td><td class="why" title="${esc(top.detail || "")}">${mlabel(top.month)}: ${esc(top.why)}</td>
      <td class="nowrap acts"><button class="btn small" data-decall="${keys}|request">Use all asks</button><button class="btn small" data-decall="${keys}|keep">Keep plan</button></td></tr>${open ? g.lines.map(l => lineRow(l, true)).join("") : ""}`;
  };
  const head = `<tr><th>Region</th><th>Item</th><th>Month</th><th class="n">Last plan</th><th class="n">Asks</th><th class="n">Expected</th><th>Why</th><th></th></tr>`;
  $("page").innerHTML = `
    <div class="planhead"><h1>Review${cyc ? ` · ${mlong(cyc)}` : ""}</h1>${rv.synthetic ? `<span class="pill Scenario">synthetic</span>` : ""}<div class="spacer"></div>${L.length === 0 && rv.total ? `<button class="btn primary" data-tab="plan">Go to publish →</button>` : ""}</div>
    <div class="stats">${tile(`${got}/6`, "sheets in", got === 6 ? "ok" : "")}${rv.total != null ? tile(fmt(rv.total), "lines") + tile(fmt(rv.accepted), "as asked", "ok") : ""}${tile(groups.length, "items need you", groups.length ? "warn" : "ok")}${done.length ? tile(done.length, "settled") : ""}</div>
    ${L.length ? `<table class="plain review flags">${head}${groups.map(groupRow).join("")}</table>` : `<div class="empty">${cyc ? "All settled." : "No sheets yet."}</div>`}
    ${done.length ? `<h2 class="toggle" data-toggle="settled">${S.open.settled ? "▾" : "▸"} Settled <span class="count grey">${done.length}</span></h2>${S.open.settled ? `<table class="plain review">${head}${done.map(l => lineRow(l, false)).join("")}</table>` : ""}` : ""}`;
  document.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => { const [k, o] = b.dataset.dec.split(/\|(?=[a-z]*$)/); decide(k, o || null); });
  document.querySelectorAll("[data-decall]").forEach(b => b.onclick = () => { const [ks, o] = b.dataset.decall.split(/\|(?=[a-z]*$)/); const cyc = desk.cycleAt(S.date); for (const k of ks.split(",")) { R.decisions = R.decisions.filter(d => d.target !== `draft:${cyc}|${k}`); R.decisions.push({ id: uid("d"), date: S.date, target: `draft:${cyc}|${k}`, outcome: o }); } commit(); });
  document.querySelectorAll("[data-set]").forEach(b => b.onclick = () => { S.setting = b.dataset.set; renderPage(); setTimeout(() => { const i = $("setVal"); if (i) { i.focus(); i.select(); } }); });
  document.querySelectorAll("[data-setform]").forEach(f => f.onsubmit = e => { e.preventDefault(); const v = parseFloat($("setVal").value); S.setting = null; if (!isNaN(v)) decide(f.dataset.setform, "set", v); else renderPage(); });
  document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { S.open[b.dataset.toggle] = !S.open[b.dataset.toggle]; renderPage(); });
}

/* ------------------------------------------------------------ Release: what purchasing and finance read */
function releaseRows() { return desk.releaseList(S.date); }
function pageRelease() {
  const rl = releaseRows();
  if (!rl.base) { $("page").innerHTML = `<div class="empty">Nothing published yet.</div>`; return; }
  const rows = rl.rows, net = rows.reduce((t, x) => t + x.d, 0);
  const keyOf = x => `${D.regions.find(r => r.name === x.region).code}|${x.sku}|${x.month}`;
  $("page").innerHTML = `
    <div class="planhead"><h1>Release</h1><span class="hint">changes since ${esc(rl.base.name)} · ${dlabel(rl.base.date)}</span><div class="spacer"></div><button class="btn primary" id="exportBuy">Export for purchasing</button></div>
    <div class="stats"><div class="stat"><b>${rows.length}</b><span>lines changed</span></div><div class="stat"><b>${sign(Math.round(net))}</b><span>cases, net</span></div><div class="stat ${rl.holds.length ? "warn" : ""}"><b>${rl.holds.length}</b><span>open questions</span></div>${rl.scenarios.length ? `<div class="stat"><b>${rl.scenarios.length}</b><span>scenarios</span></div>` : ""}</div>
    ${rows.length ? `<table class="plain review"><tr><th>Region</th><th>Item</th><th>Month</th><th class="n">Released</th><th class="n">Proposed</th><th class="n">Change</th><th>Why</th><th>How</th></tr>
      ${rows.map(x => `<tr><td>${esc(x.region)}</td><td><a data-goto="plan:${keyOf(x)}">${esc(x.item)}</a></td><td>${mlabel(x.month)}</td><td class="n">${fmt(x.released)}</td><td class="n"><b>${fmt(x.proposed)}</b></td><td class="n ${x.d > 0 ? "up" : "down"}">${sign(x.d)}</td><td class="why" title="${esc(x.reason)}">${esc(x.reason)}</td><td class="hint">${esc(x.how)}</td></tr>`).join("")}</table>`
    : `<div class="empty">No changes since release.</div>`}
    ${rl.holds.length ? `<h2>Open questions</h2><div class="mlist">${rl.holds.map(h => `<div class="mrow"><div class="mhead"><span class="pill Scenario">open</span><b>${esc(h.text)}</b><span class="hint">${esc(h.ref && !/^thread:|^cal:/.test(h.ref) ? h.ref : "")} ${dlabel(h.date)}</span></div></div>`).join("")}</div>` : ""}
    ${rl.scenarios.length ? `<h2>Scenarios <span class="hint">not in the plan</span></h2><table class="plain review"><tr><th>Region</th><th>Item</th><th>Month</th><th class="n">Released</th><th class="n">Would be</th><th>Why</th></tr>${rl.scenarios.map(x => { const [r, sku, m] = x.key.split("|"); return `<tr><td>${esc(regName(r))}</td><td>${esc(itemName(sku))}</td><td>${mlabel(m)}</td><td class="n">${fmt(x.released)}</td><td class="n">${fmt(x.would)}</td><td class="why">${esc(x.reason)}</td></tr>`; }).join("")}</table>` : ""}`;
  $("exportBuy").onclick = exportBuyReview;
}
/* ------------------------------------------------------------ Add to the desk: paste, drop, folder */
function addBoxHtml() {
  const p = S.preview;
  return `<div class="addbox" id="addbox">
    <h2 class="first">Add</h2>
    <textarea id="pasteBox" placeholder="Paste a sheet or an email, or drop a file">${esc(S.pasteText || "")}</textarea>
    <div class="acts"><button class="btn primary" id="readPaste">Read it</button>
      <label class="btn">Choose file<input type="file" id="fileIn" accept=".xlsx,.xls,.csv,.eml,.txt" multiple hidden></label>
      <button class="btn" id="watch">${S.folder ? "Check folder now" : "Watch a folder"}</button></div>
    ${S.folder ? `<div class="hint">Watching “${esc(S.folder.name)}” · ${esc(S.folder.status || "")}</div>` : ""}
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
      <div class="acts"><button class="btn primary" id="pvAdd">Add</button><button class="btn" id="pvCancel">Cancel</button></div></div>`;
  }
  const m = p.mail;
  return `<div class="preview">
    <div class="overline">Read as a message</div>
    <div class="kv"><div>Subject</div><div><input type="text" id="pvSubject" value="${esc(m.subject)}"></div>
    <div>From</div><div>${esc(m.sender || "—")}${m.date ? ` · written ${dlabel(m.date)}` : ""}</div>
    <div>Region</div><div><select id="pvRegion"><option value="">Network or unknown</option>${D.regions.map(g => `<option value="${g.code}" ${g.code === p.region ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div></div>
    <pre>${esc(m.body.slice(0, 400))}${m.body.length > 400 ? "…" : ""}</pre>
    <div class="acts"><button class="btn primary" id="pvAdd">Add</button><button class="btn" id="pvCancel">Cancel</button></div></div>`;
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
function planView() {
  const cyc = desk.cycleAt(S.date), pub = cyc && R.versions.find(v => v.cycle === cyc && v.date <= S.date);
  if (cyc && !pub) { const dv = desk.draftVersion(S.date); if (dv) return { draft: dv, grid: dv.grid, months: dv.months, applied: {}, name: `${mlong(cyc)} draft`, flags: new Set(desk.review(S.date).lines.filter(l => !l.settled).map(l => l.key)) }; }
  const w = desk.working(S.date); if (!w.base) return null;
  return { grid: w.grid, months: w.months, applied: w.applied, name: w.base.name, base: w.base, flags: new Set() };
}
function pagePlan() {
  const pv = planView();
  if (!pv) { $("page").innerHTML = `<div class="empty">No plan yet.</div>`; return; }
  if (!pv.months.includes(S.planMonth)) { const nm = nextMonth(S.date.slice(0, 7)); S.planMonth = pv.months.includes(nm) ? nm : pv.months[0]; }
  const m = S.planMonth, regs = D.regions.map(r => r.code);
  let body = "", colTot = Object.fromEntries(regs.map(r => [r, 0])), net = 0, flagged = 0, changed = 0;
  for (const cat of CATS) {
    body += `<tr class="group"><td colspan="${regs.length + 2}">${esc(cat)}</td></tr>`;
    for (const it of D.items.filter(i => i.category === cat)) {
      let rowTot = 0;
      const cells = regs.map(r => {
        const key = `${r}|${it.sku}|${m}`, v = pv.grid[r + "|" + it.sku] && pv.grid[r + "|" + it.sku][m];
        if (v == null) return `<td class="cell na"></td>`;
        rowTot += v; colTot[r] += v;
        const bad = pv.flags.has(key), ch = !!pv.applied[key]; if (bad) flagged++; if (ch) changed++;
        return `<td class="${["cell", ch ? "changed" : "", bad ? "flag" : "", S.sel === key ? "sel" : ""].join(" ")}" data-key="${key}" tabindex="-1">${fmt(v)}</td>`;
      }).join("");
      net += rowTot;
      body += `<tr><td class="l">${esc(it.name)} <span class="sku">${it.sku}</span></td>${cells}<td class="tot"><a data-goto="trend:${it.sku}|">${fmt(rowTot)}</a></td></tr>`;
    }
  }
  body += `<tr class="total"><td class="l">Total cases</td>${regs.map(r => `<td>${fmt(colTot[r])}</td>`).join("")}<td>${fmt(net)}</td></tr>`;
  const th = S.working && desk.threadsAt(S.date).find(t => t.id === S.working);
  const ak = pv.base && pv.base.origin === "added" && desk.answerKey(pv.base.id);
  $("page").innerHTML = `
    <div class="planhead">
      <h1>${mlong(m)}</h1>
      <div class="seg">${pv.months.map(x => `<button class="${x === m ? "on" : ""}" data-month="${x}">${mlabel(x)}</button>`).join("")}</div>
      ${pv.draft ? `<span class="pill Scenario">draft · not published</span>` : `<span class="pill Published">${esc(pv.name)}</span>`}
      <div class="spacer"></div>
      ${pv.draft ? `<button class="btn primary" id="publish">Publish</button>` : ""}
    </div>
    ${S.publishing && pv.draft ? publishHtml(pv.draft) : ""}
    ${ak ? `<div class="answer" data-toggle="answer"><span class="overline">vs Dutch Bros' posted plan</span> <b>${esc(ak.headline)}</b> <span class="hint">${S.open.answer ? "▾" : "▸"}</span></div>${S.open.answer ? answerHtml(ak) : ""}` : ""}
    ${th ? `<div class="banner">Logging changes for <b>${esc(th.title)}</b> <button class="btn small" id="doneWork">Done</button></div>` : ""}
    <div class="legend">${changed ? `<span><i class="key changed"></i>${changed} changed</span>` : ""}${flagged ? `<span><i class="key flag"></i>${flagged} to review</span>` : ""}<span class="hint">cases · click a number</span></div>
    <div class="layout ${S.sel ? "" : "nodetail"}">
      <div class="gridwrap"><table class="grid" id="grid"><tr><th class="l">Item</th>${regs.map(r => `<th>${esc(REGIONS[r].name)}</th>`).join("")}<th>Network</th></tr>${body}</table></div>
      ${S.sel ? `<div class="detail" id="detail">${detailHtml(S.sel, pv)}</div>` : ""}
    </div>`;
  bindPlan(pv);
}
function answerHtml(ak) {
  return `<div class="answerbody"><div class="hint">${esc(ak.leanText)}</div>
    <table class="plain mini"><tr><th>Line</th><th class="n">Ours</th><th class="n">Posted</th><th>Why</th></tr>
    ${[...ak.known, ...ak.gaps.slice(0, 6)].map(g => { const [r, sku, m] = g.key.split("|"); return `<tr><td><a data-goto="plan:${g.key}">${esc(regName(r))} · ${esc(itemName(sku))} · ${mlabel(m)}</a></td><td class="n">${fmt(g.ours)}</td><td class="n">${fmt(g.posted)}</td><td>${esc(g.text || g.why || "")}</td></tr>`; }).join("")}</table></div>`;
}
function bindPlan(pv) {
  document.querySelectorAll("[data-month]").forEach(b => b.onclick = () => { S.planMonth = b.dataset.month; if (S.sel) S.sel = S.sel.split("|").slice(0, 2).join("|") + "|" + S.planMonth; renderPage(); });
  document.querySelectorAll("td.cell[data-key]").forEach(td => {
    td.onclick = () => { if (S.sel !== td.dataset.key) { S.sel = td.dataset.key; renderPage(); focusSel(); } };
    td.ondblclick = () => startCellEdit(td.dataset.key, "");
  });
  document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { S.open[b.dataset.toggle] = !S.open[b.dataset.toggle]; renderPage(); });
  const pb = $("publish"); if (pb) pb.onclick = () => { S.publishing = !S.publishing; renderPage(); };
  const dw = $("doneWork"); if (dw) dw.onclick = () => { S.working = null; renderPage(); };
  const x = $("closeDetail"); if (x) x.onclick = () => { S.sel = null; renderPage(); };
  if (S.publishing && pv.draft) bindPublish(pv.draft);
  if (S.sel) bindDetail(pv);
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
  const pv = planView(), [r, sku, m] = key.split("|"), cur = pv.grid[r + "|" + sku][m];
  td.innerHTML = `<input class="cellin" value="${initial == null ? cur : initial}">`;
  const inp = td.querySelector("input"); inp.focus(); if (initial == null) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = parseFloat(inp.value.replace(/,/g, ""));
    if (!ok || isNaN(v) || v === cur) { renderPage(); focusSel(); return; }
    S.sel = key;
    if (pv.draft) { decide(key, "set", v); return; }
    S.draft = { key, type: "set", qty: v, unit: "CS" };
    renderPage(); const rs = $("dReason"); if (rs) rs.focus();
  };
  inp.onkeydown = e => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); finish(true); } if (e.key === "Escape") finish(false); e.stopPropagation(); };
  inp.onblur = () => finish(true);
}
const TYPES = [["add", "Add"], ["set", "Set total"], ["move", "Move"], ["scenario", "Scenario"]];
function detailHtml(key, pv) {
  const [r, sku, m] = key.split("|"), it = ITEMS[sku], li = desk.lineInfo(S.date, key);
  const v = pv.grid[r + "|" + sku] && pv.grid[r + "|" + sku][m];
  if (v == null) return `<div class="hint">No line for this item in ${esc(regName(r))}.</div>`;
  const req = desk.requestAt(S.date, key), dl = li.draft;
  const dr = S.draft && S.draft.key === key ? S.draft : { key, type: "add", qty: "", unit: "CS" };
  const live = R.changes.filter(c => c.key === key || (c.type === "move" && `${c.key.split("|")[0]}|${c.key.split("|")[1]}|${c.to}` === key));
  return `<div class="dhead"><div class="overline">${esc(regName(r))} · ${mlong(m)}</div><button class="btn small" id="closeDetail">✕</button></div>
    <h3>${esc(it.name)}</h3>
    <div class="bignum">${fmt(v)} <small>cases</small>${pv.draft ? ` <span class="pill Scenario">draft</span>` : ""}</div>
    <div class="hint">${esc(it.case_pack)} · lead ${it.lead_days} d</div>
    ${pv.draft ? "" : `<form class="dform" id="dForm">
      <div class="seg small">${TYPES.map(([t, n]) => `<button type="button" class="${dr.type === t ? "on" : ""}" data-type="${t}">${n}</button>`).join("")}</div>
      <div class="row"><input type="number" step="any" id="dQty" value="${dr.qty}" placeholder="${dr.type === "set" ? "total" : dr.type === "move" ? "cases" : "+ or −"}">
        ${dr.type === "move" ? `<span>to</span><select id="dTo">${pv.months.filter(x => x !== m).map(x => `<option value="${x}" ${dr.to === x ? "selected" : ""}>${mlabel(x)}</option>`).join("")}</select>`
        : `<select id="dUnit"><option value="CS" ${dr.unit === "CS" ? "selected" : ""}>cases</option><option value="EA" ${dr.unit === "EA" ? "selected" : ""}>${esc(it.ea_unit)}s</option></select>`}</div>
      <div class="hint" id="dCalc"></div>
      <input type="text" id="dReason" placeholder="Why (purchasing reads this)" value="${esc(dr.reason || "")}">
      <button class="btn primary small">Save</button>${S.draft ? ` <button type="button" class="btn small" id="dCancel">Cancel</button>` : ""}
    </form>`}
    ${li.changes.length ? `<h4>Changes</h4>${li.changes.map(c => `<div class="edit"><div><b>${esc(c.text)}</b> · ${dlabel(c.date)} ${R.changes.some(x => x.id === c.id) ? `<button class="btn small link" data-undo="${c.id}">Undo</button>` : ""}</div><div>${esc(c.reason)}</div>${c.source ? `<div class="src">${esc(srcName(c.source))}</div>` : ""}${c.quote ? `<div class="quote">“${esc(c.quote)}”</div>` : ""}</div>`).join("")}` : ""}
    <h4>Asked</h4>
    ${req ? `<div><b>${fmt(req.cell.cs)}</b> cases ${req.cell.unit !== "CS" && req.cell.orig != null ? `<span class="hint">= ${fmt(req.cell.orig)} ${esc(req.cell.unit)}</span>` : ""}</div><div class="src">${esc(short(req.sheet.src))} · row ${req.cell.row}${req.cell.note ? " · " + esc(req.cell.note) : ""}</div>` : `<div class="hint">No sheet yet</div>`}
    <h4>Checks</h4>
    ${li.checks.map(c => `<div class="check ${c.ok ? "ok" : "bad"}" title="${esc(c.detail || "")}">${c.ok ? "✓" : "!"} ${esc(c.label || c.name)}</div>`).join("") || `<div class="hint">—</div>`}
    <h4>Every version</h4>
    <table class="plain mini">${li.versions.map(x => `<tr><td>${dlabel(x.date)}</td><td>${esc(x.name)}</td><td class="n">${fmt(x.value)}</td></tr>`).join("")}</table>
    <div style="margin-top:8px"><button class="btn small link" data-goto="trend:${sku}|${r}">Trend →</button></div>`;
}
function srcName(id) {
  const x = desk.byId[id]; if (x) return x.kind === "sheet" ? `${regName(x.region)} sheet, ${dlabel(x.date)}` : x.mail ? x.mail.subject : id;
  const th = desk.threadsAt(END).find(t => t.id === id); return th ? th.title : id;
}
function bindDetail(pv) {
  const key = S.sel, [r, sku, m] = key.split("|"), it = ITEMS[sku], f = $("dForm");
  document.querySelectorAll("[data-undo]").forEach(b => b.onclick = () => { const c = R.changes.find(x => x.id === b.dataset.undo); if (c) c.removed_on = S.date; commit(); });
  if (!f) return;
  const cur = pv.grid[r + "|" + sku][m];
  S.draft = S.draft && S.draft.key === key ? S.draft : null;
  const state = () => ({ key, type: f.querySelector(".seg .on").dataset.type, qty: $("dQty").value, unit: $("dUnit") ? $("dUnit").value : "CS", to: $("dTo") ? $("dTo").value : null, reason: $("dReason").value });
  const calc = () => {
    const s = state(), q = parseFloat(s.qty);
    if (isNaN(q)) { $("dCalc").textContent = ""; return; }
    const cs = s.unit === "EA" ? q / it.ea_per_case : q, conv = s.unit === "EA" ? `${fmt(q)} ÷ ${it.ea_per_case} = ${fmt(cs)} CS · ` : "";
    $("dCalc").textContent = s.type === "add" ? `${conv}${fmt(cur)} → ${fmt(cur + cs)}` : s.type === "set" ? `${conv}set to ${fmt(cs)}` : s.type === "move" ? `${mlabel(m)} ${fmt(cur)} → ${fmt(cur - cs)}` : `${conv}scenario: would be ${fmt(cur + cs)}`;
  };
  f.oninput = calc; calc();
  f.querySelectorAll("[data-type]").forEach(b => b.onclick = () => { S.draft = { ...state(), type: b.dataset.type }; renderPage(); });
  const dc = $("dCancel"); if (dc) dc.onclick = () => { S.draft = null; renderPage(); focusSel(); };
  f.onsubmit = e => {
    e.preventDefault();
    const s = state(), q = parseFloat(s.qty);
    if (isNaN(q)) return $("dQty").focus();
    if (!s.reason.trim()) { $("dReason").focus(); $("dReason").classList.add("need"); return; }
    const th = S.working && desk.threadsAt(S.date).find(t => t.id === S.working);
    R.changes.push({ id: uid("c"), date: S.date, type: s.type, ref: S.working || `manual:${key}`, key, qty: q, unit: s.type === "move" ? "CS" : s.unit, to: s.to, reason: s.reason.trim(), source: S.working || null, quote: "" });
    S.draft = null; commit(); focusSel();
  };
}
function publishHtml(dv) {
  return `<form class="publish" id="pubForm"><b>Publish ${mlong(dv.cycle)}</b> <span class="${dv.preflight.unsettled || dv.preflight.missing.length ? "warn-text" : "ok-text"}">${esc(dv.preflightText)}</span>
    <div class="row"><input type="text" id="pubName" value="${esc(dv.name)}"><input type="text" id="pubNote" class="grow" placeholder="Note for purchasing and finance"><button class="btn primary">Publish</button><button type="button" class="btn" id="pubCancel">Cancel</button></div></form>`;
}
function bindPublish(dv) {
  $("pubCancel").onclick = () => { S.publishing = false; renderPage(); };
  $("pubForm").onsubmit = e => {
    e.preventDefault();
    R.versions.push({ ...dv, id: uid("v"), name: $("pubName").value.trim() || dv.name, note: $("pubNote").value.trim() });
    S.publishing = false; S.open.answer = true; commit();
  };
}
/* ------------------------------------------------------------ History */
function pageHistory() {
  $("page").innerHTML = `
    <div class="planhead"><h1>History</h1>
      <div class="seg">${[["log", "What happened"], ["trend", "Trends"], ["compare", "Compare versions"]].map(([k, n]) => `<button class="${S.hist === k ? "on" : ""}" data-hist="${k}">${n}</button>`).join("")}</div>
      <div class="spacer"></div>
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
  for (const c of R.changes.filter(c => c.date <= T)) {
    const [r, sku, m] = (c.key || "||").split("|");
    const what = c.type === "hold" ? `held an open question: ${esc(c.reason)}` : `${{ add: "added", set: "set", move: "moved", scenario: "ran a scenario on" }[c.type]} ${esc(regName(r))} · ${esc(itemName(sku))} · ${mlabel(m)}${c.type === "move" ? " → " + mlabel(c.to) : ""}: ${fmt(c.qty)} ${c.unit === "EA" ? esc(ITEMS[sku].ea_unit) + "s" : "CS"}`;
    out.push({ date: c.date, kind: "you", text: `You ${what}.${c.source ? ` From: ${esc(srcName(c.source))}.` : ""}${c.key ? ` <a data-goto="plan:${c.key}">Open</a>` : ""}`, why: c.type === "hold" ? "" : c.reason });
    if (c.removed_on && c.removed_on <= T) out.push({ date: c.removed_on, kind: "you", text: `You undid a ${dlabel(c.date)} change (${esc(c.reason)}).` });
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

/* ------------------------------------------------------------ Manager page: a regional manager sends a sheet or a late request */
function renderManager() {
  document.body.classList.add("manager");
  S.mgr = S.mgr || load("mgr", "R06");
  $("tabs").innerHTML = `<span class="tab on">Regional manager</span>`;
  $("clock").innerHTML = `<span class="hint">${dlong(S.date)}</span>`;
  $("meta").innerHTML = `<select id="mgrRegion">${D.regions.map(r => `<option value="${r.code}" ${r.code === S.mgr ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>`;
  const reg = S.mgr, mine = desk.inputs.filter(x => x.region === reg && x.date <= S.date && (x.kind === "sheet" || x.from === "manager")).slice(-6).reverse();
  const p = S.preview;
  $("page").innerHTML = `<div class="mgr">
    <div class="drop" id="mgrDrop">${p ? mgrPreview(p) : `<b>Drop your request sheet here</b><span class="hint">the same Excel file you always send · or</span><label class="btn">Choose file<input type="file" id="mgrFile" accept=".xlsx,.xls,.csv" hidden></label>`}</div>
    <h2>Late request</h2>
    <form class="mgrreq" id="mgrReq">
      <select id="rqItem">${D.items.map(i => `<option value="${i.sku}">${esc(i.name)}</option>`).join("")}</select>
      <select id="rqMonth">${(desk.planAt(S.date) || { months: [] }).months.map(m => `<option value="${m}">${mlabel(m)}</option>`).join("")}</select>
      <select id="rqType"><option value="add">Add</option><option value="set">Make it a total of</option></select>
      <input type="number" id="rqQty" placeholder="qty" style="width:80px"><select id="rqUnit"><option value="CS">cases</option><option value="EA">bottles / bags</option></select>
      <input type="text" id="rqWhy" class="grow" placeholder="Why (e.g. promo at 4 shops)"><button class="btn primary">Send</button>
    </form>
    <h2>Sent from ${esc(regName(reg))}</h2>
    <div class="mlist">${mine.map(x => `<div class="mrow"><div class="mhead"><span class="pill ${x.kind === "sheet" ? "sheet" : "email"}">${x.kind === "sheet" ? "Sheet" : "Request"}</span><b>${esc(x.kind === "sheet" ? `${mlong(x.cycle)} sheet${x.replaces ? " · correction" : ""}` : x.mail.subject)}</b><span class="hint">${esc(x.note || "")}</span><span class="hint">${dlabel(x.date)}</span></div></div>`).join("") || `<div class="empty">Nothing yet.</div>`}</div>
  </div>`;
  $("mgrRegion").onchange = e => { S.mgr = e.target.value; save("mgr", S.mgr); S.preview = null; render(); };
  const dz = $("mgrDrop");
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("on"); };
  dz.ondragleave = () => dz.classList.remove("on");
  const take = async f => { const pv = await readInput(f.name, f); if (pv.kind === "sheet") { pv.region = reg; resolvePreview(pv); } S.preview = pv; render(); };
  dz.ondrop = e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) take(f); };
  const fi = $("mgrFile"); if (fi) fi.onchange = e => { if (e.target.files[0]) take(e.target.files[0]); };
  const c = $("pvCancel"); if (c) c.onclick = () => { S.preview = null; render(); };
  const ad = $("pvAdd"); if (ad) ad.onclick = () => { const id = addPreview(S.preview); const x = R.inputs.find(i => i.id === id); x.from = "manager"; x.note = ($("pvNote") || {}).value || ""; S.preview = null; commit(); };
  $("mgrReq").onsubmit = e => {
    e.preventDefault();
    const sku = $("rqItem").value, m = $("rqMonth").value, q = $("rqQty").value, unit = $("rqUnit").value, type = $("rqType").value, why = $("rqWhy").value.trim();
    if (!q) return $("rqQty").focus();
    const what = `${type === "set" ? "Make it a total of" : "Add"} ${q} ${unit === "EA" ? ITEMS[sku].ea_unit.toLowerCase() + "s" : "cases"} of ${itemName(sku)} for ${mlong(m)}`;
    R.inputs.push({ id: uid("in"), date: S.date, time: new Date().toTimeString().slice(0, 5), src: "manager page", kind: "email", from: "manager", region: reg,
      request: { sku, month: m, type, qty: +q, unit }, mail: { date: S.date, time: "", sender: `${REGIONS[reg].manager || regName(reg)} | ${regName(reg)}`, to: "Central planning", subject: `${regName(reg)} request: ${itemName(sku)} ${mlabel(m)}`, body: `${what}.\n${why}`, attachments: [] } });
    commit();
  };
}
function mgrPreview(p) {
  if (p.error) return `<div class="preview bad"><b>Could not read ${esc(p.name)}</b><div>${esc(p.error)}</div><div class="acts"><button class="btn small" id="pvCancel">Try another file</button></div></div>`;
  if (p.kind !== "sheet") return `<div class="preview bad"><b>That isn't a request sheet.</b><div class="acts"><button class="btn small" id="pvCancel">Try another file</button></div></div>`;
  const r = p.res, prev = desk.latestSheet(S.date, p.region, p.cycle);
  let changed = 0; if (prev) for (const [k, c] of Object.entries(r.cells)) if (!prev.cells[k] || prev.cells[k].cs !== c.cs) changed++;
  const conv = Object.values(r.cells).filter(c => c.unit !== "CS" && c.orig != null).slice(0, 3);
  return `<div class="preview">
    <div class="overline">${esc(regName(p.region))} · ${mlong(p.cycle)} sheet${prev ? " · replaces your " + dlabel(prev.date) + " sheet" : ""}</div>
    <div class="stats"><div class="stat ok"><b>${r.counts.cells}</b><span>lines read</span></div><div class="stat"><b>${r.counts.ea}</b><span>converted to cases</span></div><div class="stat ${r.problems.length ? "warn" : "ok"}"><b>${r.problems.length}</b><span>problems</span></div>${prev ? `<div class="stat"><b>${changed}</b><span>lines changed</span></div>` : ""}</div>
    ${conv.length ? `<div class="hint">${conv.map(c => `${esc(itemName(c.sku))} ${mlabel(c.month)}: ${fmt(c.orig)} ${esc(c.unit)} = ${fmt(c.cs)} cases`).join(" · ")}</div>` : ""}
    ${r.problems.length ? `<div class="problems">${r.problems.slice(0, 6).map(esc).join("<br>")}</div>` : ""}
    ${prev ? `<input type="text" id="pvNote" placeholder="What changed? (the planner sees this)" style="width:100%;margin-top:6px">` : ""}
    <div class="acts"><button class="btn primary" id="pvAdd">Send to central planning</button><button class="btn" id="pvCancel">Cancel</button></div></div>`;
}

/* ------------------------------------------------------------ outputs */
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportBuyReview() { download(`buy-review-${S.date}.csv`, desk.releaseList(S.date).csv, "text/csv"); }
/* ------------------------------------------------------------ the September worked example */
function workedExample() {
  const rec = emptyRecord(), d0 = C.Desk(D, rec), dv = d0.draftVersion("2026-09-11");
  rec.versions.push({ ...dv, id: uid("v"), name: "September plan", note: "" });
  const ch = (date, type, ref, key, qty, unit, reason, source, extra = {}) => rec.changes.push({ id: uid("c"), date, type, ref, key, qty, unit, reason, source, quote: "", ...extra });
  const mango = "thread:october mango request", kit = "thread:second opening / new dock week";
  ch("2026-09-14", "add", "GC-PROMO-01", "R06|S014|2026-10", 720, "EA", "Oct mango promo", mango);
  ch("2026-09-15", "scenario", "Finance copy", "R05|S022|2026-11", 30, "CS", "Finance cup buffer", null);
  for (const [sku, q] of [["S001", 24], ["S005", 18], ["S014", 12]]) ch("2026-09-16", "move", "OP-FR-02", `R04|${sku}|2026-10`, q, "CS", "Opening kit moved to Nov 2", kit, { to: "2026-11" });
  ch("2026-09-17", "set", "GC-PROMO-01", "R06|S014|2026-10", 480, "EA", "Promo cut to 480 bottles", mango);
  ch("2026-09-18", "hold", "CA-TEST-03", "", null, "CS", "Winter trial: no sites or quantities yet", "thread:cascadia menu test / field count");
  for (const [date, target] of [["2026-09-16", "cal:OP-FR-02"], ["2026-09-16", kit], ["2026-09-17", "cal:GC-PROMO-01"], ["2026-09-17", mango]]) rec.decisions.push({ id: uid("d"), date, target, outcome: "no-change", note: "Logged as a change" });
  rec.decisions.push({ id: uid("d"), date: "2026-09-18", target: "thread:cascadia menu test / field count", outcome: "waiting", note: "Winter trial: no sites or quantities yet" });
  const done = new Set(rec.decisions.map(d => d.target));
  for (const t of C.Desk(D, rec).threadsAt("2026-09-18")) if (!done.has(t.id)) rec.decisions.push({ id: uid("d"), date: "2026-09-18", target: t.id, outcome: "no-change", note: "Handled in September" });
  return rec;
}
render();
