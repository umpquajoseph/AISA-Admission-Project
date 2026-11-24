"""Shipments to each region, in planning cases, per SKU and ship month.

Reads every Distribution export the File_Register lists (six partner layouts,
central replays, rolling desk runs, accepted amendments), keeps one value per
movement line (the highest revision accepted by the decision time), converts
source units to planning cases, and buckets by physical ship date.

Run on its own to tie the totals to Close_Controls.csv:
    python -I pipeline/shipments.py
"""
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "Dutch_Bros_Techincal_Packet" / "Distribution"
DELIM = {"COMMA": ",", "TAB": "\t", "SEMICOLON": ";"}


def read_csv(path, delim=",", skip=0):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        lines = fh.read().splitlines()
    return list(csv.DictReader(lines[skip:], delimiter=delim))


def parse_date(s, mask):
    s = (s or "").strip()
    if not s:
        return None
    if mask == "YYYY-MM-DD":
        return s[:10]
    a, b, y = re.split(r"[/.-]", s)
    if len(y) == 2:
        y = "20" + y
    d, m = (a, b) if mask.startswith("DD") else (b, a)
    return f"{y}-{int(m):02d}-{int(d):02d}"


def parse_qty(s, comma_decimal):
    s = (s or "").strip()
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace(" ", "").replace("\xa0", "")
    if comma_decimal:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    v = float(s)
    return -v if neg else v


def load():
    register = read_csv(DIST / "File_Register.csv")
    fields = defaultdict(dict)
    for r in read_csv(DIST / "Interface_Fields.csv"):
        fields[r["layout_key"]][r["source_heading"]] = r["standard_concept"]
    routing = {r["site_code"]: r for r in read_csv(DIST / "Site_Routing.csv")}
    region_of_site = {s: r["planning_region"] for s, r in routing.items()}
    items = {}
    for r in read_csv(DIST / "Warehouse_Item_Master.csv"):
        items[(r["site_code"], r["warehouse_item"])] = r
    per_case = {}                                   # (region, sku) -> (inner per case, inner per outer)
    for (site, _), r in items.items():
        per_case[(region_of_site[site], r["planning_sku"])] = (
            int(r["inner_units_per_planning_case"]),
            int(r["inner_units_per_manufacturer_outer"]) if r["inner_units_per_manufacturer_outer"] else None)

    versions = {}                                   # (line, rev) -> movement
    problems = []
    for f in register:
        lk = f["layout_key"]
        rows = read_csv(DIST / f["relative_path"], DELIM[f["delimiter"]], int(f["header_row_1based"]) - 1)
        mask = f["date_mask_for_ship_and_post"]
        for raw in rows:
            r = {fields[lk][k]: (v or "").strip() for k, v in raw.items() if k in fields[lk]}
            if not r.get("line_id"):
                continue
            if lk == "CENTRAL":
                region, sku = r["site"], r["article"]
                site = next(s for s, g in region_of_site.items() if g == region)
            else:
                site = r["site"]
                region = region_of_site[site]
                it = items.get((site, r["article"]))
                if not it:
                    problems.append(f"{f['relative_path']}: unknown article {r['article']}")
                    continue
                sku = it["planning_sku"]
            num = re.sub(r"\D", "", r["line_id"].replace(routing[site]["local_line_prefix"], "", 1))
            line = "SL-" + num.zfill(7)
            qty = parse_qty(r["qty"], comma_decimal=(site == "CB" and lk != "CENTRAL"))
            unit = r["uom"]
            rt = routing[site]
            ipc, ipo = per_case[(region, sku)]
            if unit in (rt["planning_case_token"], "CS"):
                cs = qty
            elif unit in (rt["individual_token"], "EA"):
                cs = qty / ipc
            elif unit in (rt["manufacturer_outer_token"], "MCS", "MCT", "OUT", "mc"):
                if not ipo:
                    problems.append(f"{f['relative_path']}: {line} booked in outers, none defined for {sku}")
                cs = qty * (ipo or ipc) / ipc
            else:
                problems.append(f"{f['relative_path']}: {line} unknown unit {unit}")
                continue
            m = dict(line=line, rev=int(r["revision"]), at=r["revised_at"], region=region, sku=sku,
                     ship=parse_date(r["ship_date"], mask), posted=parse_date(r["posted_date"], mask),
                     qty=qty, unit=unit, cs=cs, file=f["relative_path"])
            key = (line, m["rev"])
            if key in versions and abs(versions[key]["cs"] - cs) > 1e-9:
                problems.append(f"{line} rev {m['rev']}: {versions[key]['cs']} in "
                                f"{versions[key]['file']} vs {cs} in {f['relative_path']}")
            versions.setdefault(key, m)
    return versions, problems


def on_record(versions, as_of_utc):
    """Per movement line, the highest revision written by as_of_utc."""
    best = {}
    for (line, rev), m in versions.items():
        if m["at"] > as_of_utc:
            continue
        if line not in best or rev > best[line]["rev"]:
            best[line] = m
    return best


def monthly(lines):
    out = defaultdict(lambda: defaultdict(float))
    for m in lines.values():
        out[f"{m['region']}|{m['sku']}"][m["ship"][:7]] += m["cs"]
    return {k: {mo: round(v, 2) for mo, v in sorted(d.items())} for k, d in out.items()}


def tie_to_controls(versions):
    rows = []
    for c in read_csv(DIST / "Close_Controls.csv"):
        lines = on_record(versions, c["control_as_of_utc"])
        sel = [m for m in lines.values() if m["region"] == c["planning_region"]
               and c["ship_period_start"] <= m["ship"] <= c["ship_period_end"]]
        net = sum(m["cs"] for m in sel)
        cred = sum(m["cs"] for m in sel if m["cs"] < 0)
        rows.append(dict(region=c["planning_region"], start=c["ship_period_start"], end=c["ship_period_end"],
                         ours=round(net, 2), control=float(c["net_planning_cs"]),
                         n=len(sel), n_control=int(c["posted_movement_count"]),
                         credit=round(cred, 2), credit_control=float(c["signed_credit_cs"])))
    return rows


def build(as_of_utc="2026-09-18T23:59:59Z"):
    versions, problems = load()
    lines = on_record(versions, as_of_utc)
    ties = tie_to_controls(versions)
    return dict(as_of=as_of_utc, monthly=monthly(lines), ties=ties, problems=problems,
                last_ship=max(m["ship"] for m in lines.values()))


if __name__ == "__main__":
    b = build()
    bad = [t for t in b["ties"] if abs(t["ours"] - t["control"]) > 0.01 or t["n"] != t["n_control"]]
    for t in b["ties"]:
        flag = "" if t not in bad else "  <-- MISMATCH"
        print(f"{t['region']} {t['start']}..{t['end']}  ours {t['ours']:>9}  control {t['control']:>9}  "
              f"lines {t['n']}/{t['n_control']}  credit {t['credit']}/{t['credit_control']}{flag}")
    print(f"{len(b['ties']) - len(bad)}/{len(b['ties'])} controls tie; {len(b['problems'])} problems")
    for p in b["problems"][:20]:
        print("  ", p)
    sys.exit(1 if bad else 0)
