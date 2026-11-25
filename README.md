# Supply Desk

A working prototype for Dutch Bros' central supply planner. The six regional
sheets come in, the app drafts the plan, the planner settles only the lines that
look wrong, publishes, logs late news as typed changes, and hands purchasing one
list of what changed and why.

- [docs/DESIGN.md](docs/DESIGN.md): what it does, the checks, how results were checked.
- [docs/DEMO.md](docs/DEMO.md): the demo script.
- [synthetic/README.md](synthetic/README.md): the made-up October files.

## Run it

The packet folder `Dutch_Bros_Techincal_Packet/` must sit in this folder (it is
git-ignored).

```powershell
python -I pipeline/make_synthetic.py
python -I pipeline/build_data.py
npm install
npm run dev
```

Open http://127.0.0.1:8788. For the assistant, put `ANTHROPIC_API_KEY=...` in a
git-ignored `.dev.vars`.

## Files

| Path | What it is |
|---|---|
| `site/core.js` | The engine: reads sheets and emails, builds the plan as of a date |
| `site/app.js`, `site/app.css` | The screens |
| `site/tour.js`, `site/demo-steps.js` | The in-app demo walkthrough |
| `lib/assistant.js`, `functions/api/` | The assistant (Cloudflare Pages Functions) |
| `dev/server.mjs` | Local server for the site and the assistant |
| `pipeline/` | Builds `site/data.js` and the synthetic October files from the packet |
