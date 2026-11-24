# Supply Desk v3: the planner's month

Mon 23 Nov 2026. This replaces the screen list in SPEC §6. The rest of SPEC
(what to read, which checks, the packet cases in §5.2) still stands.

## 1. What it is for, in one paragraph

The central planner opens Supply Desk when the managers' sheets come in each
month. The app reads all six sheets, builds the draft plan itself, and shows
the planner only the few lines that look wrong next to what actually shipped
and sold. The planner settles those, publishes, and sends purchasing and
finance one list of what changed and why. When late news arrives (a promo, an
opening that moves, a trial on hold), the planner logs it as a change against
the published plan, and the list updates. Every number can be clicked to see
where it came from.

## 2. The demo story (what the interviewers see)

The packet stops on **Fri Sep 18, 2026**. The demo plays one real month and one
synthetic month through the same screens.

| Step | Desk date | What happens |
|---|---|---|
| 1 | Sep 8–10 | Six real September sheets arrive (two are corrected resends). The app builds the draft and flags a handful of lines. |
| 2 | Sep 11 | Planner settles the flags and publishes. The app compares it with the plan Dutch Bros really posted that day: "matches on N of M lines; differs on …, because …". This is the proof the app works. |
| 3 | Sep 14–17 | Mango promo, then its replacement; opening kit moves Oct → Nov; winter trial held as an open question; finance's cup buffer kept as a scenario. |
| 4 | Sep 18 | Purchasing's Monday buy review: one screen, released number vs proposed vs why, plus open questions. Export it. |
| 5 | Oct 6–16 (synthetic) | Six October sheets and a few emails arrive, made up but built from the real September files and labelled **Synthetic** on screen. The same loop runs: draft, flags, publish, late news. |
| 6 | Live | The interviewers' new information is pasted or dropped in and goes through the same loop. |

## 3. Rules the whole app follows

0. **UI/UX first; little text.** Every screen must work at a glance: numbers,
   colour and position carry the meaning, not paragraphs. No explanatory hints
   under headings. A reason is a short phrase ("ships ~310/mo"), with detail on
   click or hover. If a screen needs a paragraph to explain itself, redesign it.
1. **The plan the planner publishes is the plan in force.** Dutch Bros' own plan
   files never take over. July and August posts load as past versions so
   history is not empty. Dutch Bros' September files are the answer key: shown
   beside the planner's version, never replacing it.
2. **The app makes the draft; the planner makes decisions.** Lines that pass
   every check are accepted from the request automatically and say so. The
   planner sees only lines that fail a check, have a reading problem, or are
   touched by late news.
3. **Every flag says why in one sentence**, with the numbers: "Asks 420; ships
   about 310 a month (Sep–Nov last year, scaled for 2 new shops)".
4. **Late news is a typed change**, never a bare ±: *add*, *set total* (replaces
   an earlier change), *move* to another month, *hold* (open question, no
   numbers), *scenario* (never enters the plan). Quantity in the unit the
   message used; the app converts and shows the arithmetic.
5. **One date.** A compact "Today" control in the header (◀ previous arrival,
   date, next arrival ▶) is the demo clock. Everything the planner does is
   dated to it. No big slider; History has its own "as it stood on" picker.
6. **Plain words.** Regions by name (Gulf Coast, not R06 or Harbor). No
   "desk", "packet", "amber corner". Dutch Bros' file states get a one-line
   gloss on hover (Withdrawn = saved then pulled before posting).
7. **Synthetic is always visible.** Any screen showing October data carries a
   Synthetic badge.

## 4. Screens

Tabs follow the month left to right: **Inbox → Review → Plan → Release**, then
**History** and **Ask**.

**Inbox: what arrived.** Six region cards for the current cycle (received,
which file counts, layout, units converted, problems). Click one to see the
sheet as read. Messages below, split in two: *About the plan* (promos,
openings, trials, requests) on top with a "Log a change" button; *Everything
else* (dock, receiving, purchase orders) collapsed. Paste or drop box on the
right. A message can be marked "no change" or "waiting on …".

**Review: what needs you.** The draft for the cycle, filtered to lines needing
a decision, ranked by size of the gap. Each row: item, region, month, last
plan, request, expected from shipments, sales-implied (where it exists), why
flagged. Actions per row: *use the request*, *keep last plan*, *set a number*
(with reason), *open question*. A header line, e.g. "Draft built from 6 sheets:
N lines, N accepted as asked, N need you."

**Plan: the whole grid.** One month at a time, regions across, network total
(kept from v2). Click a number for the side panel (kept from v2, the part the
test user liked most): value, every change with reason and source quote, what
the region asked, checks, every version. Publish lives here with a pre-flight
summary: "3 flags unsettled, 1 open question. Publish anyway?" After the
September publish, the answer-key comparison shows here.

**Release: what purchasing and finance read.** Changes since the last
published plan, one row per line: released, proposed, difference, type,
reason, source. Open questions listed below. Scenarios listed separately as
"not in the plan". Export CSV. This is the buy review.

**History.** What happened, newest first; compare any two versions; trends per
item. Kept from v2.

**Ask.** Placeholder until the assistant is connected.

## 5. What the screens need from core.js

Owned by the engine worker. Names are suggestions; the report says what landed.

- **Draft for a cycle as of a date**: per region × item × month, the requested
  cases with provenance, built from the latest accepted sheet per region.
- **Checks per line**: expected from shipments, sales-implied, swing against
  last plan; each with the number, the method in one sentence, pass or fail.
- **Needs**: the lines that fail, ranked, with a one-sentence reason.
- **Changes**: the typed changes above, applied to a published version, giving
  the working plan and the diff since release with reasons.
- **Answer key**: the planner's version against Dutch Bros' posted file for the
  same cycle, with known gaps explained.
- **Synthetic October**: sheets and messages that enter through the same
  reader as real ones, flagged synthetic.

## 6. Who does what

| Part | Owner | Files |
|---|---|---|
| This workflow; screens; wording | leader (`espresso`) | `site/app.js`, `site/app.css`, `site/index.html`, `docs/WORKFLOW.md`, `README.md` |
| Engine: draft, checks, changes, answer key; synthetic October | worker (`roaster`) | `site/core.js`, `pipeline/`, `synthetic/` |

Both work in `C:\AISA` on branch `desk-v3` and commit only their own files.
