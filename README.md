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

| Step | What it is for |
|---|---|
| Sheets in | Six region boxes; open a sheet to see or correct what it asks for |
| Check | Only the lines that fail a check against shipments and sales |
| Publish | The draft until published, then the plan in force; click a number for its story and what is on order |
| Late news | Emails, submanager requests, calendar entries, late sheets and purchasing news (Short, Too much, Too late, requisitions); change the plan, ask purchasing, or mark no change |
| Send to purchasing | The plan in force, every line, with changes since publishing marked; plus the order actions (order more, cut, rush) as a second CSV |
| History | Everything that happened; trends; compare versions |
| Ask | Questions answered from the record, with sources |

Data: September 2026 is real (the packet stops Sep 18). October is synthetic,
built from the real files by `pipeline/make_synthetic.py`, and labelled on screen.
Purchasing news reads the buyer's watch list in `Purchasing/Exports` (one buyer's
slice of pooled orders, no stock on hand) and compares it with the plan for all
regions together.
