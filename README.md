# Supply Desk

A working prototype for the central supply planner: it reads the six regional
request sheets, keeps the posted plan as the baseline, logs late news as tracked
changes, and shows the whole September cycle on a time slider. Spec:
[docs/SPEC.md](docs/SPEC.md).

## Run it locally

The packet folder `Dutch_Bros_Techincal_Packet/` must sit in this folder (it is
git-ignored).

```powershell
python -I pipeline/build_data.py
python -m http.server 8765 --bind 127.0.0.1 --directory site
```

Then open http://127.0.0.1:8765.

Demo links: `?date=2026-09-17&tab=plan&example=1` loads the September worked
example on a fresh browser; `sel=R06|S014|2026-10` opens one line's detail.

## What is built

| Page | What it does |
|---|---|
| Intake | Reads all six layouts, converts EA to cases, carries blanks forward, picks the latest file per cycle, shows corrections between files |
| Plan | Working plan = posted plan + approved changes. Flags new requests that differ from the plan and big swings since the last posting. Click a number to see its source |
| Changes | Inbox of emails, calendar entries and plan files by date. Change register: add, move, open question, note, scenario; replacing a figure supersedes the old one |
| History | Every plan file plus versions published here; compare any two |
| Ask | Placeholder until the Cloudflare deploy |

Changes and published versions live in the browser and can be exported as JSON.
The buy-review export is a CSV of released vs proposed quantities with reasons.

Not built yet: shipment-based checks (Distribution files), the AI assistant,
the Cloudflare deploy.
