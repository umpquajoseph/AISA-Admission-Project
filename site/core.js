/* Supply Desk core: reads sheets and emails, and works out the plan as of a date.
 * No page code here, so the same file runs in the browser and in Node checks.
 * Packet files (bundled raw by pipeline/build_data.py) and files the planner
 * pastes, drops or picks up from a folder all go through these functions. */
"use strict";
(function (G) {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = n => String(n).padStart(2, "0");
  const str = v => v == null ? "" : String(v).trim();
  const clean = v => str(v) || null;

  /* ---------------------------------------------------------------- months */
  function normMonth(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) { const t = new Date(v.getTime() + 432e5); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; }
    if (typeof v === "number") {                                   // Excel serial date
      if (v < 30000 || v > 80000) return null;
      const t = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
    }
    const s = str(v);
    let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?(?:[ T].*)?$/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?[ \-'’]+(\d{2}|\d{4})$/);
    if (m) { const i = MON.findIndex(x => x.toLowerCase() === m[1].toLowerCase()); if (i >= 0) return `${m[2].length === 2 ? "20" + m[2] : m[2]}-${pad(i + 1)}`; }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);           // US m/d/y as Excel copies it
    if (m && +m[1] <= 12) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(+m[1])}`;
    return null;
  }
  function num(v) {
    if (v == null) return { v: null };
    if (typeof v === "number") return { v };
    const s = str(v).replace(/,/g, "");
    if (!s) return { v: null };
    const n = Number(s);
    return isNaN(n) ? { v: null, bad: str(v) } : { v: n };
  }

  /* ---------------------------------------------------------------- text tables */
  function parseDelimited(text, delim) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && cell === "") q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => { r = r.map(x => x === "" ? null : x); while (r.length && r[r.length - 1] == null) r.pop(); return r; });
  }
  const looksTabular = text => text.split(/\r?\n/).filter(l => l.includes("\t")).length >= 3;

  /* ---------------------------------------------------------------- manager sheets */
  // The first column of the header row names the layout. The packet's three layouts:
  const HEADERS = { "stock no.": "Outbound needs", "counter sku": "By month", "stock alias": "Reorder roll" };
  function findHeader(rows) {
    for (let i = 0; i < rows.length; i++) { const L = HEADERS[str(rows[i] && rows[i][0]).toLowerCase()]; if (L) return [i, L]; }
    return [-1, null];
  }
  const isSheet = rows => findHeader(rows)[0] >= 0;

  /* rows (array of arrays, as read from a workbook or pasted cells) -> entries */
  function readSheet(rows) {
    const [h, layout] = findHeader(rows);
    if (h < 0) return { error: "No request table found. The first column of the header row should read Stock no., Counter SKU or Stock alias." };
    let author = null, hub = null, dated = null;
    for (let i = 0; i < h; i++) {
      const m = str(rows[i] && rows[i][0]).match(/^(.+?)\s{2,}(.+?)\s{2,}(\d{4}-\d{2}-\d{2})/);
      if (m) { [, author, hub, dated] = m; break; }
    }
    const entries = [], bad = [];
    const add = (o, raw, row) => { const n = num(raw); if (n.bad) bad.push(`Row ${row}: “${n.bad}” is not a number`); entries.push({ ...o, qty: n.v, row }); };
    if (layout === "Outbound needs") {
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i] || []; if (!str(r[0])) continue;
        add({ local: str(r[0]), month: normMonth(r[1]), area: clean(r[2]), unit: str(r[3]).toUpperCase(), note: clean(r[6]) }, r[4], i + 1);
      }
    } else {
      const head = rows[h];
      const mcols = [];
      head.forEach((c, j) => { if (j >= 3 && c != null && !/^(dispatch|buyer)/i.test(str(c))) { const m = normMonth(c); if (m) mcols.push([j, m]); } });
      const noteCol = head.findIndex((c, j) => j >= 3 && /note|comment/i.test(str(c)));
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i] || []; if (!str(r[0])) continue;
        const note = noteCol >= 0 ? clean(r[noteCol]) : null;
        for (const [j, m] of mcols) add({ local: str(r[0]), month: m, unit: str(r[2]).toUpperCase(), note }, r[j], i + 1);
      }
    }
    return { layout, author, hub, dated, entries, bad };
  }

  /* which region and cycle a sheet belongs to, from its own contents */
  function guessRegion(sheet, ref) {
    if (sheet.hub) { const r = ref.regions.find(r => r.hub.toLowerCase() === sheet.hub.toLowerCase()); if (r) return r.code; }
    const areas = sheet.entries.map(e => e.area).filter(a => ref.regions.some(r => r.code === a));
    if (areas.length) return areas[0];
    let best = null, n = 0;
    for (const r of ref.regions) {
      const codes = new Set(ref.crosswalk.filter(c => c.region === r.code).map(c => c.local));
      const k = sheet.entries.filter(e => codes.has(e.local)).length;
      if (k > n) { n = k; best = r.code; }
    }
    return best;
  }
  const guessCycle = sheet => sheet.entries.map(e => e.month).filter(Boolean).sort()[0] || null;

  /* entries -> planning cases per SKU and month. Rules, all from the packet:
   *  - local code -> SKU and EA per case from the regional crosswalk
   *  - EA -> CS by dividing by EA per case
   *  - 'Reorder roll' blank carries the same item and month from the previous cycle; zero cancels */
  function resolveSheet(sheet, region, cycle, prev, ref) {
    const xw = new Map(ref.crosswalk.filter(c => c.region === region).map(c => [c.local, c]));
    const cells = {}, problems = [...sheet.bad];
    for (const en of sheet.entries) {
      const x = xw.get(en.local);
      if (!x) { problems.push(`Row ${en.row}: local code ${en.local} is not in the ${region} crosswalk`); continue; }
      if (!en.month) { problems.push(`Row ${en.row}: month heading not recognised`); continue; }
      const sku = x.sku, key = `${region}|${sku}|${en.month}`;
      const cell = { sku, month: en.month, local: en.local, unit: en.unit, orig: en.qty, row: en.row, note: en.note, rule: [] };
      if (en.qty == null) {
        const p = prev && prev[key];
        if (sheet.layout === "Reorder roll" && p) {
          cell.cs = p.cs; cell.rule.push(`blank: carried from ${p.cycle} cycle`); cell.carried_from = p.cycle;
        } else { cell.cs = null; problems.push(`Row ${en.row}: ${sku} ${en.month} is blank with nothing to carry`); }
      } else {
        let cs;
        if (en.unit === "EA") {
          cs = en.qty / x.ea_per_case;
          cell.rule.push(`${en.qty} EA / ${x.ea_per_case} per case`);
          if (Math.abs(cs - Math.round(cs)) > 1e-9) problems.push(`Row ${en.row}: ${sku} ${en.month} ${en.qty} EA is not a whole number of cases (${cs.toFixed(2)})`);
        } else if (en.unit === "CS") cs = en.qty;
        else { cs = null; problems.push(`Row ${en.row}: unknown unit “${en.unit}”`); }
        if (cs === 0) cell.rule.push("zero: month cancelled");
        cell.cs = cs;
      }
      cell.cycle = cycle;
      cells[key] = cell;
    }
    const cv = Object.values(cells);
    return {
      cells, problems,
      counts: { cells: cv.length, ea: cv.filter(c => c.unit === "EA" && c.orig != null).length, carried: cv.filter(c => c.carried_from).length, cancelled: cv.filter(c => c.cs === 0).length },
    };
  }

  /* ---------------------------------------------------------------- emails */
  function decodeWords(s) {
    return s.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
      try {
        const bytes = enc.toUpperCase() === "B" ? Uint8Array.from(atob(txt), c => c.charCodeAt(0))
          : Uint8Array.from(txt.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), c => c.charCodeAt(0));
        return new TextDecoder(cs).decode(bytes);
      } catch { return txt; }
    }).replace(/\?=\s+=\?/g, "");
  }
  function splitPart(raw) {
    const i = raw.search(/\r?\n\r?\n/);
    const head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, "");
    const H = {};
    for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
      const m = line.match(/^([\w-]+):\s*(.*)$/); if (m) H[m[1].toLowerCase()] = m[2];
    }
    return { H, body };
  }
  function decodeBody(body, H) {
    const enc = (H["content-transfer-encoding"] || "").toLowerCase();
    const cs = ((H["content-type"] || "").match(/charset="?([^";]+)/i) || [])[1] || "utf-8";
    let bytes;
    if (enc === "base64") bytes = Uint8Array.from(atob(body.replace(/\s+/g, "")), c => c.charCodeAt(0));
    else if (enc === "quoted-printable") bytes = Uint8Array.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), c => c.charCodeAt(0) & 255);
    else return body;
    try { return new TextDecoder(cs).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
  }
  function walkParts(raw, out) {
    const { H, body } = splitPart(raw);
    const ct = H["content-type"] || "text/plain";
    const b = ct.match(/boundary="?([^";]+)"?/i);
    if (/^multipart\//i.test(ct) && b) {
      for (const p of body.split("--" + b[1]).slice(1)) { if (p.startsWith("--")) break; walkParts(p.replace(/^\r?\n/, ""), out); }
      return H;
    }
    const fname = ((H["content-disposition"] || "") + ";" + ct).match(/(?:file)?name="?([^";]+)"?/i);
    const isAtt = /attachment/i.test(H["content-disposition"] || "") || (fname && !/^text\/plain/i.test(ct));
    if (isAtt) out.attachments.push(fname ? decodeWords(fname[1]) : "attachment");
    else if (/^text\/plain/i.test(ct) && out.text == null) out.text = decodeBody(body, H);
    return H;
  }
  /* raw .eml text -> fields. Dates are kept as written in the header (the sender's local time). */
  function readEmail(raw) {
    const out = { attachments: [], text: null };
    const H = walkParts(raw.replace(/^﻿/, ""), out);
    let date = null, time = null;
    const m = (H.date || "").match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (m) { date = `${m[3]}-${pad(MON.findIndex(x => x.toLowerCase() === m[2].toLowerCase()) + 1)}-${pad(+m[1])}`; time = `${pad(+m[4])}:${m[5]}`; }
    return { date, time, sender: decodeWords(H.from || ""), to: decodeWords(H.to || ""), subject: decodeWords(H.subject || ""), body: (out.text || "").replace(/\r\n/g, "\n").trim(), attachments: out.attachments };
  }
  /* pasted text that is not a sheet: an email with or without its header lines */
  function readPastedText(text) {
    const t = text.replace(/\r\n/g, "\n").trim();
    if (/^(from|subject|to|date):/im.test(t.split("\n\n")[0])) {
      const e = readEmail(t.replace(/\n/g, "\r\n"));
      if (e.subject || e.sender) return e;
    }
    const first = t.split("\n").find(l => l.trim()) || "";
    return { date: null, time: null, sender: "", to: "", subject: first.slice(0, 90), body: t, attachments: [] };
  }
  /* which region a piece of text is about: names of regions, hubs or managers it mentions */
  function guessRegionFromText(text, ref) {
    const t = text.toLowerCase();
    const hit = ref.regions.filter(r => [r.name, r.hub, r.manager].some(n => n && t.includes(String(n).toLowerCase())));
    return hit.length === 1 ? hit[0].code : null;
  }

  const threadKey = subj => String(subj || "").replace(/^((re|fw|fwd):\s*)+/i, "").trim().toLowerCase();

  /* ---------------------------------------------------------------- the desk as of a date */
  /* Desk(D, record): D is the bundled packet; record holds what the planner added and did:
   *   inputs    sheets and emails added on a date (pasted, dropped, from a folder)
   *   edits     changes to a plan cell: +/- cases, against the plan in force when made
   *   decisions what was decided about an input or a request line (no change, keep plan, waiting)
   *   versions  plans published here; each becomes the plan in force from its date */
  function Desk(D, record) {
    const ref = D;
    const ITEMS = Object.fromEntries(D.items.map(i => [i.sku, i]));
    const regionName = c => (D.regions.find(r => r.code === c) || {}).name || c;

    /* every input, packet and added, in arrival order */
    const inputs = [];
    for (const s of D.submissions) inputs.push({ id: "sheet:" + s.file, kind: "sheet", date: s.received, time: "", origin: "packet", src: s.file, region: s.region, cycle: s.cycle, rows: s.rows, title: s.sheet, meta: s });
    for (const e of D.emails) {
      const m = readEmail(e.raw);
      inputs.push({ id: "email:" + e.file, kind: "email", date: m.date, time: m.time, origin: "packet", src: e.file, mail: m, region: guessRegionFromText(m.sender + " " + m.subject + " " + m.body, ref) });
    }
    for (const ev of D.events) inputs.push({ id: "cal:" + ev.id, kind: "calendar", date: ev.known_on, time: "", origin: "packet", src: "Planning/Control/Planning reference.xlsx › Event calendar", event: ev, region: ev.region });
    for (const r of D.releases) inputs.push({ id: "plan:" + r.id, kind: "plan", date: r.logged, time: "", origin: "packet", src: r.file, release: r });
    for (const a of record.inputs) inputs.push({ ...a, origin: "added" });
    inputs.forEach((x, i) => {
      x.seq = i;
      // messages about one matter share a thread: an email subject without RE:/FW:, or a calendar event id
      if (x.kind === "email") x.thread = "thread:" + threadKey(x.mail.subject);
      if (x.kind === "calendar") x.thread = "cal:" + x.event.id;
    });
    const order = (a, b) => (a.date || "").localeCompare(b.date || "") || (a.origin === b.origin ? 0 : a.origin === "packet" ? -1 : 1) || (a.time || "").localeCompare(b.time || "") || a.seq - b.seq;
    inputs.sort(order);
    const byId = Object.fromEntries(inputs.map(x => [x.id, x]));

    /* resolve every sheet once, in arrival order, so blanks carry from the cycle before */
    const sheets = [];
    const lastOf = {};                                     // region|cycle -> latest resolved sheet
    for (const x of inputs.filter(x => x.kind === "sheet")) {
      const read = readSheet(x.rows);
      if (read.error) { x.error = read.error; continue; }
      x.read = read;
      x.region = x.region || guessRegion(read, ref);
      x.cycle = x.cycle || guessCycle(read);
      const earlier = Object.keys(lastOf).filter(k => k.startsWith(x.region + "|") && k.split("|")[1] < x.cycle).sort().pop();
      const res = resolveSheet(read, x.region, x.cycle, earlier ? lastOf[earlier].cells : null, ref);
      Object.assign(x, res, { layout: read.layout, author: read.author, hub: read.hub || (D.regions.find(r => r.code === x.region) || {}).hub, dated: read.dated });
      x.replaces = lastOf[x.region + "|" + x.cycle] ? lastOf[x.region + "|" + x.cycle].id : null;
      if (x.replaces) byId[x.replaces].replacedBy = x.id;
      lastOf[x.region + "|" + x.cycle] = x;
      sheets.push(x);
    }

    /* plan versions: packet plan files with status Posted, and versions published here */
    const versionsAll = [];
    for (const r of D.releases) versionsAll.push({ id: r.id, date: r.logged, name: r.file.split("/").pop().replace(/\.xlsx$/, ""), status: r.disposition, note: r.note, grid: r.grid, months: r.months, origin: "packet", file: r.file });
    for (const v of record.versions) versionsAll.push({ ...v, status: "Published here", origin: "added" });
    versionsAll.sort((a, b) => a.date.localeCompare(b.date) || (a.origin === b.origin ? 0 : a.origin === "packet" ? -1 : 1));
    const inForceKinds = new Set(["Posted", "Published here"]);

    function baseAt(T) { const v = versionsAll.filter(v => v.date <= T && inForceKinds.has(v.status)); return v[v.length - 1] || null; }
    function prevBase(base) { const v = versionsAll.filter(v => inForceKinds.has(v.status) && v.date <= base.date && v.id !== base.id && versionsAll.indexOf(v) < versionsAll.indexOf(base)); return v[v.length - 1] || null; }

    const editLive = (e, T) => e.date <= T && !(e.removed_on && e.removed_on <= T);
    function editsAt(T, base) {
      base = base || baseAt(T);
      return record.edits.filter(e => base && e.base === base.id && editLive(e, T) && e.status !== "draft" && e.status !== "rejected");
    }
    function planAt(T) {
      const base = baseAt(T); if (!base) return null;
      const grid = {}, applied = {};
      for (const [k, row] of Object.entries(base.grid)) grid[k] = { ...row };
      for (const e of editsAt(T, base)) {
        const [r, sku, m] = e.key.split("|"), k = r + "|" + sku;
        if (!grid[k] || grid[k][m] == null) continue;
        grid[k][m] = Math.round((grid[k][m] + e.dv) * 1000) / 1000;
        (applied[e.key] = applied[e.key] || []).push(e);
      }
      return { base, grid, applied, months: base.months };
    }

    const inputsAt = T => inputs.filter(x => x.date && x.date <= T);
    /* emails and calendar entries grouped by thread, as of T */
    function threadsAt(T) {
      const th = {};
      for (const x of inputsAt(T)) if (x.thread) (th[x.thread] = th[x.thread] || { id: x.thread, kind: x.kind, items: [] }).items.push(x);
      return Object.values(th).map(t => {
        const f = t.items[0];
        t.title = t.kind === "email" ? f.mail.subject.replace(/^((re|fw|fwd):\s*)+/i, "") : `${f.event.id} · ${f.event.type}`;
        t.region = (t.items.find(x => x.region) || {}).region || null;
        t.last = t.items[t.items.length - 1].date;
        return t;
      }).sort((a, b) => b.last.localeCompare(a.last));
    }
    function sheetsAt(T) { return sheets.filter(s => s.date <= T); }
    function cycleAt(T) { return sheetsAt(T).map(s => s.cycle).sort().pop() || null; }
    function latestSheet(T, region, cycle) { const s = sheetsAt(T).filter(s => s.region === region && s.cycle === cycle); return s[s.length - 1] || null; }
    /* the manager's request for a cell: the latest sheet in hand for the current cycle */
    function requestAt(T, key) {
      const cyc = cycleAt(T); if (!cyc) return null;
      const s = latestSheet(T, key.split("|")[0], cyc);
      return s && s.cells[key] ? { sheet: s, cell: s.cells[key] } : null;
    }

    const decisionAt = (T, target) => { const d = record.decisions.filter(d => d.target === target && d.date <= T); return d[d.length - 1] || null; };

    /* checks on one plan cell */
    const GAP = 0.10, SWING = 0.15, MIN = 10;
    function checks(T, plan, key) {
      const [r, sku, m] = key.split("|"), k = r + "|" + sku, v = plan.grid[k] && plan.grid[k][m];
      const out = [];
      const req = requestAt(T, key);
      if (req && req.cell.cs != null && v != null) {
        const d = req.cell.cs - v, bad = Math.abs(d) >= MIN && Math.abs(d) > GAP * Math.max(v, 1);
        out.push({ id: "request", ok: !bad, text: bad ? `${regionName(r)} asks ${fmt(req.cell.cs)}, ${sign(d)} from the plan` : `Within 10% of ${regionName(r)}'s request (${fmt(req.cell.cs)})` });
      }
      const pb = prevBase(plan.base);
      if (pb && pb.grid[k] && pb.grid[k][m] != null && v != null) {
        const p = pb.grid[k][m], d = v - p, bad = Math.abs(d) >= MIN && Math.abs(d) > SWING * Math.max(p, 1);
        out.push({ id: "swing", ok: !bad, text: bad ? `Moved ${sign(d)} (${Math.round(d / p * 100)}%) since the ${pb.name} plan (${fmt(p)})` : `Within 15% of the ${pb.name} plan (${fmt(p)})` });
      }
      return out;
    }
    const fmt = v => v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("en-US");
    const sign = v => (v > 0 ? "+" : "") + fmt(v);

    /* what needs the planner, as of T */
    function needs(T) {
      const plan = planAt(T), out = { missing: [], sheets: [], inputs: [], waiting: [] };
      if (!plan) return out;
      // Anything that arrived before the latest packet plan was posted is taken as already in it.
      // A version published here does not clear anything: what you have not decided stays open.
      const packetPosted = versionsAll.filter(v => v.origin === "packet" && v.status === "Posted" && v.date <= T).pop();
      const since = packetPosted ? packetPosted.date : "";
      const cyc = cycleAt(T);
      for (const r of D.regions) if (cyc && !latestSheet(T, r.code, cyc)) out.missing.push({ region: r.code, cycle: cyc });
      for (const r of D.regions) {
        const s = cyc && latestSheet(T, r.code, cyc);
        if (!s || s.date <= since) continue;
        const lines = [];
        for (const [key, c] of Object.entries(s.cells)) {
          const [, sku, m] = key.split("|"); const row = plan.grid[r.code + "|" + sku];
          if (!row || row[m] == null || c.cs == null) continue;
          const d = c.cs - row[m];
          if (Math.abs(d) < MIN || Math.abs(d) <= GAP * Math.max(row[m], 1)) continue;
          const dec = decisionAt(T, "line:" + s.id + "|" + key);
          if (dec) continue;
          lines.push({ key, plan: row[m], asked: c.cs, d, cell: c });
        }
        if (lines.length) out.sheets.push({ sheet: s, lines: lines.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)) });
      }
      for (const th of threadsAt(T)) {
        const last = th.items[th.items.length - 1].date;
        if (last <= since) continue;
        const dec = decisionAt(T, th.id);
        const acted = record.edits.filter(e => e.src === th.id && editLive(e, T)).map(e => e.date).sort().pop();
        const newest = [dec && dec.date, acted].filter(Boolean).sort().pop();
        if (newest && newest >= last) { if (dec && dec.outcome === "waiting" && dec.date >= (acted || "")) out.waiting.push({ thread: th, decision: dec }); continue; }
        out.inputs.push({ thread: th, reopened: !!newest });
      }
      return out;
    }

    return {
      inputs, byId, sheets, versionsAll, ITEMS, regionName,
      baseAt, prevBase, planAt, editsAt, inputsAt, threadsAt, editLive, sheetsAt, cycleAt, latestSheet, requestAt, decisionAt, checks, needs, fmt, sign,
    };
  }

  G.Core = { MON, normMonth, parseDelimited, looksTabular, isSheet, readSheet, guessRegion, guessCycle, resolveSheet, readEmail, readPastedText, guessRegionFromText, Desk };
})(typeof window !== "undefined" ? window : globalThis);
