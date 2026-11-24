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
