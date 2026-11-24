"""Make the synthetic October 2026 cycle from the real September files.

Run with:  python -I pipeline/make_synthetic.py      (then python -I pipeline/build_data.py)

Writes to synthetic/:
  - six October request sheets, each a copy of that region's real September workbook
    (same layout, units and wording), rolled forward one month (Oct 2026 - Mar 2027);
    Sandstone sends a FINAL and then a corrected resend;
  - six emails (.eml) dated Oct 12-16 that each call for a different change type,
    plus one dock email that is not about the plan;
  - calendar.csv: event-calendar rows in the packet's own columns;
  - manifest.csv: when each sheet arrived.
Everything is made up and says so: a "Synthetic practice file" line on every sheet and
an X-Synthetic header on every email, so a file dragged in live is flagged too.

The September requests come from site/core.js (the page's reader), so blanks carried
from August are rolled forward at the value the page shows.
"""
import csv
import json
import random
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
PACKET = ROOT / "Dutch_Bros_Techincal_Packet"
OUT = ROOT / "synthetic"
TAG = "Synthetic practice file: made up for rehearsal from the real September sheet."

SEP = {  # region -> real September file that counts, October file name
    "R01": ("North Fork/Sep unit plan - North Fork.xlsx", "Oct unit plan - North Fork.xlsx"),
    "R02": ("Juniper Yard/JD intake 09-26 - corrected.xlsx", "JD intake 10-26.xlsx"),
    "R03": ("Cedar Bend/Sep Rina reorder.xlsx", "Oct Rina reorder.xlsx"),
    "R04": ("Summit Yard/Summit Sep needs - corrected.xlsx", "Summit Oct needs.xlsx"),
    "R05": ("Sandstone/MesaW Sep refresh.xlsx", "MesaW Oct refresh FINAL.xlsx"),
    "R06": ("Harbor Bend/Harbor 2026-09 roll.xlsx", "Harbor 2026-10 roll.xlsx"),
}
RECEIVED = {  # file -> (date, time); Sandstone resends a corrected file the next day
    "Oct unit plan - North Fork.xlsx": ("2026-10-06", "08:40"),
    "Oct Rina reorder.xlsx": ("2026-10-06", "10:15"),
    "MesaW Oct refresh FINAL.xlsx": ("2026-10-07", "09:05"),
    "JD intake 10-26.xlsx": ("2026-10-07", "13:30"),
    "MesaW Oct refresh - corrected.xlsx": ("2026-10-08", "08:20"),
    "Summit Oct needs.xlsx": ("2026-10-08", "15:45"),
    "Harbor 2026-10 roll.xlsx": ("2026-10-09", "11:10"),
}
OCT = [f"2026-{m:02d}" for m in (10, 11, 12)] + [f"2027-{m:02d}" for m in (1, 2, 3)]
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def add_month(m, k=1):
    y, mo = map(int, m.split("-"))
    t = y * 12 + mo - 1 + k
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def september_cells():
    """Resolved September requests per region|sku|month, from the page's own reader."""
    js = r"""
global.window = {}; require(process.argv[1] + "/site/data.js"); require(process.argv[1] + "/site/core.js");
const D = window.DATA, desk = window.Core.Desk(D, {});
const out = {};
for (const r of D.regions) { const s = desk.latestSheet("2026-09-30", r.code, "2026-09");
  for (const [k, c] of Object.entries(s.cells)) out[k] = { cs: c.cs, local: c.local, unit: c.unit }; }
process.stdout.write(JSON.stringify({ cells: out, crosswalk: D.crosswalk, ship: D.shipments.monthly }));
"""
    res = subprocess.run(["node", "-e", js, str(ROOT)], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def plan_october(ref):
    """region|sku|month -> October request in cases, and which cells repeat September."""
    cells, ship = ref["cells"], ref["ship"]
    rng = random.Random(20261006)
    oct_cs, same = {}, set()
    skus = sorted({k.split("|")[1] for k in cells})
    for r in SEP:
        for sku in skus:
            for m in OCT:
                key = f"{r}|{sku}|{m}"
                if m <= "2027-02":
                    base = cells[key]["cs"]
                else:  # March is new: February's ask, scaled by last year's three-month shipments around each
                    s = ship.get(f"{r}|{sku}", {})
                    feb = sum(s.get(x, 0) for x in ("2026-01", "2026-02", "2026-03"))
                    mar = sum(s.get(x, 0) for x in ("2026-02", "2026-03", "2026-04"))
                    if sku == "S009":
                        feb, mar = s.get("2026-02", 0), s.get("2026-03", 0)
                    base = cells[f"{r}|{sku}|2027-02"]["cs"] * (mar / feb if feb else 1)
                if m <= "2027-02" and rng.random() < 0.35:
                    v = base
                    same.add(key)
                else:
                    v = base * (1 + rng.uniform(-0.04, 0.04))
                oct_cs[key] = max(0, round(v))
    # A Mesa West opening kit in November (the calendar row MW-OPEN-03 names it)
    for sku, q in (("S001", 24), ("S005", 18), ("S014", 12)):
        oct_cs[f"R05|{sku}|2026-11"] += q
        same.discard(f"R05|{sku}|2026-11")
    # Front Range's second opening moved to November on Sep 16 (OP-FR-02); its October sheet shows that
    for sku, q in (("S001", 24), ("S005", 18), ("S014", 12)):
        oct_cs[f"R04|{sku}|2026-10"] -= q
        oct_cs[f"R04|{sku}|2026-11"] += q
        same.discard(f"R04|{sku}|2026-10"); same.discard(f"R04|{sku}|2026-11")
    # Peppermint is over by March
    for r in SEP:
        oct_cs[f"{r}|S009|2027-03"] = 0
    return oct_cs, same


def ym(v):
    """'Sep 26', '2026-09', '2026/09' or a date -> '2026-09'."""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m")
    s = str(v).strip()
    if s[:3].isalpha():
        return f"20{s[-2:]}-{MON.index(s[:3]) + 1:02d}"
    return s.replace("/", "-")[:7]


def month_cell(old, m):
    """A month heading in the same style as the cell it replaces."""
    y, mo = map(int, m.split("-"))
    if isinstance(old, datetime):
        return datetime(y, mo, 1)
    s = str(old)
    if "/" in s:
        return f"{y}/{mo:02d}"
    if s[:3].isalpha():
        return f"{MON[mo - 1]} {y % 100:02d}"
    return f"{y}-{mo:02d}"


def find_header(ws):
    for row in ws.iter_rows():
        v = row[0].value
        if v is not None and str(v).strip().lower() in ("stock no.", "counter sku", "stock alias"):
            return row[0].row, str(v).strip().lower()
    raise ValueError("no header")


def tag_and_date(ws, hdr, author_date):
    """Re-date the author line, retitle, and add the synthetic line above the table."""
    for r in range(1, hdr):
        c = ws.cell(r, 1)
        if isinstance(c.value, str) and "2026-09-" in c.value:
            c.value = c.value.replace(c.value[-10:], author_date)
    for r in range(1, hdr):
        if ws.cell(r, 1).value in (None, ""):
            ws.cell(r, 1).value = TAG
            break


def write_sheet(region, src, dst, oct_cs, same, xw, author_date, edits=None):
    wb = openpyxl.load_workbook(PACKET / "Planning/Manager attachments" / src)
    ws = wb.worksheets[0]
    hdr, kind = find_header(ws)
    tag_and_date(ws, hdr, author_date)
    local = {c["local"]: c for c in xw if c["region"] == region}
    edits = edits or {}
    roll = kind == "stock alias"
    if kind == "stock no.":  # long: one row per item and month
        for r in range(hdr + 1, ws.max_row + 1):
            code = ws.cell(r, 1).value
            if not code:
                continue
            x = local[str(code).strip()]
            m = add_month(ym(ws.cell(r, 2).value))
            ws.cell(r, 2).value = month_cell(ws.cell(r, 2).value, m)
            key = f"{region}|{x['sku']}|{m}"
            cs = edits.get(key, oct_cs[key])
            unit = str(ws.cell(r, 4).value).strip().upper()
            ws.cell(r, 5).value = cs * x["ea_per_case"] if unit == "EA" else cs
            ws.cell(r, 7).value = None
    else:  # wide: months across
        cols = [c for c in range(4, ws.max_column + 1)
                if ws.cell(hdr, c).value is not None and not str(ws.cell(hdr, c).value).lower().startswith(("dispatch", "buyer"))]
        note_col = next((c for c in range(4, ws.max_column + 1)
                         if str(ws.cell(hdr, c).value or "").lower().startswith(("dispatch", "buyer"))), None)
        months = []
        for c in cols:
            old = ws.cell(hdr, c).value
            m = add_month(ym(old))
            ws.cell(hdr, c).value = month_cell(old, m)
            months.append(m)
        for r in range(hdr + 1, ws.max_row + 1):
            code = ws.cell(r, 1).value
            if not code:
                continue
            x = local[str(code).strip()]
            unit = str(ws.cell(r, 3).value).strip().upper()
            for c, m in zip(cols, months):
                key = f"{region}|{x['sku']}|{m}"
                cs = edits.get(key, oct_cs[key])
                if roll and key in same and key not in edits:
                    ws.cell(r, c).value = None          # blank: same as last cycle
                else:
                    ws.cell(r, c).value = cs * x["ea_per_case"] if unit == "EA" else cs
            if note_col:
                ws.cell(r, note_col).value = None
    return wb, ws, hdr


def sheets(ref, oct_cs, same):
    xw = ref["crosswalk"]
    OUT.mkdir(exist_ok=True)
    made = []
    for region, (src, dst) in SEP.items():
        date = RECEIVED[dst][0]
        edits = {}
        if region == "R04":  # a keying slip: December cold brew typed with an extra zero
            edits["R04|S003|2026-12"] = oct_cs["R04|S003|2026-12"] * 10
        if region == "R05":  # FINAL counts November school-route lids twice
            edits["R05|S023|2026-11"] = oct_cs["R05|S023|2026-11"] * 2
        wb, ws, hdr = write_sheet(region, src, dst, oct_cs, same, xw, date, edits)
        if region == "R04":
            for r in range(hdr + 1, ws.max_row + 1):
                if str(ws.cell(r, 1).value).strip() == "SY-HSE5":
                    ws.cell(r, 10).value = "Nov 26  November includes 24 cases for the second opening kit (moved from October)."
        if region == "R01":  # a cell the manager has not filled in yet
            for r in range(hdr + 1, ws.max_row + 1):
                if str(ws.cell(r, 1).value).strip().startswith("NF-") and "tea" in str(ws.cell(r, 2).value).lower():
                    ws.cell(r, 8).value = "tbc"
        if region == "R05":  # the kit note on the house-bean row for November
            for r in range(hdr + 1, ws.max_row + 1):
                if str(ws.cell(r, 6).value).startswith("Espresso beans / house") and str(ws.cell(r, 2).value).endswith("11"):
                    ws.cell(r, 7).value = "Includes the Nov 3 opening kit (24 CS)."
        wb.save(OUT / dst)
        made.append(dst)
        if region == "R05":  # the corrected resend, next morning
            wb, ws, hdr = write_sheet(region, src, "MesaW Oct refresh - corrected.xlsx", oct_cs, same, xw, "2026-10-08")
            for r in range(hdr + 1, ws.max_row + 1):
                if str(ws.cell(r, 6).value).startswith("Espresso beans / house") and str(ws.cell(r, 2).value).endswith("11"):
                    ws.cell(r, 7).value = "Includes the Nov 3 opening kit (24 CS)."
                if str(ws.cell(r, 6).value).startswith("Flat cold lids") and str(ws.cell(r, 2).value).endswith("11"):
                    ws.cell(r, 7).value = "Corrected: school-route lids were counted twice."
            wb.save(OUT / "MesaW Oct refresh - corrected.xlsx")
            made.append("MesaW Oct refresh - corrected.xlsx")
    with open(OUT / "manifest.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "received", "time", "note"])
        for f in sorted(RECEIVED, key=lambda f: RECEIVED[f]):
            w.writerow([f, *RECEIVED[f], "Replaced by MesaW Oct refresh - corrected.xlsx" if "FINAL" in f else ""])
    return made


EMAILS = [
    # file, date header, from, to, subject, body
    ("1012_0914_harvest_feature_spiced_pear.eml", "Mon, 12 Oct 2026 09:14:00 -0700",
     "Avery Nolan <avery.nolan@cascadia.example>", "Central planning <planning@desk.example>",
     "November harvest feature - spiced pear",
     "Hi,\n\nCascadia is running a harvest feature at 12 shops from Nov 5. Please add 600 bottles of spiced pear "
     "fruit base (S016) to November on top of our sheet.\n\nThanks,\nAvery"),
    ("1013_1102_north_route_lemonade.eml", "Tue, 13 Oct 2026 11:02:00 -0700",
     "Rina Bell <rina.bell@valleynorth.example>", "Central planning <planning@desk.example>",
     "North route resurfacing - lemonade timing",
     "Hello,\n\nThe north route is closed for resurfacing the week of Nov 16. Please move 40 CS of lemonade "
     "concentrate (S021) from November to December. The six-month total does not change.\n\nRina"),
    ("1013_1530_dock_door_four.eml", "Tue, 13 Oct 2026 15:30:00 -0700",
     "Sandstone receiving <receiving@sandstone.example>", "Dock desk <dock@desk.example>",
     "Door 4 closed Thursday",
     "Door 4 is closed Thursday for the leveller repair. Thursday's inbound trailers go to door 6."),
    ("1014_0848_holiday_kiosk_pilot.eml", "Wed, 14 Oct 2026 08:48:00 -0700",
     "Inez Vale <inez.vale@mesawest.example>", "Central planning <planning@desk.example>",
     "Holiday kiosk pilot",
     "Hi,\n\nWe may run two holiday kiosks in December. Sites are not signed yet, so please don't add any "
     "quantities. I'll confirm by Oct 30.\n\nInez"),
    ("1015_1621_re_harvest_feature_spiced_pear.eml", "Thu, 15 Oct 2026 16:21:00 -0700",
     "Avery Nolan <avery.nolan@cascadia.example>", "Central planning <planning@desk.example>",
     "RE: November harvest feature - spiced pear",
     "Hi again,\n\nThe final shop list is 8 shops, not 12. Please make it 420 bottles total instead of the 600.\n\nAvery"),
    ("1016_1005_hot_cup_sensitivity.eml", "Fri, 16 Oct 2026 10:05:00 -0700",
     "Finance planning <fpa@finance.example>", "Central planning <planning@desk.example>",
     "Sensitivity - Front Range hot cups December",
     "Could you show what Front Range hot cups (S024) for December would look like at +15%? "
     "This is for our budget sensitivity only, not for release."),
]

CALENDAR = [
    ("MW-OPEN-03", "2026-10-06", "R05", "Shop opening", "2026-11-09", "Scheduled",
     "Third autumn-wave site. Opening kit ships Nov 3: 24 CS S001, 18 CS S005 and 12 CS S014. Regular regional flow is planned separately."),
    ("CA-HARV-02", "2026-10-12", "R01", "Regional promotion", "2026-11-05", "Requested",
     "Harvest feature estimate submitted to the central planner by email."),
    ("VN-RTE-05", "2026-10-13", "R03", "Route change", "2026-11-16", "Scheduled",
     "North route resurfacing. November lemonade moves to December."),
    ("CA-HARV-02", "2026-10-15", "R01", "Regional promotion", "2026-11-05", "Scope confirmed",
     "Final shop list confirmed: 8 shops. Revised request sent by email."),
]


def emails():
    for f, date, frm, to, subj, body in EMAILS:
        raw = (f"From: {frm}\r\nTo: {to}\r\nSubject: {subj}\r\nDate: {date}\r\n"
               "X-Synthetic: yes (made up for rehearsal)\r\nMIME-Version: 1.0\r\n"
               "Content-Type: text/plain; charset=utf-8\r\n\r\n"
               + body.replace("\n", "\r\n") + "\r\n")
        (OUT / f).write_bytes(raw.encode("utf-8"))
    with open(OUT / "calendar.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["Event ID", "Known on", "Region", "Type", "Event date", "Status", "Detail"])
        w.writerows(CALENDAR)


def main():
    ref = september_cells()
    oct_cs, same = plan_october(ref)
    made = sheets(ref, oct_cs, same)
    emails()
    print(f"wrote {len(made)} sheets, {len(EMAILS)} emails, {len(CALENDAR)} calendar rows to {OUT}")


if __name__ == "__main__":
    sys.exit(main())
