/* The demo walkthrough: one small popup per step of docs/DEMO.md, beside the thing to click.
 * Its description and click come from demo-steps.js (the same file DEMO.md's table is written from). Each step's
 * `at` below picks what to point at from the desk's state, so a step with several clicks
 * follows along as they are made. Nothing here clicks for you or blocks a click: the popup
 * sits beside its target, the ring and the popup (all but its buttons) let clicks through, and both are re-placed
 * whenever app.js redraws. The step is kept in localStorage, so the submanager tab (step 11)
 * shows the same step, and Reset demo keeps the walkthrough open. */
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
    box.innerHTML = `<div class="tourtop"><span class="hint">Walkthrough · step ${st.i + 1} of ${STEPS.length}</span><button class="btn small quiet" data-tour="close" title="Close the walkthrough">✕</button></div>
      <div class="tourshows">${md(s.shows)}</div>
      <div class="tourclick"><span class="hint">Click:</span> ${md(s.click)}</div>
      <div class="tourbtns"><button class="btn small" data-tour="back" ${st.i ? "" : "disabled"}>◀ Back</button><button class="btn small primary" data-tour="${last ? "close" : "next"}">${last ? "Finish" : "Next ▶"}</button></div>`;
  }
  const visible = el => { if (!el || !el.isConnected) return null; const r = el.getBoundingClientRect(); return r.width || r.height ? r : null; };
  /* beside the target, never on it: right, below, left, above, the first that fits on screen */
  function place(fromRender) {
    const st = get(); if (!st || !STEPS[st.i]) return teardown();
    draw(st);
    let el = null; try { el = AT[st.i] && AT[st.i](); } catch (e) { el = null; }
    let r = visible(el);
    const top = 56, foot = ($("foot") || {}).offsetHeight || 0, W = innerWidth, H = innerHeight;
    if (r && el !== lastEl && fromRender && (r.top < top || r.bottom > H - foot)) { el.scrollIntoView({ block: "center", inline: "nearest" }); r = visible(el); }
    lastEl = el;
    const bw = box.offsetWidth, bh = box.offsetHeight, g = 12, pad = 8;
    const clampX = x => Math.max(pad, Math.min(W - bw - pad, x)), clampY = y => Math.max(pad, Math.min(H - bh - pad, y));
    let x, y;
    if (!r) { ring.style.display = "none"; x = W - bw - 24; y = H - foot - bh - 16; }
    else {
      ring.style.display = "block";
      Object.assign(ring.style, { left: r.left - 4 + "px", top: r.top - 4 + "px", width: r.width + 8 + "px", height: r.height + 8 + "px" });
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
