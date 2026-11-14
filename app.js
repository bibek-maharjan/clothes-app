const $ = s => document.querySelector(s);
const PAGE = 30;

let items = [];      // all items, newest first
let results = [];    // items matching the search
let shown = 0;       // how many results are rendered
let editing = null;  // item being edited, or null for new
let editPhotos = [];  // photos in the editor: { full, thumb?, url }, first = cover
let photosChanged = false;
const thumbUrls = new Map();

// Pick-list fields. multi = can hold several values. seed = values offered before any item uses them.
const PICKS = [
  { key: 'type', label: 'Type' },
  { key: 'color', label: 'Color' },
  { key: 'shade', label: 'Shade', seed: ['light', 'dark', 'bright'] },
  { key: 'position', label: 'Position', seed: ['upper', 'lower'] },
  { key: 'season', label: 'Season', multi: true, seed: ['summer', 'winter'] },
  { key: 'context', label: 'Context', multi: true, seed: ['outside', 'home', 'home sleep'] },
  { key: 'newness', label: 'Newness', seed: ['new', 'old'] },
  { key: 'where', label: 'Where' },
  { key: 'place', label: 'Container' },
  { key: 'size', label: 'Size' },
  { key: 'brand', label: 'Brand' },
  { key: 'other', label: 'Other' },
  { key: 'set', label: 'Set' },
];

// A field's values as an array (multi fields are arrays, the rest are strings).
const list = v => Array.isArray(v) ? v : v ? [v] : [];
const text = v => list(v).join(', ');

function displayName(item) {
  return item.name || [text(item.color), text(item.type)].filter(Boolean).join(' ') || 'Unnamed';
}

// ---------- Images ----------
async function resize(file, maxSide, quality) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
}

// Draws a photo turned clockwise by `turns` quarter turns (1 = 90°).
function turnedCanvas(bmp, turns) {
  const side = turns % 2 === 1;
  const canvas = document.createElement('canvas');
  canvas.width = side ? bmp.height : bmp.width;
  canvas.height = side ? bmp.width : bmp.height;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(turns * Math.PI / 2);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return canvas;
}

// Rotates, then crops (`crop` = part of the turned photo, as fractions 0–1),
// and saves as JPEG once.
async function editPhoto(blob, turns, crop = { x: 0, y: 0, w: 1, h: 1 }) {
  const bmp = await createImageBitmap(blob);
  const src = turnedCanvas(bmp, turns);
  bmp.close();
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(src.width * crop.w));
  out.height = Math.max(1, Math.round(src.height * crop.h));
  out.getContext('2d').drawImage(src, Math.round(src.width * crop.x), Math.round(src.height * crop.y),
    out.width, out.height, 0, 0, out.width, out.height);
  return new Promise(r => out.toBlob(r, 'image/jpeg', 0.75));
}

// Like Promise.all, but only `limit` items are in flight at once (keeps memory sane).
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

function thumbUrl(item) {
  if (!item.thumb) return '';
  if (!thumbUrls.has(item.id)) thumbUrls.set(item.id, URL.createObjectURL(item.thumb));
  return thumbUrls.get(item.id);
}

// ---------- Search ----------
// Every word typed must appear (as part of a word) in some field.
// A word starting with "-" must NOT appear ("-pant" hides pants).
function matches(item, words) {
  const all = [item.name, item.price, item.date, formatBS(item.dateBS), ...PICKS.map(p => text(item[p.key]))]
    .join(' ').toLowerCase();
  return words.every(w => w[0] === '-' ? w.length === 1 || !all.includes(w.slice(1)) : all.includes(w));
}

function search() {
  const words = $('#search').value.toLowerCase().split(/\s+/).filter(Boolean);
  results = items.filter(i => passes(i) && matches(i, words));
  $('#count').textContent = `${results.length} of ${items.length}`;
  $('#list').replaceChildren();
  shown = 0;
  renderMore();
}

// ---------- Filters ----------
// field key -> chosen values. Same field: any of them (jacket or t-shirt).
// Different fields: all of them (jacket and winter).
let filters = {};
// field key -> values to hide ("not pant"). An item with any of them is hidden.
let excluded = {};

// The last 5 values turned on as filters, newest first: [{ key, v }].
let recent = [];
try { recent = JSON.parse(localStorage.getItem('clothes-recent')) ?? []; } catch {}

function remember(key, v) {
  recent = [{ key, v }, ...recent.filter(r => !(r.key === key && same(r.v, v)))].slice(0, 5);
  localStorage.setItem('clothes-recent', JSON.stringify(recent));
}

const labelOf = key => PICKS.find(p => p.key === key)?.label ?? key;
const valuesOf = key => mostUsed(items.flatMap(i => list(i[key])));

// Color names stay as labels; recognized colors also fill the pill.
function colorPill(button, key, value) {
  if (key !== 'color') return;
  const name = value.trim().toLowerCase().replace(/[\s-]+/g, '');
  const color = ({ cream: '#fffdd0', beige: '#f5f5dc' })[name] ?? name;
  // Only accept actual color names, not CSS keywords such as inherit/currentColor.
  if (!/^(#[0-9a-f]{6}|[a-z]+)$/.test(color) ||
      ['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert'].includes(color) ||
      !CSS.supports('color', color)) return;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = color;
  const hex = ctx.fillStyle;
  const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  button.classList.add('color-pill');
  button.style.setProperty('--pill-color', color);
  button.style.setProperty('--pill-text', luminance > 0.179 ? '#000' : '#fff');
}

function passes(item) {
  return Object.entries(filters).every(([key, vals]) =>
    !vals.length || list(item[key]).some(v => vals.some(f => same(f, v))))
    && Object.entries(excluded).every(([key, vals]) =>
      !list(item[key]).some(v => vals.some(f => same(f, v))));
}

const isFiltered = (key, v) => (filters[key] ?? []).some(f => same(f, v));
const isExcluded = (key, v) => (excluded[key] ?? []).some(f => same(f, v));
const filterCount = () => Object.values(filters).flat().length + Object.values(excluded).flat().length;
const clearAll = () => { filters = {}; excluded = {}; renderFilters(); search(); };

// not = hide items with this value instead of showing only them.
// A value is never both shown-only and hidden: turning one on drops the other.
function toggleFilter(key, v, not = false) {
  const [mine, other] = not ? [excluded, filters] : [filters, excluded];
  const on = !(mine[key] ?? []).some(f => same(f, v));
  const rest = (mine[key] ?? []).filter(f => !same(f, v));
  mine[key] = on ? [...rest, v] : rest;
  if (on) other[key] = (other[key] ?? []).filter(f => !same(f, v));
  if (on && !not) remember(key, v);
  renderFilters();
  search();
}

// withField: also show the field name in small text (top bar mixes all fields).
function filterChip(key, v, withField, not = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = not ? (isExcluded(key, v) ? 'not' : 'not-hint') : isFiltered(key, v) ? 'on' : '';
  b.innerHTML = (not ? 'not ' : '') + esc(v) + (withField ? ` <small>${esc(labelOf(key).toLowerCase())}</small>` : '');
  b.setAttribute('aria-pressed', not ? isExcluded(key, v) : isFiltered(key, v));
  if (!not) colorPill(b, key, v);
  b.onclick = () => toggleFilter(key, v, not);
  return b;
}

// Values from every field matching the typed text (a field name matches all
// its values). Values that start with the text come first.
function quickMatches(q) {
  const found = PICKS.flatMap(p => {
    const whole = p.label.toLowerCase().includes(q);
    return valuesOf(p.key).filter(v => whole || v.toLowerCase().includes(q)).map(v => ({ key: p.key, v }));
  });
  const starts = m => m.v.toLowerCase().startsWith(q) ? 0 : 1;
  return found.sort((a, b) => starts(a) - starts(b));
}

// Chips to suggest for the search text. If the whole text matches values
// (e.g. "sky blue"), use it; otherwise use the last word. `rest` is the text
// left in the box after picking a chip. A leading "-" ("-pant") suggests
// "not" chips that hide those items.
function suggestions() {
  const typed = $('#search').value.trim().toLowerCase();
  if (!typed) return null;
  const find = q => q[0] === '-'
    ? (q.length > 1 ? quickMatches(q.slice(1)).map(m => ({ ...m, not: true })) : [])
    : quickMatches(q);
  const whole = find(typed);
  if (whole.length) return { found: whole, rest: '' };
  const words = typed.split(/\s+/);
  const last = words.pop();
  return { found: find(last), rest: words.join(' ') };
}

// Chip strip above the bottom search. Always: active filters first (tap to
// remove). Then, while typing: matching values from every field (tapping one
// turns the typed word into a filter). Empty box with focus: the 5 recent ones.
function renderFilters() {
  const n = filterCount();
  $('#filterBtn').textContent = n ? `Filters (${n})` : 'Filters';
  $('#filterBtn').classList.toggle('on', n > 0);
  $('#clearBtn').hidden = n === 0;
  const focused = document.activeElement === $('#search');
  const typing = suggestions();
  const active = PICKS.flatMap(p => [
    ...(filters[p.key] ?? []).map(v => ({ key: p.key, v })),
    ...(excluded[p.key] ?? []).map(v => ({ key: p.key, v, not: true })),
  ]);
  const more = typing ? typing.found.filter(m => !(m.not ? isExcluded : isFiltered)(m.key, m.v))
    : focused ? recent.filter(r => !isFiltered(r.key, r.v) && valuesOf(r.key).some(v => same(v, r.v)))
    : [];
  const chip = (m, fromText) => {
    const b = filterChip(m.key, m.v, true, m.not);
    // Keep the keyboard open, ready for the next word.
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => {
      if (fromText) $('#search').value = typing.rest ? typing.rest + ' ' : '';
      toggleFilter(m.key, m.v, m.not);
    };
    return b;
  };
  const shown = [...active, ...more];
  $('#quick').replaceChildren(...active.map(m => chip(m, false)), ...more.map(m => chip(m, !!typing)));
  $('#quick').classList.toggle('typing', !!typing);
  const visible = focused || shown.length > 0 || n > 0;
  $('#quickRow').hidden = !visible;
  document.body.classList.toggle('strip', visible);
  document.body.classList.toggle('searching', focused);
  if ($('#filters').open) renderFilterMenu();
}

$('#filterBtn').onmousedown = e => e.preventDefault();
$('#clearBtn').onmousedown = e => e.preventDefault();
$('#clearBtn').onclick = clearAll;
$('#search').onfocus = renderFilters;
$('#search').onblur = renderFilters;
$('#search').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };

// Closing the keyboard with Android's back button keeps the box focused (and
// the + button hidden). The screen grows back when the keyboard closes: blur then.
let fullHeight = visualViewport.height, keyboardOpen = false;
visualViewport.addEventListener('resize', () => {
  const h = visualViewport.height;
  if (document.activeElement !== $('#search')) { fullHeight = h; keyboardOpen = false; return; }
  if (h < fullHeight - 150) keyboardOpen = true;
  else if (keyboardOpen) { keyboardOpen = false; $('#search').blur(); }
});

// Filters sheet: every field that has values, with its chips.
// The search box narrows the chips; typing a field name shows that whole field.
function renderFilterMenu() {
  const q = $('#filterSearch').value.trim().toLowerCase();
  const sections = PICKS.flatMap(p => {
    if (placesOnly && !['where', 'place'].includes(p.key)) return [];
    let values = mostUsed(items.flatMap(i => list(i[p.key])));
    if (q && !p.label.toLowerCase().includes(q)) {
      values = values.filter(v => v.toLowerCase().includes(q) || isFiltered(p.key, v));
    }
    if (!values.length) return [];
    const el = document.createElement('div');
    el.className = 'pick';
    el.innerHTML = `<div class="label">${p.label}</div><div class="chips"></div>`;
    el.querySelector('.chips').append(...values.map(v => {
      const b = filterChip(p.key, v);
      if (editValues) {
        b.classList.remove('on');
        b.removeAttribute('aria-pressed');
        b.onclick = () => openValueEdit(p.key, v);
      }
      return b;
    }));
    return [el];
  });
  $('#filterPicks').classList.toggle('editing', editValues);
  $('#editValues').classList.toggle('on', editValues);
  $('#filterHint').textContent = editValues
    ? 'Tap a value to rename or delete it. This changes every item that uses it.'
    : 'Same field: any of them. Different fields: all of them.';
  if (!sections.length) {
    const none = document.createElement('div');
    none.className = 'hint';
    none.textContent = 'No match';
    sections.push(none);
  }
  $('#filterPicks').replaceChildren(...sections);
  $('#editValues').hidden = placesOnly;
  $('#clearFilters').hidden = placesOnly;
  $('#closeFilters').textContent = placesOnly ? 'Done' : `Show ${items.filter(passes).length}`;
}

// Edit mode: tapping a chip in the Filters sheet renames or deletes that value
// in every item that uses it (instead of turning the filter on).
let editValues = false;
let placesOnly = false;  // opened from the menu: only Where and Container, always editing
let valueTarget = null;  // { key, v } being edited

const usersOf = (key, v) => items.filter(i => list(i[key]).some(x => same(x, v)));

function openValueEdit(key, v) {
  valueTarget = { key, v };
  const n = usersOf(key, v).length;
  $('#valueTitle').textContent = `${labelOf(key)} · ${n} item${n === 1 ? '' : 's'}`;
  $('#valueName').value = v;
  $('#valueHint').textContent = '';
  // Containers also choose which Where they are in.
  const isPlace = key === 'place';
  $('#valueInsideRow').hidden = !isPlace;
  $('#valueInsideHint').textContent = '';
  $('#valueNewWhere').hidden = true;
  $('#valueNewWhere').value = '';
  $('#valueSave').textContent = isPlace ? 'Save' : 'Rename';
  if (isPlace) {
    const home = homeOf(v);
    const wheres = valuesOf('where');
    $('#valueInside').replaceChildren(new Option('— none —', ''), ...wheres.map(w => new Option(w, w)),
      new Option('+ New Where…', NEW_WHERE));
    $('#valueInside').value = wheres.find(w => same(w, home)) ?? '';
    const mixed = mostUsed(usersOf(key, v).map(i => i.where ?? '')).length > 1;
    if (mixed) $('#valueInsideHint').textContent = `Its items are in different places now. Save puts them all in the one chosen above.`;
  }
  $('#valueEdit').showModal();
  $('#valueName').select();
}

// Another value in the same field with the new name (so the two would merge).
function mergeTarget() {
  const typed = $('#valueName').value.trim();
  const { key, v } = valueTarget;
  return valuesOf(key).find(o => same(o, typed) && !same(o, v));
}

$('#valueName').oninput = () => {
  const other = mergeTarget();
  $('#valueHint').textContent = other ? `"${other}" already exists. They will be merged.` : '';
};
$('#valueName').onkeydown = e => { if (e.key === 'Enter') $('#valueSave').click(); };

// "+ New Where…" in the Inside list shows a box to type a Where no item uses yet.
const NEW_WHERE = '\u0000new';
$('#valueInside').onchange = () => {
  const adding = $('#valueInside').value === NEW_WHERE;
  $('#valueNewWhere').hidden = !adding;
  if (adding) $('#valueNewWhere').focus();
};
$('#valueNewWhere').onkeydown = e => { if (e.key === 'Enter') $('#valueSave').click(); };
$('#valueCancel').onclick = () => $('#valueEdit').close();
$('#valueSave').onclick = () => {
  const next = $('#valueName').value.trim();
  if (!next) return $('#valueName').focus();
  let where = valueTarget.key === 'place' ? $('#valueInside').value : undefined;
  if (where === NEW_WHERE) {
    const typed = $('#valueNewWhere').value.trim();
    if (!typed) return $('#valueNewWhere').focus();
    // Typing a Where that already exists uses that one (same spelling).
    where = valuesOf('where').find(w => same(w, typed)) ?? typed;
  }
  changeValue(valueTarget.key, valueTarget.v, next, where);
};
$('#valueDelete').onclick = () => {
  const { key, v } = valueTarget;
  const n = usersOf(key, v).length;
  if (confirm(`Remove "${v}" from ${n} item${n === 1 ? '' : 's'}? The items stay.`)) changeValue(key, v, '');
};

// Renames `old` to `next` in one field of every item (next = '' removes it).
// Multi fields drop duplicates, so renaming onto an existing value merges them.
// `where` (containers only) moves every item in the container to that Where.
async function changeValue(key, old, next, where) {
  const multi = PICKS.find(p => p.key === key).multi;
  const changed = usersOf(key, old).map(item => {
    const out = [];
    for (const x of list(item[key])) {
      const y = same(x, old) ? next : x;
      if (y && !out.some(o => same(o, y))) out.push(y);
    }
    item[key] = multi ? out : out[0] ?? '';
    if (where !== undefined) item.where = where;
    return { item };
  });
  await DB.saveMany(changed);
  const wasOn = isFiltered(key, old);
  filters[key] = (filters[key] ?? []).filter(f => !same(f, old));
  if (wasOn && next && !isFiltered(key, next)) filters[key].push(next);
  const wasNot = isExcluded(key, old);
  excluded[key] = (excluded[key] ?? []).filter(f => !same(f, old));
  if (wasNot && next && !isExcluded(key, next)) excluded[key].push(next);
  recent = recent.filter(r => !(r.key === key && same(r.v, old)));
  localStorage.setItem('clothes-recent', JSON.stringify(recent));
  $('#valueEdit').close();
  await load();
}

$('#editValues').onclick = () => { editValues = !editValues; renderFilterMenu(); };

function openFilters(places) {
  editValues = places;
  placesOnly = places;
  $('#filterSearch').value = '';
  renderFilterMenu();
  $('#filters').showModal();
  $('#filterPicks').scrollTop = 0;
}
$('#filterBtn').onclick = () => openFilters(false);
$('#placesBtn').onclick = () => { $('#menu').close(); openFilters(true); };
$('#filterSearch').oninput = renderFilterMenu;
$('#filterSearch').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
$('#closeFilters').onclick = () => $('#filters').close();
$('#clearFilters').onclick = clearAll;

// ---------- List ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
}

// ---------- View settings (list / gallery) ----------
const PROPS = [
  ['photo', 'Photo'], ['name', 'Name'], ['price', 'Price'],
  ...PICKS.filter(p => p.key !== 'place').map(p => [p.key, p.key === 'where' ? 'Where › Container' : p.label]),
  ['dateBS', 'Date (BS)'], ['date', 'Date (AD)'],
];
const propsOn = keys => Object.fromEntries(PROPS.map(([k]) => [k, !keys || keys.includes(k)]));
const allOn = () => propsOn();
let view = { mode: 'gallery', cols: 2, list: allOn(), gallery: propsOn(['photo', 'name', 'where']) };
try { Object.assign(view, JSON.parse(localStorage.getItem('clothes-view'))); } catch {}

function saveView() {
  localStorage.setItem('clothes-view', JSON.stringify(view));
  applyView();
  search();
}

function applyView() {
  const gallery = view.mode === 'gallery';
  $('#list').className = gallery ? 'gallery' : '';
  $('#list').style.setProperty('--cols', view.cols);
  for (const b of document.querySelectorAll('.seg button')) {
    b.classList.toggle('active', b.dataset.mode === view.mode);
  }
  $('#colsRow').hidden = !gallery;
  $('#colsLabel').textContent = `${view.cols} column${view.cols > 1 ? 's' : ''}`;
  const on = view[view.mode];
  $('#propList').replaceChildren(...PROPS.map(([key, label]) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" ${on[key] !== false ? 'checked' : ''}> ${label}`;
    l.querySelector('input').onchange = e => { on[key] = e.target.checked; saveView(); };
    return l;
  }));
}

for (const b of document.querySelectorAll('.seg button')) {
  b.onclick = () => { view.mode = b.dataset.mode; saveView(); };
}
$('#colsMinus').onclick = () => { view.cols = Math.max(1, view.cols - 1); saveView(); };
$('#colsPlus').onclick = () => { view.cols = Math.min(5, view.cols + 1); saveView(); };
$('#viewBtn').onclick = () => $('#viewMenu').showModal();
$('#closeView').onclick = () => $('#viewMenu').close();

// Big gallery cards use the full photo so they stay sharp.
const fullUrls = new Map();
async function setFullPhoto(img, item) {
  if (!fullUrls.has(item.id)) {
    const [blob] = await DB.getPhotos(item.id);
    if (!blob) return;
    fullUrls.set(item.id, URL.createObjectURL(blob));
  }
  img.src = fullUrls.get(item.id);
}

function itemHtml(item, on) {
  const show = k => on[k] !== false;
  const line = (...keys) => keys.filter(k => show(k) && text(item[k])).map(k => esc(text(item[k]))).join(' · ');
  const hasPrice = show('price') && item.price !== '' && item.price != null;
  const looks = [hasPrice && `<span class="price">Rs ${esc(item.price)}</span>`,
    line('type', 'color', 'shade', 'position', 'size', 'brand')].filter(Boolean).join(' · ');
  const use = line('season', 'context', 'newness', 'other', 'set');
  const where = show('where') ? [item.where, item.place].filter(Boolean).map(esc).join(' › ') : '';
  const dates = [
    show('dateBS') && esc(formatBS(item.dateBS)),
    show('date') && item.date && (show('dateBS') ? `<small>(${esc(item.date)})</small>` : esc(item.date)),
  ].filter(Boolean);
  return (show('name') ? `<div class="name">${esc(displayName(item))}</div>` : '')
    + (looks ? `<div class="meta">${looks}</div>` : '')
    + (use ? `<div class="meta">${use}</div>` : '')
    + (where ? `<div class="meta">📍 ${where}</div>` : '')
    + (dates.length ? `<div class="meta">${dates.join(' ')}</div>` : '');
}

function renderMore() {
  const gallery = view.mode === 'gallery';
  const on = view[view.mode];
  const frag = document.createDocumentFragment();
  for (const item of results.slice(shown, shown + PAGE)) {
    const el = document.createElement('div');
    el.className = gallery ? 'card' : 'item';
    el.innerHTML = `
      ${on.photo !== false ? `<img ${item.thumb ? `src="${thumbUrl(item)}"` : ''} alt="" loading="lazy">` : ''}
      ${on.photo !== false && item.photoCount > 1 ? `<span class="count-badge">📷 ${item.photoCount}</span>` : ''}
      <div class="info">${itemHtml(item, on)}</div>
      <button class="edit-btn" aria-label="Edit">✎</button>`;
    const img = el.querySelector('img');
    if (img) {
      img.onclick = e => { e.stopPropagation(); viewPhoto(item); };
      if (gallery && view.cols <= 2 && item.thumb) setFullPhoto(img, item);
    }
    el.querySelector('.edit-btn').onclick = e => { e.stopPropagation(); openEditor(item); };
    el.onclick = () => showDetails(item);
    frag.append(el);
  }
  shown += PAGE;
  $('#list').append(frag);
}

new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && shown < results.length) renderMore();
}, { rootMargin: '600px' }).observe($('#sentinel'));

// Read-only card: all photos and every filled-in field, with labels.
let detailsItem = null;
async function showDetails(item) {
  detailsItem = item;
  const rows = [
    ['Price', item.price !== '' && item.price != null ? `Rs ${item.price}` : ''],
    ...PICKS.map(p => [p.label, text(item[p.key])]),
    ['Date bought', item.dateBS ? `${formatBS(item.dateBS)} (${item.date})` : ''],
  ].filter(([, v]) => v);
  $('#detailsInfo').innerHTML = `<div class="name">${esc(displayName(item))}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  showPhotos($('#detailsPhotos'), await DB.getPhotos(item.id));
  $('#details').showModal();
}
$('#detailsPhotos').onclick = () => viewPhoto(detailsItem);
$('#detailsClose').onclick = () => $('#details').close();
$('#details').onclose = () => showPhotos($('#detailsPhotos'), []);
$('#detailsEdit').onclick = () => { $('#details').close(); openEditor(detailsItem); };
$('#detailsDup').onclick = async () => { $('#details').close(); await openEditor(detailsItem); duplicate(); };

// Fills a container with <img>s for the given Blobs (frees the old ones).
function showPhotos(box, blobs) {
  for (const img of box.querySelectorAll('img')) URL.revokeObjectURL(img.src);
  box.replaceChildren(...blobs.map(b => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(b);
    return img;
  }));
}

// Full-screen view of all the item's photos, one below the other.
async function viewPhoto(item) {
  const blobs = await DB.getPhotos(item.id);
  if (!blobs.length) return;
  showPhotos($('#viewerPhotos'), blobs);
  $('#viewer').showModal();
}
$('#viewer').onclick = () => {
  $('#viewer').close();
  showPhotos($('#viewerPhotos'), []);
};

// ---------- Dates (BS) ----------
const BS_MONTHS = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

function today() {
  return new NepaliDate().formatEnglishDate('YYYY-MM-DD');
}

// 'YYYY-MM-DD' AD -> 'YYYY-MM-DD' BS
function adToBS(ad) {
  const [y, m, d] = ad.split('-').map(Number);
  return NepaliDate.fromEnglishDate(y, m - 1, d).format('YYYY-MM-DD');
}

// 'YYYY-MM-DD' BS -> '22 Kartik 2083'
function formatBS(bs) {
  if (!bs) return '';
  const [y, m, d] = bs.split('-').map(Number);
  return `${d} ${BS_MONTHS[m - 1]} ${y}`;
}

function fillOptions(select, values, labels = values) {
  select.replaceChildren(...values.map((v, i) => new Option(labels[i], v)));
}

// Sets the three BS dropdowns to a BS 'YYYY-MM-DD' and refreshes the AD hint.
function setBSPicker(bs) {
  const [y, m, d] = bs.split('-').map(Number);
  const thisYear = new NepaliDate().getYear();
  const years = [];
  for (let i = Math.min(y, thisYear - 10); i <= thisYear + 1; i++) years.push(i);
  fillOptions($('#bsYear'), years);
  fillOptions($('#bsMonth'), BS_MONTHS.map((_, i) => i + 1), BS_MONTHS);
  const days = NepaliDate.getDaysOfMonth(y, m - 1);
  fillOptions($('#bsDay'), Array.from({ length: days }, (_, i) => i + 1));
  $('#bsYear').value = y;
  $('#bsMonth').value = m;
  $('#bsDay').value = Math.min(d, days);
  $('#adDate').textContent = `${formatBS(pickerBS())} · AD ${pickerAD()}`;
}

function pickerBS() {
  const pad = n => String(n).padStart(2, '0');
  return `${$('#bsYear').value}-${pad($('#bsMonth').value)}-${pad($('#bsDay').value)}`;
}

function pickerAD() {
  return new NepaliDate(+$('#bsYear').value, $('#bsMonth').value - 1, +$('#bsDay').value)
    .formatEnglishDate('YYYY-MM-DD');
}

for (const id of ['#bsYear', '#bsMonth', '#bsDay']) {
  $(id).onchange = () => {
    // Keep the day valid when switching to a shorter month.
    const [y, m, d] = pickerBS().split('-').map(Number);
    const max = NepaliDate.getDaysOfMonth(y, m - 1);
    setBSPicker(`${y}-${m}-${Math.min(d, max)}`);
  };
}

// 📅 button: pick an AD date, the BS dropdowns follow.
$('#adPicker').onclick = e => {
  e.target.value = pickerAD();
  try { e.target.showPicker(); } catch {}
};
$('#adPicker').onchange = e => {
  if (!e.target.value) return;
  try { setBSPicker(adToBS(e.target.value)); } catch { alert('That date is out of range'); }
};

function yesterday() {
  const [y, m, d] = today().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}

// None = no date. Today / Yesterday set the date directly; Custom shows the BS dropdowns.
let dayChoice = 'none';
function pickDay(choice) {
  dayChoice = choice;
  if (choice === 'today' || choice === 'none') setBSPicker(adToBS(today()));
  if (choice === 'yesterday') setBSPicker(adToBS(yesterday()));
  if (choice === 'none') $('#adDate').textContent = 'No date';
  $('#customDate').hidden = choice !== 'custom';
  for (const b of document.querySelectorAll('.date-quick button')) {
    b.classList.toggle('active', b.dataset.day === choice);
  }
}

for (const b of document.querySelectorAll('.date-quick button')) {
  b.onclick = () => pickDay(b.dataset.day);
}

// ---------- Pick-lists ----------
let picked = {};  // field key -> chosen values (array)

// Unique values, most used first (case-insensitive, keeps the latest spelling).
function mostUsed(values) {
  const counts = new Map();
  for (const v of values) {
    const key = v?.trim().toLowerCase();
    if (!key) continue;
    const c = counts.get(key) ?? { text: v.trim(), n: 0 };
    c.n++;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map(c => c.text);
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Values to offer: used ones (most used first), then seeds, then anything just typed.
function choices(p) {
  const out = mostUsed(items.flatMap(i => list(i[p.key])));
  for (const v of [...(p.seed ?? []), ...picked[p.key]]) {
    if (!out.some(o => same(o, v))) out.push(v);
  }
  return out;
}

function choose(p, value, on) {
  const rest = picked[p.key].filter(v => !same(v, value));
  picked[p.key] = on ? (p.multi ? [...rest, value] : [value]) : rest;
  renderPick(p);
  // A container sits in one Where, so picking it picks that Where too.
  const home = p.key === 'place' && on && homeOf(value);
  if (home) {
    picked.where = [home];
    renderPick(PICKS.find(x => x.key === 'where'));
  }
}

// The Where a container is in: the one most items in that container use.
const homeOf = place => mostUsed(usersOf('place', place).map(i => i.where))[0] ?? '';

// One row of chips per field. Tap to pick (tap again to unpick).
// Typing in "find / + new" narrows the chips; if the value is new, "+ add" appears.
function renderPick(p) {
  const chips = $(`#pick-${p.key} .chips`);
  const isOn = v => picked[p.key].some(c => same(c, v));
  const values = choices(p);
  const find = document.createElement('input');
  find.className = 'find';
  find.placeholder = 'find / + new';
  find.enterKeyHint = 'done';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add';
  add.hidden = true;
  const buttons = values.map(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = v;
    b.className = isOn(v) ? 'on' : '';
    b.setAttribute('aria-pressed', isOn(v));
    colorPill(b, p.key, v);
    b.onclick = () => choose(p, v, !isOn(v));
    return b;
  });
  // "+ add": pick the value with that exact name, or add it as new.
  const pickTyped = () => {
    const typed = find.value.trim();
    if (typed) choose(p, values.find(v => same(v, typed)) ?? typed, true);
  };
  // Enter: exact name, or the only match, or new if nothing matches.
  // With several matches it waits for more typing.
  const pickBest = () => {
    const typed = find.value.trim();
    const q = typed.toLowerCase();
    const found = values.filter(v => v.toLowerCase().includes(q));
    const pick = values.find(v => same(v, typed)) ?? (found.length === 1 ? found[0] : found.length ? null : typed);
    if (pick) choose(p, pick, true);
  };
  find.oninput = () => {
    const typed = find.value.trim();
    const q = typed.toLowerCase();
    buttons.forEach((b, i) => { b.hidden = !!q && !isOn(values[i]) && !values[i].toLowerCase().includes(q); });
    add.hidden = !q || values.some(v => same(v, typed));
    add.textContent = `+ add "${typed}"`;
  };
  find.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (find.value.trim()) pickBest(); else find.blur();
  };
  add.onclick = pickTyped;
  chips.replaceChildren(find, ...buttons, add);
}

// ---------- Master tag search ----------
// One box above the fields that searches values from every field (a field
// name shows all its values). Tapping a chip picks/unpicks it in its field,
// clears the box and keeps the keyboard open. A new value asks which field.
let tagAdding = false;  // showing "add to which field?" for the typed text

function tagMatches(q) {
  const found = PICKS.flatMap(p => {
    const whole = p.label.toLowerCase().includes(q);
    return choices(p).filter(v => whole || v.toLowerCase().includes(q)).map(v => ({ p, v }));
  });
  const starts = m => m.v.toLowerCase().startsWith(q) ? 0 : 1;
  return found.sort((a, b) => starts(a) - starts(b));
}

// Buttons here don't take focus, so the keyboard stays open.
function tagButton(html, onTap) {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = html;
  b.onmousedown = e => e.preventDefault();
  b.onclick = onTap;
  return b;
}

function tagDone() {
  $('#tagSearch').value = '';
  tagAdding = false;
  renderTags();
}

function renderTags() {
  const typed = $('#tagSearch').value.trim();
  const q = typed.toLowerCase();
  if (!q) return $('#tagResults').replaceChildren();
  if (tagAdding) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = `Add "${typed}" to which field?`;
    const fields = PICKS.map(p => tagButton(esc(p.label), () => { choose(p, typed, true); tagDone(); }));
    const back = tagButton('Cancel', () => { tagAdding = false; renderTags(); });
    return $('#tagResults').replaceChildren(hint, ...fields, back);
  }
  const chips = tagMatches(q).map(({ p, v }) => {
    const on = picked[p.key].some(c => same(c, v));
    const b = tagButton(`${esc(v)} <small>${esc(p.label.toLowerCase())}</small>`, () => { choose(p, v, !on); tagDone(); });
    b.className = on ? 'on' : '';
    b.setAttribute('aria-pressed', on);
    colorPill(b, p.key, v);
    return b;
  });
  const exact = PICKS.some(p => choices(p).some(v => same(v, typed)));
  if (!exact) {
    const add = tagButton(`+ add "${esc(typed)}" to…`, () => { tagAdding = true; renderTags(); });
    add.className = 'add';
    chips.push(add);
  }
  $('#tagResults').replaceChildren(...chips);
}

$('#tagSearch').oninput = () => { tagAdding = false; renderTags(); };
// Enter: the only match (or the only exact one) is picked; otherwise wait.
$('#tagSearch').onkeydown = e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const typed = $('#tagSearch').value.trim();
  if (!typed) return $('#tagSearch').blur();
  const found = tagMatches(typed.toLowerCase());
  const exact = found.filter(m => same(m.v, typed));
  const pick = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null;
  if (pick) { choose(pick.p, pick.v, true); tagDone(); }
  else if (!found.length) { tagAdding = true; renderTags(); }
};

$('#picks').replaceChildren(...PICKS.map(p => {
  const el = document.createElement('div');
  el.className = 'pick';
  el.id = `pick-${p.key}`;
  el.innerHTML = `<div class="label">${p.label}${p.multi ? ' (one or more)' : ''}</div><div class="chips"></div>`;
  return el;
}));

// ---------- Editor ----------

// Editor photo row: ★ makes a photo the cover (first), × removes it,
// ↻ turns it 90° (only previewed here; the photo is redrawn once on Save),
// ✂ opens the crop screen.
function renderStrip() {
  $('#photoHint').hidden = editPhotos.length > 0;
  $('#photoStrip').replaceChildren(...editPhotos.map((p, i) => {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.innerHTML = `<img src="${p.url}" alt="" style="transform: rotate(${(p.turns ?? 0) * 90}deg)">
      <button type="button" class="cover" aria-label="Make cover">★</button>
      <button type="button" class="del" aria-label="Remove">×</button>
      <button type="button" class="turn" aria-label="Rotate">↻</button>
      <button type="button" class="crop" aria-label="Crop">✂</button>`;
    el.querySelector('.crop').onclick = () => openCrop(p);
    el.querySelector('.turn').onclick = () => {
      p.turns = ((p.turns ?? 0) + 1) % 4;
      photosChanged = true;
      renderStrip();
    };
    el.querySelector('.cover').onclick = () => {
      editPhotos.unshift(...editPhotos.splice(i, 1));
      photosChanged = true;
      renderStrip();
    };
    el.querySelector('.del').onclick = () => {
      URL.revokeObjectURL(p.url);
      editPhotos.splice(i, 1);
      photosChanged = true;
      renderStrip();
    };
    return el;
  }));
}

function clearStrip() {
  for (const p of editPhotos) URL.revokeObjectURL(p.url);
  editPhotos = [];
  photosChanged = false;
  renderStrip();
}

async function openEditor(item) {
  editing = item;
  clearStrip();
  const f = $('#form');
  f.reset();
  f.title.value = item?.name ?? '';
  f.price.value = item?.price ?? '';
  for (const p of PICKS) {
    picked[p.key] = [...list(item?.[p.key])];
    renderPick(p);
  }
  tagDone();
  const bs = item?.dateBS;
  if (bs) setBSPicker(bs);
  pickDay(!bs ? 'none' : bs === adToBS(today()) ? 'today' : bs === adToBS(yesterday()) ? 'yesterday' : 'custom');
  $('#deleteBtn').hidden = !item;
  $('#dupBtn').hidden = !item;
  $('#copyHint').hidden = true;
  $('#editor').showModal();
  $('#editor').scrollTop = 0;
  if (item) {
    const saved = (await DB.getPhotos(item.id)).map(full => ({ full, url: URL.createObjectURL(full) }));
    if (saved[0]) saved[0].thumb = item.thumb;
    editPhotos = [...saved, ...editPhotos];
    renderStrip();
  }
}

// Adds a photo to the editor (Camera, Upload, or Paste).
async function usePhoto(file) {
  $('#photoHint').hidden = false;
  $('#photoHint').textContent = 'Compressing…';
  try {
    const [full, thumb] = await Promise.all([resize(file, 1280, 0.75), resize(file, 240, 0.7)]);
    editPhotos.push({ full, thumb, url: URL.createObjectURL(thumb) });
    photosChanged = true;
  } catch {
    alert('Could not read that image');
  }
  $('#photoHint').textContent = 'No photo';
  renderStrip();
}

for (const id of ['#cameraInput', '#uploadInput']) {
  $(id).onchange = e => {
    if (e.target.files[0]) usePhoto(e.target.files[0]);
    e.target.value = '';
  };
}

// Paste button (if the browser can read images from the clipboard).
if (navigator.clipboard?.read) {
  $('#pasteBtn').onclick = async () => {
    try {
      for (const entry of await navigator.clipboard.read()) {
        const type = entry.types.find(t => t.startsWith('image/'));
        if (type) return usePhoto(await entry.getType(type));
      }
      alert('No image in clipboard');
    } catch {
      alert('Could not paste. Allow clipboard access and try again.');
    }
  };
} else {
  $('#pasteBtn').hidden = true;
}

// Ctrl+V / long-press paste while the editor is open.
document.addEventListener('paste', e => {
  if (!$('#editor').open) return;
  const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
  if (file) { e.preventDefault(); usePhoto(file); }
});

$('#form').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const noDate = dayChoice === 'none';
  const item = {
    id: editing?.id ?? crypto.randomUUID(),
    created: editing?.created ?? Date.now(),
    name: f.title.value.trim(),
    price: f.price.value === '' ? '' : Number(f.price.value),
    ...Object.fromEntries(PICKS.map(p => [p.key, p.multi ? picked[p.key] : picked[p.key][0] ?? ''])),
    date: noDate ? '' : pickerAD(),
    dateBS: noDate ? '' : pickerBS(),
    thumb: editing?.thumb ?? null,
    photoCount: editing?.photoCount ?? (editing?.thumb ? 1 : 0),
  };
  if (photosChanged) {
    for (const p of editPhotos) {
      if (!p.turns) continue;
      p.full = await editPhoto(p.full, p.turns);
      p.thumb = null;
      p.turns = 0;
    }
    const cover = editPhotos[0];
    item.thumb = cover ? cover.thumb ?? await resize(cover.full, 240, 0.7) : null;
    item.photoCount = editPhotos.length;
  }
  await DB.save(item, photosChanged ? editPhotos.map(p => p.full) : undefined);
  thumbUrls.delete(item.id);
  fullUrls.delete(item.id);
  $('#editor').close();
  await load();
};

// Turns the open editor into a new item with the same photos and fields
// (whatever is on screen). The original stays as it was; Save adds the copy.
function duplicate() {
  const from = editing;
  editing = null;
  photosChanged = true;
  $('#deleteBtn').hidden = true;
  $('#dupBtn').hidden = true;
  $('#copyHint').textContent = `Copy of "${displayName(from)}". Change what you need, then Save to add it.`;
  $('#copyHint').hidden = false;
  $('#editor').scrollTop = 0;
}
$('#dupBtn').onclick = duplicate;

$('#editor').onclose = clearStrip;
$('#cancelBtn').onclick = () => $('#editor').close();

// ---------- Crop ----------
// The box is kept as fractions (0–1) of the shown photo, so it doesn't
// depend on screen size.
let cropPhoto = null;
let cropBox = null;
const FULL_BOX = { x: 0, y: 0, w: 1, h: 1 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function drawCropBox() {
  const s = $('#cropBox').style;
  s.left = cropBox.x * 100 + '%';
  s.top = cropBox.y * 100 + '%';
  s.width = cropBox.w * 100 + '%';
  s.height = cropBox.h * 100 + '%';
}

async function openCrop(p) {
  cropPhoto = p;
  const bmp = await createImageBitmap(p.full);
  const src = turnedCanvas(bmp, p.turns ?? 0);
  bmp.close();
  const c = $('#cropCanvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  cropBox = { ...FULL_BOX };
  drawCropBox();
  $('#cropper').showModal();
  // Fit the photo inside the dialog and 70% of the screen height.
  const scale = Math.min(1, ($('#cropper').clientWidth - 28) / c.width, innerHeight * 0.7 / c.height);
  c.style.width = c.width * scale + 'px';
  c.style.height = c.height * scale + 'px';
}

// Drag a corner to resize, drag inside the box to move it.
$('#cropArea').onpointerdown = e => {
  const mode = e.target.dataset.h ?? (e.target.id === 'cropBox' ? 'move' : null);
  if (!mode) return;
  e.preventDefault();
  const rect = $('#cropCanvas').getBoundingClientRect();
  const start = { ...cropBox };
  const MIN = 0.05;
  const move = ev => {
    const dx = (ev.clientX - e.clientX) / rect.width;
    const dy = (ev.clientY - e.clientY) / rect.height;
    let { x, y, w, h } = start;
    if (mode === 'move') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      if (mode.includes('l')) { const nx = clamp(x + dx, 0, x + w - MIN); w += x - nx; x = nx; }
      if (mode.includes('r')) w = clamp(w + dx, MIN, 1 - x);
      if (mode.includes('t')) { const ny = clamp(y + dy, 0, y + h - MIN); h += y - ny; y = ny; }
      if (mode.includes('b')) h = clamp(h + dy, MIN, 1 - y);
    }
    cropBox = { x, y, w, h };
    drawCropBox();
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
};

$('#cropReset').onclick = () => { cropBox = { ...FULL_BOX }; drawCropBox(); };
$('#cropCancel').onclick = () => $('#cropper').close();

// Done: rotation and crop are saved into the photo as one new JPEG.
$('#cropDone').onclick = async () => {
  const p = cropPhoto;
  const b = cropBox;
  if (b.x > 0 || b.y > 0 || b.w < 1 || b.h < 1) {
    p.full = await editPhoto(p.full, p.turns ?? 0, b);
    p.turns = 0;
    p.thumb = null;
    URL.revokeObjectURL(p.url);
    p.url = URL.createObjectURL(p.full);
    photosChanged = true;
    renderStrip();
  }
  $('#cropper').close();
};

$('#deleteBtn').onclick = async () => {
  if (!confirm(`Delete "${displayName(editing)}"?`)) return;
  await DB.remove(editing.id);
  $('#editor').close();
  await load();
};

// ---------- Backup ----------
$('#menuBtn').onclick = () => $('#menu').showModal();
$('#closeMenu').onclick = () => $('#menu').close();

$('#exportBtn').onclick = async () => {
  $('#exportBtn').textContent = 'Exporting…';
  const files = [];
  const data = [];
  for (const { thumb, ...rest } of items) {
    data.push(rest);
    (await DB.getPhotos(rest.id)).forEach((data, i) =>
      files.push({ name: `photos/${rest.id}${i ? `-${i + 1}` : ''}.jpg`, data }));
  }
  files.unshift({ name: 'items.json', data: new Blob([JSON.stringify(data, null, 1)]) });
  const zip = await Zip.create(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = `clothes-backup-${today()}.zip`;
  a.click();
  $('#exportBtn').textContent = 'Export backup (.zip)';
};

$('#importFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  const importLabel = $('#importLabel');
  importLabel.textContent = 'Reading backup…';
  try {
    const entries = await Zip.read(file);
    const data = JSON.parse(await entries.get('items.json').text());
    if (!confirm(`Import ${data.length} items? Items with the same ID will be replaced.`)) {
      importLabel.textContent = 'Import backup';
      e.target.value = '';
      return;
    }
    // 50 items per save, thumbnails made 8 at a time (the browser decodes and
    // encodes on other threads, so doing one at a time wastes them).
    for (let start = 0; start < data.length; start += 50) {
      const chunk = data.slice(start, start + 50);
      const batch = await mapLimit(chunk, 8, async item => {
        // Photos: <id>.jpg (cover), then <id>-2.jpg, <id>-3.jpg, ...
        const photos = [];
        for (let n = 1; ; n++) {
          const blob = entries.get(`photos/${item.id}${n > 1 ? `-${n}` : ''}.jpg`);
          if (!blob) break;
          photos.push(new Blob([blob], { type: 'image/jpeg' }));
        }
        item.thumb = photos[0] ? await resize(photos[0], 240, 0.7) : null;
        item.photoCount = photos.length;
        return { item, photos };
      });
      await DB.saveMany(batch);
      importLabel.textContent = `Importing ${Math.min(start + 50, data.length)} / ${data.length}…`;
      await new Promise(r => setTimeout(r, 0));
    }
    alert('Import done');
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
  importLabel.textContent = 'Import backup';
  e.target.value = '';
  $('#menu').close();
  await load();
};

// ---------- Toast (a bar at the bottom with one action) ----------
let toastTimer;
function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}
// ms = 0 keeps it until the button is tapped.
function toast(text, label, action, ms = 8000) {
  clearTimeout(toastTimer);
  $('#toastText').textContent = text;
  $('#toastBtn').textContent = label;
  $('#toastBtn').onclick = () => { hideToast(); action(); };
  $('#toast').hidden = false;
  if (ms) toastTimer = setTimeout(hideToast, ms);
}

// ---------- Start ----------
async function load() {
  items = await DB.allItems();
  items.sort((a, b) => b.created - a.created);
  renderFilters();
  search();
}

$('#search').oninput = () => { search(); renderFilters(); };
$('#addBtn').onclick = () => openEditor(null);
applyView();
load();

if ('serviceWorker' in navigator) {
  // A new version takes over in the background; offer a reload to start using it.
  const hadWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadWorker) toast('A new version is ready', 'Reload', () => location.reload(), 0);
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
  });
}
navigator.storage?.persist?.();
