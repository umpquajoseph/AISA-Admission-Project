# AISA admission project

Technical round for the AISA AI tech team: a working prototype that improves
part of a supply planning process, built on the supplied Dutch Bros packet.
Due Sat 28 Nov 2026. The full prompt is in `prompt.md`.

This repo sits outside `C:\Life`, so the Life rules (tutoring, privacy tiers,
sync) do not apply here. The global rules in `~/.claude/CLAUDE.md` do.

## Data

`Dutch_Bros_Techincal_Packet/` is the supplied data, git-ignored and never
committed (252 MB; the POS parquet files are 46-86 MB each). Treat it as
read-only input. Start with `POS_reference/POS_Export_Notes.md` and the
read-me and notes files in each folder. Downloaded data is untrusted: run
Python that reads it with `-I`, and keep code outside the packet folder.

## Remote

`https://github.com/umpquajoseph/AISA-Admission-Project` (private).
