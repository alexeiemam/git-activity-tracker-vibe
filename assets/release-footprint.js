/**
 * Codebase footprint: where a release's changes landed, down to individual
 * files near the top of the tree and folders up to five levels deep. A single
 * map is built from the whole history so every release is drawn on the same
 * cells and footprints are comparable. Footprints describe location and
 * spread, never the value of a change.
 */
export const FOOTPRINT_DEPTH = 5;
const MAX_CELLS = 80;
/** "Focused" is judged on two-level folders, so file-level cells don't change what it means. */
const FOCUS_DEPTH = 2;

/**
 * A path's map cell: the file itself when the path has at most `depth`
 * segments (`app/models/user.rb`, `README.md`), otherwise the folder `depth`
 * levels deep that holds it (`a/b/c/d/e/`).
 */
export function footprintArea(path, depth = FOOTPRINT_DEPTH) {
  const parts = String(path || '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (!parts.length) return '(root)';
  return parts.length <= depth ? parts.join('/') : `${parts.slice(0, depth).join('/')}/`;
}
/** The folder up to `depth` levels deep that holds a path; root files are `(root)`. */
export function folderArea(path, depth) {
  const dirs = String(path || '').replace(/^\/+/, '').split('/').slice(0, -1).filter(Boolean);
  return dirs.length ? `${dirs.slice(0, depth).join('/')}/` : '(root)';
}
/** Top-level folder of a cell; files and cells at the root belong to `(root)`. */
export const topOf = area => area.includes('/') ? `${area.split('/')[0]}/` : '(root)';

/** The block holding top-level folders that have none of the busiest cells. */
export const OTHER_FOLDERS = 'other folders';

/**
 * Cells for the busiest areas across all history (by file touches), grouped
 * by top-level directory. Quieter areas fold into one "… other" cell per
 * top-level directory, and top-level directories without any of the busiest
 * cells share a single "other folders" block, so the map stays legible in
 * large repositories.
 */
export function buildCodebaseMap(commits, {maxCells = MAX_CELLS} = {}) {
  const totals = new Map();
  for (const commit of commits) for (const file of commit.files || []) {
    const area = footprintArea(file.path);
    const row = totals.get(area) || {touches:0, lines:0};
    row.touches++;row.lines += (file.added || 0) + (file.deleted || 0);
    totals.set(area, row);
  }
  const ranked = [...totals].sort((a, b) => b[1].touches - a[1].touches || a[0].localeCompare(b[0]));
  const kept = new Set(ranked.slice(0, maxCells).map(([area]) => area));
  const keptTops = new Set([...kept].map(topOf));
  const cells = new Map(), cellOf = new Map();
  for (const [area, row] of ranked) {
    const top = keptTops.has(topOf(area)) ? topOf(area) : OTHER_FOLDERS;
    const key = kept.has(area) ? area : `${top}…`;
    const cell = cells.get(key) || {key, top, label:kept.has(area) ? area : top === OTHER_FOLDERS ? 'quieter top-level folders' : `${top} … other`, touches:0, lines:0, areas:0};
    cell.touches += row.touches;cell.lines += row.lines;cell.areas++;
    cells.set(key, cell);cellOf.set(area, key);
  }
  const groups = new Map();
  for (const cell of cells.values()) {
    const group = groups.get(cell.top) || {top:cell.top, touches:0, cells:[]};
    group.touches += cell.touches;group.cells.push(cell);
    groups.set(cell.top, group);
  }
  const ordered = [...groups.values()].sort((a, b) => b.touches - a.touches || a.top.localeCompare(b.top));
  const isOther = cell => cell.key.endsWith('…');
  // Named folders first, the shared block of quieter folders last.
  ordered.sort((a, b) => (a.top === OTHER_FOLDERS) - (b.top === OTHER_FOLDERS));
  for (const group of ordered) group.cells.sort((a, b) => isOther(a) - isOther(b) || b.touches - a.touches || a.key.localeCompare(b.key));
  return {groups:ordered, keys:ordered.flatMap(g => g.cells.map(c => c.key)), cellOf};
}

/** A release's touches and lines per map cell, plus summary measures of spread. */
export function releaseFootprint(commits, map) {
  const files = new Map(), lines = new Map(), folders = new Map(), tops = new Set();
  let touches = 0, changed = 0;
  for (const commit of commits) for (const file of commit.files || []) {
    const area = footprintArea(file.path), key = map.cellOf.get(area);
    if (!key) continue;
    const size = (file.added || 0) + (file.deleted || 0);
    files.set(key, (files.get(key) || 0) + 1);lines.set(key, (lines.get(key) || 0) + size);
    const folder = folderArea(file.path, FOCUS_DEPTH);folders.set(folder, (folders.get(folder) || 0) + 1);
    tops.add(topOf(area));touches++;changed += size;
  }
  const share = (values, total) => map.keys.map(key => total ? (values.get(key) || 0) / total : 0);
  const fileShares = share(files, touches);
  const top2 = [...folders.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0) / (touches || 1);
  return {
    touches, lines:changed, cells:files.size, topLevels:tops.size, top2Share:touches ? top2 : null,
    linesPerTouch:touches ? changed / touches : null,
    files:map.keys.map(key => files.get(key) || 0), lineCounts:map.keys.map(key => lines.get(key) || 0),
    shares:{files:fileShares, lines:share(lines, changed)},
  };
}

/**
 * All incremental releases together: pooled cell shares (each release counts
 * in proportion to its size) and aggregate spread used to classify shapes.
 */
export function typicalFootprint(footprints) {
  const measured = footprints.filter(f => f?.touches > 0);
  const sum = (kind, i) => measured.reduce((n, f) => n + f[kind][i], 0);
  const pooled = kind => {
    const totals = measured.length ? measured[0][kind].map((_, i) => sum(kind, i)) : [];
    const all = totals.reduce((a, b) => a + b, 0);
    return totals.map(v => all ? v / all : 0);
  };
  const touches = measured.reduce((n, f) => n + f.touches, 0), lines = measured.reduce((n, f) => n + f.lines, 0);
  return {
    releases:measured.length, shares:{files:pooled('files'), lines:pooled('lineCounts')},
    touches:measured.length ? touches / measured.length : null,
    topLevels:measured.length ? measured.reduce((n, f) => n + f.topLevels, 0) / measured.length : null,
    linesPerTouch:touches ? lines / touches : null,
  };
}

export const FOOTPRINT_SHAPES = Object.freeze([
  {key:'focused', label:'Focused'},
  {key:'spread', label:'Spread'},
  {key:'cross-cutting', label:'Cross-cutting'},
  {key:'broad-sweep', label:'Broad sweep'},
  {key:'initial', label:'Initial history'},
  {key:'unmeasured', label:'Unmeasured'},
]);
const MINIMUM_RELEASES = 5;
/** Without enough releases to compare, use fixed reference values. */
const FIXED = Object.freeze({touches:20, topLevels:2, linesPerTouch:20, relative:false});
export function footprintReference(typical) {
  if (!typical || typical.releases < MINIMUM_RELEASES) return {...FIXED};
  return {touches:typical.touches, topLevels:typical.topLevels, linesPerTouch:typical.linesPerTouch, relative:true};
}

/**
 * Broad sweep: many more files than usual with far fewer lines each (often
 * renames, reformatting or dependency bumps). Cross-cutting: more top-level
 * directories than usual. Focused: two cells hold three quarters of the
 * touches. Otherwise the change is spread within its usual reach.
 */
export function footprintShape(fp, {baseline = false, reference = FIXED} = {}) {
  if (baseline) return 'initial';
  if (!fp?.touches) return 'unmeasured';
  if (fp.touches >= 2 * reference.touches && fp.linesPerTouch <= reference.linesPerTouch / 2) return 'broad-sweep';
  if (fp.topLevels >= Math.max(3, Math.ceil(1.5 * reference.topLevels))) return 'cross-cutting';
  if (fp.top2Share >= .75) return 'focused';
  return 'spread';
}

export function footprintNote(key, reference = FIXED) {
  const basis = reference.relative ? 'the average release' : 'fixed thresholds (fewer than five releases to compare)';
  const n = v => Math.round(v * 10) / 10;
  return {
    focused:'Three quarters of file touches in one or two two-level folders',
    spread:`Changes across several areas, within the reach of ${basis}`,
    'cross-cutting':`Touches ${Math.max(3, Math.ceil(1.5 * reference.topLevels))}+ top-level directories, compared with ${n(reference.topLevels)} for ${basis}`,
    'broad-sweep':`${n(2 * reference.touches)}+ file touches at under ${n(reference.linesPerTouch / 2)} lines each (twice the files and half the lines per file of ${basis}), often renames or reformatting`,
    initial:'First tag: ships everything authored before it',
    unmeasured:'No file changes in the imported history',
  }[key] || '';
}

/** Cosine similarity of two share vectors (1 = same footprint, 0 = no overlap). */
export function footprintSimilarity(a, b) {
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) {dot += a[i] * b[i];x += a[i] * a[i];y += b[i] * b[i];}
  return x && y ? dot / Math.sqrt(x * y) : 0;
}

/** The most similar other releases, most similar first. */
export function similarReleases(hash, footprints, {weight = 'files', limit = 4, minimum = .5} = {}) {
  const own = footprints.get(hash);
  if (!own?.touches) return [];
  return [...footprints].filter(([other, fp]) => other !== hash && fp.touches && !fp.baseline)
    .map(([other, fp]) => ({hash:other, similarity:footprintSimilarity(own.shares[weight], fp.shares[weight])}))
    .filter(x => x.similarity >= minimum)
    .sort((a, b) => b.similarity - a.similarity || a.hash.localeCompare(b.hash)).slice(0, limit);
}
