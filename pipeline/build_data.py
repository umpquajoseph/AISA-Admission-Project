"""Read the Dutch Bros packet and write site/data.js for the planner page.

Run with:  python -I pipeline/build_data.py

Everything the page shows comes from this file's output. Each number keeps
where it came from (file, row, original value and unit, rule applied).
"""
import csv
import email
import email.policy
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, date
from pathlib import Path

import openpyxl

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


def num(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return float(v)


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


# ---------------------------------------------------------------- manager sheets
def read_manager_sheet(path):
    """-> dict(layout, author, hub, dated, entries=[{local, unit, month, qty, note, row}])"""
    layout, rows = sheet_rows(path)
    meta = re.split(r"\s{2,}", str(rows[2][0]).strip()) if rows[2][0] else []
    author, hub, dated = (meta + [None] * 3)[:3]
    entries = []
    if layout == "Outbound needs":
        h = find_header(rows, {"Stock no."})
        for i, r in enumerate(rows[h + 1:], start=h + 2):
            if not r[0]:
                continue
            entries.append(dict(local=str(r[0]), month=norm_month(r[1]), unit=r[3],
                                qty=num(r[4]), note=clean(r[6]) if len(r) > 6 else None, row=i))
    else:
        h = find_header(rows, {"Counter SKU", "Stock alias"})
        head = rows[h]
        mcols = [(j, norm_month(c)) for j, c in enumerate(head) if j >= 3 and c is not None
                 and not str(c).lower().startswith(("dispatch", "buyer"))]
        note_col = len(head) - 1
        for i, r in enumerate(rows[h + 1:], start=h + 2):
            if not r[0]:
                continue
            note = clean(r[note_col]) if len(r) > note_col else None
            for j, m in mcols:
                entries.append(dict(local=str(r[0]), month=m, unit=r[2], qty=num(r[j]),
                                    note=note, row=i))
    return dict(layout=layout, author=author, hub=hub, dated=dated, entries=entries)


def build_submissions(ref):
    """Resolve every manager file to cases per SKU and month.

    Rules, all from the packet:
      - local code -> SKU and EA per case from the regional crosswalk
      - EA -> CS by dividing by EA per case
      - 'Reorder roll' blank carries the same item and month from the previous
        accepted cycle; zero cancels that month
      - only the Intake log's Accepted file counts; Replaced files are kept to compare
    """
    xw = {(c["region"], c["local"]): c for c in ref["crosswalk"]}
    files = []
    accepted_by_region = defaultdict(list)          # region -> [cycle files in order]
    for e in sorted(ref["intake_log"], key=lambda e: (e["region"], e["cycle"], e["received"])):
        path = PLANNING / e["file"]
        sheet = read_manager_sheet(path)
        files.append(dict(intake=e, sheet=sheet))

    resolved_accepted = {}                           # (region, cycle) -> {(sku, month): cell}
    out_files = []
    for f in files:
        e, sheet = f["intake"], f["sheet"]
        region, cycle = e["region"], e["cycle"]
        prev = None
        cycles = sorted(c for (r, c) in resolved_accepted if r == region and c < cycle)
        if cycles:
            prev = resolved_accepted[(region, cycles[-1])]
        cells, problems = {}, []
        for en in sheet["entries"]:
            x = xw.get((region, en["local"]))
            if not x:
                problems.append(f"Row {en['row']}: local code {en['local']} is not in the crosswalk")
                continue
            sku = x["sku"]
            cell = dict(sku=sku, month=en["month"], local=en["local"], unit=en["unit"],
                        orig=en["qty"], row=en["row"], note=en["note"], rule=[])
            if en["qty"] is None:
                if sheet["layout"] == "Reorder roll" and prev and (sku, en["month"]) in prev:
                    p = prev[(sku, en["month"])]
                    cell["cs"] = p["cs"]
                    cell["rule"].append(f"blank: carried from {p['cycle']} cycle")
                    cell["carried_from"] = p["cycle"]
                else:
                    cell["cs"] = None
                    problems.append(f"Row {en['row']}: {sku} {en['month']} is blank with nothing to carry")
            else:
                if en["unit"] == "EA":
                    cs = en["qty"] / x["ea_per_case"]
                    cell["rule"].append(f"{en['qty']:g} EA / {x['ea_per_case']} per case")
                    if abs(cs - round(cs)) > 1e-9:
                        problems.append(f"Row {en['row']}: {sku} {en['month']} {en['qty']:g} EA "
                                        f"is not a whole number of cases ({cs:.2f})")
                elif en["unit"] == "CS":
                    cs = en["qty"]
                else:
                    cs = None
                    problems.append(f"Row {en['row']}: unknown unit {en['unit']!r}")
                if cs == 0:
                    cell["rule"].append("zero: month cancelled")
                cell["cs"] = cs
            cell["cycle"] = cycle
            cells[(sku, en["month"])] = cell
        if e["disposition"] == "Accepted":
            resolved_accepted[(region, cycle)] = cells
        out_files.append(dict(
            cycle=cycle, region=region, hub=e["hub"], received=e["received"],
            disposition=e["disposition"], file=e["file"], replaced_by=e["replaced_by"],
            note=e["note"], layout=sheet["layout"], author=sheet["author"], dated=sheet["dated"],
            problems=problems,
            counts=dict(cells=len(cells),
                        ea=sum(1 for c in cells.values() if c["unit"] == "EA" and c["orig"] is not None),
                        carried=sum(1 for c in cells.values() if c.get("carried_from")),
                        cancelled=sum(1 for c in cells.values() if c["cs"] == 0)),
            cells={f"{region}|{k[0]}|{k[1]}": v for k, v in cells.items()}))
    return out_files


# ---------------------------------------------------------------- correspondence
def read_emails():
    out = []
    for p in sorted((PACKET / "Correspondence").rglob("*.eml")):
        msg = email.message_from_bytes(p.read_bytes(), policy=email.policy.default)
        body = msg.get_body(preferencelist=("plain",))
        text = body.get_content() if body else ""
        attachments = [part.get_filename() for part in msg.iter_attachments() if part.get_filename()]
        dt = email.utils.parsedate_to_datetime(msg["Date"]) if msg["Date"] else None
        out.append(dict(
            id=p.stem, folder=p.parent.name, file=str(p.relative_to(PACKET)).replace("\\", "/"),
            date=dt.strftime("%Y-%m-%d") if dt else None,
            time=dt.strftime("%H:%M") if dt else None,
            sender=str(msg["From"] or ""), to=str(msg["To"] or ""),
            subject=str(msg["Subject"] or ""), body=text.strip(), attachments=attachments))
    out.sort(key=lambda e: (e["date"] or "", e["time"] or ""))
    return out


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


# ---------------------------------------------------------------- main
def main():
    ref = read_reference()
    releases = []
    for e in ref["release_log"]:
        rel = read_release(PLANNING / e["file"])
        releases.append(dict(e, **rel, id=f"{e['cycle']}:{Path(e['file']).stem}"))
    submissions = build_submissions(ref)
    emails = read_emails()
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
        sales_use=sales,
        sales_drinks=[dict(menu_id=m, sku=s, name=menu.get(m, {}).get("menu_description") or
                           menu.get(m, {}).get("name")) for m, s in std_drinks],
    )
    OUT.parent.mkdir(exist_ok=True)
    payload = json.dumps(data, separators=(",", ":"), default=str)
    OUT.write_text("// Generated by pipeline/build_data.py. Do not edit.\nwindow.DATA = "
                   + payload + ";\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(payload)/1024:.0f} KB): {len(releases)} releases, "
          f"{len(submissions)} manager files, {len(emails)} emails")
    for f in submissions:
        if f["problems"]:
            print(f"  {f['file']}: {len(f['problems'])} problems, e.g. {f['problems'][0]}")


if __name__ == "__main__":
    sys.exit(main())
