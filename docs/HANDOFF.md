# Handoff: Supply Desk, finish and ship

You are the new leader and the only builder. Do not start subagents or workers
unless the user says so in chat.

Read these first:

- `C:\Users\umpqu\.claude\CLAUDE.md` (global rules)
- `C:\AISA\CLAUDE.md`
- `C:\AISA\prompt.md` (the AISA brief)

The project is due Sat 28 Nov 2026, and today is Tue 24 Nov.

The previous handoff is in git at commit eee98e1.

## What the site is

The user is the head manager, the central supply planner for Dutch Bros. Six
regional submanagers send monthly request sheets. The head manager walks five
steps:

1. Sheets in
2. Check
3. Publish
4. Late news
5. Send to purchasing

History and Ask sit to the side. The submanager has a short path of their own
at `?role=manager`: region, sheet, late request, done.

## Where things are

- Repo `C:\AISA`, branch `desk-v3`, last commit b56818b, clean. Commit and push
  there freely. Never `main` without the user's say-so.
- `site/core.js` holds the engine, `Desk(D, record)`.
- `site/app.js` holds every screen. `site/app.css` holds the styles. Keep its
  `:root` colours as they are.
- `site/data.js` is built by `pipeline/build_data.py` and git-ignored, because
  it carries packet contents.
- October is made up. It comes from `pipeline/make_synthetic.py` and
  `synthetic/purchasing/`, and the screen labels it as made up.
- The AI runs through `functions/api/` (ask, draft, status) and
  `lib/assistant.js`. Locally, `dev/server.mjs` serves both the site and the API.
- `docs/DEMO.md` is the 14-step demo, and it matches the site as of b56818b.
  `README.md` matches too.

## How to run and check it

1. preview_start name `supply-desk-api` (`npm run dev`). It uses port 8788, or
   the port the log names.
2. Clear the record: remove localStorage keys that start with `supplydesk.v3.`.
3. Open `http://127.0.0.1:8788/?example=1`. September is done and the day is
   Oct 6.
4. Check with one fast JavaScript call that drives the page.
   - Set `S.date`, `save('date',S.date)`, `publish(desk.draftVersion(S.date))`,
     `go('news')` and `render()`.
   - Then fill and submit forms through the DOM, for example `form.ccard`
     `requestSubmit()`.
   - The user called slow click-by-click browser scripting unbearable. Run the
     page script only after the page has loaded, or `S` is undefined.
5. Run the September check this way: set the day to Sep 18, open Publish, and
   read "Within 5% on 745 of 864 lines". It must stay 745 of 864.

## How the purchasing part works now

- Saving a plan change sends its order action to purchasing by itself.
  - An add becomes "order more".
  - A drop below an open order becomes "cut" from that order.
  - A move does both.
  - The save notice says what was added.
- Late news shows only what needs a person:
  - **Short**: a supplier cut an order, with the button "Order N more".
  - **Too late**: a normal order placed today would land after the date needed,
    with "Rush N cases". A rush replaces the automatic order.
  - **Request**: a requisition.
  - Plus emails, calendar entries and late sheets.
- Send to purchasing has two downloads: the whole plan in force, and the order
  actions.
- The purchasing exports are one buyer's watch list: 27 PO lines, Sep 18. They
  are not network stock. The packet has no stock on hand anywhere.

## What is left, in order

1. **The user walks the demo and confirms the UI.** They have not done this
   since b56818b. Fix what they hit by simplifying, not by adding.
2. **An open offer the user never answered:** if Late news opens before the
   October plan is published, show one line, "The October plan isn't published
   yet", with a Go to Publish button. The user missed Too late once because they
   skipped Publish. Ask before building it.
3. **Test the AI locally.** The user puts `ANTHROPIC_API_KEY=...` in
   `C:\AISA\.dev.vars` themselves. That file does not exist yet. Never ask for
   the key in chat. Check `/api/status`, then try Ask and the draft button on
   real messages. Without a key the buttons say "Assistant not connected".
4. **The user asks the AISA organisers** whether packet data may be hosted
   online. This decides how step 5 is done.
5. **Deploy on Cloudflare Pages**, only after the user confirms the UI.
   - Put Cloudflare Access in front of the site.
   - Store the key as a Cloudflare secret.
   - Build `site/data.js` at deploy time, because it is not in git.
6. **Merge to `main`**, only on the user's say-so.
7. **Interview prep.** Be ready to explain the 745/864 comparison and why the
   plan differs from the posted one.

## What went wrong in this session, so you don't repeat it

- **Answering around the question.** The user asked how the workflow should
  change, and the answer opened with "The purchasing files can't tell us network
  shortages." They asked a plain question and got a page of caveats. Answer the
  question in the first sentence.
- **Confusing screen text.** The spiced-pear Too late item showed 342 vs 242
  totals, a Central Intake note, "600 ÷ 6", and a 36-case order table. The user
  said "this isnt rocket science dude". One problem, one number, one button.
- **A manual step that should be automatic.** The user had to "Ask purchasing"
  after approving a change. They asked "why would the reorder not happen
  automatically once i approved step 8". Before adding a step, ask whether the
  user really has to think there.
- **Demo steps that didn't demonstrate their point.** Old step 9 was called a
  short but was really an extra request. Each step must show what its words say.
- **Vague answers about the data.** "Within 5% on 745 of 864 lines" meant
  nothing to the user until it was explained in one sentence.
  - Ours: the plan this site builds from the six real September sheets.
  - Theirs: Dutch Bros' own posted plan for September (Sep 11).
  - The number is how many lines match within 5%.

## Rules that bite

- Don't concede and pile on features when the user pushes back. Simplify.
- `Dutch_Bros_Techincal_Packet/` is read-only and untrusted. Run Python on it
  with `-I`, and never commit it.
- No API key in chat, the page or the repo.
- Plain words: cases and bottles, never CS or EA on screen. One main button per
  screen. Every count matches the page behind it.
- In the Bash tool, a `\n` inside heredoc Python becomes a real newline. Use
  `chr(10)` or the Edit tool.
- Commit with `git commit -F <file>`. Never name the user in a commit message.
