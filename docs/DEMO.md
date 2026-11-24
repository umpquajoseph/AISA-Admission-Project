# Demo script

About 6 minutes. October is made up from the real September files and says so on screen.

## Before

1. In `C:\AISA`: `npm run dev`.
2. Clear the old record: in the browser console, `Object.keys(localStorage).filter(k => k.startsWith("supplydesk.v3.")).forEach(k => localStorage.removeItem(k))`.
3. Open the head-manager page: http://127.0.0.1:8788/?example=1 (if the server says it started on another port, use that one). September is done; the day is Tue Oct 6.
4. Step 9 opens the submanager page in a second tab, from **Submanager view ↗** at the top right.
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
| 8 | **Next: late news** → **Next day ▶** three times, to Mon Oct 12 → open *November harvest feature - spiced pear* → **Log a change** → `600`, **bottles** → **Save change** | "It converts 600 bottles to 100 cases. The calendar entry for the same promotion closes with it." |
| 9 | **Submanager view ↗** at the top right (opens the submanager page in a new tab) → **Gulf Coast** → drag `C:\AISA\synthetic\Harbor 2026-10 roll.xlsx` onto the drop zone → **Send sheet** → a late request → **Next: done** | "A submanager has a short path of their own: region, sheet, late request, done." |
| 10 | Back to the first tab (head manager) → **Late news** | "What they sent is here. The request opens with their numbers filled in." |
| 11 | **Next: send to purchasing** → **Download the list for purchasing** | "One list for purchasing: what changed since publishing, and why. Open questions and what-ifs change no numbers." |
| 12 | Click the date at the top → pick **Fri, Sep 18** → **Publish** step | "On the six real September sheets this lands within 5% of Dutch Bros' own posted plan on 745 of 864 lines." |

History and Ask sit at the top right. Each has a Back button to the step you came from.

## Notes

- A sheet sent after publishing shows under Late news, line by line, with **Use new number** or **Keep plan**.
- Remove a sheet from its page under **File details and remove**. Restore it from **Sheets in → Removed**.
