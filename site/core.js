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
  const FIRST_CYCLE = "2026-09";      // the first cycle the planner builds here; Dutch Bros' files from it on are the answer key

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
    record = Object.assign({ inputs: [], edits: [], decisions: [], versions: [], changes: [] }, record || {});
    const OPT = Object.assign({ tol: 0.35, min: 30, swingTol: 0.15, swingMin: 10 }, record.options || {});
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
    // Synthetic October: made-up files built from the real September ones. They carry no
    // intake-log row, so region and cycle come from the reader, as for a dropped file.
    const SY = D.synthetic || { submissions: [], emails: [], events: [] };
    for (const s of SY.submissions) inputs.push({ id: "sheet:" + s.file, kind: "sheet", date: s.received, time: s.time || "", origin: "packet", synthetic: true, src: s.file, rows: s.rows, title: s.sheet, meta: s });
    for (const e of SY.emails) {
      const m = readEmail(e.raw);
      inputs.push({ id: "email:" + e.file, kind: "email", date: m.date, time: m.time, origin: "packet", synthetic: true, src: e.file, mail: m, region: guessRegionFromText(m.sender + " " + m.subject + " " + m.body, ref) });
    }
    for (const ev of SY.events) inputs.push({ id: "cal:" + ev.id + "@" + ev.known_on, kind: "calendar", date: ev.known_on, time: "", origin: "packet", synthetic: true, src: "synthetic/calendar.csv", event: ev, region: ev.region });
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
    // role: "past" = a Dutch Bros post before the planner took over (in force, history);
    // "answer" = a Dutch Bros file from the planner's own cycles (shown beside, never in force);
    // "draft" = a Dutch Bros working or withdrawn file before then; "published" = the planner's.
    for (const r of D.releases) {
      const role = r.cycle >= FIRST_CYCLE ? "answer" : r.disposition === "Posted" ? "past" : "draft";
      versionsAll.push({ id: r.id, date: r.logged, cycle: r.cycle, name: r.file.split("/").pop().replace(/\.xlsx$/, ""), status: r.disposition, note: r.note, grid: r.grid, months: r.months, origin: "packet", file: r.file, role });
    }
    for (const v of record.versions) versionsAll.push({ ...v, status: "Published here", origin: "added", role: "published" });
    versionsAll.sort((a, b) => a.date.localeCompare(b.date) || (a.origin === b.origin ? 0 : a.origin === "packet" ? -1 : 1));
    const inForce = v => v.role === "past" || v.role === "published";

    function baseAt(T) { const v = versionsAll.filter(v => v.date <= T && inForce(v)); return v[v.length - 1] || null; }
    function prevBase(base) { const v = versionsAll.filter(v => inForce(v) && v.date <= base.date && v.id !== base.id && versionsAll.indexOf(v) < versionsAll.indexOf(base)); return v[v.length - 1] || null; }

    const editLive = (e, T) => e.date <= T && !(e.removed_on && e.removed_on <= T);
    function editsAt(T, base) {
      base = base || baseAt(T);
      return record.edits.filter(e => base && e.base === base.id && editLive(e, T) && e.status !== "draft" && e.status !== "rejected");
    }
    function planAt(T) {
      const base = baseAt(T); if (!base) return null;
      const w = working(T);
      const grid = {}, applied = {};
      for (const [k, row] of Object.entries(w.grid)) grid[k] = { ...row };
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
      const packetPosted = versionsAll.filter(v => v.role === "past" && v.date <= T).pop();
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

    /* ================================================================ v3 engine
     * The planner's month: draft from the sheets, checks against shipments and sales,
     * typed changes on a published version, and the answer key. Every text a screen
     * shows is a short phrase ("ships ~310/mo"); longer detail sits in a `detail` field. */
    const SHIP = D.shipments || { monthly: {}, amendments: [] };
    const SHOPS = D.shops || {};
    const SALES = D.sales_use || {};
    const SALES_DRINK = Object.fromEntries((D.sales_drinks || []).map(d => [d.sku, d.name]));
    const addM = (m, k) => { const [y, mo] = m.split("-").map(Number), t = y * 12 + mo - 1 + k; return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`; };
    const mShort = m => MON[+m.slice(5) - 1];
    const mRange = (a, b) => a === b ? `${mShort(a)} ${a.slice(2, 4)}` : a.slice(0, 4) === b.slice(0, 4) ? `${mShort(a)}–${mShort(b)} ${b.slice(2, 4)}` : `${mShort(a)} ${a.slice(2, 4)}–${mShort(b)} ${b.slice(2, 4)}`;
    const r0 = v => Math.round(v);
    const pct = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 1000) / 10)}%`;
    const epc = (region, sku) => { const x = D.crosswalk.find(c => c.region === region && c.sku === sku); return x ? x.ea_per_case : ITEMS[sku].ea_per_case; };

    /* the last month whose shipments are complete on date T */
    function lastComplete(T) {
      const thr = SHIP.through || "9999-12-31";
      const cap = thr.slice(8) >= "28" ? thr.slice(0, 7) : addM(thr.slice(0, 7), -1);
      const m = addM(T.slice(0, 7), -1);
      return m < cap ? m : cap;
    }
    /* monthly net cases shipped, as known on T: amendments accepted later are taken back out */
    function shipAt(T, rs) {
      const out = { ...(SHIP.monthly[rs] || {}) };
      for (const a of SHIP.amendments) if (a.region + "|" + a.sku === rs && a.accepted > T) out[a.month] = (out[a.month] || 0) - a.cs + a.old_cs;
      return out;
    }
    /* seasonal items (near zero most of the year) compare with the same month only */
    const seasonalCache = {};
    function isSeasonal(sku) {
      if (sku in seasonalCache) return seasonalCache[sku];
      const v = [];
      for (let k = 0; k < 12; k++) { const m = addM("2025-09", k); let t = 0; for (const r of D.regions) t += (SHIP.monthly[r.code + "|" + sku] || {})[m] || 0; v.push(t); }
      const mean = v.reduce((a, b) => a + b, 0) / 12, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / 12);
      return (seasonalCache[sku] = mean > 0 && sd / mean > 1);
    }
    const shopsIn = (r, m) => { const s = SHOPS[r] || {}; const k = Object.keys(s).filter(x => x <= m).sort().pop(); return k ? s[k] : null; };

    /* one-off quantities the calendar already names ("24 CS S001", "advancing 96 CS S005 from September") */
    const MONTHS_LONG = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    function monthIn(text, near) {
      const t = String(text || "").toLowerCase();
      for (let i = 0; i < 12; i++) {
        const n = MONTHS_LONG[i];
        if (new RegExp(`\\b(${n}|${n.slice(0, 3)})\\b`).test(t)) {
          const y = +near.slice(0, 4), dist = c => Math.abs((+c.slice(0, 4)) * 12 + +c.slice(5) - (y * 12 + +near.slice(5)));
          return [y - 1, y, y + 1].map(yy => `${yy}-${pad(i + 1)}`).sort((a, b) => dist(a) - dist(b))[0];
        }
      }
      return null;
    }
    function knownAt(T) {
      // per event id: status and timing from its latest row, quantities from the latest row that names any
      const byEv = {};
      for (const x of inputsAt(T)) if (x.kind === "calendar") (byEv[x.event.id] = byEv[x.event.id] || []).push(x);
      const QTY = /(\d[\d,]*)\s*CS\s+(S\d{3})/g;
      const out = [];
      for (const rows of Object.values(byEv)) {
        const last = rows[rows.length - 1], ev = last.event;
        if (/cancel|withdrawn|dropped/i.test(ev.status || "")) continue;
        const q = rows.filter(x => new RegExp(QTY.source).test(x.event.detail || "")).pop();
        if (!q) continue;
        const text = q.event.detail, near = (ev.event_date || last.date).slice(0, 7);
        const pull = /advanc|pull/i.test(text);
        const from = pull ? (text.match(/from\s+([A-Za-z]+)/) || [])[1] : null;
        // a later row that names a new delivery month moves the quantities ("requests a Nov 2 delivery")
        const moved = last !== q ? monthIn((last.event.detail || "").replace(/first[- ]service[^.]*\./i, ""), near) : null;
        const month = (from ? monthIn(from, near) : moved || monthIn(text, near)) || near;
        const re = new RegExp(QTY.source, "g"); let m;
        while ((m = re.exec(text))) {
          const qty = +m[1].replace(/,/g, ""), sku = m[2];
          out.push({ ref: ev.id, region: ev.region, sku, month, cs: pull ? -qty : qty, type: ev.type, status: ev.status, input: q.id, synthetic: !!q.synthetic, text: pull ? `${qty} pulled to ${mShort(addM(month, -1))}` : `${/opening/i.test(ev.type) ? "opening kit" : ev.type.toLowerCase()} +${qty}` });
        }
      }
      return out;
    }

    /* expected cases for one region × SKU × month, from shipments, as known on T */
    function expectShip(T, key) {
      const [r, sku, m] = key.split("|"), rs = r + "|" + sku, sh = shipAt(T, rs), lc = lastComplete(T);
      const seasonal = isSeasonal(sku);
      const months = seasonal ? [addM(m, -12)] : [addM(m, -13), addM(m, -12), addM(m, -11)];
      if (months.some(x => x > lc || !(x in sh))) return null;
      const avg = months.reduce((a, x) => a + sh[x], 0) / months.length;
      const now = shopsIn(r, m), then = shopsIn(r, addM(m, -12));
      if (!now || !then) return null;
      const v = avg * now / then, span = mRange(months[0], months[months.length - 1]);
      return { v, label: `ships ~${r0(v)}/mo`, method: `${span} avg × shops ${now}/${then}`, detail: `${seasonal ? "Seasonal item, same month last year" : "Same three months last year"} (${span}): ${fmt(avg)} CS a month shipped, × ${now}/${then} open shops = ${fmt(v)} CS.` };
    }
    /* expected cases from sales of the one drink with a portion standard (S001, S005, S014) */
    function expectSales(T, key) {
      const [r, sku, m] = key.split("|"), rs = r + "|" + sku, use = SALES[rs];
      if (!use) return null;
      const lc = [lastComplete(T), addM((D.sales_through || "9999-12-31").slice(0, 7), -1)].sort()[0];
      const sh = shipAt(T, rs);
      const last12 = Array.from({ length: 12 }, (_, i) => addM(lc, -i));
      const sShip = last12.reduce((a, x) => a + (sh[x] || 0), 0), sUse = last12.reduce((a, x) => a + (use[x] || 0), 0);
      const rec = [0, 1, 2].map(i => addM(lc, -i));
      const g1 = rec.reduce((a, x) => a + (use[x] || 0), 0), g0 = rec.reduce((a, x) => a + (use[addM(x, -12)] || 0), 0);
      const months = isSeasonal(sku) ? [addM(m, -12)] : [addM(m, -13), addM(m, -12), addM(m, -11)];
      if (!sUse || !g0 || months.some(x => !(x in use) || x > lc)) return null;
      const base = months.reduce((a, x) => a + use[x], 0) / months.length, k = sShip / sUse, g = g1 / g0, v = base * g * k;
      const drink = SALES_DRINK[sku] || "one drink";
      return { v, label: `sales ~${r0(v)}/mo`, method: `${drink} sales ${pct(g - 1)} YoY`, detail: `${drink}, sold + comped, ${mRange(months[0], months[months.length - 1])}: ${fmt(base)} CS a month of this item. Sales ${pct(g - 1)} on a year ago (${mRange(rec[2], rec[0])}). × ${fmt(k)} cases shipped per sales-implied case (last 12 months) = ${fmt(v)} CS.` };
    }

    /* checks on a number for one line, as of T. last = the plan in force before this cycle */
    function lineChecks(T, key, value, last, known) {
      const out = [], adj = (known || []).reduce((a, k) => a + k.cs, 0);
      const judge = (id, name, e) => {
        if (!e) return;
        const target = e.v + adj, d = value - target, ok = !(Math.abs(d) >= OPT.min && Math.abs(d) > OPT.tol * Math.max(target, 1));
        out.push({ id, name, expected: r0(target), base: r0(e.v), adj, d: r0(d), ok,
          label: e.label + (adj ? ` ${adj > 0 ? "+" : "−"}${Math.abs(adj)} known` : ""), method: e.method,
          detail: e.detail + (adj ? ` Known one-offs: ${known.map(k => `${k.ref} ${k.cs > 0 ? "+" : ""}${k.cs}`).join(", ")}.` : "") + ` Flags beyond ±${Math.round(OPT.tol * 100)}% and ${OPT.min} CS.` });
      };
      judge("ship", "Shipments", expectShip(T, key));
      judge("sales", "Sales", expectSales(T, key));
      if (last != null) {
        const d = value - last, ok = !(Math.abs(d) >= OPT.swingMin && Math.abs(d) > OPT.swingTol * Math.max(last, 1));
        out.push({ id: "swing", name: "Last plan", expected: last, d: r0(d), ok, label: `was ${fmt(last)}`, method: "change on last plan", detail: `Plan in force before this cycle: ${fmt(last)} CS. Flags beyond ±${Math.round(OPT.swingTol * 100)}% and ${OPT.swingMin} CS.` });
      }
      return out;
    }
    /* a line needs the planner when the evidence disagrees with the number: shipments fail and
     * sales, where it exists, does not back the number. A swing on last plan alone does not flag. */
    function verdict(checks) {
      const s = checks.find(c => c.id === "ship"), q = checks.find(c => c.id === "sales");
      if (s) return !s.ok && !(q && q.ok);
      return !!(q && !q.ok);
    }
    function reasonOf(value, checks) {
      const s = checks.find(c => c.id === "ship"), q = checks.find(c => c.id === "sales"), w = checks.find(c => c.id === "swing");
      return [`Asks ${fmt(value)}`, s && s.label, q && q.label, w && !w.ok && w.label].filter(Boolean).join("; ");
    }

    /* ---------------------------------------------------------------- draft */
    const cycleMonths = cycle => Array.from({ length: 6 }, (_, i) => addM(cycle, i));
    const lastPlanFor = (T, cycle) => versionsAll.filter(v => inForce(v) && v.date <= T && (v.cycle || "") < cycle).pop() || null;
    /* the draft for a cycle as of T: one line per region × SKU × month from the latest sheet in
     * hand per region, with provenance, checks, status and any decision the planner made */
    function draft(T, cycle) {
      cycle = cycle || cycleAt(T); if (!cycle) return null;
      const pin = lastPlanFor(T, cycle), known = knownAt(T), months = cycleMonths(cycle);
      const lines = [], regions = {};
      for (const r of D.regions) {
        const s = latestSheet(T, r.code, cycle);
        const all = sheetsAt(T).filter(x => x.region === r.code && x.cycle === cycle);
        regions[r.code] = s ? { sheet: s.id, src: s.src, date: s.date, layout: s.layout, synthetic: !!s.synthetic, counts: s.counts, problems: s.problems, replaced: all.filter(x => x.id !== s.id).map(x => x.id) } : null;
        if (!s) {
          if (pin) for (const [rs, row] of Object.entries(pin.grid)) if (rs.startsWith(r.code + "|")) for (const m of months) if (row[m] != null)
            lines.push({ key: rs + "|" + m, region: r.code, sku: rs.split("|")[1], month: m, asked: null, last: row[m], value: row[m], status: "nosheet", reason: "No sheet yet; last plan kept", checks: [], settled: true });
          continue;
        }
        for (const [key, c] of Object.entries(s.cells)) {
          const [, sku, m] = key.split("|");
          if (!months.includes(m)) continue;
          const row = pin && pin.grid[r.code + "|" + sku], last = row && row[m] != null ? row[m] : null;
          const kn = known.filter(k => k.region === r.code && k.sku === sku && k.month === m);
          const ln = { key, region: r.code, sku, month: m, asked: c.cs, last, cell: c, sheet: s.id, src: s.src, synthetic: !!s.synthetic, known: kn, gap: 0 };
          if (c.cs == null) { ln.status = "problem"; ln.reason = "Blank, nothing to carry"; ln.checks = []; }
          else {
            ln.checks = lineChecks(T, key, c.cs, last, kn);
            ln.status = verdict(ln.checks) ? "needs" : "accepted";
            ln.reason = ln.status === "needs" ? reasonOf(c.cs, ln.checks) : kn.length ? `Checks pass with ${kn.map(k => k.ref).join(", ")}` : "Checks pass";
            const s0 = ln.checks.find(x => x.id === "ship") || ln.checks.find(x => x.id === "sales");
            if (s0) ln.gap = s0.d;
          }
          if (kn.length) ln.note = kn.map(k => `${k.text} (${k.ref})`).join("; ");
          // a decision on the line: v3 target "draft:<cycle>|<key>", or the v2 screens' buttons
          // (decision "line:<sheet>|<key>" = keep plan; an edit from this sheet on this key = use the request)
          let dec = decisionAt(T, "draft:" + cycle + "|" + key);
          if (!dec) { const old = decisionAt(T, "line:" + s.id + "|" + key); if (old) dec = { ...old, outcome: old.outcome === "keep" ? "keep" : old.outcome }; }
          if (!dec) { const e = record.edits.filter(e => e.src === s.id && e.key === key && editLive(e, T)).pop(); if (e) dec = { id: e.id, date: e.date, target: "edit", outcome: "request", note: e.reason }; }
          if (dec) ln.decision = dec;
          ln.value = !dec ? ln.asked : dec.outcome === "keep" ? last : dec.outcome === "set" ? +dec.value : ln.asked;
          ln.settled = ln.status === "accepted" || (!!dec && dec.outcome !== "question");
          lines.push(ln);
        }
      }
      const n = s => lines.filter(l => l.status === s).length, got = Object.values(regions).filter(Boolean);
      const counts = { sheets: got.length, lines: lines.length - n("nosheet"), accepted: n("accepted"), needs: n("needs"), problems: n("problem"), nosheet: n("nosheet"), unsettled: lines.filter(l => !l.settled).length, questions: lines.filter(l => l.decision && l.decision.outcome === "question").length };
      return {
        cycle, asOf: T, months, lastPlan: pin ? { id: pin.id, name: pin.name, date: pin.date } : null, regions, lines, counts,
        synthetic: got.some(x => x.synthetic),
        headline: `${counts.sheets} sheets: ${fmt(counts.lines)} lines, ${fmt(counts.accepted)} as asked, ${counts.needs + counts.problems} need you`,
      };
    }
    /* the lines that need the planner, biggest gap first */
    function flags(T, cycle) {
      const d = draft(T, cycle); if (!d) return [];
      return d.lines.filter(l => l.status === "needs" || l.status === "problem").sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    }
    /* Review screen rows: the flagged lines with the numbers side by side */
    function review(T, cycle) {
      const d = draft(T, cycle); if (!d) return { lines: [], total: null, sheets: 0 };
      const L = d.lines.filter(l => l.status === "needs" || l.status === "problem").sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).map(l => {
        const sh = l.checks.find(c => c.id === "ship"), sa = l.checks.find(c => c.id === "sales");
        return { key: l.key, region: l.region, sku: l.sku, month: l.month, last: l.last, ask: l.asked, expected: sh ? sh.expected : sa ? sa.expected : null, sales: sa ? sa.expected : null,
          why: l.reason, detail: l.checks.map(c => `${c.name}: ${c.detail}`).join(" · "), method: l.checks.filter(c => !c.ok).map(c => c.method).join("; "),
          sheet: l.sheet, note: l.note || (l.cell && l.cell.rule.join("; ")) || "", status: l.status, decision: l.decision || null, settled: l.settled, value: l.value, synthetic: l.synthetic, checks: l.checks };
      });
      return { lines: L, total: d.counts.lines, accepted: d.counts.accepted, sheets: d.counts.sheets, cycle: d.cycle, headline: d.headline, synthetic: d.synthetic, lastPlan: d.lastPlan };
    }
    /* the same flags grouped by region × item: one decision often covers several months */
    function flagGroups(T, cycle) {
      const g = {};
      for (const l of flags(T, cycle)) (g[l.region + "|" + l.sku] = g[l.region + "|" + l.sku] || { region: l.region, sku: l.sku, item: ITEMS[l.sku].name, lines: [] }).lines.push(l);
      return Object.values(g).map(x => ({ ...x, months: x.lines.map(l => l.month).sort(), gap: x.lines.reduce((a, l) => a + l.gap, 0), reason: x.lines.length > 1 ? `${x.lines.length} months; ${x.lines.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0].reason}` : x.lines[0].reason })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    }
    /* the draft as a version the screens can publish (the screen adds an id and pushes it to record.versions) */
    function draftVersion(T, opts) {
      const d = draft(T); if (!d) return null;
      const grid = {};
      for (const l of d.lines) if (l.value != null) { const rs = l.region + "|" + l.sku; (grid[rs] = grid[rs] || {})[l.month] = l.value; }
      const pre = { unsettled: d.counts.unsettled, questions: d.counts.questions, missing: D.regions.filter(r => !d.regions[r.code]).map(r => r.code) };
      return {
        date: T, cycle: d.cycle, name: (opts && opts.name) || `${MON[+d.cycle.slice(5) - 1]} plan`, note: (opts && opts.note) || "", grid, months: d.months,
        from: d.lastPlan && d.lastPlan.id, synthetic: d.synthetic, preflight: pre,
        preflightText: [pre.unsettled && `${pre.unsettled} flag${pre.unsettled > 1 ? "s" : ""} unsettled`, pre.questions && `${pre.questions} open question${pre.questions > 1 ? "s" : ""}`, pre.missing.length && `${pre.missing.length} sheet${pre.missing.length > 1 ? "s" : ""} missing`].filter(Boolean).join(", ") || "All settled",
      };
    }

    /* ---------------------------------------------------------------- typed changes */
    /* record.changes: { id, date, type: add|set|move|hold|scenario, ref, key "R06|S014|2026-10",
     *   qty, unit "CS"|"EA", to (move: target month), replaces (set: a change id; default the
     *   latest live change with the same ref and key), reason, source (input id), quote,
     *   base (version id; default the version in force on its date), removed_on } */
    const chLive = (c, T) => c.date <= T && !(c.removed_on && c.removed_on <= T);
    function toCases(c) {
      const [r, sku] = c.key.split("|"), q = +c.qty || 0;
      if (String(c.unit || "CS").toUpperCase() === "EA") { const e = epc(r, sku), cs = q / e; return { cs, arith: `${fmt(q)} ${(ITEMS[sku].ea_unit || "EA").toLowerCase()}s ÷ ${e} = ${fmt(cs)} CS` }; }
      return { cs: q, arith: `${fmt(q)} CS` };
    }
    function changesAt(T, base) {
      base = base || baseAt(T);
      const CH = record.changes || [];
      const live = CH.filter(c => chLive(c, T) && base && (c.base ? c.base === base.id : (baseAt(c.date) || {}).id === base.id)).map(c => ({ ...c }));
      for (const c of live.filter(c => c.type === "set")) {
        let old = c.replaces ? live.find(x => x.id === c.replaces) : null;
        if (!old && c.ref) old = live.filter(x => x.id !== c.id && x.ref === c.ref && x.key === c.key && (x.type === "add" || x.type === "set") && CH.findIndex(y => y.id === x.id) < CH.findIndex(y => y.id === c.id)).pop();
        if (old) { old.replacedBy = c.id; c.replacesId = old.id; }
      }
      return live;
    }
    /* the working plan: the version in force at T with its live typed changes applied,
     * and the diff since that release with reasons */
    function working(T) {
      const base = baseAt(T);
      if (!base) return { base: null, grid: {}, months: [], applied: {}, diff: [], holds: [], scenarios: [], superseded: [] };
      const grid = {}; for (const [k, row] of Object.entries(base.grid)) grid[k] = { ...row };
      const applied = {}, holds = [], scenarios = [], superseded = [];
      const at = (key, delta, c, text) => {
        const [r, sku, m] = key.split("|"), rs = r + "|" + sku;
        if (!grid[rs] || grid[rs][m] == null) return;
        grid[rs][m] = Math.round((grid[rs][m] + delta) * 1000) / 1000;
        (applied[key] = applied[key] || []).push({ id: c.id, type: c.type, ref: c.ref || null, delta, text, reason: c.reason || "", source: c.source || null, quote: c.quote || null, date: c.date });
      };
      const all = changesAt(T, base);
      for (const c of all) {
        if (c.replacedBy) { superseded.push({ id: c.id, ref: c.ref, key: c.key, by: c.replacedBy, date: c.date, text: `${toCases(c).arith} replaced` }); continue; }
        if (c.type === "hold") { holds.push({ id: c.id, ref: c.ref, key: c.key || null, date: c.date, text: c.reason || "Open question", source: c.source || null, quote: c.quote || null }); continue; }
        const { cs, arith } = toCases(c);
        const [r, sku, m] = c.key.split("|"), cur = (grid[r + "|" + sku] || {})[m];
        if (c.type === "add") at(c.key, cs, c, `${cs >= 0 ? "+" : ""}${arith}`);
        else if (c.type === "set") {
          if (c.replacesId) at(c.key, cs, c, `${arith}, replaces ${toCases(all.find(x => x.id === c.replacesId)).arith}`);
          else if (cur != null) at(c.key, cs - cur, c, `set to ${arith}, was ${fmt(cur)}`);
        } else if (c.type === "move") {
          const t = `${fmt(cs)} CS ${mShort(m)} → ${mShort(c.to)}`;
          at(c.key, -cs, c, t); at(`${r}|${sku}|${c.to}`, cs, c, t);
        } else if (c.type === "scenario") {
          scenarios.push({ id: c.id, ref: c.ref, key: c.key, date: c.date, released: (base.grid[r + "|" + sku] || {})[m], would: cur == null ? null : cur + cs, d: cs, text: `${cs >= 0 ? "+" : ""}${arith}`, reason: c.reason || "", source: c.source || null });
        }
      }
      const diff = [];
      for (const [key, list] of Object.entries(applied)) {
        const [r, sku, m] = key.split("|"), released = base.grid[r + "|" + sku][m], proposed = grid[r + "|" + sku][m];
        if (Math.abs(proposed - released) < 1e-9) continue;
        const main = list[list.length - 1];
        diff.push({ key, region: r, sku, month: m, released, proposed, d: Math.round((proposed - released) * 1000) / 1000, type: main.type, ref: main.ref, reason: main.reason, text: list.map(x => x.text).join("; "), source: main.source, changes: list });
      }
      diff.sort((a, b) => a.region.localeCompare(b.region) || a.sku.localeCompare(b.sku) || a.month.localeCompare(b.month));
      return { base, grid, months: base.months, applied, diff, holds, scenarios, superseded };
    }

    /* ---------------------------------------------------------------- answer key */
    const KNOWN_GAPS = {
      "R02|S005|2026-09": "Both net the 96 CS pulled to Aug (HD-PULL-01)",
      "R06|S001|2026-09": "Asked 399, posted 412; not in the records",
    };
    /* the planner's version for a cycle against Dutch Bros' posted file for the same cycle */
    function answerKey(version, cycle) {
      version = typeof version === "string" ? versionsAll.find(v => v.id === version) : version;
      if (!version) return null;
      cycle = cycle || version.cycle;
      const posted = versionsAll.find(v => v.role === "answer" && v.cycle === cycle && v.status === "Posted");
      if (!posted) return null;
      const prev = versionsAll.filter(v => v.role === "past" && v.date < posted.date).pop();
      const rows = [];
      for (const [rs, row] of Object.entries(posted.grid)) for (const [m, pv] of Object.entries(row)) {
        const mv = version.grid[rs] && version.grid[rs][m]; if (mv == null || pv == null) continue;
        const lp = prev && prev.grid[rs] && prev.grid[rs][m] != null ? prev.grid[rs][m] : null;
        rows.push({ key: rs + "|" + m, ours: mv, posted: pv, d: pv - mv, pct: (pv - mv) / Math.max(mv, 1), last: lp, known: KNOWN_GAPS[rs + "|" + m] || null });
      }
      if (!rows.length) return null;
      const n = rows.length, exact = rows.filter(r => r.d === 0).length, within = rows.filter(r => Math.abs(r.pct) <= 0.05 + 1e-9).length;
      const tOurs = rows.reduce((a, r) => a + r.ours, 0), tPosted = rows.reduce((a, r) => a + r.posted, 0);
      // how far Dutch Bros leaned back toward its previous plan: slope of (posted − ours) on (last − ours)
      let num = 0, den = 0; for (const r of rows) if (r.last != null) { num += r.d * (r.last - r.ours); den += (r.last - r.ours) ** 2; }
      const lean = den ? num / den : null;
      const why = r => r.known || (r.last != null && r.d !== 0 && Math.sign(r.d) === Math.sign(r.last - r.ours) ? `toward last plan (${fmt(r.last)})` : "not in the records");
      const gaps = rows.slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10).map(r => ({ ...r, why: why(r) }));
      const known = Object.entries(KNOWN_GAPS).map(([key, text]) => { const r = rows.find(x => x.key === key); return { key, text, ours: r ? r.ours : null, posted: r ? r.posted : null }; });
      const tp = (tPosted - tOurs) / tOurs;
      return {
        cycle, version: { id: version.id, name: version.name, date: version.date }, posted: { id: posted.id, name: posted.name, date: posted.date, file: posted.file },
        lines: n, exact, within5: within, total: { ours: tOurs, posted: tPosted, pct: tp }, lean, gaps, known, rows,
        headline: `Within 5% on ${within} of ${n} lines; total ${pct(tp)}`,
        leanText: lean != null && prev ? `Dutch Bros leans ${Math.round(lean * 100)}% back to ${prev.name}` : null,
        detail: `Dutch Bros posted "${posted.name}" on ${posted.date}. ${exact} of ${n} lines are equal and ${within} are within 5%. Network total ${fmt(tPosted)} posted vs ${fmt(tOurs)} CS here.` + (lean != null && prev ? ` Its numbers sit about ${Math.round(lean * 100)}% of the way from the managers' requests back to "${prev.name}"; no rule in the packet reproduces them exactly.` : ""),
      };
    }
    /* everything the checks said about one line, for the side panel */
    function lineInfo(T, key) {
      const d = draft(T), ln = d && d.lines.find(l => l.key === key);
      const w = working(T), [r, sku, m] = key.split("|");
      const value = (w.grid[r + "|" + sku] || {})[m];
      const known = knownAt(T).filter(k => k.region === r && k.sku === sku && k.month === m);
      const checks = value == null ? [] : lineChecks(T, key, value, ln ? ln.last : null, known);
      return { key, value, draft: ln || null, checks, changes: w.applied[key] || [], versions: versionsAll.filter(v => v.date <= T && v.grid[r + "|" + sku] && v.grid[r + "|" + sku][m] != null).map(v => ({ id: v.id, name: v.name, date: v.date, role: v.role, value: v.grid[r + "|" + sku][m] })) };
    }
    /* released vs proposed for purchasing and finance: Release screen and CSV */
    function releaseList(T) {
      const w = working(T);
      const rows = w.diff.map(x => ({ region: regionName(x.region), sku: x.sku, item: ITEMS[x.sku].name, month: x.month, released: x.released, proposed: x.proposed, d: x.d, type: x.type, ref: x.ref, reason: x.reason, how: x.text, source: x.source }));
      const esc = v => /[",\n]/.test(String(v == null ? "" : v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v == null ? "" : v);
      const head = ["Region", "SKU", "Item", "Month", "Released CS", "Proposed CS", "Difference", "Type", "Ref", "Reason", "How"];
      const lines = [head.join(",")].concat(rows.map(x => [x.region, x.sku, x.item, x.month, x.released, x.proposed, x.d, x.type, x.ref, x.reason, x.how].map(esc).join(",")));
      for (const h of w.holds) lines.push(["", "", "", "", "", "", "", "open question", h.ref, h.text, ""].map(esc).join(","));
      for (const s of w.scenarios) { const [r, sku, m] = s.key.split("|"); lines.push([regionName(r), sku, ITEMS[sku].name, m, s.released, s.would, s.d, "scenario (not in plan)", s.ref, s.reason, s.text].map(esc).join(",")); }
      return { base: w.base && { id: w.base.id, name: w.base.name, date: w.base.date }, rows, holds: w.holds, scenarios: w.scenarios, superseded: w.superseded, csv: lines.join("\n") + "\n" };
    }

    return {
      inputs, byId, sheets, versionsAll, ITEMS, regionName,
      baseAt, prevBase, planAt, editsAt, inputsAt, threadsAt, editLive, sheetsAt, cycleAt, latestSheet, requestAt, decisionAt, checks, needs, fmt, sign,
      // v3
      options: OPT, draft, review, flags, flagGroups, draftVersion, working, changesAt, answerKey, lineInfo, releaseList, knownAt, shipAt, expectShip, expectSales, lineChecks, isSeasonal, lastPlanFor, toCases, addM,
    };
  }

  G.Core = { MON, normMonth, parseDelimited, looksTabular, isSheet, readSheet, guessRegion, guessCycle, resolveSheet, readEmail, readPastedText, guessRegionFromText, Desk };
})(typeof window !== "undefined" ? window : globalThis);
