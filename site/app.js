/* Supply Desk page. One record, one guided path.
 * Head manager (default): 1 Sheets in → 2 Check → 3 Publish → 4 Late news → 5 Send to purchasing.
 * History and Ask sit to the side. ?role=manager is the submanager page: region → sheet → late request → done.
 * The day control sets the desk's date. Anything added or changed is dated to it.
 * Reading and plan logic live in core.js; this file only draws and records. */
"use strict";
const D = window.DATA, C = window.Core;
const START = D.releases.filter(r => r.disposition === "Posted").map(r => r.logged).sort()[0];
const END = [D.cutoff, ...((D.synthetic || {}).submissions || []).map(x => x.received), ...((D.synthetic || {}).events || []).map(x => x.known_on), ...((D.synthetic || {}).emails || []).map(x => (x.raw.match(/^Date: .*?(\d{1,2}) (\w{3}) (\d{4})/m) || []).slice(1).join(" ")).map(t => t && new Date(t + " 12:00 UTC").toISOString().slice(0, 10))].filter(Boolean).sort().pop();
const ITEMS = Object.fromEntries(D.items.map(i => [i.sku, i]));
const REGIONS = Object.fromEntries(D.regions.map(r => [r.code, r]));
const CATS = [...new Set(D.items.map(i => i.category))];
const STEPS = [["sheets", "Sheets in"], ["check", "Check"], ["publish", "Publish"], ["news", "Late news"], ["send", "Send to purchasing"]];
const SIDE = [["history", "History"], ["ask", "Ask"]];

/* ------------------------------------------------------------ storage */
const KEY = "supplydesk.v3.";
function load(k, d) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { alert("This browser would not save the desk record: " + e.message); } }
const emptyRecord = () => ({ inputs: [], edits: [], decisions: [], versions: [], changes: [], reportEdits: [], removed: [], orders: [] });
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let R = { ...emptyRecord(), ...load("record", {}) };
let desk = C.Desk(D, R);
function commit() { save("record", R); desk = C.Desk(D, R); render(); }

const ROLE = new URLSearchParams(location.search).get("role") === "manager" ? "manager" : "planner";
const S = {
  tab: load("tab", "sheets"), date: load("date", null), region: null, checkRegion: null, from: "sheets",
  planMonth: null, sel: null, open: {}, hist: "log", histKind: "all",
  trend: { sku: "S014", region: "R06" }, diffA: null, diffB: null, preview: null, pending: null, folder: null,
  mstep: load("mstep", "region"), mgr: load("mgr", null),
};
if (![...STEPS, ...SIDE].some(([id]) => id === S.tab)) S.tab = "sheets";
(() => {                                                  // demo links: ?tab=check&date=2026-10-09&example=1
  const q = new URLSearchParams(location.search);
  if (q.get("tab")) S.tab = q.get("tab");
  if (q.get("date") >= START && q.get("date") <= END) { S.date = q.get("date"); save("date", S.date); }
  if (!S.date) S.date = desk.sheets.filter(s => s.cycle === "2026-09").map(s => s.date).sort()[0] || END;
  if (q.get("example") === "1" && !R.changes.length && !R.versions.length) {
    R = workedExample(); save("record", R); desk = C.Desk(D, R);
    S.date = desk.sheets.filter(s => s.cycle === "2026-10").map(s => s.date).sort()[0] || S.date; save("date", S.date); S.tab = "sheets";
  }
})();

/* ------------------------------------------------------------ helpers */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = id => document.getElementById(id);
const fmt = desk.fmt, sign = desk.sign;
const MON = C.MON;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const mlabel = m => MON[+m.slice(5) - 1] + (m.slice(0, 4) !== "2026" ? " ’" + m.slice(2, 4) : "");
const mlong = m => MONTHS[+m.slice(5) - 1] + " " + m.slice(0, 4);
const mname = m => MONTHS[+m.slice(5) - 1];
const dlabel = d => d ? MON[+d.slice(5, 7) - 1] + " " + (+d.slice(8)) : "";
const dlong = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const itemName = sku => ITEMS[sku] ? ITEMS[sku].name : sku;
const regName = r => REGIONS[r] ? REGIONS[r].name : (r || "Network");
const short = f => String(f || "").split("/").pop();
const units = sku => ((ITEMS[sku] || {}).ea_unit || "unit").toLowerCase() + "s";
const unitWord = (sku, u) => u === "EA" ? units(sku) : "cases";
const plural = (n, w, ws = w + "s") => `${fmt(n)} ${n === 1 ? w : ws}`;
const who = x => x.kind === "email" ? x.mail.sender.replace(/<.*>/, "").replace(/"/g, "").trim() : x.kind === "calendar" ? "Event calendar" : x.kind === "sheet" ? (x.author || regName(x.region)) : "Central planning";
const nextMonth = d => { const [y, m] = d.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

/* ------------------------------------------------------------ the day control: "Day: Fri, Oct 9 · Next day ▶" */
const ARRIVALS = {};                                      // date -> inputs that arrived that day
function indexArrivals() {
  for (const k in ARRIVALS) delete ARRIVALS[k];
  for (const x of desk.inputs) if (x.date >= START && x.date <= END) (ARRIVALS[x.date] = ARRIVALS[x.date] || []).push(x);
  for (const it of desk.purchaseNews(END)) if ((it.kind === "short" || it.kind === "request") && it.date >= START) (ARRIVALS[it.date] = ARRIVALS[it.date] || []).push({ kind: "purchase", id: it.id });
}
function dayText(d) {
  const a = ARRIVALS[d] || []; if (!a.length) return "";
  const parts = [], sh = a.filter(x => x.kind === "sheet"), m = a.filter(x => x.kind === "email" || x.kind === "calendar").length;
  if (sh.length) parts.push(sh.length === 1 ? `${regName(sh[0].region)} sheet` : `${sh.length} sheets`);
  if (m) parts.push(plural(m, "message"));
  const p = a.filter(x => x.kind === "purchase").length;
  if (p) parts.push(`${p} from purchasing`);
  return parts.join(", ") + " arrived today";
}
const arrivalDays = () => [...new Set([...Object.keys(ARRIVALS), S.date])].filter(d => d >= "2026-08-15").sort();
function renderClock() {
  const days = arrivalDays(), next = S.date < END ? addDays(S.date, 1) : null, prev = S.date > "2026-08-15" ? addDays(S.date, -1) : null;
  const synth = desk.inputs.some(x => x.synthetic && x.date === S.date) || (desk.cycleAt(S.date) || "") >= "2026-10";
  $("clock").innerHTML = `
    <span class="daylbl">Day</span>
    <button class="btn icon quiet" id="prevDay" ${prev ? "" : "disabled"} title="Previous day">◀</button>
    <label class="daypick"><select id="daySel" title="Pick a day: the list shows days when something arrived">${days.map(d => `<option value="${d}" ${d === S.date ? "selected" : ""}>${dlong(d)}${dayText(d) ? " · " + dayText(d) : ""}</option>`).join("")}</select><b>${dlong(S.date)}</b><span class="caret">▾</span></label>
    <button class="btn" id="nextDay" ${next ? "" : "disabled"} title="${next ? esc(dlong(next) + (dayText(next) ? ": " + dayText(next) : "")) : "No later news"}">Next day ▶</button>
    ${dayText(S.date) ? `<span class="hint">${esc(dayText(S.date))}</span>` : ""}
    ${synth ? `<span class="pill Scenario" title="The real packet stops Fri Sep 18, 2026. October files are made up from the September ones.">made-up October data</span>` : ""}`;
  $("prevDay").onclick = () => prev && setDate(prev);
  $("nextDay").onclick = () => next && setDate(next);
  $("daySel").onchange = e => setDate(e.target.value);
}
function setDate(d) { S.date = d; save("date", d); render(); }

/* ------------------------------------------------------------ the assistant */
const AI = { connected: false, checked: false };
fetch("/api/status").then(r => r.ok ? r.json() : null).then(j => { AI.checked = true; AI.connected = !!(j && j.connected); AI.server = !!j; render(); }).catch(() => { AI.checked = true; render(); });
async function aiCall(path, body) {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    return r.ok ? j : { error: j.error || `HTTP ${r.status}` };
  } catch (e) { return { error: "Assistant server not running" }; }
}

/* ------------------------------------------------------------ shell */
function render() { indexArrivals(); if (ROLE === "manager") return renderManager(); renderClock(); renderPage(); }
window.addEventListener("popstate", e => { if (e.state && e.state.tab) { Object.assign(S, { tab: e.state.tab, region: e.state.region || null, checkRegion: e.state.checkRegion || null }); shown = navKey(); renderPage(); } });
window.addEventListener("storage", e => {                  // another tab (the submanager page) changed the record
  if (e.key === KEY + "record") { R = { ...emptyRecord(), ...load("record", {}) }; desk = C.Desk(D, R); render(); }
  if (e.key === KEY + "date") { S.date = load("date", S.date); render(); }
});
const navKey = () => [S.tab, S.region || "", S.checkRegion || ""].join("|");
let shown = null;
function go(tab, extra = {}) {
  if (STEPS.some(([id]) => id === S.tab)) S.from = S.tab;
  Object.assign(S, { tab, region: null, checkRegion: null, sel: tab === "publish" ? S.sel : null, flash: null }, extra);
  renderPage(); window.scrollTo(0, 0); $("page").scrollTop = 0;
}
/* everything a step needs to say how many, computed once per draw so every screen agrees */
function context() {
  const cyc = desk.cycleAt(S.date), rv = desk.review(S.date);
  const got = cyc ? D.regions.filter(r => desk.latestSheet(S.date, r.code, cyc)) : [];
  const pub = cyc ? R.versions.filter(v => v.cycle === cyc && v.date <= S.date).pop() || null : null;
  const late = lateSheets(pub), news = newsLists();
  news.count = news.open.length + late.filter(x => x.pending).length + news.buy.length;
  return { cyc, rv, got, missing: D.regions.filter(r => !got.includes(r)), pub, late, news, month: cyc ? mname(cyc) : "" };
}
function renderPage() {
  if (shown !== navKey()) {
    const u = new URL(location.href); u.searchParams.delete("example"); u.searchParams.delete("date"); u.searchParams.set("tab", S.tab);
    const st = { tab: S.tab, region: S.region, checkRegion: S.checkRegion };
    if (shown === null) history.replaceState(st, "", u); else history.pushState(st, "", u);
    shown = navKey();
  }
  save("tab", S.tab);
  const X = context();
  const railInfo = {
    sheets: X.cyc ? `${X.got.length} of 6 in` : "none yet",
    check: X.pub ? "done" : X.rv.open ? `${X.rv.open} to check` : X.rv.total != null ? "all checked" : "",
    publish: X.pub ? `published ${dlabel(X.pub.date)}` : "not yet",
    news: (X.news.count ? `${X.news.count} open` : "nothing open") + (X.news.waiting.length ? ` · ${X.news.waiting.length} waiting` : ""),
    send: X.pub ? (() => { const n = desk.releaseList(S.date).rows.length, o = desk.ordersAt(S.date).rows.length; return [n ? plural(n, "change") : o ? "" : "no changes yet", o ? plural(o, "order action") : ""].filter(Boolean).join(" · "); })() : "after publishing",
  };
  const stepI = STEPS.findIndex(([id]) => id === S.tab);
  $("rail").innerHTML = STEPS.map(([id, n], i) => `<button class="step ${S.tab === id ? "on" : ""} ${stepI > i ? "past" : ""} ${id === "check" && X.rv.open && !X.pub ? "warn" : ""}" data-step="${id}"><span class="no">${i + 1}</span><span class="nm">${n}</span><span class="st">${esc(railInfo[id])}</span></button>`).join("");
  $("side").innerHTML = SIDE.map(([id, n]) => `<button class="sidelink ${S.tab === id ? "on" : ""}" data-step="${id}">${n}</button>`).join("") + `<a class="sidelink" href="?role=manager" target="_blank" rel="noopener">Submanager view ↗</a>`;
  document.querySelectorAll("[data-step]").forEach(b => b.onclick = () => go(b.dataset.step));
  (PAGES[S.tab] || pageSheets)(X);
}
const PAGES = { sheets: pageSheets, check: pageCheck, publish: pagePublish, news: pageNews, send: pageSend, history: pageHistory, ask: pageAsk };
/* the bottom bar: Back on the left, the screen's one main button on the right */
function foot({ back, note, main }) {
  $("foot").innerHTML = `${back ? `<button class="btn" id="footBack">◀ ${esc(back.label)}</button>` : "<span></span>"}<span class="footnote">${note || ""}</span>${main ? `<button class="btn primary big" id="footMain" ${main.disabled ? "disabled" : ""}>${esc(main.label)}</button>` : "<span></span>"}`;
  if (back) $("footBack").onclick = back.act;
  if (main && !main.disabled) $("footMain").onclick = main.act;
}
const head = (title, lede, extra = "") => `<div class="pagehead"><h1>${title}</h1>${extra}</div><p class="lede">${lede}</p>`;
document.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (g) goto(g.dataset.goto); });
function goto(spec) {                                     // "plan:R06|S014|2026-10" or "trend:S014|R06" or "sheet:<id>"
  const [tab, ...rest] = spec.split(":"), v = rest.join(":");
  if (tab === "plan") { if (v) S.planMonth = v.split("|")[2]; go("publish", { sel: v || null }); }
  if (tab === "trend") { const [sku, region] = v.split("|"); S.hist = "trend"; S.trend = { sku, region }; go("history"); }
  if (tab === "sheet") { const x = desk.byId[v]; go("sheets", { region: x ? x.region : null }); }
}
const toggles = () => document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => { S.open[b.dataset.toggle] = !S.open[b.dataset.toggle]; renderPage(); });

/* ================================================================ 1 Sheets in */
function pageSheets(X) {
  if (S.region) return pageSheet(X);
  const { cyc, rv } = X;
  const box = r => {
    const s = cyc && desk.latestSheet(S.date, r.code, cyc), n = !X.pub && rv.openBy ? rv.openBy[r.code] || 0 : 0;
    if (!s) return `<div class="rbox wait"><b>${esc(r.name)}</b><span>not in yet</span></div>`;
    return `<button class="rbox ${n ? "warn" : "ok"}" data-region="${r.code}"><b>${esc(r.name)}</b><span>sent ${dlabel(s.date)}${s.replaces ? " · corrected copy" : ""}</span>
      <span class="state">${X.pub ? ((X.late.find(x => x.sheet.id === s.id) || {}).pending ? `new copy: see Late news` : "in the published plan") : n ? `${plural(n, "line")} to check` : "nothing to check"}</span></button>`;
  };
  const removed = (R.removed || []);
  $("page").innerHTML = `
    ${head(cyc ? `${mname(cyc)} sheets` : "Sheets", cyc ? `Each region sends one request sheet a month. Open a sheet to see what it asks for or to correct it.` : "No request sheets yet. Move the day forward, or add one below.")}
    ${cyc ? `<div class="rboxes">${D.regions.map(box).join("")}</div>` : ""}
    <div class="more"><button class="btn link" data-toggle="add">${S.open.add ? "▾" : "▸"} Add a sheet or message by hand</button>${S.open.add ? addBoxHtml() : ""}</div>
    ${removed.length ? `<div class="more"><button class="btn link" data-toggle="removed">${S.open.removed ? "▾" : "▸"} Removed (${removed.length})</button>${S.open.removed ? `<ul class="plainlist">${removed.map(x => `<li>${esc(x.label || x.input)} <span class="hint">removed ${dlabel(x.date)}</span> <button class="btn small link" data-restore="${esc(x.id)}">Restore</button></li>`).join("")}</ul>` : ""}</div>` : ""}`;
  document.querySelectorAll("[data-region]").forEach(b => b.onclick = () => go("sheets", { region: b.dataset.region }));
  document.querySelectorAll("[data-restore]").forEach(b => b.onclick = () => { R.removed = R.removed.filter(x => x.id !== b.dataset.restore); commit(); });
  bindRegionDrop();
  toggles(); if (S.open.add) bindAddBox();
  foot({
    note: X.missing.length && cyc ? `Not in yet: ${X.missing.map(r => r.name).join(", ")}` : cyc ? "All six sheets are in." : "",
    main: X.pub ? { label: "Next: late news", act: () => go("news") } : { label: rv.open ? `Next: check ${plural(rv.open, "line")}` : "Next: check", act: () => go("check") },
  });
}
/* a file dropped on a region's box is read as that region's sheet */
function bindRegionDrop() {
  document.querySelectorAll(".rbox").forEach(t => {
    t.ondragover = e => { e.preventDefault(); t.classList.add("drop"); };
    t.ondragleave = () => t.classList.remove("drop");
    t.ondrop = async e => {
      e.preventDefault(); t.classList.remove("drop");
      const f = e.dataTransfer.files[0]; if (!f) return;
      const p = await readInput(f.name, f);
      const code = t.dataset.region || D.regions.find(r => t.textContent.includes(r.name)).code;
      if (p.kind === "sheet") { p.region = code; resolvePreview(p); }
      S.preview = p; S.open.add = true; renderPage();
    };
  });
}
/* one region's sheet: what it asks for, what needs checking, and the head manager's corrections */
function pageSheet(X) {
  const { cyc, rv } = X, code = S.region, s = cyc && desk.latestSheet(S.date, code, cyc);
  const backAll = { label: "All sheets", act: () => go("sheets") };
  if (!s) { $("page").innerHTML = head(`${esc(regName(code))}`, `No ${X.month} sheet from ${esc(regName(code))} yet.`); foot({ back: backAll }); return; }
  const open = X.pub ? [] : rv.lines.filter(l => !l.settled && l.region === code), openKeys = new Set(open.map(l => l.key));
  const prev = s.replaces ? desk.byId[s.replaces] : null;
  const months = [...new Set(Object.values(s.cells).map(c => c.month))].sort();
  const bySku = {}; for (const c of Object.values(s.cells)) (bySku[c.sku] = bySku[c.sku] || {})[c.month] = c;
  const rows = D.items.filter(i => bySku[i.sku]).map(i => {
    const any = Object.values(bySku[i.sku]).find(c => c.unit) || {};
    return `<tr><td class="l">${esc(i.name)}</td><td class="l hint">${any.unit === "EA" ? esc(units(i.sku)) : "cases"}</td>${months.map(m => {
      const c = bySku[i.sku][m], key = `${code}|${i.sku}|${m}`; if (!c) return "<td></td>";
      const p = prev && prev.cells[key], diff = prev && (!p || p.cs !== c.cs);
      const tip = [c.problem, c.rule.join("; "), c.orig != null && c.unit === "EA" ? `sheet says ${fmt(c.orig)} ${units(i.sku)}` : "", diff ? `earlier copy: ${p ? fmt(p.cs) : "blank"}` : "", c.note].filter(Boolean).join(" · ");
      const cls = ["cell", c.problem ? "problem" : openKeys.has(key) ? "check" : "", c.edited ? "edited" : "", c.carried_from ? "carried" : "", diff ? "changed" : ""].join(" ");
      return `<td class="${cls}" data-cell="${key}" title="${esc(tip)}" tabindex="0">${c.cs == null ? (c.raw ? `“${esc(c.raw)}”` : "blank") : fmt(c.cs)}</td>`;
    }).join("")}</tr>`;
  }).join("");
  const edited = Object.values(s.cells).filter(c => c.edited);
  $("page").innerHTML = `
    ${head(`${esc(regName(code))} · ${X.month} sheet`, `Sent ${dlabel(s.date)}${s.author ? ` by ${esc(s.author)}` : ""}${prev ? `, replacing the ${dlabel(prev.date)} copy` : ""}. It asks for ${months.length} months ahead, ${mlabel(months[0])} to ${mlabel(months[months.length - 1])}, every number in cases. Click a number to correct it.`)}
    ${X.pub ? `<div class="okline">The ${X.month} plan was published ${dlabel(X.pub.date)}. A correction here no longer changes it; change the plan itself under Publish.</div>` : open.length ? `<div class="tocheck"><b>${plural(open.length, "line")} to check</b><ul>${open.map(l => `<li class="jump" ${l.sku ? `data-jump="${esc(l.key)}"` : ""}>${l.sku ? `${esc(itemName(l.sku))}, ${mlabel(l.month)}` : `Row ${l.row}`}: ${esc(l.why)}</li>`).join("")}</ul></div>` : `<div class="okline">Nothing on this sheet needs checking.</div>`}
    <div class="legend"><span><i class="key check"></i>to check</span><span><i class="key problem"></i>could not be read</span><span><i class="key edited"></i>your correction</span>${s.counts.carried ? `<span><i class="key carried"></i>blank, carried from last month</span>` : ""}${prev ? `<span><i class="key changed"></i>changed from the earlier copy</span>` : ""}</div>
    <div class="gridwrap"><table class="grid sheet"><tr><th class="l">Item</th><th class="l">Sent in</th>${months.map(m => `<th>${mlabel(m)}</th>`).join("")}</tr>${rows}</table></div>
    ${edited.length ? `<h2>Your corrections</h2><ul class="plainlist">${edited.map(c => `<li>${esc(itemName(c.sku))}, ${mlabel(c.month)}: ${c.edited.was == null ? "blank" : esc(typeof c.edited.was === "string" ? c.edited.was : fmt(c.edited.was))} → <b>${fmt(c.cs)}</b> <span class="hint">${dlabel(c.edited.date)}</span> <button class="btn small link" data-unedit="${esc(`${code}|${c.sku}|${c.month}`)}">Undo</button></li>`).join("")}</ul>` : ""}
    <div class="more"><button class="btn link" data-toggle="sheetmore">${S.open.sheetmore ? "▾" : "▸"} File details and remove</button>${S.open.sheetmore ? `<div class="morebody"><div class="hint">${esc(short(s.src))} · layout “${esc(s.layout)}” · ${plural(s.counts.cells, "line")} read · ${s.counts.ea} converted from ${esc("bottles, bags and other units")} · ${s.counts.cancelled} zeros (month cancelled)${s.meta && s.meta.note ? ` · desk note: ${esc(s.meta.note)}` : ""}</div><button class="btn danger" id="removeSheet">Remove this sheet</button> <span class="hint">It drops out of every screen${prev ? `; the ${dlabel(prev.date)} copy counts again` : ""}. You can restore it from Sheets in.</span></div>` : ""}</div>`;
  document.querySelectorAll("[data-jump]").forEach(li => li.onclick = () => { const td = document.querySelector(`td[data-cell="${CSS.escape(li.dataset.jump)}"]`); if (td) { td.scrollIntoView({ block: "center" }); td.focus(); } });
  document.querySelectorAll("td[data-cell]").forEach(td => { td.onclick = () => editReportCell(td, s); td.onkeydown = e => { if (e.key === "Enter") editReportCell(td, s); }; });
  document.querySelectorAll("[data-unedit]").forEach(b => b.onclick = () => { R.reportEdits.push({ id: uid("re"), date: S.date, sheet: s.id, key: b.dataset.unedit, cs: null, reason: "Undone" }); commit(); });
  const rm = $("removeSheet"); if (rm) rm.onclick = () => { R.removed.push({ id: uid("rm"), date: S.date, input: s.id, label: `${regName(code)} ${X.month} sheet, ${short(s.src)}` }); S.region = null; commit(); };
  toggles();
  foot({ back: backAll, main: open.length ? { label: `Check ${regName(code)}'s ${plural(open.length, "line")}`, act: () => go("check", { checkRegion: code }) } : { label: "Back to all sheets", act: () => go("sheets") } });
}
function editReportCell(td, s) {
  if (td.querySelector("input")) return;
  const key = td.dataset.cell, c = s.cells[key];
  td.innerHTML = `<input class="cellin" value="${c.cs == null ? "" : c.cs}">`;
  const inp = td.querySelector("input"); inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = parseFloat(inp.value.replace(/,/g, ""));
    if (!ok || isNaN(v) || v === c.cs) { renderPage(); return; }
    R.reportEdits.push({ id: uid("re"), date: S.date, sheet: s.id, key, cs: v, reason: "Corrected by the head manager" });
    commit();
  };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); finish(true); } if (e.key === "Escape") finish(false); };
  inp.onblur = () => finish(true);
}

/* ================================================================ 2 Check */
function decide(key, outcome, value) {
  const cyc = desk.cycleAt(S.date), l = desk.review(S.date).lines.find(x => x.key === key);
  if (l && outcome) S.flash = { tab: "check", key, text: `${regName(l.region)}, ${l.sku ? `${itemName(l.sku)} ${mlabel(l.month)}` : `row ${l.row}`}: ${outcome === "request" ? `used their ${fmt(l.ask)}` : outcome === "keep" ? (l.sku ? `kept the last plan, ${fmt(l.last)}` : "row ignored") : `set to ${fmt(value)}`}.` };
  else S.flash = null;
  R.decisions = R.decisions.filter(d => d.target !== `draft:${cyc}|${key}`);
  if (outcome) R.decisions.push({ id: uid("d"), date: S.date, target: `draft:${cyc}|${key}`, outcome, ...(value != null ? { value } : {}) });
  S.setting = null; commit();
}
function pageCheck(X) {
  const { cyc, rv } = X, inR = l => !S.checkRegion || l.region === S.checkRegion;
  const order = (a, b) => D.regions.findIndex(r => r.code === a.region) - D.regions.findIndex(r => r.code === b.region) || itemName(a.sku || "").localeCompare(itemName(b.sku || "")) || (a.month || "").localeCompare(b.month || "");
  const L = rv.lines.filter(l => !l.settled && inR(l) && !X.pub).sort(order), done = rv.lines.filter(l => l.settled && inR(l) && l.decision).sort(order);
  const outcome = l => ({ request: "used theirs", keep: l.sku ? "kept last plan" : "ignored", set: `set to ${fmt(l.value)}` })[l.decision && l.decision.outcome] || "";
  const what = l => l.sku ? `${esc(itemName(l.sku))}` : `Row ${l.row}`;
  const acts = l => S.setting === l.key ? `<form class="inline" data-setform="${esc(l.key)}"><input type="number" id="setVal" placeholder="cases" style="width:76px"><button class="btn small primary">Set</button><button type="button" class="btn small" id="setCancel">Cancel</button></form>`
    : !l.sku ? `<button class="btn small" data-dec="${esc(l.key)}|keep">Ignore this row</button>`
    : `${l.ask != null ? `<button class="btn small" data-dec="${esc(l.key)}|request">Use theirs</button>` : ""}${l.last != null ? `<button class="btn small" data-dec="${esc(l.key)}|keep">Keep last plan</button>` : ""}<button class="btn small" data-set="${esc(l.key)}">Set…</button>`;
  const row = l => `<tr class="${l.status}"><td><a class="lnk" data-sheetof="${l.region}">${esc(regName(l.region))}</a></td><td>${what(l)}</td><td>${l.month ? mlabel(l.month) : ""}</td>
    <td class="n">${l.sku ? (l.last == null ? `<span class="hint">none</span>` : fmt(l.last)) : ""}</td><td class="n"><b>${l.ask == null ? (l.raw ? `“${esc(l.raw)}”` : l.sku ? "blank" : "") : fmt(l.ask)}</b></td><td class="n" title="${esc(l.detail || "")}">${l.expected != null ? fmt(l.expected) : ""}</td>
    <td class="why" title="${esc(l.detail || l.why)}">${esc(l.why)}</td><td class="acts">${acts(l)}</td></tr>`;
  const doneRow = l => `<tr class="done"><td>${esc(regName(l.region))}</td><td>${what(l)}</td><td>${l.month ? mlabel(l.month) : ""}</td><td class="n">${l.sku ? fmt(l.last) : ""}</td><td class="n">${l.ask == null ? "" : fmt(l.ask)}</td><td class="n">${l.sku ? `<b>${fmt(l.value)}</b>` : ""}</td><td>${esc(outcome(l))}</td><td class="acts"><button class="btn small link" data-dec="${esc(l.key)}|">Undo</button></td></tr>`;
  const th = `<tr><th>Region</th><th>Item</th><th>Month</th><th class="n">Last plan</th><th class="n">They ask</th><th class="n" title="What it usually ships, from last year's shipments, or what sales point to">Usual</th><th>Why it needs you</th><th></th></tr>`;
  const others = rv.total != null ? rv.total - rv.lines.filter(l => l.sku).length : 0;
  $("page").innerHTML = `
    ${head(cyc ? `Check ${X.month}` : "Check", X.pub ? `The ${X.month} plan was published ${dlabel(X.pub.date)}. Lines left unchecked went in as asked. To change a number now, click it under Publish.` : rv.total != null ? `These lines need you: the sheet asks for an unusual amount, or a number could not be read. The other ${fmt(others)} lines go into the plan as asked.` : "No sheets to check yet.",
      S.checkRegion ? `<span class="chip on">${esc(regName(S.checkRegion))} only</span><button class="btn small link" id="showAll">Show all ${rv.open}</button>` : "")}
    ${S.flash && S.flash.tab === "check" ? `<div class="flash">Done: ${esc(S.flash.text)} <button class="btn small link" data-dec="${esc(S.flash.key)}|">Undo</button></div>` : L.length ? `<div class="flash quiet">A decided line leaves this list. Your last decision shows here, with Undo. All of them are under Decided.</div>` : ""}
    ${L.length ? `<table class="plain review">${th}${L.map(row).join("")}</table>` : X.pub ? "" : rv.total != null ? `<div class="okline">${S.checkRegion ? `Nothing left to check for ${esc(regName(S.checkRegion))}.` : "Everything is checked."}</div>` : ""}
    ${done.length ? `<div class="more"><button class="btn link" data-toggle="settled">${S.open.settled ? "▾" : "▸"} Decided (${done.length})</button>${S.open.settled ? `<table class="plain review"><tr><th>Region</th><th>Item</th><th>Month</th><th class="n">Last plan</th><th class="n">They ask</th><th class="n">In the plan</th><th>Your decision</th><th></th></tr>${done.map(doneRow).join("")}</table>` : ""}</div>` : ""}`;
  document.querySelectorAll("[data-dec]").forEach(b => b.onclick = () => { const v = b.dataset.dec, i = v.lastIndexOf("|"); decide(v.slice(0, i), v.slice(i + 1) || null); });
  document.querySelectorAll("[data-sheetof]").forEach(a => a.onclick = () => go("sheets", { region: a.dataset.sheetof }));
  document.querySelectorAll("[data-set]").forEach(b => b.onclick = () => { S.setting = b.dataset.set; renderPage(); setTimeout(() => { const i = $("setVal"); if (i) { i.focus(); i.select(); } }); });
  document.querySelectorAll("[data-setform]").forEach(f => f.onsubmit = e => { e.preventDefault(); const v = parseFloat($("setVal").value); if (!isNaN(v)) decide(f.dataset.setform, "set", v); else { S.setting = null; renderPage(); } });
  const sc = $("setCancel"); if (sc) sc.onclick = () => { S.setting = null; renderPage(); };
  const sa = $("showAll"); if (sa) sa.onclick = () => go("check");
  toggles();
  const restOpen = rv.open - L.length;
  foot({
    back: S.checkRegion ? { label: `${regName(S.checkRegion)}'s sheet`, act: () => go("sheets", { region: S.checkRegion }) } : { label: "Sheets in", act: () => go("sheets") },
    note: X.pub ? "" : S.checkRegion && restOpen ? `${plural(restOpen, "more line")} to check in other regions` : rv.open ? `Lines you leave unchecked go in as asked.` : "",
    main: S.checkRegion && restOpen && !X.pub ? { label: `Check the other ${plural(restOpen, "line")}`, act: () => go("check") } : { label: "Next: publish", act: () => go("publish") },
  });
}

/* ================================================================ 3 Publish (the plan table) */
function planView(X) {
  if (X.cyc && !X.pub) { const dv = desk.draftVersion(S.date); if (dv) return { draft: dv, grid: dv.grid, months: dv.months, applied: {}, name: `${X.month} draft`, flags: new Set(X.rv.lines.filter(l => !l.settled).map(l => l.key)) }; }
  const w = desk.working(S.date); if (!w.base) return null;
  return { grid: w.grid, months: w.months, applied: w.applied, name: w.base.name, base: w.base, flags: new Set() };
}
function pagePublish(X) {
  const pv = planView(X);
  if (!pv) { $("page").innerHTML = head("Publish", "No plan yet."); foot({ back: { label: "Check", act: () => go("check") } }); return; }
  if (!pv.months.includes(S.planMonth)) S.planMonth = X.cyc && pv.months.includes(X.cyc) ? X.cyc : pv.months[0];
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
      body += `<tr><td class="l">${esc(it.name)}</td>${cells}<td class="tot">${fmt(rowTot)}</td></tr>`;
    }
  }
  body += `<tr class="total"><td class="l">Total cases</td>${regs.map(r => `<td>${fmt(colTot[r])}</td>`).join("")}<td>${fmt(net)}</td></tr>`;
  const ak = pv.base && pv.base.origin === "added" && desk.answerKey(pv.base.id);
  const pre = pv.draft && pv.draft.preflight;
  const preText = pre ? [pre.unsettled && `${plural(pre.unsettled, "line")} not checked, across all months, go in as asked`, pre.missing.length && `no sheet yet from ${pre.missing.map(x => regName(x.region || x)).join(", ")}: last plan stands`].filter(Boolean).join(" · ") : "";
  $("page").innerHTML = `
    ${head(pv.draft ? `${X.month} plan, not published` : esc(pv.name), pv.draft ? `The sheets plus your checks, in cases, for ${mlabel(pv.months[0])} to ${mlabel(pv.months[pv.months.length - 1])}. Click a region's number to see where it came from. Publish to make it the plan in force.` : `The plan in force${X.pub ? `, published ${dlabel(X.pub.date)}` : ""}. Click a region's number to see where it came from or to change it.`)}
    <div class="row"><div class="seg">${pv.months.map(x => `<button class="${x === m ? "on" : ""}" data-month="${x}">${mlabel(x)}</button>`).join("")}</div>
      <div class="legend">${changed ? `<span><i class="key changed"></i>${changed} changed in ${mname(m)} since publishing</span>` : ""}${flagged ? `<span><i class="key flag"></i>${flagged} not checked in ${mname(m)}</span>` : ""}</div></div>
    ${ak ? `<div class="answer" data-toggle="answer"><span class="hint">Compared with Dutch Bros' own posted plan:</span> <b>${esc(ak.headline)}</b> <span class="hint">${S.open.answer ? "▾" : "▸"}</span></div>${S.open.answer ? answerHtml(ak) : ""}` : ""}
    <div class="layout ${S.sel ? "" : "nodetail"}">
      <div class="gridwrap"><table class="grid" id="grid"><tr><th class="l">Item</th>${regs.map(r => `<th>${esc(REGIONS[r].name)}</th>`).join("")}<th>All regions</th></tr>${body}</table></div>
      ${S.sel ? `<div class="detail" id="detail">${detailHtml(S.sel, pv)}</div>` : ""}
    </div>`;
  bindPlan(pv);
  foot(pv.draft
    ? { back: { label: "Check", act: () => go("check") }, note: preText, main: { label: `Publish the ${X.month} plan`, act: () => publish(pv.draft) } }
    : { back: { label: "Check", act: () => go("check") }, note: X.pub ? `Published ${dlabel(X.pub.date)}.` : "", main: { label: "Next: late news", act: () => go("news") } });
}
function publish(dv) { R.versions.push({ ...dv, id: uid("v"), name: `${mname(dv.cycle)} plan`, note: "" }); S.open.answer = true; commit(); }
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
  toggles();
  const x = $("closeDetail"); if (x) x.onclick = () => { S.sel = null; renderPage(); };
  if (S.sel) bindDetail(pv);
}
function focusSel() { const td = document.querySelector(`td.cell[data-key="${CSS.escape(S.sel)}"]`); if (td) td.focus({ preventScroll: false }); }
/* spreadsheet keys on the plan: arrows move, a digit or Enter starts typing */
document.addEventListener("keydown", e => {
  if (S.tab !== "publish" || !S.sel || e.target.closest("input,textarea,select")) return;
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
  const pv = planView(context()), [r, sku, m] = key.split("|"), cur = pv.grid[r + "|" + sku][m];
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
const TYPES = [["add", "Add or take away"], ["set", "Change total to"], ["move", "Move to month"]];
function detailHtml(key, pv) {
  const [r, sku, m] = key.split("|"), it = ITEMS[sku], li = desk.lineInfo(S.date, key);
  const v = pv.grid[r + "|" + sku] && pv.grid[r + "|" + sku][m];
  if (v == null) return `<div class="hint">No line for this item in ${esc(regName(r))}.</div>`;
  const req = desk.requestAt(S.date, key);
  const dr = S.draft && S.draft.key === key ? S.draft : { key, type: "add", qty: "", unit: "CS" };
  return `<div class="dhead"><div class="hint">${esc(regName(r))} · ${mlong(m)}</div><button class="btn small" id="closeDetail" title="Close">✕</button></div>
    <h3>${esc(it.name)}</h3>
    <div class="bignum">${fmt(v)} <small>cases</small></div>
    <div class="hint">${esc(it.case_pack)} · ${it.lead_days} days to arrive</div>
    ${pv.draft ? `<div class="hint" style="margin-top:6px">To change it before publishing, type a new number over it, or decide it under Check.</div>` : `<form class="dform" id="dForm">
      <div class="seg small">${TYPES.map(([t, n]) => `<button type="button" class="${dr.type === t ? "on" : ""}" data-type="${t}">${n}</button>`).join("")}</div>
      <div class="row"><input type="number" step="any" id="dQty" value="${dr.qty}" placeholder="${dr.type === "set" ? "total" : dr.type === "move" ? "all of them" : "+ or −"}">
        ${dr.type === "move" ? `<span>to</span><select id="dTo">${pv.months.filter(x => x !== m).map(x => `<option value="${x}" ${dr.to === x ? "selected" : ""}>${mlabel(x)}</option>`).join("")}</select>`
        : `<select id="dUnit"><option value="CS" ${dr.unit === "CS" ? "selected" : ""}>cases</option><option value="EA" ${dr.unit === "EA" ? "selected" : ""}>${esc(units(sku))}</option></select>`}</div>
      <div class="hint" id="dCalc"></div>
      <input type="text" id="dReason" placeholder="Why (purchasing reads this)" value="${esc(dr.reason || "")}">
      <button class="btn primary small">Save change</button>${S.draft ? ` <button type="button" class="btn small" id="dCancel">Cancel</button>` : ""}
    </form>`}
    ${li.changes.length ? `<h4>Changes</h4>${li.changes.map(c => `<div class="edit"><div><b>${esc(c.text)}</b> · ${dlabel(c.date)} ${R.changes.some(x => x.id === c.id) ? `<button class="btn small link" data-undo="${c.id}">Undo</button>` : ""}</div><div>${esc(c.reason)}</div>${c.source ? `<div class="src">${esc(srcName(c.source))}</div>` : ""}${c.quote ? `<div class="quote">“${esc(c.quote)}”</div>` : ""}</div>`).join("")}` : ""}
    <h4>Asked</h4>
    ${req ? `<div><b>${req.cell.cs == null ? "blank" : fmt(req.cell.cs)}</b> cases ${req.cell.unit === "EA" && req.cell.orig != null ? `<span class="hint">= ${fmt(req.cell.orig)} ${esc(units(sku))}</span>` : ""}</div><div class="src"><a class="lnk" data-goto="sheet:${esc(req.sheet.id)}">${esc(regName(r))}'s sheet</a>, row ${req.cell.row ?? "—"}${req.cell.note ? " · " + esc(req.cell.note) : ""}</div>` : `<div class="hint">No sheet yet</div>`}
    <h4>Checks</h4>
    ${li.checks.map(c => `<div class="check ${c.ok ? "ok" : "bad"}" title="${esc(c.detail || "")}">${c.ok ? "✓" : "!"} ${esc(c.label || c.name)}</div>`).join("") || `<div class="hint">—</div>`}
    <h4>On order</h4>
    ${onOrderHtml(sku, m, pv)}
    <h4>Every version</h4>
    <table class="plain mini">${li.versions.map(x => `<tr><td>${dlabel(x.date)}</td><td>${esc(x.name)}</td><td class="n">${fmt(x.value)}</td></tr>`).join("")}</table>
    <div style="margin-top:8px"><button class="btn small link" data-goto="trend:${sku}|${r}">See the trend</button></div>`;
}
/* open orders for an item on the buyer's watch list, pooled for all regions */
function onOrderHtml(sku, m, pv) {
  const open = desk.poAt(S.date).filter(l => l.sku === sku && l.open > 0).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  return `${open.map(l => `<div>On order: <b>${esc(l.id)}</b>, ${plural(l.open, "case")}, due ${dlabel(l.due)}${l.month !== m ? ` <span class="hint">(for ${mlabel(l.month)})</span>` : ""}</div>`).join("") || `<div class="hint">Nothing open for this item on the buyer's watch list.</div>`}
`;
}
function srcName(id) {
  const x = desk.byId[id]; if (x) return x.kind === "sheet" ? `${regName(x.region)} sheet, ${dlabel(x.date)}` : x.mail ? x.mail.subject : id;
  const th = desk.threadsAt(END).find(t => t.id === id); if (th) return th.title;
  const b = desk.purchaseNews(S.date).find(i => i.id === id) || desk.purchaseNews(END).find(i => i.id === id); return b ? b.title : id;
}
function bindDetail(pv) {
  const key = S.sel, [r, sku, m] = key.split("|"), it = ITEMS[sku], f = $("dForm");
  document.querySelectorAll("[data-undo]").forEach(b => b.onclick = () => { const c = R.changes.find(x => x.id === b.dataset.undo); if (c) c.removed_on = S.date; commit(); });
  if (!f) return;
  const cur = pv.grid[r + "|" + sku][m];
  S.draft = S.draft && S.draft.key === key ? S.draft : null;
  const state = () => ({ key, type: f.querySelector(".seg .on").dataset.type, qty: $("dQty").value, unit: $("dUnit") ? $("dUnit").value : "CS", to: $("dTo") ? $("dTo").value : null, reason: $("dReason").value });
  const calc = () => {
    const s = state(), q = s.type === "move" && s.qty === "" ? cur : parseFloat(s.qty);
    if (isNaN(q)) { $("dCalc").textContent = ""; return; }
    const cs = s.unit === "EA" ? q / it.ea_per_case : q, conv = s.unit === "EA" ? `${fmt(q)} ${units(sku)} ÷ ${it.ea_per_case} = ${fmt(cs)} cases · ` : "";
    $("dCalc").textContent = s.type === "add" ? `${conv}${fmt(cur)} → ${fmt(cur + cs)}` : s.type === "set" ? `${conv}set to ${fmt(cs)}` : `${s.qty === "" ? "all " : ""}${mlabel(m)} ${fmt(cur)} → ${fmt(cur - cs)}`;
  };
  f.oninput = calc; calc();
  f.querySelectorAll("[data-type]").forEach(b => b.onclick = () => { S.draft = { ...state(), type: b.dataset.type }; renderPage(); });
  const dc = $("dCancel"); if (dc) dc.onclick = () => { S.draft = null; renderPage(); focusSel(); };
  f.onsubmit = e => {
    e.preventDefault();
    const s = state(), q = s.type === "move" && s.qty === "" ? cur : parseFloat(s.qty);
    if (isNaN(q)) return $("dQty").focus();
    if (!s.reason.trim()) { $("dReason").focus(); $("dReason").classList.add("need"); return; }
    R.changes.push({ id: uid("c"), date: S.date, type: s.type, ref: `manual:${key}`, key, qty: q, unit: s.type === "move" ? "CS" : s.unit, to: s.to, reason: s.reason.trim(), source: null, quote: "" });
    S.draft = null; commit(); focusSel();
  };
}

/* ================================================================ 4 Late news */
const isPlanThread = th => th.kind === "calendar" || th.items.some(x => x.kind === "email" && !/Buyer_and_dock\//.test(x.src || ""));
function newsLists() {
  const n = desk.needs(S.date);
  const planAll = n.inputs.filter(t => isPlanThread(t.thread));
  // every message not yet decided stays open, whatever plan has been published since it arrived
  const byDate = (a, b) => a.thread.last.localeCompare(b.thread.last);
  return { open: planAll.sort(byDate), other: n.inputs.filter(t => !isPlanThread(t.thread)), waiting: n.waiting, buy: desk.purchaseNews(S.date).filter(i => i.open) };
}
/* a calendar entry is settled by the message that logs its change: the email names the event id,
 * or it comes from the same region within three days and the change is for the event's month */
function coveredCalendars(threadId, ref, month) {
  const all = desk.threadsAt(S.date), th = all.find(t => t.id === threadId); if (!th || th.kind === "calendar") return [];
  const text = th.items.map(x => x.kind === "email" ? x.mail.subject + " " + x.mail.body : "").join(" ") + " " + (ref || "");
  const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 3 * 864e5;
  return all.filter(t => t.kind === "calendar" && (text.includes(t.id.replace(/^cal:/, "")) || (t.region && t.region === th.region && near(t.last, th.last) &&
    (!month || t.items.some(x => (x.event.event_date || "").slice(0, 7) === month))))).map(t => t.id);
}
function decideThread(target, outcome, note, ref, month) {
  const ids = [uid("d")];
  R.decisions.push({ id: ids[0], date: S.date, target, outcome, note });
  const cov = outcome !== "waiting" ? coveredCalendars(target, ref, month) : [];
  for (const cal of cov) { const id = uid("d"); ids.push(id); R.decisions.push({ id, date: S.date, target: cal, outcome: "no-change", note: `Covered by: ${threadTitle(target)}` }); }
  return { text: cov.length ? ` Closed with it: ${cov.map(threadTitle).join(", ")}.` : "", ids };
}
/* Undo from the Late news flash: take back the decisions, changes and asks of purchasing it made */
function undoFlash(u) {
  R.decisions = R.decisions.filter(d => !(u.decisions || []).includes(d.id));
  for (const c of R.changes) if ((u.changes || []).includes(c.id)) c.removed_on = S.date;
  for (const o of R.orders) if ((u.orders || []).includes(o.id)) o.removed_on = S.date;
  S.flash = { tab: "news", text: "Undone. The item is open again." };
  commit();
}
function pageNews(X) {
  const N = X.news;
  const row = (t, waiting) => {
    const th = t.thread, id = th.id, open = S.open[id], last = th.items[th.items.length - 1];
    return `<div class="mrow ${open ? "open" : ""}">
      <div class="mhead" data-toggle="${esc(id)}"><span class="pill ${th.kind}">${th.kind === "email" ? (th.items.some(x => x.from === "manager") ? "Request" : "Email") : "Calendar"}</span><b>${esc(th.title)}</b>${th.region ? `<span class="reg">${esc(regName(th.region))}</span>` : ""}<span class="hint">${dlabel(last.date)}</span>${waiting ? `<span class="pill Scenario" title="${esc(t.decision.note || "")}">waiting</span>` : ""}<span class="chev">${open ? "▾" : "▸"}</span></div>
      ${open ? `<div class="mbody">${th.items.map((x, i) => msgHtml(x, i === th.items.length - 1 || S.open[id + ":all"])).join("")}
        <div class="acts"><button class="btn small primary" data-work="${esc(id)}">Log a change</button><button class="btn small" data-decide="${esc(id)}|no-change">No change needed</button>${waiting ? "" : `<button class="btn small" data-decide="${esc(id)}|waiting">Waiting on someone</button>`}<button class="btn small ai" data-aidraft="${esc(id)}" ${AI.connected ? "" : `title="Assistant not connected"`}>${S.aiBusy === id ? "Drafting…" : "Draft with AI"}</button><span class="spacer"></span><button class="btn small link" data-rmthread="${esc(id)}">Remove</button></div>
        ${S.aiNote && S.aiNote.thread === id ? `<div class="ainote ${S.aiNote.error ? "bad" : ""}">${esc(S.aiNote.text)}</div>` : ""}
        ${(S.aiDrafts || []).map((c, i) => c.thread === id ? changeCardHtml(c, i) : "").join("")}
        ${S.cc && S.cc.thread === id ? changeCardHtml() : ""}
        ${decFormHtml(id)}</div>` : ""}
    </div>`;
  };
  const items = [...N.open.map(t => ({ date: t.thread.last, html: row(t, false) })), ...N.buy.map(it => ({ date: it.date, html: buyRow(it) }))].sort((a, b) => a.date.localeCompare(b.date));
  $("page").innerHTML = `
    ${head("Late news", `Emails, submanager requests, calendar entries and purchasing news since the last plan. Open each one: change the plan, ask purchasing, or mark it no change needed.`)}
    ${S.flash && S.flash.tab === "news" ? `<div class="flash">${esc(S.flash.text)} <span class="hint">${S.flash.change || S.flash.order ? "It is in History and under Send to purchasing." : S.flash.undo ? "It is in History." : ""}</span>${S.flash.undo ? ` <button class="btn small link" id="flashUndo">Undo</button>` : ""}</div>` : ""}
    ${X.late.map(lateHtml).join("")}
    <div class="mlist">${items.map(x => x.html).join("") || (X.late.some(x => x.pending) ? "" : `<div class="okline">Nothing open. Use Next day ▶ at the top to see what arrives later.</div>`)}</div>
    ${N.waiting.length ? `<h2>Waiting on someone (${N.waiting.length})</h2><div class="mlist">${N.waiting.map(t => row(t, true)).join("")}</div>` : ""}
    ${N.other.length ? `<div class="more"><button class="btn link" data-toggle="other">${S.open.other ? "▾" : "▸"} Dock and orders (${N.other.length})</button>${S.open.other ? `<div class="mlist">${N.other.map(t => row(t, false)).join("")}</div>` : ""}</div>` : ""}`;
  bindNews();
  foot({ back: { label: "Publish", act: () => go("publish") }, note: N.count ? `${plural(N.count, "item")} still open` : "", main: { label: "Next: send to purchasing", act: () => go("send") } });
}
const decFormHtml = id => S.pending && S.pending.target === id ? `<form class="inline" id="decForm"><input type="text" id="decNote" placeholder="${S.pending.outcome === "waiting" ? "Waiting on whom?" : "Why? (optional)"}"><button class="btn small primary">Save</button><button type="button" class="btn small" id="decCancel">Cancel</button></form>` : "";
/* purchasing news: a short or late order, too late to order, a requisition */
const PKIND = { short: "Short", late: "Too late", request: "Request" };
const ACTS = [["more", "Order more"], ["cut", "Cut the order"], ["rush", "Rush"]];
const actWord = a => ({ more: "order more", cut: "cut the order by", rush: "rush" })[a] || a;
function buyRow(it) {
  const id = it.id, open = S.open[id];
  return `<div class="mrow ${open ? "open" : ""}">
    <div class="mhead" data-toggle="${esc(id)}"><span class="pill ${it.kind}">${PKIND[it.kind]}</span><b>${esc(it.title)}</b><span class="reg">${esc(it.region ? regName(it.region) : "All regions")}</span><span class="hint">${dlabel(it.date)}</span><span class="chev">${open ? "▾" : "▸"}</span></div>
    ${open ? `<div class="mbody">
      <div class="msg"><div class="hint">${esc([it.from && `From ${it.from}`, it.source, it.synthetic && "made up for rehearsal"].filter(Boolean).join(" · "))}</div><div>${esc(it.text)}</div>${it.quote && it.kind === "request" ? `<div class="quote">“${esc(it.quote)}”</div>` : ""}${it.desk ? `<div class="hint">${esc(it.desk)}</div>` : ""}</div>
      ${it.asked.length ? `<div style="margin-top:4px">Already asked: ${it.asked.map(o => `${actWord(o.action)} ${fmt(o.qty)} cases by ${dlabel(o.by)} (${dlabel(o.date)})`).join("; ")}</div>` : ""}
      <div class="acts"><button class="btn small primary" data-ask="${esc(id)}">${it.prefill.action === "more" && it.kind === "short" ? `Order ${fmt(it.prefill.qty)} more` : it.prefill.action === "rush" ? `Rush ${fmt(it.prefill.qty)} cases` : "Ask purchasing"}</button><button class="btn small" data-buyplan="${esc(id)}">Change the plan</button><button class="btn small" data-decide="${esc(id)}|no-change">No change needed</button></div>
      ${S.ask && S.ask.item === id ? askFormHtml(S.ask, it) : ""}
      ${S.cc && S.cc.thread === id ? changeCardHtml() : ""}
      ${decFormHtml(id)}</div>` : ""}
  </div>`;
}
function askCalc(a) {
  const q = parseFloat(a.qty), it = ITEMS[a.sku]; if (isNaN(q) || !it) return "";
  return `${fmt(q)} cases = ${fmt(q * it.ea_per_case)} ${units(a.sku)}${a.by ? ` · by ${dlong(a.by)}` : ""}`;
}
function askFormHtml(a, it) {
  const pos = it.lines.filter(l => l.open > 0);
  return `<form class="ccard" id="askForm">
    <div class="seg small">${ACTS.map(([k, n]) => `<button type="button" class="${a.action === k ? "on" : ""}" data-aact="${k}">${n}</button>`).join("")}</div>
    <div class="row"><input type="number" min="0" step="any" data-a="qty" value="${esc(a.qty)}" placeholder="cases" style="width:90px"><span>cases</span><span>by</span><input type="date" data-a="by" value="${esc(a.by)}">
      <select data-a="po"><option value="">${a.action === "more" || !pos.length ? "A new order" : "Any open order"}</option>${pos.map(l => `<option value="${esc(l.id)}" ${l.id === a.po ? "selected" : ""}>${esc(l.id)}, ${fmt(l.open)} open</option>`).join("")}</select></div>
    <input type="text" data-a="reason" value="${esc(a.reason)}" placeholder="Why (purchasing reads this)">
    <div class="row"><span class="calc">${esc(askCalc(a))}</span><span class="spacer"></span><button class="btn small primary">Save</button><button type="button" class="btn small" id="askCancel">Cancel</button></div>
  </form>`;
}
const buyItem = id => desk.purchaseNews(S.date).find(i => i.id === id);
function bindBuy() {
  document.querySelectorAll("[data-ask]").forEach(b => b.onclick = () => {
    const it = buyItem(b.dataset.ask); if (!it) return;
    S.cc = null; S.pending = null;
    S.ask = { item: it.id, sku: it.sku, ...it.prefill, qty: Math.round(it.prefill.qty * 100) / 100, reason: it.title }; renderPage();
  });
  document.querySelectorAll("[data-buyplan]").forEach(b => b.onclick = () => {
    const it = buyItem(b.dataset.buyplan); if (!it) return;
    S.ask = null; S.pending = null;
    S.cc = newCard({ id: it.id, kind: "purchase", region: it.change.region, title: it.title, items: [] }, { ...it.change, ref: it.id }); renderPage();
  });
  const f = $("askForm"); if (!f) return;
  const a = S.ask;
  f.querySelectorAll("[data-aact]").forEach(b => b.onclick = () => { a.action = b.dataset.aact; renderPage(); });
  f.querySelectorAll("[data-a]").forEach(el => el.oninput = el.onchange = () => { a[el.dataset.a] = el.value; const c = f.querySelector(".calc"); if (c) c.textContent = askCalc(a); });
  $("askCancel").onclick = () => { S.ask = null; renderPage(); };
  f.onsubmit = e => {
    e.preventDefault();
    const it = buyItem(a.item), q = parseFloat(a.qty);
    if (isNaN(q) || q <= 0) return f.querySelector('[data-a="qty"]').focus();
    if (!a.by) return f.querySelector('[data-a="by"]').focus();
    const o = { id: uid("o"), date: S.date, item: a.item, kind: it ? it.kind : "", action: a.action, sku: a.sku, po: a.po || "", qty: q, by: a.by, reason: (a.reason || "").trim() || (it ? it.title : ""), title: it ? it.title : a.item };
    R.orders.push(o);
    S.flash = { tab: "news", order: true, undo: { orders: [o.id] }, text: `Asked purchasing: ${actWord(o.action)} ${fmt(q)} cases of ${itemName(o.sku)}${o.po ? ` on ${o.po}` : ""} by ${dlabel(o.by)}.` };
    S.ask = null; commit();
  };
}
/* a sheet that arrived after the month was published: its new numbers are not in the plan until taken */
function lateSheets(pub) {
  if (!pub) return [];
  const w = desk.working(S.date), out = [];
  for (const r of D.regions) {
    const s = desk.latestSheet(S.date, r.code, pub.cycle); if (!s || s.date <= pub.date) continue;
    const prev = s.replaces && desk.byId[s.replaces];
    const lines = Object.entries(s.cells).map(([key, c]) => { const [, sku, m] = key.split("|"); return { key, sku, month: m, cell: c, was: prev ? (prev.cells[key] || {}).cs ?? null : null, plan: (w.grid[r.code + "|" + sku] || {})[m] ?? null }; })
      .filter(l => l.cell.cs != null && l.plan != null && (prev ? l.was !== l.cell.cs : l.plan !== l.cell.cs));
    const taken = l => R.decisions.some(d => d.target === `line:${s.id}|${l.key}` && d.date <= S.date) || R.changes.some(c => c.source === s.id && c.key === l.key && !c.removed_on && c.date <= S.date);
    const open = lines.filter(l => !taken(l)), seen = R.decisions.some(d => d.target === s.id && d.date <= S.date);
    out.push({ sheet: s, prev, lines, open, same: !lines.length, pending: open.length > 0 || (!lines.length && !seen) });
  }
  return out;
}
function lateHtml(x) {
  const s = x.sheet, id = "late:" + s.id, open = x.open.length && (S.open[id] === true || (S.open[id] !== false && x.open.length <= 10));
  if (!x.pending) return "";
  const note = s.meta && s.meta.note || s.note;
  if (x.same) return `<div class="mlist" style="margin-bottom:var(--m)"><div class="mrow open">
    <div class="mhead"><span class="pill sheet">Sheet</span><b>${esc(regName(s.region))} sent ${x.prev ? "a new copy of its" : "its"} ${mname(s.cycle)} sheet after you published</b><span class="hint">same numbers as the plan · ${dlabel(s.date)}</span></div>
    <div class="mbody">${note ? `<div class="msg"><pre>${esc(note)}</pre></div>` : ""}
      <div>No line differs${x.prev ? ` from the ${dlabel(x.prev.date)} copy` : " from the plan"}, so nothing in the plan changes.</div>
      <div class="acts"><button class="btn small primary" data-latesame="${esc(s.id)}">Got it</button><a class="lnk" data-goto="sheet:${esc(s.id)}">Open the sheet</a></div></div>
  </div></div>`;
  return `<div class="mlist" style="margin-bottom:var(--m)"><div class="mrow ${open ? "open" : ""}">
    <div class="mhead" data-latetoggle="${esc(id)}"><span class="pill sheet">Sheet</span><b>${esc(regName(s.region))} sent ${x.prev ? "a new copy of its" : "its"} ${mname(s.cycle)} sheet after you published</b><span class="hint">${plural(x.open.length, "line")} ${x.open.length === 1 ? "differs" : "differ"} · ${dlabel(s.date)}</span><span class="chev">${open ? "▾" : "▸"}</span></div>
    ${open ? `<div class="mbody">${s.meta && s.meta.note || s.note ? `<div class="msg"><pre>${esc(s.note || s.meta.note)}</pre></div>` : ""}
      <table class="plain review" style="margin-top:6px"><tr><th>Item</th><th>Month</th><th class="n">In the plan</th>${x.prev ? `<th class="n">Earlier copy</th>` : ""}<th class="n">New copy</th><th></th></tr>
      ${x.open.map(l => `<tr><td>${esc(itemName(l.sku))}</td><td>${mlabel(l.month)}</td><td class="n">${fmt(l.plan)}</td>${x.prev ? `<td class="n">${fmt(l.was)}</td>` : ""}<td class="n"><b>${fmt(l.cell.cs)}</b></td><td class="acts"><button class="btn small primary" data-takeline="${esc(s.id + "|" + l.key)}">Use new number</button> <button class="btn small" data-keepline="${esc(s.id + "|" + l.key)}">Keep plan</button></td></tr>`).join("")}</table>
      <div class="acts">${x.open.length > 1 ? `<button class="btn small" data-takeall="${esc(s.id)}">Use all ${x.open.length}</button>` : ""}<a class="lnk" data-goto="sheet:${esc(s.id)}">Open the sheet</a></div></div>` : ""}
  </div></div>`;
}
function msgHtml(x, full) {
  if (x.kind === "calendar") return `<div class="msg"><div class="hint">${dlabel(x.date)} · ${esc(x.event.status)} · event date ${esc(x.event.event_date || "")}</div><div>${esc(x.event.detail)}</div></div>`;
  const b = x.mail.body;
  return `<div class="msg"><div class="hint">${dlabel(x.date)} ${x.time || ""} · ${esc(who(x))}${x.mail.attachments.length ? " · 📎 " + esc(x.mail.attachments.join(", ")) : ""}</div><pre>${esc(full ? b : b.split(/\n/)[0].slice(0, 140) + "…")}</pre></div>`;
}
function bindNews() {
  toggles();
  const fu = $("flashUndo"); if (fu) fu.onclick = () => undoFlash(S.flash.undo);
  bindBuy();
  const late = context().late, split = v => { const i = v.indexOf("|"); return [v.slice(0, i), v.slice(i + 1)]; };
  const take = (sid, keys) => {
    const x = late.find(x => x.sheet.id === sid);
    for (const key of keys) { const l = x.open.find(l => l.key === key); if (!l) continue;
      R.changes.push({ id: uid("c"), date: S.date, type: "set", ref: sid, key, qty: l.cell.cs, unit: "CS", to: null, reason: `${regName(x.sheet.region)}'s ${dlabel(x.sheet.date)} sheet`, source: sid, quote: "" }); }
    commit();
  };
  document.querySelectorAll("[data-latetoggle]").forEach(b => b.onclick = () => { const k = b.dataset.latetoggle; S.open[k] = !b.closest(".mrow").classList.contains("open"); renderPage(); });
  document.querySelectorAll("[data-takeline]").forEach(b => b.onclick = () => { const [sid, key] = split(b.dataset.takeline); take(sid, [key]); });
  document.querySelectorAll("[data-latesame]").forEach(b => b.onclick = () => { const id = b.dataset.latesame, x = late.find(x => x.sheet.id === id);
    R.decisions.push({ id: uid("d"), date: S.date, target: id, outcome: "no-change", note: "Same numbers as before" });
    S.flash = { tab: "news", text: `${regName(x.sheet.region)}'s ${dlabel(x.sheet.date)} sheet: same numbers, no change needed.` }; commit(); });
  document.querySelectorAll("[data-takeall]").forEach(b => b.onclick = () => { const x = late.find(x => x.sheet.id === b.dataset.takeall); take(x.sheet.id, x.open.map(l => l.key)); });
  document.querySelectorAll("[data-keepline]").forEach(b => b.onclick = () => { const [sid, key] = split(b.dataset.keepline); R.decisions.push({ id: uid("d"), date: S.date, target: `line:${sid}|${key}`, outcome: "keep", note: "Kept the plan" }); commit(); });
  document.querySelectorAll("[data-work]").forEach(b => b.onclick = () => {
    const th = desk.threadsAt(S.date).find(t => t.id === b.dataset.work), rq = th.items.map(x => x.request).filter(Boolean).pop();
    const why = rq ? (th.items.filter(x => x.request).pop().mail.body.split("\n")[1] || "").trim() : "";
    S.cc = newCard(th, rq ? { type: rq.type, sku: rq.sku, month: rq.month, qty: rq.qty, unit: rq.unit, region: th.region, reason: why ? `${regName(th.region)}: ${why}` : th.title } : {}); renderPage();
  });
  bindChangeCard();
  document.querySelectorAll("[data-aidraft]").forEach(b => b.onclick = () => aiDraft(b.dataset.aidraft));
  document.querySelectorAll("[data-decide]").forEach(b => b.onclick = () => { const v = b.dataset.decide, i = v.lastIndexOf("|"), target = v.slice(0, i), outcome = v.slice(i + 1); S.pending = { target, outcome }; S.ask = null; S.cc = null; renderPage(); setTimeout(() => $("decNote") && $("decNote").focus()); });
  document.querySelectorAll("[data-rmthread]").forEach(b => b.onclick = () => {
    const th = desk.threadsAt(S.date).find(t => t.id === b.dataset.rmthread); if (!th) return;
    for (const x of th.items) R.removed.push({ id: uid("rm"), date: S.date, input: x.id, label: `${th.kind === "calendar" ? "Calendar" : "Message"}: ${th.title}${th.items.length > 1 ? ` (${dlabel(x.date)})` : ""}` });
    commit();
  });
  const df = $("decForm");
  if (df) {
    df.onsubmit = e => {
      e.preventDefault(); const note = $("decNote").value.trim();
      const dt = decideThread(S.pending.target, S.pending.outcome, note);
      S.flash = { tab: "news", undo: { decisions: dt.ids }, text: `${threadTitle(S.pending.target)}: ${S.pending.outcome === "waiting" ? "waiting on someone" : "no change needed"}.` + dt.text };
      S.pending = null; commit();
    };
    $("decCancel").onclick = () => { S.pending = null; renderPage(); };
  }
}
/* the change card: one typed change, filled by hand or by the assistant, saved against a message */
const CTYPES = [["add", "Add or take away"], ["set", "Change total to"], ["move", "Move to month"]];
function newCard(th, init = {}) {
  const plan = desk.planAt(S.date), months = plan ? plan.months : [];
  return { thread: th.id, ref: th.kind === "calendar" ? th.id.replace(/^cal:/, "") : th.id, type: "add", region: th.region || D.regions[0].code, sku: guessSku(th) || D.items[0].sku, month: guessMonth(th) || months[0], qty: "", unit: "CS", to: null, reason: th.title, quote: "", ...init };
}
function cardCalc(c) {
  const it = ITEMS[c.sku], w = desk.working(S.date), cur = (w.grid[c.region + "|" + c.sku] || {})[c.month];
  const q = moveAll(c) ? cur : parseFloat(c.qty); if (q == null || isNaN(q)) return "";
  const cs = c.unit === "EA" ? q / it.ea_per_case : q, conv = c.unit === "EA" ? `${fmt(q)} ${units(c.sku)} ÷ ${it.ea_per_case} = ${fmt(cs)} cases · ` : "";
  if (cur == null) return `${conv}${regName(c.region)} has no plan line for this item`;
  if (c.type === "add") return `${conv}${mlabel(c.month)} ${fmt(cur)} → ${fmt(cur + cs)}`;
  if (c.type === "set") { const prev = R.changes.filter(x => x.ref === c.ref && x.key === `${c.region}|${c.sku}|${c.month}` && !x.removed_on).pop(); return `${conv}${prev ? `replaces the earlier ${fmt(prev.qty)} ${unitWord(c.sku, prev.unit)}` : `${mlabel(c.month)} becomes ${fmt(cs)}`}`; }
  return `${moveAll(c) ? "all of " : ""}${mlabel(c.month)} ${fmt(cur)} → ${fmt(cur - cs)} · ${mlabel(c.to || "")} +${fmt(cs)}`;
}
const moveAll = c => c.type === "move" && String(c.qty).trim() === "";
function changeCardHtml(c = S.cc, idx = null) {
  const plan = desk.planAt(S.date), months = plan ? plan.months : [], k = idx == null ? "" : idx;
  return `<form class="ccard ${c.ai ? "ai" : ""}" data-card="${k}">
    ${c.ai ? `<div class="hint">Drafted by the assistant. Nothing changes until you approve it.</div>` : ""}
    <div class="seg small">${CTYPES.map(([t, n]) => `<button type="button" class="${c.type === t ? "on" : ""}" data-ctype="${t}">${n}</button>`).join("")}</div>
    <div class="row">
      <select data-f="region">${D.regions.map(r => `<option value="${r.code}" ${r.code === c.region ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
      <select data-f="sku">${D.items.map(i => `<option value="${i.sku}" ${i.sku === c.sku ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select>
      <select data-f="month">${months.map(m => `<option value="${m}" ${m === c.month ? "selected" : ""}>${mlabel(m)}</option>`).join("")}</select>
      <input type="number" step="any" data-f="qty" value="${esc(c.qty)}" placeholder="${c.type === "set" ? "total" : c.type === "move" ? "all of them" : "how many"}" style="width:90px">
      ${c.type === "move" ? `<span>to</span><select data-f="to">${months.filter(m => m !== c.month).map(m => `<option value="${m}" ${m === c.to ? "selected" : ""}>${mlabel(m)}</option>`).join("")}</select>`
        : `<select data-f="unit"><option value="CS" ${c.unit === "CS" ? "selected" : ""}>cases</option><option value="EA" ${c.unit === "EA" ? "selected" : ""}>${esc(units(c.sku))}</option></select>`}
    </div>
    <input type="text" data-f="reason" value="${esc(c.reason)}" placeholder="Why (purchasing reads this)">
    ${c.quote ? `<div class="quote">“${esc(c.quote)}”</div>` : ""}
    ${c.checks && c.checks.length ? `<div class="warn-text">${c.checks.map(esc).join(" · ")}</div>` : ""}
    <div class="row"><span class="calc">${esc(cardCalc(c))}</span><span class="spacer"></span><button class="btn small primary">${c.ai ? "Approve" : "Save change"}</button><button type="button" class="btn small" data-cclose="${k}">${c.ai ? "Reject" : "Cancel"}</button></div>
  </form>`;
}
function bindChangeCard() {
  document.querySelectorAll("form.ccard[data-card]").forEach(f => {
    const idx = f.dataset.card, get = () => idx === "" ? S.cc : S.aiDrafts[+idx];
    f.querySelectorAll("[data-ctype]").forEach(b => b.onclick = () => { const c = get(); c.type = b.dataset.ctype; if (c.type === "move" && !c.to) { const ms = desk.planAt(S.date).months; c.to = ms[ms.indexOf(c.month) + 1] || ms[0]; c.unit = "CS"; } renderPage(); });
    f.querySelectorAll("[data-f]").forEach(el => el.oninput = el.onchange = () => { const c = get(); c[el.dataset.f] = el.value; const calc = f.querySelector(".calc"); if (calc) calc.textContent = cardCalc(c); if (el.tagName === "SELECT" && el.dataset.f !== "region") renderPage(); });
    f.querySelector("[data-cclose]").onclick = () => { if (idx === "") S.cc = null; else S.aiDrafts.splice(+idx, 1); renderPage(); };
    f.onsubmit = e => {
      e.preventDefault();
      const c = get();
      const cur = (desk.working(S.date).grid[c.region + "|" + c.sku] || {})[c.month];
      if (moveAll(c)) c.qty = cur;
      if (isNaN(parseFloat(c.qty))) { const q = f.querySelector('[data-f="qty"]'); if (q) q.focus(); return; }
      const calcText = cardCalc(c);
      const cid = uid("c");
      R.changes.push({ id: cid, date: S.date, type: c.type, ref: c.ref, key: `${c.region}|${c.sku}|${c.month}`, qty: +c.qty, unit: c.type === "move" ? "CS" : c.unit, to: c.type === "move" ? c.to : null, reason: c.reason, source: c.thread, quote: c.quote || "", ai: !!c.ai, ...(c.replaces ? { replaces: c.replaces } : {}) });
      const dt = decideThread(c.thread, "changed", c.reason, c.ref, c.month);
      S.flash = { tab: "news", change: true, undo: { changes: [cid], decisions: dt.ids }, text: `Saved: ${regName(c.region)}, ${itemName(c.sku)} ${mlabel(c.month)}, ${calcText}.` + dt.text };
      if (idx === "") S.cc = null; else S.aiDrafts.splice(+idx, 1);
      commit();
      // what the change sent to purchasing by itself
      const sent = (desk.purchaseNews(S.date).autos || []).filter(o => o.sku === c.sku && [c.month, c.to].includes(o.month) && o.by >= S.date);
      if (sent.length) { S.flash.text += ` Added to purchasing's list: ${sent.map(o => `${o.action === "cut" ? `cut ${fmt(o.qty)} cases from ${o.po}` : `order ${fmt(o.qty)} cases`} for ${mlabel(o.month)}`).join(", ")}.`; renderPage(); }
    };
  });
}
async function aiDraft(threadId) {
  if (S.aiBusy) return;
  const th = desk.threadsAt(S.date).find(t => t.id === threadId); if (!th) return;
  S.aiBusy = threadId; S.aiNote = null; S.aiDrafts = (S.aiDrafts || []).filter(c => c.thread !== threadId); renderPage();
  const j = await aiCall("/api/draft", { message: desk.messageText(threadId, S.date), context: desk.assistantContext(S.date, { focus: threadId }) });
  S.aiBusy = null;
  if (j.error) S.aiNote = { thread: threadId, text: j.error === "Assistant server not running" ? j.error : AI.connected ? j.error : "Assistant not connected. Use Log a change instead.", error: true };
  else {
    const def = newCard(th);
    for (const c of j.changes || []) S.aiDrafts.push(newCard(th, { ...c, ref: c.ref || def.ref, region: c.region || def.region, sku: c.sku || def.sku, month: c.month || def.month, qty: c.qty ?? "", unit: c.unit || "CS", ai: true }));
    S.aiNote = { thread: threadId, text: j.note || (j.changes && j.changes.length ? "" : "No change drafted.") };
  }
  S.open[threadId] = true; renderPage();
}
function guessSku(th) {
  const t = th.items.map(x => x.kind === "email" ? x.mail.subject + " " + x.mail.body : x.event.detail).join(" ");
  const code = D.items.find(i => new RegExp("\\b" + i.sku + "\\b").test(t));
  return code ? code.sku : (D.items.find(i => t.toLowerCase().includes(i.name.toLowerCase().replace(/ \/.*$/, ""))) || {}).sku || null;
}
function threadTitle(id) { const t = desk.threadsAt(S.date).find(x => x.id === id); if (t) return t.title; const b = buyItem(id); return b ? b.title : id; }
function guessMonth(th) {
  const t = th.items.map(x => x.kind === "email" ? x.mail.subject + " " + x.mail.body : x.event.detail).join(" ");
  const plan = desk.planAt(S.date); if (!plan) return null;
  return plan.months.find(m => new RegExp("\\b" + MONTHS[+m.slice(5) - 1] + "\\b", "i").test(t)) || null;
}

/* ================================================================ 5 Send to purchasing */
function pageSend(X) {
  const back = { label: "Late news", act: () => go("news") };
  if (!X.pub) {
    $("page").innerHTML = head("Send to purchasing", `Purchasing gets the ${X.month} plan once it is published. It is not published yet.`);
    foot({ back, main: { label: `Go to publish`, act: () => go("publish") } }); return;
  }
  const rl = desk.releaseList(S.date), rows = rl.rows, net = rows.reduce((t, x) => t + x.d, 0), oa = desk.ordersAt(S.date), ofile = `order-actions-for-purchasing-${S.date}.csv`;
  const keyOf = x => `${D.regions.find(r => r.name === x.region).code}|${x.sku}|${x.month}`;
  const file = `${X.month.toLowerCase()}-plan-for-purchasing-${S.date}.csv`, span = `${mlabel(rl.months[0])} to ${mlabel(rl.months[rl.months.length - 1])}`;
  $("page").innerHTML = `
    ${head("Send to purchasing", `Purchasing gets the ${esc(rl.base.name)} as it stands today: all ${fmt(rl.count)} lines, ${span}, in cases. Lines you changed since publishing on ${dlabel(rl.base.date)} show the published number, the change and why.`)}
    <p class="sum">${rows.length ? `<b>${plural(rows.length, "line")} changed since publishing</b>, ${sign(Math.round(net))} cases in all.` : "<b>No changes since publishing.</b> The file matches the published plan."}</p>
    ${rows.length ? `<table class="plain review"><tr><th>Region</th><th>Item</th><th>Month</th><th class="n">Published</th><th class="n">Now</th><th class="n">Change</th><th>Why</th><th>How</th></tr>
      ${rows.map(x => `<tr><td>${esc(x.region)}</td><td><a data-goto="plan:${keyOf(x)}">${esc(x.item)}</a></td><td>${mlabel(x.month)}</td><td class="n">${fmt(x.released)}</td><td class="n"><b>${fmt(x.proposed)}</b></td><td class="n ${x.d > 0 ? "up" : "down"}">${sign(x.d)}</td><td class="why" title="${esc(x.reason)}">${esc(x.reason)}</td><td class="hint">${esc(x.how)}</td></tr>`).join("")}</table>` : ""}
    <h2>Order actions</h2>
    ${oa.rows.length ? `<p class="sum"><b>${plural(oa.rows.length, "order action")}</b> from your plan changes and Late news. They go to purchasing as a second file, ${esc(ofile)}.</p>
      <table class="plain review"><tr><th>Since</th><th>Action</th><th>Item</th><th>Order</th><th class="n">Cases</th><th>By</th><th>Why</th></tr>
      ${oa.rows.map(o => `<tr><td>${dlabel(o.date)}</td><td><b>${esc(o.actionText)}</b></td><td>${esc(itemName(o.sku))}</td><td>${esc(o.po || "new order")}</td><td class="n">${fmt(o.qty)}</td><td>${dlabel(o.by)}</td><td class="why" title="${esc(o.reason)}">${esc(o.reason)}</td></tr>`).join("")}</table>
      <div class="acts"><button class="btn" id="dlOrders">Download the order actions</button>${S.sentOrders === S.date ? ` <span class="hint">Saved ${esc(ofile)} to your downloads folder.</span>` : ""}</div>`
    : `<p class="hint">No order actions. A plan change sends its order here by itself; a Short in Late news can add one.</p>`}`;
  if ($("dlOrders")) $("dlOrders").onclick = () => { download(ofile, oa.csv, "text/csv"); S.sentOrders = S.date; renderPage(); };
  foot({ back, note: S.sent === S.date ? `Saved ${file} to your downloads folder. Send it to purchasing${oa.rows.length ? ", with the order actions" : ""}.` : X.news.count ? `${plural(X.news.count, "item")} in Late news still open, not in this plan` : "", main: { label: "Download the plan for purchasing", act: () => { download(file, rl.csv, "text/csv"); S.sent = S.date; renderPage(); } } });
}

/* ================================================================ Add by hand: paste, drop, file, folder */
function addBoxHtml() {
  const p = S.preview;
  return `<div class="addbox" id="addbox">
    <textarea id="pasteBox" placeholder="Paste a sheet or an email here, or drop a file on this box">${esc(S.pasteText || "")}</textarea>
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
    const cycles = [...new Set(p.read.entries.map(e => e.month).filter(Boolean))].sort();
    return `<div class="preview">
      <div class="hint">Read as a request sheet</div>
      <div class="kv"><div>Region</div><div><select id="pvRegion">${D.regions.map(g => `<option value="${g.code}" ${g.code === p.region ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>
      <div>Month</div><div><select id="pvCycle">${cycles.map(m => `<option value="${m}" ${m === cyc ? "selected" : ""}>${mlong(m)}</option>`).join("")}</select></div>
      <div>Lines</div><div>${r.counts.cells} read · ${r.counts.ea} converted to cases · ${r.counts.carried} blanks carried</div></div>
      ${r.problems.length ? `<div class="problems">${r.problems.slice(0, 8).map(esc).join("<br>")}${r.problems.length > 8 ? `<br>and ${r.problems.length - 8} more` : ""}</div>` : `<div class="hint ok-text">Every line read.</div>`}
      <div class="acts"><button class="btn primary" id="pvAdd">Add this sheet</button><button class="btn" id="pvCancel">Cancel</button></div></div>`;
  }
  const m = p.mail;
  return `<div class="preview">
    <div class="hint">Read as a message</div>
    <div class="kv"><div>Subject</div><div><input type="text" id="pvSubject" value="${esc(m.subject)}"></div>
    <div>From</div><div>${esc(m.sender || "—")}${m.date ? ` · written ${dlabel(m.date)}` : ""}</div>
    <div>Region</div><div><select id="pvRegion"><option value="">All regions or unknown</option>${D.regions.map(g => `<option value="${g.code}" ${g.code === p.region ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div></div>
    <pre>${esc(m.body.slice(0, 400))}${m.body.length > 400 ? "…" : ""}</pre>
    <div class="acts"><button class="btn primary" id="pvAdd">Add this message</button><button class="btn" id="pvCancel">Cancel</button></div></div>`;
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

/* ================================================================ History (to the side) */
const sideFoot = () => foot({ back: { label: `Back to ${(STEPS.find(([id]) => id === S.from) || STEPS[0])[1]}`, act: () => go(S.from || "sheets") } });
function pageHistory() {
  $("page").innerHTML = `
    ${head("History", "Everything that arrived or changed, in order. Trends and version comparisons are here too.")}
    <div class="row"><div class="seg">${[["log", "What happened"], ["trend", "Trends"], ["compare", "Compare versions"]].map(([k, n]) => `<button class="${S.hist === k ? "on" : ""}" data-hist="${k}">${n}</button>`).join("")}</div></div>
    <div id="histBody"></div>
    <div class="more"><button class="btn link" data-toggle="record">${S.open.record ? "▾" : "▸"} This browser's record</button>${S.open.record ? `<div class="morebody">
      <button class="btn small" id="recExport">Save a copy</button>
      <label class="btn small">Load a copy<input type="file" id="recImport" accept=".json" hidden></label>
      <button class="btn small" id="recExample">Start over from the September example</button>
      <button class="btn small danger" id="recClear">Clear everything</button></div>` : ""}</div>`;
  ({ log: histLog, trend: histTrend, compare: histCompare })[S.hist]();
  document.querySelectorAll("[data-hist]").forEach(b => b.onclick = () => { S.hist = b.dataset.hist; renderPage(); });
  toggles();
  if (S.open.record) {
    $("recExport").onclick = () => download(`supply-desk-record-${S.date}.json`, JSON.stringify(R, null, 1), "application/json");
    $("recImport").onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const v = JSON.parse(t); if (!v.edits || !v.inputs) throw 0; R = { ...emptyRecord(), ...v }; commit(); } catch { alert("That file is not a desk record copy."); } }); };
    $("recExample").onclick = () => { if (confirm("Replace this browser's record with the September example? Save a copy first to keep it.")) { R = workedExample(); S.date = desk.sheets.filter(s => s.cycle === "2026-10").map(s => s.date).sort()[0]; save("date", S.date); S.from = "sheets"; commit(); } };
    $("recClear").onclick = () => { if (confirm("Delete everything added, changed, decided and published in this browser? Save a copy first to keep it.")) { R = emptyRecord(); commit(); } };
  }
  sideFoot();
}
function logEntries(T) {
  const out = [];
  for (const x of desk.inputsAt(T)) {
    if (x.kind === "sheet") {
      if (x.error) { out.push({ date: x.date, kind: "sheet", text: `Could not read ${esc(short(x.src))}: ${esc(x.error)}` }); continue; }
      const prev = x.replaces && desk.byId[x.replaces];
      let changed = 0; if (prev) for (const [k, c] of Object.entries(x.cells)) if (!prev.cells[k] || prev.cells[k].cs !== c.cs) changed++;
      out.push({ date: x.date, kind: "sheet", text: `<b>${esc(regName(x.region))}</b> sent its ${mlong(x.cycle)} sheet${prev ? `, replacing the ${dlabel(prev.date)} copy (${plural(changed, "line")} changed)` : ""}. ${x.counts.cells} lines, ${x.counts.ea} converted to cases, ${x.counts.carried} carried forward${x.problems.length ? `, <span class="warn-text">${plural(x.problems.length, "line")} unreadable</span>` : ""}.${x.origin === "added" ? " Added here." : ""} <a data-goto="sheet:${esc(x.id)}">See the sheet</a>`, why: x.meta && x.meta.note });
    } else if (x.kind === "plan") {
      const r = x.release, verb = { Posted: "posted; it became the plan in force", Withdrawn: "saved, then withdrawn", Working: "saved as a working draft", Scenario: "saved as a side scenario; never the plan in force" }[r.disposition] || r.disposition;
      out.push({ date: x.date, kind: "plan", text: `Plan file <b>${esc(short(r.file).replace(/\.xlsx$/, ""))}</b> ${verb}.`, why: r.note });
    } else if (x.kind === "email") out.push({ date: x.date, time: x.time, kind: "msg", text: `${x.from === "manager" ? "Request" : "Email"} from ${esc(who(x))}: <b>${esc(x.mail.subject)}</b>${x.origin === "added" && x.from !== "manager" ? " (added here)" : ""}`, body: x.mail.body });
    else if (x.kind === "calendar") out.push({ date: x.date, kind: "msg", text: `Calendar: <b>${esc(x.event.id)}</b> ${esc(x.event.type)}, ${esc(x.event.status.toLowerCase())}`, why: x.event.detail });
  }
  for (const e of R.edits.filter(e => e.date <= T)) {
    const [r, sku, m] = e.key.split("|");
    out.push({ date: e.date, kind: "you", text: `You changed ${esc(regName(r))} · ${esc(itemName(sku))} · ${mlabel(m)} by <b>${sign(e.dv)}</b> cases. <a data-goto="plan:${e.key}">Open</a>`, why: e.reason });
  }
  for (const c of R.changes.filter(c => c.date <= T && ["add", "set", "move"].includes(c.type))) {
    const [r, sku, m] = (c.key || "||").split("|");
    const what = `${{ add: "added to", set: "set", move: "moved" }[c.type]} ${esc(regName(r))} · ${esc(itemName(sku))} · ${mlabel(m)}${c.type === "move" ? " → " + mlabel(c.to) : ""}: ${fmt(c.qty)} ${unitWord(sku, c.unit)}`;
    out.push({ date: c.date, kind: "you", text: `You ${what}.${c.source ? ` From: ${esc(srcName(c.source))}.` : ""}${c.key ? ` <a data-goto="plan:${c.key}">Open</a>` : ""}`, why: c.reason });
    if (c.removed_on && c.removed_on <= T) out.push({ date: c.removed_on, kind: "you", text: `You undid a ${dlabel(c.date)} change (${esc(c.reason)}).` });
  }
  for (const it of desk.purchaseNews(T).filter(i => i.kind === "short" || i.kind === "request")) out.push({ date: it.date, kind: "msg", text: `${esc(it.from || "Purchasing")}: <b>${esc(it.title)}</b>`, why: [it.source, it.quote].filter(Boolean).join(" · ") });
  for (const o of (R.orders || []).filter(o => o.date <= T)) {
    out.push({ date: o.date, kind: "you", text: `You asked purchasing to ${actWord(o.action)} <b>${fmt(o.qty)} cases</b> of ${esc(itemName(o.sku))}${o.po ? ` on ${esc(o.po)}` : ""} by ${dlabel(o.by)}. From: ${esc(o.title)}.`, why: o.reason !== o.title ? o.reason : "" });
    if (o.removed_on && o.removed_on <= T) out.push({ date: o.removed_on, kind: "you", text: `You took back a ${dlabel(o.date)} ask of purchasing (${actWord(o.action)} ${fmt(o.qty)} cases of ${esc(itemName(o.sku))}).` });
  }
  for (const e of (R.reportEdits || []).filter(e => e.date <= T)) {
    const [r, sku, m] = e.key.split("|");
    out.push({ date: e.date, kind: "you", text: e.cs == null ? `You undid your correction to ${esc(regName(r))}'s sheet: ${esc(itemName(sku))} · ${mlabel(m)}.` : `You corrected ${esc(regName(r))}'s sheet: ${esc(itemName(sku))} · ${mlabel(m)} to <b>${fmt(e.cs)}</b> cases.` });
  }
  for (const x of (R.removed || []).filter(x => x.date <= T)) out.push({ date: x.date, kind: "you", text: `You removed ${esc(x.label || x.input)}.` });
  for (const d of R.decisions.filter(d => d.date <= T)) {
    if (d.outcome === "changed" || d.outcome === "keep" || d.target.startsWith("draft:") || d.target.startsWith("line:")) continue;
    out.push({ date: d.date, kind: "you", text: `You marked <b>${esc(srcName(d.target))}</b> as ${d.outcome === "waiting" ? "waiting on someone" : "no change needed"}.`, why: d.note });
  }
  const checked = {}; for (const d of R.decisions.filter(d => d.date <= T && d.target.startsWith("draft:"))) checked[d.date] = (checked[d.date] || 0) + 1;
  for (const [date, n] of Object.entries(checked)) out.push({ date, kind: "you", text: `You decided ${plural(n, "line")} under Check.` });
  for (const v of R.versions.filter(v => v.date <= T)) out.push({ date: v.date, kind: "plan", text: `You published <b>${esc(v.name)}</b>. It became the plan in force.`, why: v.note });
  const rank = e => ({ you: 0, plan: 1 })[e.kind] ?? 2;
  return out.sort((a, b) => b.date.localeCompare(a.date) || rank(a) - rank(b) || (b.time || "").localeCompare(a.time || ""));
}
function histLog() {
  const kinds = [["all", "Everything"], ["plan", "Plans"], ["sheet", "Sheets"], ["msg", "Messages"], ["you", "Yours"]];
  const all = logEntries(S.date), es = all.filter(e => S.histKind === "all" || e.kind === S.histKind);
  let last = "";
  const rows = es.map((e, i) => { const d = e.date !== last ? `<div class="day">${dlong(e.date)}</div>` : ""; last = e.date; const id = "log" + i;
    return d + `<div class="logrow ${e.kind}"><span class="pill ${e.kind}">${{ plan: "Plan", sheet: "Sheet", msg: "Message", you: "You" }[e.kind]}</span><div><div>${e.text}${e.body ? ` <button class="btn small link" data-logopen="${id}">${S.open[id] ? "Hide" : "Read"}</button>` : ""}</div>${e.why ? `<div class="hint">${esc(e.why)}</div>` : ""}${e.body && S.open[id] ? `<pre>${esc(e.body)}</pre>` : ""}</div></div>`; }).join("");
  $("histBody").innerHTML = `
    <div class="seg small" style="margin:10px 0">${kinds.map(([k, n]) => `<button class="${S.histKind === k ? "on" : ""}" data-kind="${k}">${n} (${k === "all" ? all.length : all.filter(e => e.kind === k).length})</button>`).join("")}</div>
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
  posted.forEach(v => { if (plan && v.id === plan.base.id) return; series.push({ name: v.name, cls: "old", pts: v.months.map(m => [m, sum(r => v.grid[r + "|" + sku] && v.grid[r + "|" + sku][m])]) }); });
  if (plan) series.push({ name: `Plan now (${plan.base.name}${desk.changesAt ? " with changes" : ""})`, cls: "now", pts: plan.months.map(m => [m, sum(r => plan.grid[r + "|" + sku] && plan.grid[r + "|" + sku][m])]) });
  const reqMonths = {};
  for (const s of desk.sheetsAt(T)) for (const c of Object.values(s.cells)) if (c.sku === sku && regs.includes(s.region) && c.cs != null) (reqMonths[c.month] = reqMonths[c.month] || {})[s.region] = c.cs;
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
      <select id="tReg"><option value="">All regions</option>${D.regions.map(r => `<option value="${r.code}" ${r.code === region ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
    </div>
    ${svg}
    <div class="legend">${series.map(s => `<span><i class="sw ${s.cls}"></i>${esc(s.name)}</span>`).join("")}</div>
    ${hasSales ? `<div class="hint">Use from sales counts one drink's servings × its portion standard (${esc((D.sales_drinks.find(d => d.sku === sku) || {}).name || "")}). Other drinks use this item too, so real use is at least this line. September is partial, to Sep 18.</div>` : `<div class="hint">No portion standard links sales to this item, so there is no sales line. The packet has standards for three items only.</div>`}`;
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
    <div class="hint" style="margin-top:6px">${plural(rows.length, "line")} ${rows.length === 1 ? "differs" : "differ"}. Note on the later one: ${esc(B.note || "—")}</div>`;
  $("dA").onchange = e => { S.diffA = e.target.value; renderPage(); };
  $("dB").onchange = e => { S.diffB = e.target.value; renderPage(); };
}

/* ================================================================ Ask (to the side) */
function pageAsk() {
  const examples = ["Why did Gulf Coast mango October change?", "What changed since the last published plan?", "What is Late news still waiting on?"];
  const hist = S.asks || [];
  $("page").innerHTML = `<div class="ask">
    ${head("Ask", "Ask a question about the plan, a sheet, an email or a change. The answer comes only from this desk's record and names its source.")}
    <form class="askbox" id="askForm"><textarea id="askQ" placeholder="Ask about the plan, a sheet, an email or a change">${esc(S.askQ || "")}</textarea><button class="btn primary" ${S.asking ? "disabled" : ""}>${S.asking ? "Thinking…" : "Ask"}</button></form>
    ${AI.checked && !AI.connected ? `<div class="hint">${AI.server ? "The assistant is not connected here: the server has no API key." : "The assistant server is not running (npm run dev)."}</div>` : ""}
    ${hist.length ? "" : `<div class="chips">${examples.map(q => `<button class="chip" data-askex="${esc(q)}">${esc(q)}</button>`).join("")}</div>`}
    ${hist.map(h => `<div class="qa"><div class="q">${esc(h.q)}</div>${h.error ? `<div class="ainote bad">${esc(h.error)}</div>` : `<div class="a">${esc(h.answer)}</div><div class="cites">${(h.cites || []).map(c => `<span class="pill">${esc(c.label || c.id)}</span>`).join(" ")}</div>`}<div class="hint">as of ${dlabel(h.date)}</div></div>`).join("")}
  </div>`;
  const ask = async q => {
    if (!q.trim() || S.asking) return;
    S.asking = true; S.askQ = q; renderPage();
    const j = await aiCall("/api/ask", { question: q, context: desk.assistantContext(S.date) });
    S.asking = false; S.askQ = "";
    (S.asks = S.asks || []).unshift({ q, date: S.date, ...(j.error ? { error: j.error } : j) });
    renderPage();
  };
  $("askForm").onsubmit = e => { e.preventDefault(); ask($("askQ").value); };
  $("askQ").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(e.target.value); } };
  document.querySelectorAll("[data-askex]").forEach(b => b.onclick = () => ask(b.dataset.askex));
  sideFoot();
}

/* ================================================================ Submanager page: region → sheet → late request → done */
const MSTEPS = [["region", "Your region"], ["sheet", "Send your sheet"], ["late", "Late request"], ["done", "Done"]];
function mgo(step) { S.mstep = step; save("mstep", step); S.preview = null; S.mnote = null; render(); }
function renderManager() {
  document.body.classList.add("manager");
  if (!S.mgr && S.mstep !== "region") S.mstep = "region";
  const reg = S.mgr, cyc = desk.cycleAt(S.date) || S.date.slice(0, 7);
  $("clock").innerHTML = `<span class="daylbl">Day</span><b>${dlong(S.date)}</b>${reg ? `<span class="hint">· ${esc(regName(reg))}</span>` : ""}`;
  $("side").innerHTML = `<a class="sidelink" href="./">Head manager view</a>`;
  const si = MSTEPS.findIndex(([id]) => id === S.mstep);
  $("rail").innerHTML = MSTEPS.map(([id, n], i) => `<button class="step ${S.mstep === id ? "on" : ""} ${si > i ? "past" : ""}" data-mstep="${id}" ${!reg && id !== "region" ? "disabled" : ""}><span class="no">${i + 1}</span><span class="nm">${n}</span><span class="st"></span></button>`).join("");
  document.querySelectorAll("[data-mstep]").forEach(b => b.onclick = () => mgo(b.dataset.mstep));
  const mine = reg ? desk.inputs.filter(x => x.region === reg && x.date <= S.date && (x.kind === "sheet" || x.from === "manager")).slice(-8).reverse() : [];
  const sentList = () => `<div class="mlist">${mine.map(x => `<div class="mrow"><div class="mhead"><span class="pill ${x.kind === "sheet" ? "sheet" : "email"}">${x.kind === "sheet" ? "Sheet" : "Request"}</span><b>${esc(x.kind === "sheet" ? `${mlong(x.cycle)} sheet${x.replaces ? ", corrected copy" : ""}` : x.mail.body.split(String.fromCharCode(10))[0])}</b><span class="hint">${esc(x.note || "")}</span><span class="hint">${dlabel(x.date)}</span></div></div>`).join("") || `<div class="empty">Nothing sent yet.</div>`}</div>`;
  const page = $("page");
  if (S.mstep === "region") {
    page.innerHTML = `${head("Which region are you?", "Pick your region. You can change it later.")}
      <div class="rboxes">${D.regions.map(r => `<button class="rbox ${r.code === reg ? "sel" : ""}" data-pick="${r.code}"><b>${esc(r.name)}</b><span>${esc(r.manager || "")}</span></button>`).join("")}</div>`;
    document.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { S.mgr = b.dataset.pick; save("mgr", S.mgr); mgo("sheet"); });
    foot({ note: "", main: { label: reg ? `Next: send ${regName(reg)}'s sheet` : "Pick a region first", disabled: !reg, act: () => mgo("sheet") } });
    return;
  }
  if (S.mstep === "sheet") {
    const p = S.preview, prev = desk.latestSheet(S.date, reg, cyc);
    page.innerHTML = `${head(`Send ${esc(regName(reg))}'s sheet`, `Drop the Excel request sheet you always send. The head manager sees it straight away.${prev ? ` You already sent your ${mname(cyc)} sheet on ${dlabel(prev.date)}; sending again replaces it.` : ""}`)}
      ${S.mnote ? `<div class="okline">${esc(S.mnote)}</div>` : ""}
      <div class="drop" id="mgrDrop">${p ? mgrPreview(p) : `<b>Drop your request sheet here</b><span class="hint">or</span><label class="btn">Choose file<input type="file" id="mgrFile" accept=".xlsx,.xls,.csv" hidden></label>`}</div>`;
    const dz = $("mgrDrop");
    dz.ondragover = e => { e.preventDefault(); dz.classList.add("on"); };
    dz.ondragleave = () => dz.classList.remove("on");
    const take = async f => { const pv = await readInput(f.name, f); if (pv.kind === "sheet") { pv.looksLike = pv.region; pv.region = reg; resolvePreview(pv); } S.preview = pv; S.mnote = null; render(); };
    dz.ondrop = e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) take(f); };
    const fi = $("mgrFile"); if (fi) fi.onchange = e => { if (e.target.files[0]) take(e.target.files[0]); };
    const c = $("pvCancel"); if (c) c.onclick = () => { S.preview = null; render(); };
    const ok = p && !p.error && p.kind === "sheet" && p.res.counts.cells > 0;
    const send = () => { const id = addPreview(S.preview); const x = R.inputs.find(i => i.id === id); x.from = "manager"; x.note = ($("pvNote") || {}).value || ""; S.preview = null; S.mstep = "late"; save("mstep", "late"); S.mnote = `Sheet sent on ${dlabel(S.date)}.`; commit(); };
    foot({ back: { label: "Your region", act: () => mgo("region") }, main: ok ? { label: "Send sheet", act: send } : p && !p.error && p.kind === "sheet" ? { label: "Nothing on this file to send", disabled: true } : { label: prev ? "Skip: keep the sheet I sent" : "Skip: no sheet to send", act: () => mgo("late") } });
    return;
  }
  if (S.mstep === "late") {
    const months = (desk.planAt(S.date) || { months: [] }).months.filter(m => m >= S.date.slice(0, 7));
    page.innerHTML = `${head("Late request", `Need more or less of something after your sheet went in? Send it here. The head manager sees it under Late news. If you need nothing, go on to Done.`)}
      ${S.mnote ? `<div class="okline">${esc(S.mnote)}</div>` : ""}
      <form class="mgrreq" id="mgrReq">
        <label>Item<select id="rqItem">${D.items.map(i => `<option value="${i.sku}">${esc(i.name)}</option>`).join("")}</select></label>
        <label>Month<select id="rqMonth">${months.map((m, i) => `<option value="${m}" ${i === Math.min(1, months.length - 1) ? "selected" : ""}>${mlong(m)}</option>`).join("")}</select></label>
        <label>What<select id="rqType"><option value="add">Add this many</option><option value="set">Make the total</option></select></label>
        <label>How many<span class="pair"><input type="number" id="rqQty" style="width:90px"><select id="rqUnit"><option value="CS">cases</option><option value="EA">bottles, bags or units</option></select></span></label>
        <label class="grow">Why<input type="text" id="rqWhy" placeholder="e.g. promo at 4 shops"></label>
      </form>`;
    const send = () => {
      const sku = $("rqItem").value, m = $("rqMonth").value, q = $("rqQty").value, unit = $("rqUnit").value, type = $("rqType").value, why = $("rqWhy").value.trim();
      if (!q) return $("rqQty").focus();
      const what = `${type === "set" ? "Make it a total of" : "Add"} ${q} ${unitWord(sku, unit)} of ${itemName(sku)} for ${mlong(m)}`;
      R.inputs.push({ id: uid("in"), date: S.date, time: new Date().toTimeString().slice(0, 5), src: "submanager page", kind: "email", from: "manager", region: reg,
        request: { sku, month: m, type, qty: +q, unit }, mail: { date: S.date, time: "", sender: `${REGIONS[reg].manager || regName(reg)} | ${regName(reg)}`, to: "Central planning", subject: `${regName(reg)} request: ${itemName(sku)} ${mlabel(m)}`, body: `${what}.\n${why}`, attachments: [] } });
      S.mnote = `Request sent: ${what}.${why ? " " + why : ""}`; commit();
    };
    $("mgrReq").onsubmit = e => { e.preventDefault(); send(); };
    const just = S.mnote && S.mnote.startsWith("Request sent");
    if (just) { $("mgrReq").style.display = "none"; }
    foot(just
      ? { back: { label: "Send your sheet", act: () => mgo("sheet") }, main: { label: "Next: done", act: () => mgo("done") }, note: `<button class="btn link" id="another">Send another request</button>` }
      : { back: { label: "Send your sheet", act: () => mgo("sheet") }, main: { label: "Send request", act: send }, note: `<button class="btn link" id="toDone">Nothing to request: go to Done ▶</button>` });
    if (just) $("another").onclick = () => { S.mnote = null; render(); }; else $("toDone").onclick = () => mgo("done");
    return;
  }
  const pubd = R.versions.some(v => v.cycle === cyc && v.date <= S.date);
  page.innerHTML = `${head("Done", `This is what ${esc(regName(reg))} has sent. ${pubd ? `The ${mname(cyc)} plan is already published; the head manager sees anything new under Late news.` : "The head manager checks it and publishes the plan."}`)}${sentList()}`;
  foot({ back: { label: "Late request", act: () => mgo("late") }, main: { label: "Send something else", act: () => mgo("sheet") } });
}
function mgrPreview(p) {
  if (p.error) return `<div class="preview bad"><b>Could not read ${esc(p.name)}</b><div>${esc(p.error)}</div><div class="acts"><button class="btn small" id="pvCancel">Try another file</button></div></div>`;
  if (p.kind !== "sheet") return `<div class="preview bad"><b>That isn't a request sheet.</b><div class="acts"><button class="btn small" id="pvCancel">Try another file</button></div></div>`;
  const r = p.res, prev = desk.latestSheet(S.date, p.region, p.cycle), probs = [...new Set(r.problems)];
  if (p.looksLike && p.looksLike !== p.region) return `<div class="preview bad"><b>This looks like ${esc(regName(p.looksLike))}'s sheet, not ${esc(regName(p.region))}'s.</b><div>${esc(p.name)}: none of its item codes are on ${esc(regName(p.region))}'s list. Choose your own region's file, or go back and pick ${esc(regName(p.looksLike))}.</div><div class="acts"><button class="btn small" id="pvCancel">Choose a different file</button></div></div>`;
  let changed = 0; if (prev) for (const [k, c] of Object.entries(r.cells)) if (!prev.cells[k] || prev.cells[k].cs !== c.cs) changed++;
  return `<div class="preview">
    <p><b>${esc(regName(p.region))} · ${mlong(p.cycle)} sheet</b>${prev ? (changed ? `, replacing your ${dlabel(prev.date)} copy (${plural(changed, "line")} changed)` : `: the same numbers as your ${dlabel(prev.date)} copy`) : ""}</p>
    <p>${plural(r.counts.cells, "line")} read. ${r.counts.ea ? `${r.counts.ea} converted from bottles or bags to cases.` : ""} ${probs.length ? `<span class="warn-text">${plural(probs.length, "problem")}; the head manager will see ${probs.length === 1 ? "it" : "them"}.</span>` : `<span class="ok-text">Every line read.</span>`}</p>
    ${probs.length ? `<div class="problems">${probs.slice(0, 6).map(esc).join("<br>")}${probs.length > 6 ? `<br>and ${probs.length - 6} more` : ""}</div>` : ""}
    ${prev ? `<input type="text" id="pvNote" placeholder="What changed? (the head manager sees this)" style="width:100%;margin-top:6px">` : ""}
    <div class="acts"><button class="btn" id="pvCancel">Choose a different file</button></div></div>`;
}

/* ------------------------------------------------------------ outputs */
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
/* ------------------------------------------------------------ the September worked example */
function workedExample() {
  const rec = emptyRecord(), d0 = C.Desk(D, rec), dv = d0.draftVersion("2026-09-11");
  rec.versions.push({ ...dv, id: uid("v"), name: "September plan", note: "" });
  const ch = (date, type, ref, key, qty, unit, reason, source, extra = {}) => rec.changes.push({ id: uid("c"), date, type, ref, key, qty, unit, reason, source, quote: "", ...extra });
  const mango = "thread:october mango request", kit = "thread:second opening / new dock week";
  ch("2026-09-14", "add", "GC-PROMO-01", "R06|S014|2026-10", 720, "EA", "Oct mango promo", mango);
  for (const [sku, q] of [["S001", 24], ["S005", 18], ["S014", 12]]) ch("2026-09-16", "move", "OP-FR-02", `R04|${sku}|2026-10`, q, "CS", "Opening kit moved to Nov 2", kit, { to: "2026-11" });
  ch("2026-09-17", "set", "GC-PROMO-01", "R06|S014|2026-10", 480, "EA", "Promo cut to 480 bottles", mango);
  for (const [date, target] of [["2026-09-16", "cal:OP-FR-02"], ["2026-09-16", kit], ["2026-09-17", "cal:GC-PROMO-01"], ["2026-09-17", mango]]) rec.decisions.push({ id: uid("d"), date, target, outcome: "no-change", note: "Logged as a change" });
  // September ends settled, so the October demo starts on a clean slate
  rec.decisions.push({ id: uid("d"), date: "2026-09-18", target: "thread:cascadia menu test / field count", outcome: "no-change", note: "Menu ops: keep the holiday order as is until a trial list is released" });
  rec.decisions.push({ id: uid("d"), date: "2026-09-18", target: "rq:RQ-0917-7", outcome: "no-change", note: "Signed off: GC-PROMO-01 is in the plan and its order went to purchasing Sep 17" });
  for (const it of C.Desk(D, rec).purchaseNews("2026-09-18")) if (it.open) rec.decisions.push({ id: uid("d"), date: "2026-09-18", target: it.id, outcome: "no-change", note: "Handled in September" });
  const done = new Set(rec.decisions.map(d => d.target));
  for (const t of C.Desk(D, rec).threadsAt("2026-09-18")) if (!done.has(t.id)) rec.decisions.push({ id: uid("d"), date: "2026-09-18", target: t.id, outcome: "no-change", note: "Handled in September" });
  return rec;
}
render();
