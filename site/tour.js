/* Demo walkthrough: one popup per step of demo-steps.js, beside the thing to click.
 * `at` picks the target from the desk's state; `DONE` moves on once the step's clicks are made.
 * The popup never blocks a click and is re-placed whenever app.js redraws. */
"use strict";
window.Tour = (() => {
  const KEY = "supplydesk.tour", STEPS = window.DEMO_STEPS || [];
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const put = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch {} };

  /* ------------------------------------------------ what each step points at */
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const main = () => $("footMain");
  const rail = id => q(`#rail [data-step="${id}"]`);
  const mhead = (txt, pill) => qa(".mhead").find(h => h.textContent.toLowerCase().includes(txt) && (!pill || (h.querySelector(".pill") || {}).textContent === pill));
  const pageHead = () => q("#page .pagehead");
  const published = () => R.versions.some(v => v.cycle === "2026-10");
  const onTab = t => S.tab === t;
  /* a Late news row worked through its change card: open it, Log a change, fill, save */
  const cardFlow = (h, fill) => {
    const row = h.parentElement;
    if (!row.classList.contains("open")) return h;
    const card = row.querySelector('form.ccard[data-card=""]');
    if (!card || !S.cc) return row.querySelector("[data-work]");
    return fill(card, S.cc) || card.querySelector("button.primary");
  };
  const AT = [
    /* 1 */ () => $("rail"),
    /* 2 */ () => $("nextDay"),
    /* 3 */ () => q('.rbox[data-region="R01"]') || pageHead(),
    /* 4 */ () => onTab("sheets") && S.region === "R01" ? q('td[data-cell="R01|S020|2027-02"]') : q('.rbox[data-region="R01"]') || rail("sheets"),
    /* 5 */ () => (onTab("sheets") && S.region === "R01") || onTab("check") ? main() :q('.rbox[data-region="R01"]') || rail("sheets"),
    /* 6 */ () => {
      if (!onTab("check")) return rail("check");
      const n = R.decisions.filter(d => d.target.startsWith("draft:2026-10")).length - ((get() || {}).base || 0);
      if (S.setting) return q("[data-setform]");
      return (n === 0 && q('[data-dec$="|request"]')) || (n === 1 && q('[data-dec$="|keep"]')) || (n === 2 && q("[data-set]")) || main();
    },
    /* 7 */ () => onTab("check") ? main() : !onTab("publish") ? rail("publish") : published() ? q(".answer") || main() : !S.sel ? q("#grid td.cell[data-key]") : main(),
    /* 8 */ () => {
      if (!onTab("news")) return onTab("publish") && published() ? main() : rail("news");
      if (S.date < "2026-10-12") return $("nextDay");
      const h = mhead("november harvest feature");
      if (h) return cardFlow(h, (card, c) => !String(c.qty).trim() ? card.querySelector('[data-f="qty"]') : c.unit !== "EA" ? card.querySelector('[data-f="unit"]') : null);
      const t = mhead("fruit base", "Too late");
      if (t) { const row = t.parentElement; if (!row.classList.contains("open")) return t; const f = row.querySelector("#askForm"); return f ? f.querySelector("button.primary") : row.querySelector("[data-ask]"); }
      return q("#page .flash") || pageHead();
    },
    /* 9 */ () => {
      if (S.date < "2026-10-13") return $("nextDay");
      const asks = S.asks || [], approved = asks.some(a => (a.actions || []).some(x => x.done));
      if (!onTab("ask")) return approved ? pageHead() : q('#side [data-step="ask"]');
      if (S.asking || asks.length < 2) return $("askForm");
      return q("[data-approve]") || (approved ? $("footBack") : $("askForm"));
    },
    /* 10 */ () => {
      if (!onTab("news")) return rail("news");
      const h = mhead("north route resurfacing");
      if (h) return cardFlow(h, (card, c) => c.type !== "move" ? card.querySelector('[data-ctype="move"]') : !String(c.qty).trim() ? card.querySelector('[data-f="qty"]') : c.to !== "2026-12" ? card.querySelector('[data-f="to"]') : null);
      return q("#page .flash") || pageHead();
    },
    /* 11 */ () => {
      if (ROLE !== "manager") return q('#side a[href="?role=manager"]');
      if (S.mstep === "region") return q('[data-pick="R06"]');
      if (S.mstep === "sheet") return S.preview && !S.preview.error ? main() : $("mgrDrop");
      if (S.mstep === "late") return S.mnote && S.mnote.startsWith("Request sent") ? main() : $("mgrReq");
      return pageHead();
    },
    /* 12 */ () => ROLE === "manager" ? null : !onTab("news") ? rail("news") : mhead("", "Request") || q("#page .mlist") || pageHead(),
    /* 13 */ () => onTab("news") ? main() : !onTab("send") ? rail("send") : S.sent !== S.date ? main() : $("dlOrders") || main(),
    /* 14 */ () => S.date !== "2026-09-18" ? q(".daypick") : !onTab("publish") ? rail("publish") : q(".answer") || pageHead(),
  ];

  /* when a step's clicks are all made: the walkthrough moves on by itself. Step 1 has no click.
   * Step 11 is done in the submanager tab, every other step in the head manager's. */
  const DONE = [
    /* 1 */ null,
    /* 2 */ () => S.date >= "2026-10-09",
    /* 3 */ () => onTab("sheets") && S.region === "R01",
    /* 4 */ () => R.reportEdits.some(e => e.key === "R01|S020|2027-02" && e.cs != null),
    /* 5 */ () => onTab("check") && !S.checkRegion,
    /* 6 */ () => R.decisions.filter(d => d.target.startsWith("draft:2026-10")).length - ((get() || {}).base || 0) >= 3,
    /* 7 */ published,
    /* 8 */ () => R.orders.some(o => o.action === "rush" && !o.removed_on),
    /* 9 */ () => !onTab("ask") && (S.asks || []).some(a => (a.actions || []).some(x => x.done)),
    /* 10 */ () => R.changes.some(c => c.type === "move" && c.to === "2026-12" && !c.removed_on),
    /* 11 */ () => S.mstep === "done",
    /* 12 */ () => { const h = onTab("news") && mhead("", "Request"); return !!h && h.parentElement.classList.contains("open"); },
    /* 13 */ () => S.sentOrders === S.date,
    /* 14 */ null,
  ];
  /* moves on only when the step becomes done while it is shown: going Back to a finished step stays there */
  let seenI = null, seenDone = false;
  function autoNext(st) {
    const d = DONE[st.i];
    if (!d || (st.i === 10) !== (ROLE === "manager")) { seenI = null; return false; }
    let now = false; try { now = !!d(); } catch (e) {}
    if (seenI !== st.i) { seenI = st.i; seenDone = now; return false; }
    if (!now || seenDone) return false;
    seenDone = true; show(st.i + 1); return true;
  }

  /* ------------------------------------------------ the popup and the ring */
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`(.+?)`/g, "<code>$1</code>");
  let box = null, ring = null, shownI = null, lastEl = null;
  function build() {
    if (box) return;
    ring = document.createElement("div"); ring.className = "tourring";
    box = document.createElement("div"); box.className = "tourbox"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Demo walkthrough");
    document.body.append(ring, box);
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-tour]"); if (!b) return;
      const st = get(); if (!st) return;
      const a = b.dataset.tour;
      if (a === "close") return close();
      show(a === "next" ? st.i + 1 : st.i - 1);
    });
  }
  function teardown() { if (box) { box.remove(); ring.remove(); box = ring = null; shownI = null; lastEl = null; } }
  function draw(st) {
    build();
    if (shownI === st.i) return;
    shownI = st.i; lastEl = null;
    const s = STEPS[st.i], last = st.i === STEPS.length - 1;
    box.innerHTML = `<div class="tourtop"><span class="hint" title="Drag to move">Walkthrough · step ${st.i + 1} of ${STEPS.length} · drag to move</span><button class="btn small quiet" data-tour="close" title="Close the walkthrough">✕</button></div>
      <div class="tourshows">${md(s.shows)}</div>
      <div class="tourclick"><span class="hint">Click:</span> ${md(s.click)}</div>
      <div class="tourbtns"><button class="btn small" data-tour="back" ${st.i ? "" : "disabled"}>◀ Back</button><button class="btn small primary" data-tour="${last ? "close" : "next"}">${last ? "Finish" : "Next ▶"}</button></div>`;
    bindDrag();
  }
  const visible = el => { if (!el || !el.isConnected) return null; const r = el.getBoundingClientRect(); return r.width || r.height ? r : null; };
  /* the emptiest spot near the target. The screen is sampled on a 24px grid: a point is busy when it
   * lands on text, a control or a table cell, and counts three on the bars at the top and bottom,
   * which the demo keeps clicking. Each spot that keeps clear of the target scores its busy points
   * plus one per 40px from the target; the box stays where it is unless a spot scores clearly
   * better, so it does not hop while typing. */
  const BUSY = "button,a,input,select,textarea,label,td,th,[data-toggle],[tabindex]";
  const busy = el => !el ? 1 : el === document.body || el === document.documentElement ? 0 : el.closest(".topbar,.foot,.rail") ? 3 :
    el.closest(BUSY) || [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) ? 1 : 0;
  function freeSpot(r, bw, bh, cur) {
    const C = 24, W = innerWidth, H = innerHeight, nx = Math.ceil(W / C), ny = Math.ceil(H / C), w = nx + 1;
    const P = new Int32Array(w * (ny + 1));
    box.style.visibility = "hidden";
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      P[(j + 1) * w + i + 1] = busy(document.elementFromPoint(i * C + C / 2, j * C + C / 2)) + P[j * w + i + 1] + P[(j + 1) * w + i] - P[j * w + i];
    box.style.visibility = "";
    const pad = 8, gap = 12;
    const score = (x, y) => {
      if (x < pad || y < pad || x + bw > W - pad || y + bh > H - pad) return null;
      if (x < r.right + gap && x + bw > r.left - gap && y < r.bottom + gap && y + bh > r.top - gap) return null;
      const i0 = Math.floor(x / C), j0 = Math.floor(y / C), i1 = Math.min(nx, Math.ceil((x + bw) / C)), j1 = Math.min(ny, Math.ceil((y + bh) / C));
      const hits = P[j1 * w + i1] - P[j0 * w + i1] - P[j1 * w + i0] + P[j0 * w + i0];
      const dx = Math.max(0, r.left - (x + bw), x - r.right), dy = Math.max(0, r.top - (y + bh), y - r.bottom);
      return hits + Math.hypot(dx, dy) / 40;
    };
    let best = null;
    for (let y = pad; y + bh <= H - pad; y += 12) for (let x = pad; x + bw <= W - pad; x += 12) {
      const s = score(x, y); if (s != null && (!best || s < best[2])) best = [x, y, s];
    }
    const now = cur && score(cur[0], cur[1]);
    return now != null && best && now <= best[2] + 2 ? cur : best;
  }
  /* drag the box by its top line; it stays where it is put until the step changes or the target moves under it */
  let pinned = null;
  function bindDrag() {
    const top = box.querySelector(".tourtop");
    top.onpointerdown = e => {
      if (e.target.closest("button")) return;
      e.preventDefault(); top.setPointerCapture(e.pointerId);
      const b = box.getBoundingClientRect(), ox = e.clientX - b.left, oy = e.clientY - b.top, st = get();
      top.onpointermove = m => {
        const x = Math.max(0, Math.min(innerWidth - b.width, m.clientX - ox)), y = Math.max(0, Math.min(innerHeight - 40, m.clientY - oy));
        Object.assign(box.style, { left: x + "px", top: y + "px" }); pinned = { i: st && st.i, x, y };
      };
      top.onpointerup = () => { top.onpointermove = top.onpointerup = null; };
    };
  }
  /* beside the target, never on it, on the emptiest spot near it */
  function place(fromRender) {
    const st = get(); if (!st || !STEPS[st.i]) return teardown();
    if (autoNext(st)) return;
    draw(st);
    let el = null; try { el = AT[st.i] && AT[st.i](); } catch (e) { el = null; }
    let r = visible(el);
    const top = 56, foot = ($("foot") || {}).offsetHeight || 0, W = innerWidth, H = innerHeight;
    if (r && el !== lastEl && fromRender && (r.top < top || r.bottom > H - foot)) { el.scrollIntoView({ block: "center", inline: "nearest" }); r = visible(el); }
    lastEl = el;
    const bw = box.offsetWidth, bh = box.offsetHeight, g = 12, pad = 8;
    const clampX = x => Math.max(pad, Math.min(W - bw - pad, x)), clampY = y => Math.max(pad, Math.min(H - bh - pad, y));
    let x, y;
    if (r) { ring.style.display = "block"; Object.assign(ring.style, { left: r.left - 4 + "px", top: r.top - 4 + "px", width: r.width + 8 + "px", height: r.height + 8 + "px" }); }
    else ring.style.display = "none";
    if (pinned && pinned.i === st.i && !(r && pinned.x < r.right && pinned.x + bw > r.left && pinned.y < r.bottom && pinned.y + bh > r.top)) return;
    pinned = null;
    const cur = box.style.left ? [parseFloat(box.style.left), parseFloat(box.style.top)] : null;
    const spot = r && freeSpot(r, bw, bh, cur);
    if (!r) { x = W - bw - 24; y = H - foot - bh - 16; }
    else if (spot) [x, y] = spot;
    else {
      const tries = [
        [r.right + g, clampY(r.top + r.height / 2 - bh / 2)],
        [clampX(r.left + r.width / 2 - bw / 2), r.bottom + g],
        [r.left - g - bw, clampY(r.top + r.height / 2 - bh / 2)],
        [clampX(r.left + r.width / 2 - bw / 2), r.top - g - bh],
      ];
      const overlap = ([a, b]) => Math.max(0, Math.min(a + bw, r.right + 4) - Math.max(a, r.left - 4)) * Math.max(0, Math.min(b + bh, r.bottom + 4) - Math.max(b, r.top - 4));
      const fits = ([a, b]) => a >= pad && b >= pad && a + bw <= W - pad && b + bh <= H - pad;
      const ok = tries.find(fits) || tries.map(([a, b]) => [clampX(a), clampY(b)]).sort((p, o) => overlap(p) - overlap(o))[0];
      [x, y] = ok;
    }
    Object.assign(box.style, { left: Math.round(x) + "px", top: Math.round(y) + "px" });
  }
  let queued = false;
  const later = fromRender => { if (queued) return; queued = true; setTimeout(() => { queued = false; place(fromRender); }); };

  function show(i) {
    const st = get() || {};
    i = Math.max(0, Math.min(STEPS.length - 1, i));
    put({ i, base: i === 5 ? R.decisions.filter(d => d.target.startsWith("draft:2026-10")).length : st.base || 0 });
    later(true);
  }
  function close() { put(null); teardown(); }
  /* start over: the demo resets (app.js), the walkthrough opens on step 1 */
  function begin() { put({ i: 0, base: 0 }); }

  new MutationObserver(ms => { if (get() && ms.some(m => !(box && box.contains(m.target)) && !(ring && ring === m.target))) later(true); })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  addEventListener("resize", () => later(false));
  document.addEventListener("scroll", () => later(false), true);
  addEventListener("storage", e => { if (e.key === KEY) { if (!get()) teardown(); else later(true); } });
  if (get()) later(true);
  return { begin, close, active: () => !!get() };
})();
