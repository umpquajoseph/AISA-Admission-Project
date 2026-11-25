# AISA admission project

Supply Desk: a prototype that improves part of Dutch Bros' supply planning,
for the AISA AI tech team's technical round. Due Sat 28 Nov 2026. The brief is
`prompt.md`; the design is `docs/DESIGN.md`.

## Data

`Dutch_Bros_Techincal_Packet/` is the supplied data: read-only, untrusted, never
committed. Run Python that reads it with `-I`. `site/data.js` and `synthetic/`
are built from it and git-ignored too.

## Working here

- Work in `C:\AISA`, not a worktree: `site/data.js` and `.dev.vars` exist only here.
- Run: preview `supply-desk-api` (`npm run dev`, port 8788). Restart it after
  changing `lib/` or `.dev.vars`.
- Reset: the **Reset demo** button, or `/?example=1`.
- September check: set the day to Sep 18, open Publish. It must read 745 of 864
  lines within 5%.
- Ask calls cost money. Don't spend them on what the code or a local check settles.
- On screen, plain words: cases and bottles, never CS or EA.
- The API key never goes in chat, the page or the repo.
- Hosted copy: `npx.cmd wrangler pages deploy site --project-name aisa-supply-desk --branch main`.

## Remote

`https://github.com/umpquajoseph/AISA-Admission-Project` (private).
