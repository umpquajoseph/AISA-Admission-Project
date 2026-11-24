# Supply Desk

A working prototype for Dutch Bros' central supply planner. The six regional
sheets come in, the app drafts the plan, the planner settles only the lines
that look wrong, publishes, logs late news as typed changes, and hands
purchasing one list of what changed and why. Design:
[docs/WORKFLOW.md](docs/WORKFLOW.md). Original spec: [docs/SPEC.md](docs/SPEC.md).

## Run it locally

The packet folder `Dutch_Bros_Techincal_Packet/` must sit in this folder (it is
git-ignored).

```powershell
python -I pipeline/make_synthetic.py
python -I pipeline/build_data.py
npm install
npm run dev
```

Open http://127.0.0.1:8788. For the assistant, put `ANTHROPIC_API_KEY=...` in a
git-ignored `.dev.vars`; without it the AI buttons say "Assistant not connected".

| Link | Opens |
|---|---|
| `/?example=1` | September done (published, late news logged), ready for October |
| `/?role=manager` | A regional manager's page; in a second tab it feeds the planner's Inbox live |

## Screens

| Tab | What it is for |
|---|---|
| Inbox | Six region tiles (drop a sheet on one), plan messages, Log a change or Draft with AI |
| Review | Only the lines that fail a check against shipments and sales, grouped by item |
| Plan | The draft until published, then the plan in force; click a number for its story |
| Release | Released vs proposed, why, open questions, scenarios; export for purchasing |
| History | Everything that happened; trends; compare versions |
| Ask | Questions answered from the record, with sources |

Data: September 2026 is real (the packet stops Sep 18). October is synthetic,
built from the real files by `pipeline/make_synthetic.py`, and labelled on screen.
