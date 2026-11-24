# Synthetic October 2026

Made-up files for rehearsal and the live demo. Each one is built from the real
September file for the same region (same layout, units and wording), rolled
forward one month. Every sheet carries a "Synthetic practice file" line and every
email an `X-Synthetic` header, so the app flags them even when dragged in live.

Rebuild: `python -I pipeline/make_synthetic.py`, then `python -I pipeline/build_data.py`.

| Arrives | File | What it shows |
|---|---|---|
| Oct 6 | `Oct unit plan - North Fork.xlsx` | One cell reads "tbc": a reading problem |
| Oct 6 | `Oct Rina reorder.xlsx` | Blanks carry from September |
| Oct 7 | `MesaW Oct refresh FINAL.xlsx` | November lids counted twice (flags) |
| Oct 7 | `JD intake 10-26.xlsx` | EA lines converted to cases |
| Oct 8 | `MesaW Oct refresh - corrected.xlsx` | The resend that replaces the FINAL |
| Oct 8 | `Summit Oct needs.xlsx` | December cold brew keyed with an extra zero; opening kit now in November |
| Oct 9 | `Harbor 2026-10 roll.xlsx` | Blanks carry; peppermint cancelled for March |

| Date | Email | Change type |
|---|---|---|
| Oct 12 | `1012_0914_harvest_feature_spiced_pear.eml` | add: 600 bottles, Cascadia spiced pear, Nov |
| Oct 13 | `1013_1102_north_route_lemonade.eml` | move: 40 CS lemonade, Nov → Dec |
| Oct 13 | `1013_1530_dock_door_four.eml` | none: dock mail |
| Oct 14 | `1014_0848_holiday_kiosk_pilot.eml` | hold: no quantities yet |
| Oct 15 | `1015_1621_re_harvest_feature_spiced_pear.eml` | set total: 420 bottles, replaces the 600 |
| Oct 16 | `1016_1005_hot_cup_sensitivity.eml` | scenario: hot cups +15%, not for release |

`calendar.csv` adds event-calendar rows in the packet's columns. MW-OPEN-03 names
a Mesa West opening kit, so those November lines pass with "opening kit +24".
`manifest.csv` gives each sheet's arrival date.

`purchasing/` adds made-up rows in the packet's own `Purchasing/Exports` columns,
each marked in a `synthetic` column. Rebuild just these with
`python -I pipeline/make_synthetic.py purchasing`.

| Date | Row | What Late news shows |
|---|---|---|
| Sep 21-30 | Receipts for the September lines still open on Sep 18 | Nothing: those orders arrive in full |
| Sep 24-Oct 1 | New orders PO-6066, PO-6069, PO-6072 for October and November | The orders behind later items |
| Oct 13 | CH-101: vanilla order cut from 96 to 60 cases | Short |
| Oct 14 | CH-103: 48 cases of oat drink slip from Oct 14 to Oct 21 | Short |

Too much and Too late are not rows: they come from the planner's own changes
against these open orders (lemonade moved out of November; spiced pear added).
