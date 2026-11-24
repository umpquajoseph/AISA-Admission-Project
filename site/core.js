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
    let author = null, hub = null, dated = null, synthetic = false;
    for (let i = 0; i < h; i++) if (/synthetic/i.test(str(rows[i] && rows[i][0]))) synthetic = true;
    for (let i = 0; i < h; i++) {
      const m = str(rows[i] && rows[i][0]).match(/^(.+?)\s{2,}(.+?)\s{2,}(\d{4}-\d{2}-\d{2})/);
      if (m) { [, author, hub, dated] = m; break; }
    }
    const entries = [], bad = [];
    const add = (o, raw, row) => { const n = num(raw); if (n.bad) bad.push(`Row ${row}: “${n.bad}” is not a number`); entries.push({ ...o, qty: n.v, raw: n.bad || null, row }); };
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
    return { layout, author, hub, dated, entries, bad, synthetic };
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
   *  - 'Reorder roll' blank carries the same item and month from the previous cycle; zero cancels
   * Anything the reader cannot use is one issue: { row, key, text }. An issue with a key belongs to
   * that cell (cell.problem); one without a key is a row the reader could not place at all.
   * problems = the issues as text, one line each. */
  function resolveSheet(sheet, region, cycle, prev, ref) {
    const xw = new Map(ref.crosswalk.filter(c => c.region === region).map(c => [c.local, c]));
    const rname = (ref.regions.find(r => r.code === region) || {}).name || region;
    const cells = {}, issues = [];
    for (const en of sheet.entries) {
      const x = xw.get(en.local);
      if (!x) { issues.push({ row: en.row, key: null, text: `Item code ${en.local} is not on ${rname}'s list` }); continue; }
      if (!en.month) { issues.push({ row: en.row, key: null, text: "Month heading not recognised" }); continue; }
      const sku = x.sku, key = `${region}|${sku}|${en.month}`;
      const ea = ((ref.items.find(i => i.sku === sku) || {}).ea_unit || "each").toLowerCase();
      const cell = { sku, month: en.month, local: en.local, unit: en.unit, orig: en.qty, raw: en.raw || null, row: en.row, note: en.note, rule: [] };
      if (en.qty == null) {
        const p = prev && prev[key];
        if (en.raw != null) { cell.cs = null; cell.problem = `“${en.raw}” is not a number`; }
        else if (sheet.layout === "Reorder roll" && p) {
          cell.cs = p.cs; cell.rule.push(`blank: carried from the ${p.cycle} sheet`); cell.carried_from = p.cycle;
        } else { cell.cs = null; cell.problem = "Blank, and nothing earlier to carry"; }
      } else {
        let cs;
        if (en.unit === "EA") {
          cs = en.qty / x.ea_per_case;
          cell.rule.push(`${en.qty} ${ea}s ÷ ${x.ea_per_case} a case`);
          if (Math.abs(cs - Math.round(cs)) > 1e-9) cell.problem = `${en.qty} ${ea}s is ${cs.toFixed(1)} cases, not a whole case`;
        } else if (en.unit === "CS") cs = en.qty;
        else { cs = null; cell.problem = `Unit “${en.unit}” not known`; }
        if (cs === 0) cell.rule.push("zero: month cancelled");
        cell.cs = cs;
      }
      if (cell.problem) issues.push({ row: en.row, key, text: cell.problem });
      cell.cycle = cycle;
      cells[key] = cell;
    }
    const cv = Object.values(cells);
    return {
      cells, issues, problems: issueText(issues),
      counts: { cells: cv.length, ea: cv.filter(c => c.unit === "EA" && c.orig != null).length, carried: cv.filter(c => c.carried_from).length, cancelled: cv.filter(c => c.cs === 0).length },
    };
  }

  const issueText = issues => issues.map(i => `Row ${i.row}: ${i.text}`);

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
    return { date, time, sender: decodeWords(H.from || ""), to: decodeWords(H.to || ""), subject: decodeWords(H.subject || ""), body: (out.text || "").replace(/\r\n/g, "\n").trim(), attachments: out.attachments, synthetic: !!H["x-synthetic"] };
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
    record = Object.assign({ inputs: [], edits: [], decisions: [], versions: [], changes: [], reportEdits: [], removed: [], orders: [] }, record || {});
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
    for (const a of record.inputs) inputs.push({ ...a, origin: "added", synthetic: a.synthetic || !!(a.mail && a.mail.synthetic) });
    // the head manager removed these: a sheet, an email or a calendar row drops out of every view
    // (a removed correction lets the file it replaced count again, since it never resolves)
    const REMOVED = new Set((record.removed || []).map(r => r.input));
    for (let i = inputs.length - 1; i >= 0; i--) if (REMOVED.has(inputs[i].id)) inputs.splice(i, 1);
    // the head manager's edits to report cells: the latest per (sheet, key) wins; cs null restores the original
    const REDIT = {};
    for (const e of (record.reportEdits || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""))) REDIT[e.sheet + "#" + e.key] = e;
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
      if (read.synthetic) x.synthetic = true;
      x.region = x.region || guessRegion(read, ref);
      x.cycle = x.cycle || guessCycle(read);
      const earlier = Object.keys(lastOf).filter(k => k.startsWith(x.region + "|") && k.split("|")[1] < x.cycle).sort().pop();
      const res = resolveSheet(read, x.region, x.cycle, earlier ? lastOf[earlier].cells : null, ref);
      for (const e of Object.values(REDIT)) {
        if (e.sheet !== x.id || e.cs == null || e.cs === "") continue;
        const [, sku, month] = e.key.split("|");
        const cell = res.cells[e.key] || (res.cells[e.key] = { sku, month, local: null, unit: "CS", orig: null, row: null, note: "", rule: [], cycle: x.cycle });
        cell.edited = { was: cell.cs == null ? (cell.raw != null ? `“${cell.raw}”` : null) : cell.cs, problem: cell.problem || null, date: e.date, reason: e.reason || "", id: e.id };
        cell.cs = +e.cs;
        delete cell.problem;
        cell.rule.push(`changed by the head manager: was ${cell.edited.was == null ? "blank" : typeof cell.edited.was === "string" ? cell.edited.was : Math.round(cell.edited.was * 10) / 10}`);
        res.issues = res.issues.filter(i => i.key !== e.key);
      }
      res.problems = issueText(res.issues);
      res.counts.edited = Object.values(res.cells).filter(c => c.edited).length;
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
        t.title = t.kind === "email" ? f.mail.subject.replace(/^((re|fw|fwd):\s*)+/i, "") : `${f.event.type}, ${new Date(f.event.event_date + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
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
      return { v, label: `usually ships about ${r0(v)} a month`, method: `${span} avg × shops ${now}/${then}`, detail: `${seasonal ? "Seasonal item, same month last year" : "Same three months last year"} (${span}): ${fmt(avg)} cases a month shipped, × ${now}/${then} open shops = ${fmt(v)} cases.` };
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
      return { v, label: `sales point to about ${r0(v)} a month`, method: `${drink} sales ${pct(g - 1)} YoY`, detail: `${drink}, sold + comped, ${mRange(months[0], months[months.length - 1])}: ${fmt(base)} cases a month of this item. Sales ${pct(g - 1)} on a year ago (${mRange(rec[2], rec[0])}). × ${fmt(k)} cases shipped per sales-implied case (last 12 months) = ${fmt(v)} cases.` };
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
        out.push({ id: "swing", name: "Last plan", expected: last, d: r0(d), ok, label: `last plan ${fmt(last)}`, method: "change on last plan", detail: `Plan in force before this cycle: ${fmt(last)} cases. Flags beyond ±${Math.round(OPT.swingTol * 100)}% and ${OPT.swingMin} CS.` });
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
      const t = [s && s.label, q && q.label, w && !w.ok && w.label].filter(Boolean).join("; ") || `asks ${fmt(value)}`;
      return t[0].toUpperCase() + t.slice(1);
    }

    /* ---------------------------------------------------------------- draft */
    const cycleMonths = cycle => Array.from({ length: 6 }, (_, i) => addM(cycle, i));
    const lastPlanFor = (T, cycle) => versionsAll.filter(v => inForce(v) && v.date <= T && (v.cycle || "") < cycle).pop() || null;
    /* the draft for a cycle as of T: one line per region × SKU × month from the latest sheet in
     * hand per region, with provenance, checks, status and any decision the planner made */
    function draft(T, cycle) {
      cycle = cycle || cycleAt(T); if (!cycle) return null;
      const pin = lastPlanFor(T, cycle), known = knownAt(T), months = cycleMonths(cycle);
      // late news logged on the plan in force (adds and set totals) is extra to the managers' sheets,
      // so it carries into the next cycle's draft. Moves are timing the next sheet already shows.
      const carry = {};
      if (pin && pin.role === "published") {
        const w = working(T);
        if (w.base && w.base.id === pin.id) for (const [key, list] of Object.entries(w.applied)) for (const a of list) if (a.type === "add" || a.type === "set") (carry[key] = carry[key] || []).push({ id: a.id, ref: a.ref, delta: a.delta, text: a.text, date: a.date, reason: a.reason });
      }
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
          // a cell the reader could not use is one line to check, whatever its numbers say
          if (c.problem || c.cs == null) { ln.status = "problem"; ln.reason = c.problem || "Blank"; ln.checks = c.cs == null ? [] : lineChecks(T, key, c.cs, last, kn); }
          else {
            ln.checks = lineChecks(T, key, c.cs, last, kn);
            ln.status = verdict(ln.checks) ? "needs" : "accepted";
            ln.reason = ln.status === "needs" ? reasonOf(c.cs, ln.checks) : kn.length ? `Checks pass with ${kn.map(k => k.ref).join(", ")}` : "Checks pass";
            const s0 = ln.checks.find(x => x.id === "ship") || ln.checks.find(x => x.id === "sales");
            if (s0) ln.gap = s0.d;
          }
          if (kn.length) ln.note = kn.map(k => `${k.text} (${k.ref})`).join("; ");
          const cr = carry[key] || [];
          if (cr.length) { ln.carried = cr; ln.touched = true; ln.note = [ln.note, ...cr.map(c => `${c.delta >= 0 ? "+" : ""}${fmt(c.delta)} ${c.ref || "change"} kept`)].filter(Boolean).join("; "); }
          const extra = cr.reduce((a, c) => a + c.delta, 0);
          // a decision on the line: v3 target "draft:<cycle>|<key>", or the v2 screens' buttons
          // (decision "line:<sheet>|<key>" = keep plan; an edit from this sheet on this key = use the request)
          let dec = decisionAt(T, "draft:" + cycle + "|" + key);
          if (!dec) { const old = decisionAt(T, "line:" + s.id + "|" + key); if (old) dec = { ...old, outcome: old.outcome === "keep" ? "keep" : old.outcome }; }
          if (!dec) { const e = record.edits.filter(e => e.src === s.id && e.key === key && editLive(e, T)).pop(); if (e) dec = { id: e.id, date: e.date, target: "edit", outcome: "request", note: e.reason }; }
          if (dec) ln.decision = dec;
          // no usable number: the last plan stands until the head manager decides
          const asIs = ln.asked == null ? last : ln.asked + extra;
          ln.value = !dec ? asIs : dec.outcome === "keep" ? last : dec.outcome === "set" ? +dec.value : asIs;
          ln.settled = ln.status === "accepted" || (!!dec && dec.outcome !== "question" && !(dec.outcome === "request" && ln.asked == null));
          lines.push(ln);
        }
        // rows the reader could not place (unknown item code, unreadable month): one line each to check
        for (const i of (s.issues || []).filter(i => !i.key)) {
          const key = `row:${s.id}#${i.row}`, dec = decisionAt(T, "draft:" + cycle + "|" + key);
          lines.push({ key, region: r.code, sku: null, month: null, row: i.row, asked: null, last: null, value: null, sheet: s.id, src: s.src, synthetic: !!s.synthetic, known: [], gap: 0, checks: [], status: "problem", reason: i.text, ...(dec ? { decision: dec } : {}), settled: !!dec && dec.outcome !== "question" });
        }
      }
      const n = s => lines.filter(l => l.status === s).length, got = Object.values(regions).filter(Boolean);
      const counts = { sheets: got.length, lines: lines.filter(l => l.sku).length - n("nosheet"), accepted: n("accepted"), needs: n("needs"), problems: n("problem"), nosheet: n("nosheet"), unsettled: lines.filter(l => !l.settled).length, questions: lines.filter(l => l.decision && l.decision.outcome === "question").length };
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
        return { key: l.key, region: l.region, sku: l.sku, month: l.month, row: l.row || (l.cell && l.cell.row) || null, raw: (l.cell && l.cell.raw) || null, last: l.last, ask: l.asked, expected: sh ? sh.expected : sa ? sa.expected : null, sales: sa ? sa.expected : null,
          why: l.reason, detail: l.checks.map(c => `${c.name}: ${c.detail}`).join(" · "), method: l.checks.filter(c => !c.ok).map(c => c.method).join("; "),
          sheet: l.sheet, note: l.note || (l.cell && l.cell.rule.join("; ")) || "", status: l.status, decision: l.decision || null, settled: l.settled, value: l.value, synthetic: l.synthetic, checks: l.checks };
      });
      // the one count of what needs the head manager: unsettled lines, in total and per region.
      // Every screen that says "to check" reads these numbers, and Review lists exactly these lines.
      const openBy = {}; for (const l of L) if (!l.settled) openBy[l.region] = (openBy[l.region] || 0) + 1;
      const touched = d.lines.filter(l => l.touched).map(l => ({ key: l.key, region: l.region, sku: l.sku, month: l.month, last: l.last, ask: l.asked, value: l.value, why: l.note, carried: l.carried, status: l.status }));
      return { lines: L, open: L.filter(l => !l.settled).length, openBy, touched, total: d.counts.lines, accepted: d.counts.accepted, sheets: d.counts.sheets, cycle: d.cycle, headline: d.headline, synthetic: d.synthetic, lastPlan: d.lastPlan };
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
        from: d.lastPlan && d.lastPlan.id, synthetic: d.synthetic, preflight: pre, carried: d.lines.flatMap(l => (l.carried || []).map(c => c.id)),
        preflightText: [pre.unsettled && `${pre.unsettled} not checked`, pre.missing.length && `${pre.missing.length} sheet${pre.missing.length > 1 ? "s" : ""} missing`].filter(Boolean).join(", ") || "All settled",
      };
    }

    /* ---------------------------------------------------------------- typed changes */
    /* record.changes: { id, date, type: add|set|move, ref, key "R06|S014|2026-10",
     *   qty, unit "CS"|"EA", to (move: target month), replaces (set: a change id; default the
     *   latest live change with the same ref and key), reason, source (input id), quote,
     *   base (version id; default the version in force on its date), removed_on } */
    const chLive = (c, T) => c.date <= T && !(c.removed_on && c.removed_on <= T);
    function toCases(c) {
      const [r, sku] = c.key.split("|"), q = +c.qty || 0;
      if (String(c.unit || "CS").toUpperCase() === "EA") { const e = epc(r, sku), cs = q / e; return { cs, arith: `${fmt(q)} ${(ITEMS[sku].ea_unit || "EA").toLowerCase()}s ÷ ${e} = ${fmt(cs)} cases` }; }
      return { cs: q, arith: `${fmt(q)} cases` };
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
      if (!base) return { base: null, grid: {}, months: [], applied: {}, diff: [], superseded: [] };
      const grid = {}; for (const [k, row] of Object.entries(base.grid)) grid[k] = { ...row };
      const applied = {}, superseded = [];
      const at = (key, delta, c, text) => {
        const [r, sku, m] = key.split("|"), rs = r + "|" + sku;
        if (!grid[rs] || grid[rs][m] == null) return;
        grid[rs][m] = Math.round((grid[rs][m] + delta) * 1000) / 1000;
        (applied[key] = applied[key] || []).push({ id: c.id, type: c.type, ref: c.ref || null, delta, text, reason: c.reason || "", source: c.source || null, quote: c.quote || null, date: c.date });
      };
      const all = changesAt(T, base).filter(c => c.type === "add" || c.type === "set" || c.type === "move");   // older records may hold retired types
      for (const c of all) {
        if (c.replacedBy) { superseded.push({ id: c.id, ref: c.ref, key: c.key, by: c.replacedBy, date: c.date, text: `${toCases(c).arith} replaced` }); continue; }
        const { cs, arith } = toCases(c);
        const [r, sku, m] = c.key.split("|"), cur = (grid[r + "|" + sku] || {})[m];
        if (c.type === "add") at(c.key, cs, c, `${cs >= 0 ? "+" : ""}${arith}`);
        else if (c.type === "set") {
          if (c.replacesId) at(c.key, cs, c, `${arith}, replaces ${toCases(all.find(x => x.id === c.replacesId)).arith}`);
          else if (cur != null) at(c.key, cs - cur, c, `set to ${arith}, was ${fmt(cur)}`);
        } else if (c.type === "move") {
          const t = `${fmt(cs)} cases ${mShort(m)} → ${mShort(c.to)}`;
          at(c.key, -cs, c, t); at(`${r}|${sku}|${c.to}`, cs, c, t);
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
      return { base, grid, months: base.months, applied, diff, superseded };
    }

    /* ---------------------------------------------------------------- answer key */
    const KNOWN_GAPS = {
      "R02|S005|2026-09": "Both net the 96 cases pulled to Aug (HD-PULL-01)",
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
    /* the plan for purchasing: every line of the plan in force with live changes applied,
     * and for the lines changed since publishing, the published figure and why */
    function releaseList(T) {
      const w = working(T);
      const rows = w.diff.map(x => ({ region: regionName(x.region), sku: x.sku, item: ITEMS[x.sku].name, month: x.month, released: x.released, proposed: x.proposed, d: x.d, type: x.type, ref: x.ref, reason: x.reason, how: x.text }));
      const byKey = {}; for (const x of w.diff) byKey[x.key] = x;
      const esc = v => /[",\n]/.test(String(v == null ? "" : v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v == null ? "" : v);
      const r2 = v => v == null ? "" : Math.round(v * 100) / 100;
      const lines = [["Region", "SKU", "Item", "Month", "Cases", "Published cases", "Change since publishing", "Why it changed"].join(",")];
      let count = 0;
      for (const r of D.regions) for (const it of D.items) for (const m of w.months) {
        const v = (w.grid[r.code + "|" + it.sku] || {})[m]; if (v == null) continue;
        const x = byKey[`${r.code}|${it.sku}|${m}`]; count++;
        lines.push([r.name, it.sku, it.name, m, r2(v), x ? r2(x.released) : r2(v), x ? r2(x.d) : "", x ? x.reason : ""].map(esc).join(","));
      }
      return { base: w.base && { id: w.base.id, name: w.base.name, date: w.base.date }, rows, count, months: w.months, superseded: w.superseded, csv: lines.join("\n") + "\n" };
    }

    /* ---------------------------------------------------------------- purchasing */
    /* The buyer's watch list (Purchasing/Exports, Sep 18) and the made-up October rows. Orders are
     * pooled at Central Intake, so they are compared with the plan for all regions together. The
     * list is a slice of one buyer's desk: no stock on hand, not every order. Each line's state on a
     * date comes from the journal and receipt dates; on Sep 18 it matches the export's own columns.
     * record.orders: { id, date, item (a purchasing item id), kind, action more|cut|rush, sku, po,
     *   qty (cases), by (date), reason, title, removed_on } — the planner's asks of purchasing. */
    const PU0 = D.purchasing || {}, PU1 = SY.purchasing || {};
    const both = k => [...(PU0[k] || []).map(x => ({ ...x, synthetic: false })), ...(PU1[k] || []).map(x => ({ ...x, synthetic: true }))];
    const PO = { lines: both("lines"), journal: both("journal"), receipts: both("receipts"), reqs: both("requisitions") };
    const addD = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const mLong = m => MONTHS_LONG[+m.slice(5) - 1].replace(/^./, c => c.toUpperCase());
    const dl = d => d ? `${mShort(d.slice(0, 7))} ${+d.slice(8, 10)}` : "";
    const poId = l => `${l.po}/${l.line}`;
    const csOf = v => parseFloat(String(v || "").replace(/,/g, "")) || 0;
    const etaOf = (v, near) => { const m = String(v || "").match(/(\d{1,2})\/(\d{1,2})/); return m ? `${near.slice(0, 4)}-${pad(+m[1])}-${pad(+m[2])}` : null; };
    const poCache = {};
    /* every PO line entered by T, as it stood on T */
    function poAt(T) {
      if (poCache[T]) return poCache[T];
      const out = [];
      for (const l of PO.lines) {
        if (l.entered > T) continue;
        const k = poId(l), js = PO.journal.filter(j => `${j.po}/${j.line}` === k && j.at.slice(0, 10) <= T).sort((a, b) => a.at.localeCompare(b.at));
        let cancelled = 0, due = l.due0, voided = false;
        for (const j of js) {
          if (j.type === "Cancel balance") cancelled = l.qty - csOf(j.new);
          else if (j.type === "Void line") { cancelled = l.qty; voided = true; due = null; }
          else if (j.type === "Balance ETA") due = etaOf(j.new, l.due0) || due;
        }
        const rc = PO.receipts.filter(r => `${r.po}/${r.line}` === k && r.at.slice(0, 10) <= T);
        const received = rc.reduce((a, r) => a + r.qty, 0), open = Math.max(0, l.qty - cancelled - received);
        out.push({ ...l, id: k, cancelled, received, open, due, month: l.due0.slice(0, 7), status: voided ? "Void" : open === 0 ? "Closed" : received ? "Part received" : "Released", receipts: rc, changes: js });
      }
      return (poCache[T] = out);
    }
    const netPlan = (grid, sku, m) => { let t = 0, any = false; for (const r of D.regions) { const v = (grid[r.code + "|" + sku] || {})[m]; if (v != null) { t += v; any = true; } } return any ? Math.round(t * 1000) / 1000 : null; };
    const askedOf = (id, T) => (record.orders || []).filter(o => o.item === id && o.date <= T && !(o.removed_on && o.removed_on <= T));
    /* the latest thing the planner did about an item: a decision, an ask of purchasing, or a change logged from it */
    function handledAt(id, T) {
      return [...record.decisions.filter(d => d.target === id && d.date <= T).map(d => d.date), ...askedOf(id, T).map(o => o.date),
        ...(record.changes || []).filter(c => c.source === id && chLive(c, T)).map(c => c.date)].sort().pop() || null;
    }
    /* the region with the biggest plan line for an item and month: where a network change most likely lands */
    const mainRegion = (grid, sku, m) => D.regions.map(r => [r.code, (grid[r.code + "|" + sku] || {})[m] || 0]).sort((a, b) => b[1] - a[1])[0][0];
    const newsCache = {};
    /* purchasing items for Late news as of T, open and settled:
     *   short   a journal entry: the supplier cut an order, a balance slipped, a line was voided and reissued
     *   much    the plan for an item and month went down after an open order for it was placed
     *   late    a change since publishing adds cases and the order-by date (need date − lead days) is near or past
     *   request a requisition awaiting planner review */
    function purchaseNews(T) {
      if (newsCache[T]) return newsCache[T];
      const lines = poAt(T), w = working(T), months = w.months || [], items = [];
      const planNow = (sku, m) => months.includes(m) ? netPlan(w.grid, sku, m) : null;
      const name = sku => ITEMS[sku] ? ITEMS[sku].name : sku;
      const lead = sku => (ITEMS[sku] || {}).lead_days || 0;
      const planText = (sku, m) => { const v = planNow(sku, m); return v == null ? `${mLong(m)} is not in the plan in force` : `Plan for ${mLong(m)}, all regions: ${fmt(v)} cases`; };
      const changeInit = (sku, m, extra) => ({ type: "add", sku, month: months.includes(m) ? m : months[0], region: w.base ? mainRegion(w.grid, sku, months.includes(m) ? m : months[0]) : D.regions[0].code, qty: "", unit: "CS", ...extra });
      // 1. journal entries
      for (const j of PO.journal.filter(j => j.at.slice(0, 10) <= T)) {
        const day = j.at.slice(0, 10), l = lines.find(x => x.id === `${j.po}/${j.line}`); if (!l) continue;
        const base = { id: "po:" + j.no, kind: "short", date: day, sku: l.sku, month: l.month, region: null, synthetic: !!j.synthetic, quote: j.comment, source: `Supplier: ${l.supplier}` };
        if (j.type === "Cancel balance") {
          const kept = csOf(j.new), cut = csOf(j.old) - kept;
          items.push({ ...base, lines: [l], need: cut, title: `${name(l.sku)}: ${l.received >= kept ? "supplier sent" : "order cut to"} ${fmt(kept)} of ${fmt(csOf(j.old))} cases`,
            text: `${fmt(cut)} cases short on ${j.po}/${j.line}, ordered for ${dl(l.due0)}.`,
            prefill: { action: "more", qty: cut, by: [l.due0, addD(T, lead(l.sku))].sort().pop(), po: "" }, change: changeInit(l.sku, l.month, { qty: -cut }) });
        } else if (j.type === "Balance ETA") {
          const was = etaOf(j.old, l.due0), now = etaOf(j.new, l.due0), then = poAt(day).find(x => x.id === l.id), open = then ? then.open : l.open;
          const slip = was && now ? Math.round((new Date(now) - new Date(was)) / 864e5) : null;
          items.push({ ...base, lines: [l], need: open, title: `${name(l.sku)}: ${fmt(open)} cases now due ${dl(now)}, not ${dl(was)}`,
            text: `The balance on ${j.po}/${j.line} arrives ${slip != null ? `${slip} day${slip === 1 ? "" : "s"} ` : ""}later than planned.`,
            done: l.open === 0 ? "received" : null, prefill: { action: "rush", qty: open, by: [was, addD(T, 2)].sort().pop(), po: l.id }, change: changeInit(l.sku, l.month) });
        } else if (j.type === "Void line") {
          const re = (j.comment.match(/PO-\d+\/\d+/) || [])[0], rl = re && lines.find(x => x.id === re);
          const rj = rl && PO.journal.find(x => x.type === "Replacement issued" && `${x.po}/${x.line}` === re && x.at.slice(0, 10) <= T);
          if (rl && rj) items.push({ ...base, id: "po:" + rj.no, date: rj.at.slice(0, 10) > day ? rj.at.slice(0, 10) : day, lines: [l, rl], need: rl.qty, source: `Supplier: ${l.supplier}`,
            title: `${name(l.sku)}: ${fmt(rl.qty)} cases reissued on ${rl.po}, due ${dl(rl.due0)}, not ${dl(l.due0)}`, text: `${j.po}/${j.line} was voided and reissued on ${re}.`,
            done: rl.open === 0 ? "received" : null, prefill: { action: "rush", qty: rl.qty, by: [l.due0, addD(T, 2)].sort().pop(), po: rl.id }, change: changeInit(l.sku, l.month) });
          else items.push({ ...base, lines: [l], need: l.qty, title: `${name(l.sku)}: order for ${fmt(l.qty)} cases voided`, text: `${j.po}/${j.line} was voided with no replacement on the list.`,
            prefill: { action: "more", qty: l.qty, by: [l.due0, addD(T, lead(l.sku))].sort().pop(), po: "" }, change: changeInit(l.sku, l.month) });
        }
      }
      // 2. the plan moved after orders were placed: changes since publishing, and Check decisions on the published version
      if (w.base) {
        const agg = {};
        const slot = (sku, m) => agg[sku + "|" + m] = agg[sku + "|" + m] || { sku, month: m, d: 0, date: "", parts: [], check: 0, checkParts: [] };
        for (const x of w.diff) {
          const a = slot(x.sku, x.month), dt = x.changes.map(c => c.date).sort().pop();
          a.d += x.d; if (dt > a.date) a.date = dt;
          a.parts.push({ region: x.region, d: x.d, date: dt, text: x.text, reason: x.reason });
        }
        if (w.base.role === "published" && w.base.cycle) {
          const dr = draft(w.base.date, w.base.cycle);
          for (const l of (dr ? dr.lines : [])) if (l.sku && l.decision && l.last != null && l.value != null && l.value < l.last - 1e-9 && months.includes(l.month)) {
            const a = slot(l.sku, l.month); a.check += l.last - l.value; a.checkParts.push({ region: l.region, last: l.last, value: l.value });
          }
        }
        const cal = inputsAt(T).filter(x => x.kind === "calendar");
        for (const a of Object.values(agg)) {
          const pos = lines.filter(l => l.sku === a.sku && l.month === a.month && l.open > 0);
          const before = pos.filter(l => l.entered <= w.base.date), check = before.length ? a.check : 0;
          const net = Math.round((a.d - check) * 1000) / 1000;
          const dates = [a.d < 0 ? a.date : "", check ? w.base.date : ""].filter(Boolean).sort();
          if (net <= -1 && pos.length) {
            const used = pos.filter(l => l.entered <= (dates[dates.length - 1] || T)), open = used.reduce((t, l) => t + l.open, 0);
            // cases the supplier or buyer already cut from these orders count against the drop
            const cut0 = used.reduce((t, l) => t + l.cancelled, 0), excess = Math.min(open, -net - cut0); if (excess < 1 || !used.length) continue;
            const id = "much:" + a.sku + "@" + a.month, cut = askedOf(id, T).filter(o => o.action === "cut").reduce((t, o) => t + o.qty, 0);
            const how = [...a.parts.filter(p => p.d < 0).map(p => `${regionName(p.region)} ${p.text}${p.reason ? ` (${p.reason})` : ""}`), ...(check ? a.checkParts.map(p => `${regionName(p.region)}: set to ${fmt(p.value)} under Check, was ${fmt(p.last)}`) : [])];
            const big = used.slice().sort((x, y) => y.open - x.open)[0];
            items.push({ id, kind: "much", date: dates[dates.length - 1] || w.base.date, sku: a.sku, month: a.month, region: null, lines: used, need: excess, synthetic: used.some(l => l.synthetic),
              title: `${name(a.sku)}: ${fmt(excess)} more cases on order for ${mLong(a.month)} than the plan now needs`,
              text: `You lowered ${mLong(a.month)} by ${fmt(-net)} cases: ${how.join("; ")}. ${fmt(open)} cases are still on order for it.`, source: "",
              prefill: { action: "cut", qty: Math.max(0, excess - cut), by: big.due || big.due0, po: big.id }, change: changeInit(a.sku, a.month) });
          } else if (net >= 1 && a.d > 0) {
            // need date: a calendar event for the same region and month that arrived within three days of
            // the change (the rule Late news uses to close a calendar entry with a change); else the 1st
            const near = (x, d) => Math.abs(new Date(x) - new Date(d)) <= 3 * 864e5;
            const needs = a.parts.filter(p => p.d > 0).map(p => (cal.filter(x => x.region === p.region && (x.event.event_date || "").slice(0, 7) === a.month && near(x.date, p.date) && !/cancel|withdrawn|dropped/i.test(x.event.status || "")).map(x => x.event.event_date).sort()[0]) || a.month + "-01");
            const need = needs.sort()[0], by = addD(need, -lead(a.sku));
            if (by > addD(a.date, 14) || need < T) continue;
            const id = "late:" + a.sku + "@" + a.month, more = askedOf(id, T).filter(o => o.action !== "cut").reduce((t, o) => t + o.qty, 0);
            const ups = a.parts.filter(p => p.d > 0), reg = ups.slice().sort((x, y) => y.d - x.d)[0].region;
            const whys = [...new Set(ups.map(p => p.reason).filter(Boolean))].join("; ");
            items.push({ id, kind: "late", date: a.date, sku: a.sku, month: a.month, region: reg, lines: lines.filter(l => l.sku === a.sku && l.open > 0), need: net, synthetic: false, orderBy: by,
              title: `${name(a.sku)}: ${ups.length === 1 ? `${regionName(reg)}'s ` : ""}extra ${fmt(net)} cases for ${dl(need)} ${by < T ? "won't arrive in time" : `must be ordered by ${dl(by)}`}`,
              text: `You added ${fmt(net)} cases for ${ups.length === 1 ? regionName(reg) : ups.map(p => regionName(p.region)).join(", ")}${whys ? ` (${whys})` : ""}. No order covers them yet. ${name(a.sku)} takes ${lead(a.sku)} days to arrive${by < T ? `, so an order placed today arrives ${dl(addD(T, lead(a.sku)))}` : ""}.`,
              source: "", already: true,
              // already asked for more than the plan now adds: offer to cut the difference
              prefill: net - more < 0 ? { action: "cut", qty: more - net, by: need, po: "" } : { action: by < T ? "rush" : "more", qty: net - more, by: need, po: "" }, change: changeInit(a.sku, a.month, { region: reg }) });
          }
        }
      }
      // 3. requisitions waiting on the planner
      for (const q of PO.reqs.filter(q => q.at.slice(0, 10) <= T && /awaiting planner/i.test(q.state) && ITEMS[q.item] && q.need)) {
        const m = q.need.slice(0, 7), unit = String(q.uom || "").toLowerCase(), ea = unit && unit !== "cs" && unit !== "case";
        const cs = ea ? q.qty / epc(q.by, q.item) : q.qty, by = addD(q.need, -lead(q.item));
        const key = `${q.by}|${q.item}|${m}`, inPlan = (w.grid[q.by + "|" + q.item] || {})[m], ch = w.applied[key] || [];
        items.push({ id: "rq:" + q.id, kind: "request", date: q.at.slice(0, 10), sku: q.item, month: m, region: q.by, synthetic: !!q.synthetic, need: cs, orderBy: by,
          lines: lines.filter(l => l.sku === q.item && l.open > 0), quote: q.note, source: `Requisition ${q.id}${q.po ? `, on order ${q.po}` : ", not ordered yet"}`,
          title: `${regionName(q.by)}: ${fmt(q.qty)} ${ea ? unit + "s" : "cases"} of ${name(q.item)} for ${dl(q.need)}`,
          text: `${ea ? `${fmt(q.qty)} ${unit}s is ${fmt(cs)} cases. ` : ""}In the plan for ${regionName(q.by)}, ${mLong(m)}: ${inPlan == null ? "no line" : `${fmt(inPlan)} cases`}${ch.length ? `, including ${ch.map(c => `${c.ref || "a change"}, ${c.delta >= 0 ? "+" : ""}${fmt(c.delta)} cases, logged ${dl(c.date)}`).join("; ")}` : ""}. Order-by date ${dl(by)}${by < T ? " has passed" : ""}.`,
          prefill: { action: by < T ? "rush" : "more", qty: cs, by: q.need, po: "" }, change: { type: "add", region: q.by, sku: q.item, month: months.includes(m) ? m : months[0], qty: ea ? q.qty : cs, unit: ea ? "EA" : "CS", reason: `${q.id}: ${q.scope}` } });
      }
      for (const it of items) {
        it.planText = planText(it.sku, it.month);
        it.asked = askedOf(it.id, T);
        it.handled = handledAt(it.id, T);
        // a late balance that has since been received needs nothing more
        it.open = !it.done && (!it.handled || it.handled < it.date);
        it.change.reason = it.change.reason || it.title;
      }
      items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      return (newsCache[T] = items);
    }
    /* what purchasing is asked to do, as of T: every live ask whose date to act by has not passed */
    function ordersAt(T) {
      const ACT = { more: "Order more", cut: "Cut the order", rush: "Rush" };
      const rows = (record.orders || []).filter(o => o.date <= T && !(o.removed_on && o.removed_on <= T) && (o.by || "") >= T).sort((a, b) => a.date.localeCompare(b.date) || a.sku.localeCompare(b.sku));
      const esc = v => /[",\n]/.test(String(v == null ? "" : v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v == null ? "" : v);
      const csv = [["Asked on", "Action", "SKU", "Item", "PO line", "Cases", "Needed by", "Why", "Late news item"].join(","),
        ...rows.map(o => [o.date, ACT[o.action], o.sku, ITEMS[o.sku].name, o.po || "new order", Math.round(o.qty * 100) / 100, o.by, o.reason, o.title === o.reason ? "" : o.title].map(esc).join(","))];
      return { rows: rows.map(o => ({ ...o, actionText: ACT[o.action] })), csv: csv.join("\n") + "\n" };
    }

    /* ---------------------------------------------------------------- assistant */
    /* one message as plain text, for POST /api/draft: an input id, a thread id, or pasted text */
    function messageText(idOrText, T) {
      const one = x => x.kind === "email" ? [`From: ${x.mail.sender}`, `To: ${x.mail.to || ""}`, `Date: ${x.date} ${x.time || ""}`.trim(), `Subject: ${x.mail.subject}`, "", x.mail.body].join("\n")
        : x.kind === "calendar" ? `Event calendar row ${x.event.id} (${x.event.type}, ${x.event.status}), known ${x.date}: ${x.event.detail}`
        : x.kind === "sheet" ? `Sheet ${x.src} (${regionName(x.region)}, ${x.cycle} cycle), received ${x.date}` : String(x.src || "");
      if (byId[idOrText]) return one(byId[idOrText]);
      const th = T && threadsAt(T).find(t => t.id === idOrText);
      if (th) return th.items.map(one).join("\n\n---\n\n");
      return String(idOrText || "");
    }
    /* what the assistant reads: the desk as of T, compact. The page sends this same object on
     * every call, so the answer can only come from what the planner can see on that date.
     * opts.focus: a thread or input id to send in full; opts.bodyChars: trim for other emails */
    function assistantContext(T, opts) {
      opts = opts || {};
      const cut = (s, n) => { s = String(s || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); return s.length > n ? s.slice(0, n) + " …" : s; };
      const w = working(T), cyc = cycleAt(T), rv = review(T), ak = (() => { const v = versionsAll.filter(v => v.role === "published" && v.date <= T).pop(); return v ? answerKey(v) : null; })();
      const months = w.months || [];
      const plan = {};
      for (const [rs, row] of Object.entries(w.grid)) plan[rs] = months.map(m => row[m] == null ? null : Math.round(row[m] * 10) / 10);
      const msgItem = (x, n) => x.kind === "email" ? { id: x.id, date: x.date, from: x.mail.sender, subject: x.mail.subject, body: cut(x.mail.body, n), synthetic: !!x.synthetic || undefined }
        : x.kind === "calendar" ? { id: x.id, date: x.date, event: x.event.id, type: x.event.type, status: x.event.status, region: x.event.region, detail: cut(x.event.detail, n) }
        : { id: x.id, date: x.date, kind: x.kind, src: x.src };
      const focus = opts.focus || null, bodyChars = opts.bodyChars || 700;
      const threads = threadsAt(T).slice(0, opts.threads || 30).map(t => ({ id: t.id, title: t.title, region: t.region, last: t.last, messages: t.items.map(x => msgItem(x, t.id === focus || x.id === focus ? 6000 : bodyChars)) }));
      const ch = (record.changes || []).filter(c => c.date <= T).map(c => ({ id: c.id, date: c.date, type: c.type, ref: c.ref || null, key: c.key || null, qty: c.qty == null ? null : c.qty, unit: c.unit || null, to: c.to || null, reason: c.reason || "", quote: c.quote || undefined, source: c.source || null, removed_on: c.removed_on && c.removed_on <= T ? c.removed_on : undefined }));
      const dec = (record.decisions || []).filter(d => d.date <= T).slice(-40).map(d => ({ id: d.id, date: d.date, target: d.target, outcome: d.outcome, value: d.value, note: d.note || undefined }));
      return {
        asOf: T, cycle: cyc, synthetic: inputsAt(T).some(x => x.synthetic) || undefined,
        units: "Quantities are cases (CS) unless a unit says EA; EA ÷ ea_per_case = CS. Keys are region|sku|month.",
        regions: D.regions.map(r => ({ code: r.code, name: r.name, manager: r.manager, hub: r.hub, shops: r.shops })),
        items: D.items.map(i => ({ sku: i.sku, name: i.name, ea_unit: i.ea_unit, ea_per_case: i.ea_per_case })),
        planInForce: w.base ? { id: w.base.id, name: w.base.name, date: w.base.date, role: w.base.role } : null,
        months, plan,
        diff: w.diff.map(x => ({ key: x.key, released: x.released, proposed: x.proposed, d: x.d, how: x.text, reason: x.reason, changes: x.changes.map(c => c.id) })),
        superseded: w.superseded,
        changes: ch, decisions: dec,
        versions: versionsAll.filter(v => v.date <= T).map(v => ({ id: v.id, name: v.name, date: v.date, cycle: v.cycle, role: v.role, status: v.status, note: v.note || undefined })),
        sheets: sheetsAt(T).filter(s => !cyc || s.cycle >= addM(cyc, -1)).map(s => ({ id: s.id, src: s.src, date: s.date, region: s.region, cycle: s.cycle, replaces: s.replaces || undefined, problems: (s.problems || []).length || undefined })),
        draft: rv.headline ? { cycle: rv.cycle, headline: rv.headline, lastPlan: rv.lastPlan && rv.lastPlan.name, flags: rv.lines.slice(0, opts.flags || 30).map(l => ({ key: l.key, last: l.last, ask: l.ask, expected: l.expected, why: l.why, note: l.note || undefined, decision: l.decision ? l.decision.outcome : undefined })) } : null,
        known: knownAt(T).map(k => ({ ref: k.ref, key: `${k.region}|${k.sku}|${k.month}`, cs: k.cs, text: k.text, input: k.input })),
        threads,
        answerKey: ak ? { headline: ak.headline, lean: ak.leanText } : undefined,
        purchasing: { note: "One buyer's watch list of pooled orders at Central Intake, not every order and no stock on hand. Cases.",
          open: purchaseNews(T).filter(i => i.open).map(i => ({ id: i.id, kind: i.kind, date: i.date, title: i.title, detail: i.text })),
          orders: poAt(T).filter(l => l.open > 0).map(l => ({ po: l.id, sku: l.sku, open: l.open, due: l.due })),
          asked: ordersAt(T).rows.map(o => ({ date: o.date, action: o.action, sku: o.sku, po: o.po || null, cases: o.qty, by: o.by, why: o.reason })) },
      };
    }

    return {
      messageText, assistantContext,
      inputs, byId, sheets, versionsAll, ITEMS, regionName,
      baseAt, prevBase, planAt, editsAt, inputsAt, threadsAt, editLive, sheetsAt, cycleAt, latestSheet, requestAt, decisionAt, checks, needs, fmt, sign,
      // v3
      options: OPT, draft, review, flags, flagGroups, draftVersion, working, changesAt, answerKey, lineInfo, releaseList, knownAt, poAt, purchaseNews, ordersAt, shipAt, expectShip, expectSales, lineChecks, isSeasonal, lastPlanFor, toCases, addM,
    };
  }

  G.Core = { MON, normMonth, parseDelimited, looksTabular, isSheet, readSheet, guessRegion, guessCycle, resolveSheet, readEmail, readPastedText, guessRegionFromText, Desk };
})(typeof window !== "undefined" ? window : globalThis);
