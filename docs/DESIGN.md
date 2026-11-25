# Design

## The problem

Each month six regional managers email a six-month request sheet: four layouts,
local item codes, some in cases and some in bottles, and some that read "blank =
same as last cycle, zero = cancel". Managers resend corrected copies. The planner
retypes them into one Excel grid, posts a bare grid with no reasons, and keeps late
news (promotions, openings that move, trials) in a side list. Nothing checks a
request against what actually shipped or sold, and nothing records why a number
changed.

## What the app does

1. **Sheets in.** Reads every layout, keeps the latest copy per region, maps local
   codes to items, converts bottles to cases, and carries blanks forward. Every
   number keeps its file, row and original value.
2. **Check.** Builds the draft and shows only the lines the evidence disagrees with.
   Everything else goes in as asked.
3. **Publish.** The planner's published plan is the plan in force. Dutch Bros' own
   September file is shown beside it as an answer key, never in place of it.
4. **Late news.** Each item becomes a typed change: add, set total (replaces an
   earlier change), move to another month, hold, or scenario. A change sends its
   order action to purchasing by itself. Late news shows only what needs a person.
5. **Send to purchasing.** The whole plan in force, with every changed line showing
   the published number, the change and why. Order actions go as a second file.

History and Ask sit to the side. Ask answers from the record, cites its sources,
and proposes actions the planner approves one by one.

## The checks

- **Shipments.** The same three months last year, scaled by open shops now over
  then. Seasonal items use the same month only. Amendments count from the date
  they were accepted.
- **Sales.** For the three drinks with a portion standard (S001, S005, S014):
  servings sold and comped, converted to cases, scaled by year-on-year growth.
- **Flag rule.** A line is flagged when shipments disagree by more than 35% and
  30 cases, and sales do not back the number. A swing against the last plan is
  shown but never flags on its own.

## Packet cases it must get right

- **GC-PROMO-01 mango.** +720 bottles is later replaced by 480 bottles. The two are
  not summed: Gulf Coast mango for October gains 80 cases.
- **OP-FR-02 opening kit.** Moves from October to November. Totals do not change.
- **HD-PULL-01 vanilla.** 96 cases shipped in August. Juniper's corrected sheet
  already nets them out, so the app does not subtract them again.
- **Finance cup buffer.** A scenario. It never enters the plan.
- **CA-TEST-03 winter trial.** A hold. It shows as an open question.

## How the results were checked

- Rebuilding September from the six real sheets lands within 5% of Dutch Bros'
  posted plan on 745 of 864 lines.
- Shipment totals tie to all 42 region-quarter totals in
  `Distribution/Close_Controls.csv` (`python -I pipeline/shipments.py`).

## Out of scope, and why

- **Transfers and shop receiving.** They track stock after the plan is set. The plan
  is the part every other desk reads.
- **A statistical forecast.** There are 20 months of history, portion standards for
  three drinks, and no stock on hand. The checks point the planner at lines to
  look at; they do not replace the managers' requests.
- **Stock on hand.** Not in the packet, so the app can flag a line but cannot size
  a shortage.

## Data

September 2026 is real; the packet stops Sep 18. October is synthetic, built from
the real September files by `pipeline/make_synthetic.py`, and labelled on screen.
Purchasing reads one buyer's watch list (`Purchasing/Exports`), pooled for all
regions.
