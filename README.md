# Supply Desk

A working prototype for the central supply planner. Sheets and emails come in,
the desk shows what needs a decision, the planner changes the plan with a reason,
and every arrival and change stays in the history. A time slider replays the
packet day by day. Spec: [docs/SPEC.md](docs/SPEC.md).

## Run it locally

The packet folder `Dutch_Bros_Techincal_Packet/` must sit in this folder (it is
git-ignored).

```powershell
python -I pipeline/build_data.py
python -m http.server 8765 --bind 127.0.0.1 --directory site
```

Then open http://127.0.0.1:8765. `?example=1` loads the September worked
example on a fresh browser.

## How it fits together

One record, three views. The slider sets the desk's date; everything you add or
change is dated to it, so moving the slider back shows the desk as it stood.

| View | What it does |
|---|---|
| Inbox | What needs a decision: new sheets that differ from the plan (use the request or keep the plan, per line or all), and messages grouped by thread (change the plan, no change, waiting on someone). A reply reopens a thread. Add sheets and emails by pasting, dropping a file, or watching a folder. Click a region's sheet to see every line as read, with conversions and corrections |
| Plan | One month at a time, regions across, network total. Click a number for its source, request, checks and every plan file's value. Type to change it, or add/move with a reason; EA converts to cases. Publish makes the working plan the plan in force |
| History | Everything that arrived or changed, newest first; trends per item (each posted plan, the requests, sales-implied use); compare any two versions |

Files: `pipeline/build_data.py` bundles the packet raw. `site/core.js` reads
every sheet and email (packet or added, one reader) and works out the plan as of
a date. `site/app.js` draws it. The browser reader matches the old Python reader
on all 43 packet sheets and 23 emails.

The desk record (inputs added, changes, decisions, versions) lives in the
browser; export and import it from History.

Not built yet: the AI assistant that drafts changes from an email or a raw
dump, shipment checks from the Distribution files, the Cloudflare deploy.
