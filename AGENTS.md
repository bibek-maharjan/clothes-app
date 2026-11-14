# Clothes app — project notes

Read this first when starting a new session. Sister app of
`/mnt/jarvis/personal-projects/purchases-app` (read its `AGENTS.md` for the
background, testing notes, and the user's preferences). Same approach, same
rules: no build step, offline PWA, phone only, data in IndexedDB, manual
Export/Import .zip backup.

- Live: https://bibek-maharjan.github.io/clothes-app/
- Repo: https://github.com/bibek-maharjan/clothes-app (Pages from `main`, root)
- GitHub account: **bibek-maharjan** only.
- **Deploy only when the user asks.** Bump `VERSION` in `sw.js` on every change
  (now `clothes-v18`).

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
- v5: update bug fix. GitHub Pages sends `Cache-Control: max-age=600`, and
  `addAll()` went through the browser's HTTP cache, so a new `clothes-vN`
  cache could be filled with the OLD files (v4 never showed on the phone).
  `sw.js` now caches with `new Request(f, { cache: 'reload' })`. After a deploy
  the app shows the new version on the 2nd open. Tested with
  `/tmp/opencode/serve600.py` (a local server with the same header).
  **Purchases `sw.js` still has this bug** (plain `c.addAll(FILES)`).
- v6: top bar redesigned (replaces v3's row of every type). `#quickSearch`
  box + Filters button. Typing shows matching values from **every** field
  (`quickMatches()`; field name matches all its values; "starts with" first),
  each chip with its field in small text. Tapping one turns it on, clears the
  box and keeps the keyboard open (`mousedown` preventDefault). Enter picks
  the only match. Empty box: active filters, then the **5 recent** filters
  (localStorage `clothes-recent`, `[{ key, v }]`, saved when a filter is
  turned on anywhere; values no item has any more are skipped).
- v7: the user's idea: **no top bar any more**; the chip strip (`#quickRow`:
  Filters button + `#quick`) sits inside `#searchBar`, above the bottom
  search. The bottom search still filters by text as you type, and its text
  suggests chips (`suggestions()`: whole text if it matches values, else the
  last word). Tapping a suggestion turns that text into a filter (the rest of
  the text stays) and keeps the keyboard open. Strip order: active filters
  (always), then suggestions while typing, or the 5 recent when the empty box
  has focus. Strip hidden when nothing to show and the box isn't focused.
  `body.strip` lifts the + button; `body.searching` hides it.
  `#clearBtn` ("✕ Clear", after the Filters button) shows while any filter
  is on and clears them all in one tap.
- v8: the card's 📍 line always shows `where › place`. The View menu has one
  "Where › Place" checkbox (the `where` setting); Place has no checkbox now.
- v9: bug fix: closing the keyboard with Android's back button left `#search`
  focused, so `body.searching` kept the + button hidden. A `visualViewport`
  resize listener blurs the box when the keyboard closes (screen grows back).

- v10: keyboard fix. Android used to pan the view down to the fixed search bar when the
  keyboard opened, hiding the results above. The viewport meta now has
  `interactive-widget=resizes-content`. Same fix in Things and Purchases. Tested by the user in Things: works. Deployed.

- v11: edit values. The Filters sheet has an **✎ Edit** toggle (`editValues`).
  While on, tapping a chip opens `#valueEdit` (rename / delete) instead of
  filtering. `changeValue()` rewrites that field in every item that uses the
  value (case-insensitive) with one `DB.saveMany` (photos untouched). Renaming
  onto an existing value merges them (multi fields drop duplicates); delete
  only removes the value, never the items. Active filters and the 5 recent are
  updated too. Only values in use are listed (seeds in `PICKS` are not).
  Tested headless: rename, merge, delete. Deployed with v12.

- v12: exclude. A search word starting with `-` hides items that contain it
  (`-pant`). Typing `-pant` also suggests red **not pant** chips; tapping one
  adds it to `excluded` (key -> values, like `filters`; an item with any of
  them is hidden). Red chips show in the strip and count in Filters (N);
  Clear clears both. A value is never in both `filters` and `excluded`.
  Not saved to the 5 recent. Tested headless. Deployed.

- v14: containers. **Place** is shown as **Container** (a plastic/jhola; key
  stays `place`), and it sits inside a **Where** (bora etc.). No new data:
  `homeOf(place)` = the Where most items in that container use. Editor:
  picking a container also picks its Where (`choose()`). Filters ✎ Edit on a
  container shows an **Inside (Where)** select; Save renames and moves every
  item in it to that Where (`changeValue(key, old, next, where)`). If its
  items disagree, a hint says Save will put them all in one. Tested headless.
  Deployed with v16. (Built on top of uncommitted v13 work: colored Color pills.)

- v15: master tag search in the editor (the user's idea). `#tagSearch` sits
  above the fields and searches values from **every** field (`tagMatches()`,
  uses `choices()` so seeds count; a field name shows all its values). Chips
  show `value  field`; tapping one picks/unpicks it in that field
  (`choose()`), clears the box and keeps the keyboard open. A value that
  exists nowhere shows `+ add "…" to…`, then a chip per field to choose
  where it goes. Enter = the only (or only exact) match; no match = ask the
  field. Tested headless. Deployed with v16.

- v16/v17: duplicate. **Duplicate** button in the editor (existing items
  only) and in the details sheet. `duplicate()` turns the open editor into a
  new item (`editing = null`, `photosChanged = true`) with the same photos and
  fields as on screen; `#copyHint` says it is a copy. Nothing is saved until
  Save; the original is untouched. Tested headless. The code went out with the
  v16 deploy (another session committed it); v17 only fixes the editor's
  bottom row so "Duplicate" fits at 360px (buttons size to their text).
  Deployed with v17.

- v18: reload popup, copied from Things. When a new version takes over
  (`controllerchange`, only if a worker was already in charge), a `#toast`
  bar next to the + button says "A new version is ready" with **Reload**.
  The app also checks for updates each time it comes back on screen
  (`reg.update()` on `visibilitychange`). Tested headless. Deployed.

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
  Since v14 it is labelled **Container**: one container lives in one Where.
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
