# Demo script

About 7 minutes. October is made up from the real September files and says so on screen.

## Before

1. In `C:\AISA`: `npm run dev`.
2. Clear the old record: in the browser console, `Object.keys(localStorage).filter(k => k.startsWith("supplydesk.v3.")).forEach(k => localStorage.removeItem(k))`.
3. Open the head-manager page: http://127.0.0.1:8788/?example=1 (if the server says it started on another port, use that one). September is done; the day is Tue Oct 6.
4. Step 11 opens the submanager page in a second tab, from **Submanager view ↗** at the top right.
5. The AI buttons need `ANTHROPIC_API_KEY=...` in `C:\AISA\.dev.vars`. Without it they say "Assistant not connected".

## Steps

| # | Click | Say |
|---|---|---|
| 1 | Nothing yet: point at the five steps across the top | "Every month is the same five steps. Back and Next walk me through them." |
| 2 | **Next day ▶** three times, to Fri Oct 9 (one day per click) | "Sheets arrive from the six regions through the week. Each box says how many lines need me." |
| 3 | **Cascadia** box | "Every number is in cases, even where the region wrote bottles. Orange needs a look." |
| 4 | Black tea sachets, Feb '27, the red **“tbc”** → type `80` → Enter | "I can correct anything a region sends. It is logged, with Undo." |
| 5 | **Check Cascadia's 1 line**, then **Check the other … lines** | "Only unusual lines come here, checked against last year's shipments and sales. Everything else goes in as asked." |
| 6 | On three lines: **Use theirs**, **Keep last plan**, **Set…** | "Three choices. Anything I skip goes in as asked." |
| 7 | **Next: publish** → click any number → **Publish the October plan** | "Each number shows what was asked, the checks and every past version." |
| 8 | **Next: late news** → **Next day ▶** three times, to Mon Oct 12 → open *November harvest feature - spiced pear* → **Log a change** → `600`, **bottles** → **Save change** → open **Too late** *Spiced pear fruit base: 100 more cases for Nov 5 won't arrive in time* → **Rush 100 cases** → **Save** | "It converts 600 bottles to 100 cases, and the order for them goes to purchasing by itself. Spiced pear takes 30 days, so a normal order lands Nov 11, after the promotion. Late news flags that, and I ask for a rush instead." |
| 9 | **Next day ▶** to Tue Oct 13 → open **Short** *Vanilla syrup: supplier cut 36 cases from an order due Oct 20* → **Order 36 more** → **Save** | "We ordered 96 cases of vanilla and the supplier will send only 60. I order the 36 they shorted us." |
| 10 | Open *North route resurfacing - lemonade timing* → **Log a change** → **Move to month**, `40`, to **Dec** → **Save change** | "Moving 40 cases from November to December cuts 40 from the open November order and orders 40 for December. Both go to purchasing by themselves. The Request is a Gulf Coast requisition the buyer has held since Sep 17." |
| 11 | **Submanager view ↗** at the top right (opens the submanager page in a new tab) → **Gulf Coast** → drag `C:\AISA\synthetic\Harbor 2026-10 roll.xlsx` onto the drop zone → **Send sheet** → a late request → **Next: done** | "A submanager has a short path of their own: region, sheet, late request, done." |
| 12 | Back to the first tab (head manager) → **Late news** | "What they sent is here. The request opens with their numbers filled in." |
| 13 | **Next: send to purchasing** → **Download the plan for purchasing** → **Download the order actions** | "Purchasing gets the whole plan in force. Every line I changed since publishing shows the published number, the change and why. The order actions go as a second file: what my plan changes need, plus anything I asked for in Late news." |
| 14 | Click the date at the top → pick **Fri, Sep 18** → **Publish** step | "On the six real September sheets this lands within 5% of Dutch Bros' own posted plan on 745 of 864 lines." |

History and Ask sit at the top right. Each has a Back button to the step you came from.

## Notes

- A sheet sent after publishing shows under Late news, line by line, with **Use new number** or **Keep plan**.
- Remove a sheet from its page under **File details and remove**. Restore it from **Sheets in → Removed**.
- Purchasing news comes from the buyer's watch list (Sep 18) and made-up October rows in `synthetic/purchasing/`. A saved plan change adds its order action by itself: order more for an add, cut an open order for a drop. Late news shows only what needs a person: Short on the journal date, and Too late when a normal order placed today would arrive after the date needed.
- **Click any number** under Publish: the panel shows "On order: PO-…, N cases, due …" for that item.
