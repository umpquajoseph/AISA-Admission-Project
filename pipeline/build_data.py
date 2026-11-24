"""Read the Dutch Bros packet and write site/data.js for the planner page.

Run with:  python -I pipeline/build_data.py

This bundles the packet for the page: reference tables, plan files, sales-implied
use, and the raw cells of every manager sheet and raw text of every email. The
page interprets sheets and emails itself (site/core.js), so packet files and
files the planner adds go through the same reader.
"""
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, date
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shipments  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PACKET = ROOT / "Dutch_Bros_Techincal_Packet"
PLANNING = PACKET / "Planning"
OUT = ROOT / "site" / "data.js"

MONTH_ABBR = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


# ---------------------------------------------------------------- helpers
def sheet_rows(path, sheet=None):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = [tuple(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return ws.title if not sheet else sheet, rows


def find_header(rows, first_cells):
    for i, r in enumerate(rows):
        if r and r[0] is not None and str(r[0]).strip() in first_cells:
            return i
    raise ValueError(f"no header starting with {first_cells}")


def iso(d):
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date().isoformat()
    if isinstance(d, date):
        return d.isoformat()
    return str(d)


def norm_month(v):
    """Every month heading in the packet -> 'YYYY-MM'."""
    if isinstance(v, (datetime, date)):
        return f"{v.year:04d}-{v.month:02d}"
    s = str(v).strip()
    m = re.fullmatch(r"(\d{4})[-/](\d{1,2})", s)
    if m:
        return f"{int(m[1]):04d}-{int(m[2]):02d}"
    m = re.fullmatch(r"([A-Z][a-z]{2}) (\d{2})", s)
    if m and m[1] in MONTH_ABBR:
        return f"20{m[2]}-{MONTH_ABBR[m[1]]:02d}"
    raise ValueError(f"unrecognised month heading {v!r}")


def clean(v):
    return None if v is None else (str(v).strip() or None)


# ---------------------------------------------------------------- reference
def read_reference():
    ref = {}
    _, rows = sheet_rows(PLANNING / "Control/Planning reference.xlsx", "Item master")
    h = find_header(rows, {"SKU"})
    ref["items"] = [
        dict(sku=r[0], name=r[1], category=r[2], case_pack=r[3], ea_unit=r[4],
             ea_per_case=int(r[5]), lead_days=int(r[6]), storage=r[7])
        for r in rows[h + 1:] if r[0]]

    _, rows = sheet_rows(PLANNING / "Control/Planning reference.xlsx", "Region directory")
    h = find_header(rows, {"Region"})
    ref["regions"] = [
        dict(code=r[0], name=r[1], manager=r[2], shops=r[3], hub=r[4], cadence=r[5])
        for r in rows[h + 1:] if r[0]]

    _, rows = sheet_rows(PLANNING / "Control/Planning reference.xlsx", "Event calendar")
    h = find_header(rows, {"Event ID"})
    ref["events"] = [
        dict(id=r[0], known_on=iso(r[1]), region=r[2], type=r[3], event_date=iso(r[4]),
             status=r[5], detail=r[6])
        for r in rows[h + 1:] if r[0]]

    _, rows = sheet_rows(PLANNING / "Control/Regional item crosswalk.xlsx")
    h = find_header(rows, {"Region"})
    ref["crosswalk"] = [
        dict(region=r[0], local=str(r[1]), sku=r[2], desk_unit=r[3], ea_per_case=int(r[4]),
             item=r[5], hub=r[6])
        for r in rows[h + 1:] if r[0]]

    _, rows = sheet_rows(PLANNING / "Control/Planning desk registers.xlsx", "Release log")
    h = find_header(rows, {"Cycle"})
    ref["release_log"] = [
        dict(cycle=r[0], logged=iso(r[1]), disposition=r[2], circulation=r[3],
             file=r[4], note=r[5])
        for r in rows[h + 1:] if r[0]]

    _, rows = sheet_rows(PLANNING / "Control/Planning desk registers.xlsx", "Intake log")
    h = find_header(rows, {"Cycle"})
    ref["intake_log"] = [
        dict(cycle=r[0], region=r[1], hub=r[2], received=iso(r[3]), disposition=r[4],
             file=r[5], replaced_by=clean(r[6]) if len(r) > 6 else None,
             note=clean(r[7]) if len(r) > 7 else None)
        for r in rows[h + 1:] if r[0]]
    # A replaced row carries the replacing file in col 6; an accepted row may carry
    # its receipt note in col 6 instead. Tell them apart by the file extension.
    for e in ref["intake_log"]:
        if e["replaced_by"] and not e["replaced_by"].endswith(".xlsx"):
            e["note"], e["replaced_by"] = e["replaced_by"], None
    return ref


# ---------------------------------------------------------------- releases
def read_release(path):
    title, rows = sheet_rows(path)
    h = find_header(rows, {"Region"})
    head = rows[h]
    months = [norm_month(c) for c in head[4:] if c is not None]
    grid = {}
    for r in rows[h + 1:]:
        if not r or not r[0] or not str(r[0]).startswith("R0"):
            continue
        grid[f"{r[0]}|{r[1]}"] = {m: r[4 + i] for i, m in enumerate(months)}
    stamp = " ".join(str(c) for c in rows[2] if c) if len(rows) > 2 else ""
    return dict(sheet=title, months=months, stamp=stamp, grid=grid)


# ---------------------------------------------------------------- manager sheets and emails
# The page reads these itself (site/core.js), with the same code it uses for a
# sheet or email the planner pastes, drops or picks up from a watched folder.
# This script only bundles the raw cells and text, so there is one reader.
def raw_cell(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return v


def raw_rows(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = []
    for r in ws.iter_rows(values_only=True):
        r = [raw_cell(v) for v in r]
        while r and r[-1] is None:
            r.pop()
        rows.append(r)
    title = ws.title
    wb.close()
    return title, rows


def bundle_submissions(ref):
    out = []
    for e in sorted(ref["intake_log"], key=lambda e: (e["received"], e["region"])):
        title, rows = raw_rows(PLANNING / e["file"])
        out.append(dict(e, sheet=title, rows=rows))
    return out


def bundle_emails():
    return [dict(file=str(p.relative_to(PACKET)).replace("\\", "/"),
                 raw=p.read_bytes().decode("utf-8", errors="replace"))
            for p in sorted((PACKET / "Correspondence").rglob("*.eml"))]


# ---------------------------------------------------------------- sales-implied use
def read_sales_use():
    """Cases of one ingredient implied by sales of the three drinks with portion
    standards. Sold and complimentary servings count as used; voids do not.
    This is a partial measure: it covers one drink per SKU, not every recipe."""
    std = {}
    with open(PACKET / "POS_reference/POS_Portion_Standards.csv", newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            std[(r["menu_id"], r["size_code"])] = (
                r["sku"], float(r["component_per_serving"]), float(r["component_per_each"]),
                int(r["eaches_per_case"]))
    use = defaultdict(float)
    with open(PACKET / "POS_reference/POS_Menu_Monthly.csv", newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            k = (r["menu_id"], r["size_code"])
            if k not in std:
                continue
            sku, per_serving, per_each, per_case = std[k]
            servings = int(r["sold_units"]) + int(r["comp_units"])
            use[(r["region_code"], sku, r["business_month"])] += servings * per_serving / per_each / per_case
    out = defaultdict(dict)
    for (region, sku, month), v in use.items():
        out[f"{region}|{sku}"][month] = round(v, 1)
    return out


def read_menu_names():
    names = {}
    with open(PACKET / "POS_reference/POS_Menu.csv", newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            names[r["menu_id"]] = r
    return names


# ---------------------------------------------------------------- shipments and shops
def read_shipments():
    """Monthly net planning cases shipped per region|SKU (accepted revisions as of the
    packet cutoff), plus each amendment that changed a month after the fact, so the
    page can show shipments as they were known on any date."""
    versions, problems = shipments.load()
    final = shipments.on_record(versions, "2026-09-18T23:59:59Z")
    amend = []
    for line, m in final.items():
        if m["rev"] == 1:
            continue
        old = max((v for (l, r), v in versions.items() if l == line and r < m["rev"]), key=lambda v: v["rev"])
        if abs(old["cs"] - m["cs"]) > 1e-9 or old["ship"][:7] != m["ship"][:7]:
            amend.append(dict(line=line, region=m["region"], sku=m["sku"], accepted=m["at"][:10],
                              month=m["ship"][:7], old_cs=round(old["cs"], 3), cs=round(m["cs"], 3),
                              old_unit=old["unit"], unit=m["unit"]))
    ties = shipments.tie_to_controls(versions)
    tied = sum(1 for t in ties if abs(t["ours"] - t["control"]) < 0.01 and t["n"] == t["n_control"])
    last_ship = max(m["ship"] for m in final.values())
    return dict(monthly=shipments.monthly(final), amendments=sorted(amend, key=lambda a: a["accepted"]),
                through=last_ship, controls_tied=f"{tied}/{len(ties)}", problems=problems)


def read_shops():
    """Open shops per region at each month end, Jan 2025 to Dec 2027 (directory as of Sep 18)."""
    rows = list(csv.DictReader(open(PACKET / "POS_reference/POS_Shop_Directory.csv", newline="",
                                    encoding="utf-8-sig")))
    out = defaultdict(dict)
    for y in (2025, 2026, 2027):
        for mo in range(1, 13):
            nxt = f"{y + (mo == 12):04d}-{mo % 12 + 1:02d}-01"
            for r in rows:
                out[r["region_code"]].setdefault(f"{y:04d}-{mo:02d}", 0)
                if r["open_date"] < nxt:
                    out[r["region_code"]][f"{y:04d}-{mo:02d}"] += 1
    return out


# ---------------------------------------------------------------- purchasing
def read_purchasing(folder):
    """The buyer's watch list (Purchasing/Exports): PO lines, the buyer change journal, posted
    receipts and the requisition tray. The page works out each line's state on any date from
    the journal and receipt dates, so only the facts that carry a date are bundled. Quantities
    are cases. The notes say this is a slice of one buyer's desk, not network coverage or stock."""
    def rows(prefix):
        out = []
        for p in sorted(Path(folder).glob(prefix + "_*.csv")):
            out += list(csv.DictReader(open(p, newline="", encoding="utf-8-sig")))
        return out
    def qty(v):
        v = (v or "").strip()
        return int(float(v)) if v else None
    lines = [dict(po=r["po_number"], line=r["po_line"], supplier=r["supplier_name"], entered=r["entered_on"],
                  location=r["delivery_location"], allocation=r["allocation"], sku=r["item_no"], item=r["description"],
                  qty=qty(r["original_order_qty"]), due0=r["initial_due_date"],
                  snap=dict(cancelled=qty(r["cancelled_qty"]), received=qty(r["posted_received_qty"]),
                            open=qty(r["open_qty"]), due=r["current_due_date"] or None, status=r["line_status"]))
             for r in rows("PO_line_status")]
    journal = [dict(no=r["change_no"], at=r["entered_local"], po=r["po_number"], line=r["po_line"],
                    type=r["change_type"], old=r["old_value"], new=r["new_value"], ref=r["evidence_ref"],
                    comment=r["buyer_comment"]) for r in rows("Buyer_change_journal")]
    receipts = [dict(no=r["receipt_no"], rline=r["receipt_line"], at=r["posted_local"], supplier=r["supplier_code"],
                     po=r["po_number"], line=r["po_line"], sku=r["item_no"], qty=qty(r["posted_qty"]),
                     slip=r["packing_slip"]) for r in rows("Receipt_journal")]
    reqs = [dict(id=r["request_id"], at=r["entered_local"], by=r["requested_by"], item=r["item_or_family"],
                 need=r["need_date"] or None, qty=qty(r["requested_quantity"]), uom=r["request_uom"] or None,
                 state=r["current_state"], po=r["po_link"] or None, scope=r["scope"], note=r["original_note"])
            for r in rows("Requisition_tray")]
    return dict(lines=lines, journal=journal, receipts=receipts, requisitions=reqs)


# ---------------------------------------------------------------- synthetic October
def bundle_synthetic():
    """The made-up October cycle in synthetic/ (pipeline/make_synthetic.py), bundled raw
    like the packet's own files so it goes through the same reader on the page."""
    d = ROOT / "synthetic"
    if not (d / "manifest.csv").exists():
        return dict(submissions=[], emails=[], events=[])
    subs = []
    for r in csv.DictReader(open(d / "manifest.csv", newline="", encoding="utf-8")):
        title, rows = raw_rows(d / r["file"])
        subs.append(dict(file="synthetic/" + r["file"], received=r["received"], time=r["time"],
                         note=r["note"] or None, sheet=title, rows=rows))
    emails = [dict(file="synthetic/" + p.name, raw=p.read_bytes().decode("utf-8", errors="replace"))
              for p in sorted(d.glob("*.eml"))]
    events = [dict(id=r["Event ID"], known_on=r["Known on"], region=r["Region"], type=r["Type"],
                   event_date=r["Event date"], status=r["Status"], detail=r["Detail"])
              for r in csv.DictReader(open(d / "calendar.csv", newline="", encoding="utf-8"))]
    purchasing = read_purchasing(d / "purchasing") if (d / "purchasing").exists() else None
    return dict(submissions=subs, emails=emails, events=events, purchasing=purchasing)


# ---------------------------------------------------------------- main
def main():
    ref = read_reference()
    releases = []
    for e in ref["release_log"]:
        rel = read_release(PLANNING / e["file"])
        releases.append(dict(e, **rel, id=f"{e['cycle']}:{Path(e['file']).stem}"))
    submissions = bundle_submissions(ref)
    emails = bundle_emails()
    sales = read_sales_use()
    menu = read_menu_names()
    std_drinks = sorted({(r["menu_id"], r["sku"]) for r in csv.DictReader(
        open(PACKET / "POS_reference/POS_Portion_Standards.csv", newline="", encoding="utf-8-sig"))})
    data = dict(
        built=datetime.now().isoformat(timespec="seconds"),
        cutoff="2026-09-18",
        items=ref["items"], regions=ref["regions"], events=ref["events"],
        crosswalk=ref["crosswalk"], release_log=ref["release_log"], intake_log=ref["intake_log"],
        releases=releases, submissions=submissions, emails=emails,
        sales_use=sales, sales_through="2026-09-18",
        shipments=read_shipments(), shops=read_shops(), synthetic=bundle_synthetic(),
        purchasing=read_purchasing(PACKET / "Purchasing/Exports"),
        sales_drinks=[dict(menu_id=m, sku=s, name=menu.get(m, {}).get("menu_description") or
                           menu.get(m, {}).get("name")) for m, s in std_drinks],
    )
    OUT.parent.mkdir(exist_ok=True)
    payload = json.dumps(data, separators=(",", ":"), default=str)
    OUT.write_text("// Generated by pipeline/build_data.py. Do not edit.\nwindow.DATA = "
                   + payload + ";\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(payload)/1024:.0f} KB): {len(releases)} releases, "
          f"{len(submissions)} manager files, {len(emails)} emails")


if __name__ == "__main__":
    sys.exit(main())
