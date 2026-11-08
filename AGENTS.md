# Clothes app — project notes

Read this first when starting a new session. Sister app of
`/run/media/bibek/New Volume/purchases-app` (read its `AGENTS.md` for the
background, testing notes, and the user's preferences). Same approach, same
rules: no build step, offline PWA, phone only, data in IndexedDB, manual
Export/Import .zip backup.

- Live: https://bibek-maharjan.github.io/clothes-app/
- Repo: https://github.com/bibek-maharjan/clothes-app (Pages from `main`, root)
- GitHub account: **bibek-maharjan** only.
- **Deploy only when the user asks.** Bump `VERSION` in `sw.js` on every change
  (now `clothes-v4`).

## Update history

- v1: first version.
- v2: ↻ rotate and ✂ crop for each photo in the editor, copied from Purchases
  v18/v19 (`turnedCanvas()`, `editPhoto()`, `#cropper` dialog). See the
  Purchases `AGENTS.md` (Rotate / Crop) for how they work; keep both apps in sync.
- v3: quick filters. Sticky top bar: **Filters** button + a chip for every
  `type` value (`QUICK` in `app.js`), tap to toggle. The Filters sheet has
  chips for every field. Same field = any of them (OR), different fields = all
  of them (AND), and the search box applies on top. Filters are not saved
  between visits.
- v4: search for chips. Filters sheet: `#filterSearch` narrows values (a
  field name shows the whole field; chosen chips stay visible). Editor: each
  field's "find / + new" box (first in the row) narrows its chips and shows
  `+ add "…"` for a new value. Enter = exact name, else the only match, else
  add new if nothing matches (does nothing with several matches). No add on
  blur, so tapping a chip after typing never adds the typed text.

## Decisions (from the user, Nov 2026)

- Fields: photos (several, ★ cover), name (optional), price, and pick-list
  fields type, color, shade, position, season, context, newness, where, place,
  size, brand, other, set. Plus an optional **date bought** (BS first:
  None / Today / Yesterday / Custom + 📅 AD picker).
- Pick-lists are chips: tap to choose, tap again to unchoose, "+ new" adds a
  value. Values come from existing items (most used first) plus a few seeds
  (`PICKS` in `app.js`). **season** and **context** allow several values and
  are stored as arrays; the rest are strings.
- **place** is a sub-location of **where** (shown as `📍 where › place`).
- With no name, the item shows as `color type` (`displayName()`).
- Opens in **Gallery, 2 columns**. List view also available. Newest first.
- The old Obsidian views (Upper, Winter, ...) are just searches:
  `upper winter` (every word must match).

Item shape: `{ id, created, name, price, type, color, shade, position,
season[], context[], newness, where, place, size, brand, other, set, date,
dateBS, thumb, photoCount }`.

## Shared website — important

Both apps live on `bibek-maharjan.github.io`, so they share localStorage,
IndexedDB, and Cache Storage. Hence: DB name `clothes`, localStorage key
`clothes-view`, cache names `clothes-v<N>`, and each `sw.js` deletes only its
own old caches. Keep it that way.

## Testing

Local server: `python3 -m http.server 8932` in this folder.
The Playwright MCP runs in **extension mode** (controls the user's real Brave,
one controller at a time) and hangs when several sessions use it. A reliable
alternative: a Node script that launches a separate headless Brave with
`require('/home/bibek/.npm/_npx/9833c18b2d85bc59/node_modules/playwright')`,
`chromium.launch({ executablePath: '/usr/bin/brave-origin', headless: true })`.
Downloads and `setInputFiles` work there.

## Migration

Script: `/run/media/bibek/New Volume/clothes-migration/migrate_clothes.py`
(outside this repo). Reads `notion/*.md` in the vault (never changes it) and
writes `clothes-migration.zip` for Import, plus `migration-report.txt`.
Rules are in the script's top comment (name = file name with `_` → space,
values lowercased except brand, "Home, Outside" split, the conflict copy of
`half_trouser_green` merged in as a 2nd photo). First run (Nov 2026): 62 items,
63 photos, 6.6 MB, no broken links. Import tested in a browser: 62 items in
~0.3 s.
