import {
  aggregate,
  longestConsecutiveWorkdays,
  longestStreak,
  parseGitLog,
  sum,
} from './domain.js';

import { generateDemoLog } from './demo-data.js';

let rawCommits = [],
  mergeGroups = [],
  parsedData = null;

let penaliseReverts = false; // default: off
let commitsByDate = {}; // date string → array of raw commit objects
let includeMerges = false; // default: exclude merge commits
let currentMetric = 'commits',
  activeYear = 'all',
  activeCompTab = 'timeline';

let hiddenSeries = new Set();
let expandedCommitDayHeatmaps = new Set();
const COLORS = [
  '#c0392b', '#2980b9', '#16a085', '#8e44ad', '#d35400',
  '#27ae60', '#1a6b8a', '#b07d12', '#5d2e8c', '#c0586a'
];

// ── Sidebar pins (persisted) ────────────────────────────────────
const PIN_STORAGE_KEY = 'git_activity_pins_v1';
// store contributor group ids (gi) in a Set
let pinnedContributors = new Set();

function loadPinnedContributors() {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(x => +x).filter(x => Number.isFinite(x)));
  } catch {
    return new Set();
  }
}

function toggleCommitDayHeatmap(gi) {
  gi = +gi;
  if (!Number.isFinite(gi)) return;

  if (expandedCommitDayHeatmaps.has(gi)) expandedCommitDayHeatmaps.delete(gi);
  else expandedCommitDayHeatmaps.add(gi);

  render(); // re-render heatmaps with the new year span
}

function savePinnedContributors() {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...pinnedContributors]));
  } catch {}
}

function updateCmd() {
  const y = +document.getElementById('range-select').value;
  const noMergesFlag = document.getElementById('include-merges').checked ? '' : ' --no-merges';
  document.getElementById('git-cmd').textContent =
    `git log --since="${y * 12} months ago"${noMergesFlag} --pretty=format:"COMMIT|%H|%ae|%an|%aI|%s" --numstat | pbcopy`;
}

function onMergeToggle() {
  includeMerges = document.getElementById('include-merges').checked;
  updateCmd();
  if (!parsedData) return; // dashboard not yet rendered, nothing to do
  // Re-aggregate with updated filter and re-render in place
  const groups = mergeGroups.filter(g => g.emails.length > 0);
  parsedData = aggregate(rawCommits, groups, { includeMerges, penaliseReverts, colorCount: COLORS.length });
  activeYear = 'all';
  hiddenSeries = new Set();
  render();
}

// Toggle handler: add next to onMergeToggle()
function onRevertToggle() {
  if (!parsedData) {
    penaliseReverts = document.getElementById('penalise-reverts').checked;
    return;
  }
  penaliseReverts = document.getElementById('penalise-reverts').checked;
  const groups = mergeGroups.filter(g => g.emails.length > 0);
  parsedData = aggregate(rawCommits, groups, { includeMerges, penaliseReverts, colorCount: COLORS.length });
  activeYear = 'all';
  hiddenSeries = new Set();
  render();
}

function copyCmd() {
  navigator.clipboard.writeText(document.getElementById('git-cmd').textContent).then(() => {
    const b = document.querySelector('.cmd-copy');
    b.textContent = 'copied!';
    setTimeout(() => b.textContent = 'copy', 1500);
  });
}

function parseStep() {
  const raw = document.getElementById('log-input').value.trim();
  const err = document.getElementById('parse-error');
  err.textContent = '';
  if (!raw) {
    err.textContent = 'Paste git log output first.';
    return;
  }
  try {
    rawCommits = parseGitLog(raw);

    // capture current toggle state when parsing
    includeMerges = document.getElementById('include-merges').checked;
    penaliseReverts = document.getElementById('penalise-reverts').checked;

    // Build date → commits lookup for rich tooltip (always include all for tooltip display)
    commitsByDate = {};
    for (const c of rawCommits) {
      if (c.date) {
        if (!commitsByDate[c.date]) commitsByDate[c.date] = [];
        commitsByDate[c.date].push(c);
      }
    }

    buildInitialGroups();
    document.getElementById('merge-step').hidden = false;
    document.getElementById('dashboard').hidden = true;
    document.getElementById('merge-step').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  } catch (e) {
    err.textContent = e.message;
  }
}

function buildInitialGroups() {
  const byEmail = {};
  for (const c of rawCommits) {
    if (!byEmail[c.email]) byEmail[c.email] = {
      email: c.email,
      names: []
    };
    if (!byEmail[c.email].names.includes(c.name)) byEmail[c.email].names.push(c.name);
  }

  const ids = Object.values(byEmail).map(i => ({
    email: i.email,
    name: i.names.sort((a, b) => b.length - a.length)[0]
  }));

  const byName = {};
  ids.forEach(id => {
    const k = id.name.toLowerCase().trim();
    if (!byName[k]) byName[k] = [];
    byName[k].push(id);
  });

  mergeGroups = [];
  const placed = new Set();
  Object.entries(byName).forEach(([, grp]) => {
    if (grp.length > 1) {
      mergeGroups.push({
        displayName: grp[0].name,
        emails: grp.map(g => g.email),
        suggested: true
      });
      grp.forEach(g => placed.add(g.email));
    }
  });

  ids.filter(i => !placed.has(i.email)).forEach(i => mergeGroups.push({
    displayName: i.name,
    emails: [i.email],
    suggested: false
  }));

  renderMergeUI();
}

function emailsNotInGroup(gi) {
  return mergeGroups.flatMap((g, i) => i === gi ? [] : g.emails.map(e => ({
    email: e,
    fromGroup: i,
    fromName: g.displayName
  })));
}

function renderMergeUI() {
  const c = document.getElementById('merge-groups');
  c.innerHTML = '';
  mergeGroups.forEach((g, gi) => {
    const avail = emailsNotInGroup(gi);
    const div = document.createElement('div');

    div.className =
      'merge-group flex flex-wrap items-start gap-4 border border-border bg-surface px-4 py-3.5';

    div.innerHTML =
      `<div class="mg-name-col min-w-[200px] flex-shrink-0">
      <div class="merge-group-label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">
        Display name${g.suggested ? '<span class="suggestion-badge ml-2 inline-block rounded-full border border-mergeborder bg-[#e0c84a22] px-2 py-[2px] font-mono text-[0.58rem] text-[#7a5c00]">auto</span>' : ''}
      </div>
      <input class="mg-name-input w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-[0.78rem] text-ink outline-none focus:border-accent"
             type="text" value="${esc(g.displayName)}"
             data-merge-name-index="${gi}"/>
    </div>

    <div class="mg-emails-col min-w-[260px] flex-1">
      <div class="merge-group-label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Emails (${g.emails.length})</div>

      <div class="identity-chips mb-2 flex min-h-[28px] flex-wrap gap-1.5">
        ${g.emails.map(e => `<span class="identity-chip inline-flex items-center gap-1.5 rounded-[2px] border border-border bg-bg px-2 py-1 font-mono text-[0.65rem]">
          <span>${esc(e)}</span>
          ${g.emails.length > 1 ? `<button type="button" class="chip-remove border-0 bg-transparent p-0 text-[0.8rem] leading-none text-muted transition hover:text-accent" data-action="split-out" data-group-index="${gi}" data-email="${esc(e)}" aria-label="Split ${esc(e)} into a separate contributor">✕</button>` : ''}
        </span>`).join('')}
      </div>

      <div class="merge-add-row flex items-center gap-2">
        <select class="merge-add-select flex-1 min-w-[160px] max-w-[300px] border border-border bg-bg px-2 py-1.5 font-mono text-[0.7rem] text-ink outline-none focus:border-accent" id="sel-${gi}">
          <option value="">+ merge another email…</option>
          ${avail.map(a => `<option value="${esc(a.email)}">${esc(a.email)} (from: ${esc(a.fromName)})</option>`).join('')}
        </select>
        <button type="button" class="btn-small inline-flex items-center gap-2 whitespace-nowrap border border-border bg-transparent px-3 py-1.5 font-mono text-[0.65rem] text-muted transition hover:border-ink hover:text-ink" data-action="merge-into" data-group-index="${gi}">Merge</button>
      </div>
    </div>

    <div class="mg-actions-col flex items-start pt-5">
      ${g.emails.length > 1 ? `<button type="button" class="btn-small danger inline-flex items-center gap-2 whitespace-nowrap border border-border bg-transparent px-3 py-1.5 font-mono text-[0.65rem] text-muted transition hover:border-accent hover:text-accent" data-action="split-all" data-group-index="${gi}">Split all</button>` : ''}
    </div>`;

    c.appendChild(div);
  });
}

function splitOut(gi, email) {
  mergeGroups[gi].emails = mergeGroups[gi].emails.filter(e => e !== email);
  if (!mergeGroups[gi].emails.length) mergeGroups.splice(gi, 1);
  mergeGroups.push({
    displayName: email,
    emails: [email],
    suggested: false
  });
  renderMergeUI();
}

function splitAll(gi) {
  const e = mergeGroups[gi].emails;
  mergeGroups.splice(gi, 1);
  e.forEach(em => mergeGroups.push({
    displayName: em,
    emails: [em],
    suggested: false
  }));
  renderMergeUI();
}

function mergeInto(gi) {
  const sel = document.getElementById(`sel-${gi}`);
  const email = sel.value;
  if (!email) return;

  const tg = mergeGroups[gi];
  mergeGroups.forEach(g => {
    g.emails = g.emails.filter(e => e !== email);
  });

  for (let i = mergeGroups.length - 1; i >= 0; i--) {
    if (mergeGroups[i] !== tg && mergeGroups[i].emails.length === 0) mergeGroups.splice(i, 1);
  }

  tg.emails.push(email);
  renderMergeUI();
}

function addEmptyGroup() {
  mergeGroups.push({
    displayName: 'New contributor',
    emails: [],
    suggested: false
  });
  renderMergeUI();
}

function skipMerge() {
  const ae = [...new Set(rawCommits.map(c => c.email))];
  const be = {};
  rawCommits.forEach(c => {
    if (!be[c.email]) be[c.email] = c.name;
  });
  mergeGroups = ae.map(e => ({
    displayName: be[e] || e,
    emails: [e]
  }));
  applyAndRender();
}

function applyAndRender() {
  includeMerges = document.getElementById('include-merges').checked;
  penaliseReverts = document.getElementById('penalise-reverts').checked;

  const groups = mergeGroups.filter(g => g.emails.length > 0);
  parsedData = aggregate(rawCommits, groups, { includeMerges, penaliseReverts, colorCount: COLORS.length });
  activeYear = 'all';
  hiddenSeries = new Set();

  document.getElementById('merge-step').hidden = true;
  document.getElementById('dashboard').hidden = false;
  document.getElementById('export-btn').hidden = false;

  pinnedContributors = loadPinnedContributors();
  mountStickyDock();

  render();

  document.getElementById('dashboard').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

// aggregate(): includes merge filter, revert penalties, and Releases metric
function yrSum(map) {
  if (activeYear === 'all') return sum(map);
  const p = String(activeYear);
  return Object.entries(map || {}).filter(([d]) => d.startsWith(p)).reduce((a, [, v]) => a + v, 0);
}

function metricLabel(key) {
  const labels = {
    commits: 'Commits',
    lines_added: 'Lines Added',
    lines_deleted: 'Lines Deleted',
    files: 'Files Changed',
    active_days: 'Active Days',
    releases: 'Releases',
  };
  return labels[key] || key;
}

function metricValueForContributor(c, key) {
  if (!c) return 0;

  if (key === 'active_days') {
    if (activeYear === 'all') return c.totalActiveDays || 0;
    const p = String(activeYear);
    return [...(c.activeDays || [])].filter(d => d.startsWith(p)).length;
  }

  // maps are stored by day: c.commits, c.lines_added, c.files, c.releases, etc
  return yrSum(c[key] || {});
}

function render() {
  const {
    committers,
    minDate,
    maxDate
  } = parsedData;

  mountStickyDock();
  syncStickyTogglesFromMain();
  const minY = +minDate.slice(0, 4),
    maxY = +maxDate.slice(0, 4);
  const years = [];
  for (let y = minY; y <= maxY; y++) years.push(y);

  const tc = committers.reduce((a, c) => a + yrSum(c.commits), 0);
  const ta = committers.reduce((a, c) => a + yrSum(c.lines_added), 0);
  const td = committers.reduce((a, c) => a + yrSum(c.lines_deleted), 0);

  const activeCommitters = (activeYear === 'all') ? committers : committers.filter(c => metricValueForContributor(c,
    currentMetric) > 0);

  document.getElementById('summary-bar').innerHTML =
    `<div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">Contributors</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-ink">${activeCommitters.length}</div>
   </div>` +
    `<div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">${activeYear === 'all' ? 'Total' : 'Year'} Commits</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-ink">${tc.toLocaleString()}</div>
   </div>` +
    `<div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">Lines Added</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-added">+${ta.toLocaleString()}</div>
   </div>` +
    `<div class="stat-box bg-surface px-5 py-4">
      <div class="label mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">Lines Deleted</div>
      <div class="value font-mono text-[1.6rem] font-semibold leading-none text-deleted">−${td.toLocaleString()}</div>
   </div>`;

  renderComparisonPanel();
  renderHeatmaps(committers, years);
  renderTable(committers);
  renderSidebarDock();
}

// ── COMPARISON PANEL ──────────────────────────────────────────
function setCompTab(tab) {
  activeCompTab = tab;
  document.querySelectorAll('.comp-tab').forEach(button => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  ['timeline', 'share', 'pace', 'h2h'].forEach(name => {
    document.getElementById(`comp-${name}`).hidden = name !== tab;
  });
  renderComparisonPanel();
}

function renderComparisonPanel() {
  if (!parsedData) return;
  if (activeCompTab === 'timeline') renderTimeline();
  else if (activeCompTab === 'share') renderShare();
  else if (activeCompTab === 'pace') renderPace();
  else if (activeCompTab === 'h2h') {
    populateH2HSelects();
    renderH2H();
  }
}

// ── TIMELINE ─────────────────────────────────────────────────
function renderTimeline() {
  const {
    committers,
    minDate,
    maxDate
  } = parsedData;
  const W = 1060,
    H = 220;
  const PAD = {
    top: 12,
    right: 24,
    bottom: 30,
    left: 48
  };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const startDate = activeYear === 'all' ? new Date(minDate + 'T00:00:00') : new Date(activeYear + '-01-01');
  const endDate = activeYear === 'all' ? new Date(maxDate + 'T00:00:00') : new Date(activeYear + '-12-31');
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const weeks = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    weeks.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  if (!weeks.length) return;

  const metKey = currentMetric === 'active_days' ? 'commits' : currentMetric;
  const series = committers.map(c => {
    const data = weeks.map(wkStart => {
      let val = 0;
      for (let d = 0; d < 7; d++) {
        const day = new Date(wkStart);
        day.setDate(day.getDate() + d);
        const dk = ds(day);
        if (currentMetric === 'active_days') {
          if (c.activeDays.has(dk)) val++;
        } else val += (c[metKey] || {})[dk] || 0;
      }
      return val;
    });
    // 4-week rolling
    const smooth = data.map((v, i) => {
      const sl = data.slice(Math.max(0, i - 3), i + 1);
      return sl.reduce((a, b) => a + b, 0) / sl.length;
    });
    return {
      c,
      data,
      smooth
    };
  });

  const visibleMax = Math.max(...series.filter(s => !hiddenSeries.has(s.c.gi)).flatMap(s => s.smooth), 1);
  const xS = i => PAD.left + (i / (weeks.length - 1 || 1)) * chartW;
  const yS = v => PAD.top + chartH - (v / visibleMax) * chartH;

  let svg =
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;font-family:'IBM Plex Mono',monospace">`;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (i / 4) * chartH;
    const val = Math.round(visibleMax * (1 - i / 4));
    svg +=
      `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border2)" stroke-width="1"/>`;
    svg +=
      `<text x="${PAD.left - 6}" y="${y}" text-anchor="end" font-size="9" fill="var(--muted)" dominant-baseline="middle">${val}</text>`;
  }

  let lm = -1;
  weeks.forEach((wk, i) => {
    const m = wk.getMonth();
    if (m !== lm) {
      lm = m;
      const x = xS(i);
      const lbl = wk.toLocaleString('default', {
        month: 'short'
      });
      svg +=
        `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + chartH}" stroke="var(--border2)" stroke-width="1" opacity="0.5"/>`;
      svg += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${lbl}</text>`;
    }
  });

  series.forEach(({
    c,
    smooth
  }) => {
    if (hiddenSeries.has(c.gi)) return;
    const color = COLORS[c.colorIndex];
    const pts = smooth.map((v, i) => `${xS(i)},${yS(v)}`).join(' ');
    const area = `${pts} ${xS(smooth.length - 1)},${PAD.top + chartH} ${xS(0)},${PAD.top + chartH}`;
    svg += `<polygon points="${area}" fill="${color}" opacity="0.08"/>`;
    svg +=
      `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  svg += '</svg>';

  const wrap = document.getElementById('timeline-svg-wrap');
  wrap.innerHTML = svg;

  document.getElementById('timeline-legend').innerHTML = parsedData.committers.map(c => `
  <button type="button" class="legend-item inline-flex cursor-pointer select-none items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[0.65rem] text-ink transition ${hiddenSeries.has(c.gi) ? 'opacity-30' : ''}" data-action="toggle-series" data-contributor-id="${c.gi}" aria-pressed="${hiddenSeries.has(c.gi)}">
    <span class="legend-dot h-2.5 w-2.5 flex-shrink-0 rounded-full" style="background:${COLORS[c.colorIndex]}"></span>
    ${esc(c.displayName)}
  </button>`).join('');

  const svgEl = wrap.querySelector('svg');
  const cursor = document.getElementById('timeline-cursor');
  const tip = document.getElementById('timeline-tip');
  cursor.style.height = H + 'px';

  svgEl.addEventListener('mousemove', e => {
    const rect = svgEl.getBoundingClientRect();
    const scaleX = rect.width / W;
    const relX = e.clientX - rect.left;
    const chartRelX = relX / scaleX - PAD.left;
    if (chartRelX < 0 || chartRelX > chartW) {
      cursor.style.display = 'none';
      tip.style.display = 'none';
      return;
    }

    const idx = Math.min(Math.max(Math.round(chartRelX / chartW * (weeks.length - 1)), 0), weeks.length - 1);
    const xPx = xS(idx) * scaleX;
    cursor.style.display = 'block';
    cursor.style.left = xPx + 'px';

    const wkLabel = weeks[idx].toLocaleDateString('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const lines = series
      .filter(s => !hiddenSeries.has(s.c.gi))
      .sort((a, b) => b.smooth[idx] - a.smooth[idx])
      .map(s =>
        `<span style="color:${COLORS[s.c.colorIndex]}">■</span> ${esc(s.c.displayName)}: <strong>${Math.round(s.data[idx])}</strong>`
      )
      .join('<br>');

    tip.innerHTML = `<strong style="display:block;margin-bottom:4px">Week of ${wkLabel}</strong>${lines}`;
    tip.style.display = 'block';
    const tipW = tip.offsetWidth || 160;
    tip.style.left = (relX > rect.width * 0.6 ? relX / scaleX - tipW - 10 : relX / scaleX + 14) + 'px';
  });

  svgEl.addEventListener('mouseleave', () => {
    cursor.style.display = 'none';
    tip.style.display = 'none';
  });
}

function toggleSeries(gi) {
  if (hiddenSeries.has(gi)) hiddenSeries.delete(gi);
  else hiddenSeries.add(gi);
  renderTimeline();
}

// ── SHARE ────────────────────────────────────────────────────

function renderShare() {
  const {
    committers
  } = parsedData;

  // Share is now controlled by the sidebar metric selection
  const key = currentMetric;

  const vals = committers.map(c => metricValueForContributor(c, key));
  const total = vals.reduce((a, b) => a + b, 0) || 1;

  // Highlight the current metric near the share viz
  const label = metricLabel(key);
  const scope = activeYear === 'all' ? 'All years' : `Year ${activeYear}`;
  const header = `
<div class="mb-3 flex items-center justify-between">
  <div class="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Metric</div>
  <div class="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 font-mono text-[0.65rem] text-ink">
    <span class="opacity-70">${esc(label)}</span>
    <span class="opacity-30">·</span>
    <span class="opacity-70">${esc(scope)}</span>
  </div>
</div>
  `;

  // Put the highlight above the bars (share panel container must exist)
  const barsEl = document.getElementById('share-bars');
  if (!barsEl) return;

  // Render header + bars
  barsEl.innerHTML = header + committers.map((c, i) => {
    const val = vals[i];
    const pct = (val / total * 100).toFixed(1);
    const color = COLORS[c.colorIndex];

    // label text for the right side
    const unit = (key === 'active_days') ? 'days' : label.toLowerCase();

    return `<div class="share-row mb-2.5 flex items-center gap-3">
  <div class="share-name w-[130px] flex-shrink-0 truncate font-mono text-[0.7rem] text-ink" title="${esc(c.displayName)}">${esc(c.displayName)}</div>
  <div class="share-bar-track h-[22px] flex-1 overflow-hidden rounded-[2px] bg-c0">
    <div class="share-bar-fill flex h-full items-center rounded-[2px] transition-[width] duration-500 ease-[cubic-bezier(.22,.61,.36,1)]"
         style="width:${pct}%;background:${color}">
      ${+pct > 8 ? `<span class="share-pct pl-2 font-mono text-[0.6rem] text-white/90 whitespace-nowrap">${pct}%</span>` : ''}
    </div>
  </div>
  <div class="share-abs w-[120px] flex-shrink-0 text-right font-mono text-[0.62rem] text-muted">${val.toLocaleString()} ${esc(unit)}</div>
</div>`;
  }).join('');
}

// ── CUMULATIVE PACE ──────────────────────────────────────────
function renderPace() {
  const {
    committers
  } = parsedData;
  const W = 1060,
    H = 240;
  const PAD = {
    top: 12,
    right: 100,
    bottom: 30,
    left: 56
  };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const metKey = currentMetric === 'active_days' ? 'commits' : currentMetric;
  const allDates = [...new Set(committers.flatMap(c => Object.keys((c[metKey] || c.commits) || {})))].sort();
  const filtered = activeYear === 'all' ? allDates : allDates.filter(d => d.startsWith(String(activeYear)));

  if (!filtered.length) {
    document.getElementById('pace-svg-wrap').innerHTML =
      '<p style="font:0.7rem IBM Plex Mono,monospace;color:var(--muted);padding:20px 0">No data for this period.</p>';
    return;
  }

  const series = committers.map(c => {
    let cum = 0;
    const pts = filtered.map(d => {
      if (currentMetric === 'active_days') {
        if (c.activeDays.has(d)) cum++;
      } else cum += ((c[metKey] || {})[d] || 0);
      return cum;
    });
    return {
      c,
      pts
    };
  });

  const maxVal = Math.max(...series.map(s => s.pts[s.pts.length - 1] || 0), 1);
  const xS = i => PAD.left + (i / (filtered.length - 1 || 1)) * chartW;
  const yS = v => PAD.top + chartH - (v / maxVal) * chartH;

  let svg =
    `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;font-family:'IBM Plex Mono',monospace">`;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (i / 4) * chartH;
    const val = Math.round(maxVal * (1 - i / 4));
    svg +=
      `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border2)" stroke-width="1"/>`;
    svg +=
      `<text x="${PAD.left - 6}" y="${y}" text-anchor="end" font-size="9" fill="var(--muted)" dominant-baseline="middle">${val}</text>`;
  }

  let lm = -1;
  filtered.forEach((d, i) => {
    const m = new Date(d + 'T00:00:00').getMonth();
    if (m !== lm) {
      lm = m;
      const x = xS(i);
      const lbl = new Date(d + 'T00:00:00').toLocaleString('default', {
        month: 'short'
      });
      svg += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${lbl}</text>`;
    }
  });

  series.forEach(({
    c,
    pts
  }) => {
    if (hiddenSeries.has(c.gi)) return;
    const color = COLORS[c.colorIndex];
    const polyPts = pts.map((v, i) => `${xS(i)},${yS(v)}`).join(' ');
    svg +=
      `<polyline points="${polyPts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    const lx = xS(pts.length - 1),
      ly = yS(pts[pts.length - 1]);
    svg += `<circle cx="${lx}" cy="${ly}" r="4" fill="${color}"/>`;
    svg +=
      `<text x="${lx + 8}" y="${ly}" font-size="10" fill="${color}" dominant-baseline="middle" font-weight="600">${esc(c.displayName.split(' ')[0])}</text>`;
  });

  svg += '</svg>';
  document.getElementById('pace-svg-wrap').innerHTML = svg;

  const labels = {
    commits: 'commits',
    lines_added: 'lines added',
    lines_deleted: 'lines deleted',
    files: 'files changed',
    active_days: 'active days',
    releases: 'releases'
  };
  document.getElementById('pace-info').textContent =
    `Cumulative ${labels[currentMetric] || currentMetric} over time — a steeper slope means a faster pace. Click contributors in the Timeline legend to show/hide.`;
}

// ── HEAD-TO-HEAD ─────────────────────────────────────────────
function populateH2HSelects() {
  const {
    committers
  } = parsedData;
  ['h2h-a', 'h2h-b'].forEach((id, idx) => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = committers.map((c, i) =>
      `<option value="${i}" ${(prev === String(i) || (prev === '' && i === idx)) ? 'selected' : ''}>${esc(c.displayName)}</option>`
    ).join('');
  });
}

function renderH2H() {
  const {
    committers
  } = parsedData;
  const ai = +document.getElementById('h2h-a').value;
  const bi = +document.getElementById('h2h-b').value;
  const a = committers[ai],
    b = committers[bi];
  if (!a || !b) return;

  const cA = COLORS[a.colorIndex],
    cB = COLORS[b.colorIndex];
  const mkInit = c => c.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  document.getElementById('h2h-header').innerHTML = [a, b].map((c, idx) => {
    const col = idx === 0 ? cA : cB;
    return `<div class="h2h-header-cell bg-surface px-5 py-4" style="border-top:3px solid ${col}">
    <div class="label mb-2 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-muted">${idx === 0 ? 'Contributor A' : 'Contributor B'}</div>
    <div class="h2h-name-row flex items-center gap-2.5">
      <div class="avatar flex h-7 w-7 items-center justify-center rounded-full font-mono text-[0.65rem] font-semibold text-white" style="background:${col}">${mkInit(c)}</div>
      <div>
        <div class="h2h-name font-mono text-[0.82rem] font-semibold" style="color:${col}">${esc(c.displayName)}</div>
        <div class="h2h-email font-mono text-[0.58rem] text-muted">${c.emails.slice(0, 2).map(esc).join(', ')}</div>
      </div>
    </div>
  </div>`;
  }).join('');

  function getV(c, key) {
    const scopedDays = activeYear === 'all' ? [...c.activeDays] : [...c.activeDays].filter(d => d.startsWith(String(
      activeYear)));
    if (key === 'active_days') return scopedDays.length;
    if (key === 'streak') return longestStreak(scopedDays);
    if (key === 'workday_streak') return longestConsecutiveWorkdays(scopedDays);
    if (key === 'avg_commit_size') {
      const commits = yrSum(c.commits) || 1;
      return Math.round((yrSum(c.lines_added) + yrSum(c.lines_deleted)) / commits);
    }
    if (key === 'avg_daily') {
      const ad = scopedDays.length || 1;
      return +(yrSum(c.commits) / ad).toFixed(2);
    }
    return yrSum(c[key] || c.commits);
  }

  const metrics = [{
      key: 'commits',
      label: 'Commits',
      fmt: v => v.toLocaleString()
    },
    {
      key: 'lines_added',
      label: 'Lines Added',
      fmt: v => '+' + v.toLocaleString()
    },
    {
      key: 'lines_deleted',
      label: 'Lines Deleted',
      fmt: v => '−' + v.toLocaleString()
    },
    {
      key: 'files',
      label: 'Files Changed',
      fmt: v => v.toLocaleString()
    },
    {
      key: 'active_days',
      label: 'Active Days',
      fmt: v => v + ' days'
    },
    {
      key: 'streak',
      label: 'Longest Streak',
      fmt: v => v + ' days'
    },
    {
      key: 'workday_streak',
      label: 'Longest Consecutive Workdays (Mon–Thu)',
      fmt: v => v + ' days'
    },
    {
      key: 'avg_daily',
      label: 'Commits / Active Day',
      fmt: v => v.toFixed(2)
    },
    {
      key: 'avg_commit_size',
      label: 'Avg Lines / Commit',
      fmt: v => v.toLocaleString()
    },
    {
      key: 'releases',
      label: 'Releases',
      fmt: v => v.toLocaleString()
    },
  ];

  document.getElementById('h2h-metrics').innerHTML = metrics.map(m => {
    const av = getV(a, m.key),
      bv = getV(b, m.key);
    const aWin = av > bv,
      bWin = bv > av,
      tie = av === bv;
    const mx = Math.max(av, bv) || 1;
    const aW = (av / mx) * 44,
      bW = (bv / mx) * 44;

    return `<div class="h2h-metric-row grid grid-cols-[1fr_auto_1fr] items-stretch border-b border-border2 last:border-b-0">
    <div class="h2h-val left flex items-center justify-end px-4 py-3.5 font-mono text-[0.8rem] font-semibold ${aWin ? 'win' : ''}" style="${aWin ? 'color:' + cA : ''}">
      ${aWin ? '<span style="font-size:0.55rem;margin-right:6px;color:' + cA + '">▲</span>' : ''}${m.fmt(av)}
    </div>
    <div class="h2h-mid flex min-w-[120px] flex-col items-center justify-center gap-1.5 border-x border-border2 bg-bg px-4 py-3.5 text-center font-mono text-[0.58rem] uppercase tracking-[0.08em] text-muted">
      <span>${m.label}</span>
      <div class="h2h-sparkbar relative h-1.5 w-[90px] overflow-hidden rounded-full bg-c0">
        <div class="h2h-sparkbar-l absolute right-1/2 top-0 h-full rounded-l-full" style="width:${aW}%;background:${cA};opacity:0.8"></div>
        <div class="h2h-sparkbar-r absolute left-1/2 top-0 h-full rounded-r-full" style="width:${bW}%;background:${cB};opacity:0.8"></div>
      </div>
      ${tie ? '<span style="font-size:0.55rem;color:var(--muted)">tie</span>' : ''}
    </div>
    <div class="h2h-val right flex items-center justify-start px-4 py-3.5 font-mono text-[0.8rem] font-semibold ${bWin ? 'win' : ''}" style="${bWin ? 'color:' + cB : ''}">
      ${m.fmt(bv)}${bWin ? '<span style="font-size:0.55rem;margin-left:6px;color:' + cB + '">▲</span>' : ''}
    </div>
  </div>`;
  }).join('');
}

// ── HEATMAPS ─────────────────────────────────────────────────
function buildYearWeeks(year) {
  const s = new Date(year, 0, 1);
  s.setDate(s.getDate() - s.getDay());
  const e = new Date(year, 11, 31);
  e.setDate(e.getDate() + (6 - e.getDay()));
  const weeks = [];
  let cur = new Date(s),
    wk = [];
  while (cur <= e) {
    wk.push(new Date(cur));
    if (cur.getDay() === 6) {
      weeks.push(wk);
      wk = [];
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (wk.length) weeks.push(wk);
  return weeks;
}

function ds(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

function level(val, max) {
  if (!val || max === 0) return 0;
  const r = val / max;
  return r < 0.15 ? 1 : r < 0.40 ? 2 : r < 0.70 ? 3 : 4;
}

function monthLabels(weeks) {
  let lm = -1;
  return weeks.map(w => {
    const m = w[0].getMonth();
    if (m !== lm) {
      lm = m;
      return w[0].toLocaleString('default', {
        month: 'short'
      });
    }
    return '';
  });
}

function renderHeatmaps(committers, years) {
  const container = document.getElementById('committer-heatmaps');
  container.innerHTML = '';
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  committers.forEach((c, ci) => {
    const color = COLORS[c.colorIndex];
    const initials = c.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const section = document.createElement('div');
    section.className = 'committer-section mb-9 overflow-hidden border border-border bg-surface';
    section.id = `cs-${ci}`;

    const tc = yrSum(c.commits);
    const ta = yrSum(c.lines_added);
    const td = yrSum(c.lines_deleted);
    const tad = activeYear === 'all' ? c.totalActiveDays : [...c.activeDays].filter(d => d.startsWith(String(
      activeYear))).length;

    section.innerHTML = `
    <button type="button" class="committer-header flex w-full cursor-pointer select-none items-center gap-4 border-x-0 border-t-0 border-b border-border2 bg-transparent px-6 py-4 text-left hover:bg-bg" data-action="toggle-committer" data-committer-index="${ci}" aria-expanded="true">
      <span class="avatar flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-mono text-[0.75rem] font-semibold text-white" style="background:${color}">${initials}</span>
      <span class="min-w-0">
        <span class="committer-name block font-mono text-[0.85rem] font-semibold text-ink">${esc(c.displayName)}</span>
        <span class="committer-emails mt-0.5 block font-mono text-[0.63rem] text-muted">${c.emails.map(esc).join(' · ')}</span>
      </span>
      <span class="committer-meta ml-auto flex flex-wrap justify-end gap-4 font-mono text-[0.7rem] text-muted">
        <span><span class="hi font-semibold text-ink">${tc.toLocaleString()}</span> commits</span>
        <span><span class="hi font-semibold" style="color:var(--added)">+${ta.toLocaleString()}</span></span>
        <span><span class="hi font-semibold" style="color:var(--deleted)">−${td.toLocaleString()}</span></span>
        <span><span class="hi font-semibold text-ink">${tad}</span> active days</span>
      </span>
      <span class="chevron ml-2 flex-shrink-0 text-[0.65rem] text-muted">▼</span>
    </button>

    <div class="committer-body px-6 pb-7 pt-6">
      ${
        (activeYear === 'all' && years.length > 1)
        ? `
          <div class="mb-3 flex items-center justify-between gap-3">
            <div class="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">
              --
            </div>

            <button type="button"
              class="border border-border bg-transparent px-3 py-1 font-mono text-[0.62rem] text-muted transition hover:border-ink hover:text-ink"
              data-action="toggle-commit-day-heatmap" data-contributor-id="${c.gi}"
            >
              ${
                expandedCommitDayHeatmaps.has(c.gi)
                  ? `
                    <span class="text-ink">Showing all years</span>
                    <span class="opacity-60"> · Collapse to 1 year</span>
                  `
                  : `
                    <span class="text-ink">Showing ${years[years.length - 1]}</span>
                    <span class="opacity-60"> · Show all years</span>
                  `
              }
            </button>
          </div>
        ` : `
            <div class="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">
              --
            </div>
          `
      }

      <div id="yr-${ci}"></div>

      <div class="legend mt-4 flex items-center gap-1.5 font-mono text-[0.6rem] text-muted">
        Less
        <div class="legend-cells flex gap-1.5">
          ${[0,1,2,3,4].map(l => `<div class="legend-cell h-3 w-3 rounded-[2px]" style="background:var(--c${l})"></div>`).join('')}
        </div>
        More
      </div>

      <div class="lines-chart mt-5 border-t border-border2 pt-4">
        <div class="lines-chart-title mb-2.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Weekly lines added / deleted</div>
        <div class="week-bars flex h-[52px] items-end gap-0.5 overflow-x-auto" id="wb-${ci}"></div>
      </div>

      <div class="rhythm-charts flex flex-wrap gap-0">
        <div class="rhythm-half hour-chart-section min-w-[300px] flex-1 border-t border-border2 pt-4 mt-5" id="hc-${ci}"></div>
        <div class="rhythm-half dow-chart-section min-w-[300px] flex-1 border-t border-border2 pt-4 mt-5" id="dc-${ci}"></div>
      </div>

      <div class="dowhour-section mt-5 border-t border-border2 pt-4" id="dhc-${ci}"></div>
    </div>
  `;
    container.appendChild(section);

    const latestYear = years[years.length - 1];

    let displayYears;
    if (activeYear === 'all') {
      // collapsed => 1 year (latest); expanded => all years
      displayYears = expandedCommitDayHeatmaps.has(c.gi) ? years : [latestYear];
    } else {
      // active year filter forces 1 year regardless of expanded/collapsed
      displayYears = [+activeYear];
    }
    const metMap = metricMap(c);
    const mxVal = maxForMetric(metMap);
    const yrContainer = section.querySelector(`#yr-${ci}`);

    displayYears.forEach(year => {
      const wks = buildYearWeeks(year);
      const mls = monthLabels(wks);

      const rowDiv = document.createElement('div');
      rowDiv.className = 'year-row mb-5';

      if (displayYears.length > 1) {
        rowDiv.innerHTML =
          `<div class="year-row-label mb-2 border-l-[3px] border-border pl-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted">${year}</div>`;
      }

      const wrap = document.createElement('div');
      wrap.className = 'heatmap-wrap overflow-x-auto pb-1';

      const CELL_W = 12,
        DL_W = 30,
        weekSlot = 15;

      const mlRow = document.createElement('div');
      mlRow.className = 'month-labels relative mb-1 h-[14px] min-w-[580px]';
      mls.forEach((ml, wi) => {
        if (!ml) return;
        const s = document.createElement('div');
        s.className =
          'month-label-item absolute top-0 whitespace-nowrap font-mono text-[0.6rem] uppercase tracking-[0.05em] text-muted';
        s.textContent = ml;
        s.style.left = (DL_W + wi * weekSlot) + 'px';
        mlRow.appendChild(s);
      });
      wrap.appendChild(mlRow);

      const grid = document.createElement('div');
      grid.className = 'heatmap-grid-row flex min-w-[580px] items-start gap-1.5';

      const dlCol = document.createElement('div');
      dlCol.className = 'day-labels-col flex w-6 flex-shrink-0 flex-col gap-[3px] pt-[1px]';
      for (let d = 0; d < 7; d++) {
        const el = document.createElement('div');
        el.className = 'day-label h-3 pr-1 text-right font-mono text-[0.55rem] leading-3 text-muted';
        el.textContent = d % 2 === 1 ? DN[d] : '';
        dlCol.appendChild(el);
      }
      grid.appendChild(dlCol);

      const weeksDiv = document.createElement('div');
      weeksDiv.className = 'heatmap-weeks flex flex-1 gap-[3px]';
      wks.forEach(week => {
        const wkDiv = document.createElement('div');
        wkDiv.className = 'heatmap-week flex flex-col gap-[3px]';
        week.forEach(day => {
          const d2 = ds(day);
          const inYear = d2.startsWith(String(year));
          const val = metMap[d2] || 0;

          const cell = document.createElement('div');
          cell.className = 'heatmap-cell' + (inYear ? '' : ' faded');
          cell.dataset.level = inYear ? level(val, mxVal) : 0;
          cell.dataset.date = d2;
          cell.dataset.val = val;
          cell.dataset.ci = ci;

          if (inYear) {
            cell.addEventListener('mouseenter', tip);
            cell.addEventListener('mouseleave', hideTooltip);
          }

          wkDiv.appendChild(cell);
        });
        weeksDiv.appendChild(wkDiv);
      });

      grid.appendChild(weeksDiv);
      wrap.appendChild(grid);
      rowDiv.appendChild(wrap);
      yrContainer.appendChild(rowDiv);
    });

    const allWks = displayYears.flatMap(y => buildYearWeeks(y));
    const wbCont = section.querySelector(`#wb-${ci}`);
    const mxA = Math.max(...allWks.map(w => w.reduce((s, d) => s + (c.lines_added[ds(d)] || 0), 0)), 1);
    const mxD = Math.max(...allWks.map(w => w.reduce((s, d) => s + (c.lines_deleted[ds(d)] || 0), 0)), 1);
    const gmx = Math.max(mxA, mxD);

    allWks.forEach(week => {
      const wa = week.reduce((s, d) => s + (c.lines_added[ds(d)] || 0), 0);
      const wd = week.reduce((s, d) => s + (c.lines_deleted[ds(d)] || 0), 0);
      const wr = document.createElement('div');
      wr.className = 'week-bar-wrap flex min-w-[3px] max-w-[14px] flex-1 flex-col items-center gap-px';

      if (wa) {
        const b = document.createElement('div');
        b.className = 'week-bar bar-added w-full rounded-t-[1px]';
        b.style.height = Math.max(1, (wa / gmx) * 48) + 'px';
        b.style.background = 'var(--added)';
        wr.appendChild(b);
      }
      if (wd) {
        const b = document.createElement('div');
        b.className = 'week-bar bar-deleted w-full rounded-t-[1px]';
        b.style.height = Math.max(1, (wd / gmx) * 48) + 'px';
        b.style.background = 'var(--deleted)';
        wr.appendChild(b);
      }
      if (!wa && !wd) {
        const b = document.createElement('div');
        b.className = 'week-bar w-full';
        b.style.cssText = 'height:2px;background:var(--border)';
        wr.appendChild(b);
      }
      wbCont.appendChild(wr);
    });

    renderHourChart(c, ci, color);
    renderDowChart(c, ci, color);
    renderDowHourChart(c, ci, color);
  });
}

    function renderHourChart(c, ci, color) {
  const container = document.getElementById(`hc-${ci}`);

  if (!c.hasHourData) {
    container.innerHTML =
      `<div class="hour-chart-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Hour-of-day activity</div>
   <div class="hour-no-data font-mono text-[0.68rem] italic text-muted">No time data — re-run git log using the updated command above (uses <code>%aI</code> for full timestamps).</div>`;
    return;
  }

  // year-filtered hourly array from timedByDate
  const hourly = new Array(24).fill(0);
  const yearPrefix = activeYear === 'all' ? null : String(activeYear);

  for (const [dateStr, info] of Object.entries(c.timedByDate || {})) {
    if (yearPrefix && !dateStr.startsWith(yearPrefix)) continue;
    for (const [hStr, cnt] of Object.entries(info.hours || {})) {
      const h = +hStr;
      if (h >= 0 && h < 24) hourly[h] += cnt;
    }
  }

  const totalH = hourly.reduce((a, b) => a + b, 0);
  if (!totalH) {
    container.innerHTML =
      `<div class="hour-chart-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Hour-of-day activity (local time)</div>
   <div class="hour-no-data font-mono text-[0.68rem] italic text-muted">No timed commits in this ${activeYear === 'all' ? 'range' : 'year'}.</div>`;
    return;
  }

  const maxH = Math.max(...hourly, 1);
  const peakHour = hourly.indexOf(maxH);

  // ── helpers for arcs (supports fractional hours + wrap) ──────────────
  const TAU = Math.PI * 2;
  const angleForHour = (h) => (h / 24) * TAU - Math.PI / 2; // start at top

  function polar(cx, cy, r, a) {
    return {
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r
    };
  }

  // Creates donut-segment path from startHour -> endHour (may wrap 24)
  function arcSegmentPath(cx, cy, r0, r1, startHour, endHour) {
    // normalize into [0, 24) and handle wrap
    const segs = [];
    const s = ((startHour % 24) + 24) % 24;
    const e = ((endHour % 24) + 24) % 24;
    if (startHour === endHour) return ''; // nothing

    if (startHour < endHour) {
      segs.push([startHour, endHour]);
    } else {
      // wrap around midnight
      segs.push([startHour, 24]);
      segs.push([0, endHour]);
    }

    return segs.map(([aH, bH]) => {
      const a = angleForHour(aH);
      const b = angleForHour(bH);

      // large-arc if > 12 hours
      const span = (bH - aH);
      const large = span > 12 ? 1 : 0;

      const p0 = polar(cx, cy, r1, a);
      const p1 = polar(cx, cy, r1, b);
      const p2 = polar(cx, cy, r0, b);
      const p3 = polar(cx, cy, r0, a);

      // outer arc: sweep=1, inner arc: sweep=0 (reverse)
      return [
        `M ${p0.x.toFixed(3)} ${p0.y.toFixed(3)}`,
        `A ${r1} ${r1} 0 ${large} 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
        `L ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
        `A ${r0} ${r0} 0 ${large} 0 ${p3.x.toFixed(3)} ${p3.y.toFixed(3)}`,
        'Z'
      ].join(' ');
    }).join(' ');
  }

  function hourLabel24(h) {
    return String(h).padStart(2, '0');
  }

  function fmtHourRange24(h) {
    const hh = ((h % 24) + 24) % 24;
    return `${hourLabel24(hh)}:00`;
  }

  function fmtTime(hFloat) {
    const h = Math.floor(hFloat);
    const m = Math.round((hFloat - h) * 60);
    return `${hourLabel24(h)}:${String(m).padStart(2, '0')}`;
  }

  // ── Clock SVG sizing (bigger so labels aren't clipped) ───────────────
  const W = 200,
    H2 = 200;
  const CX = 100,
    CY = 100;
  const R = 82; // outer circle
  const innerR = 22;
  const outerMaxR = R - 6;

  // Subtle background bands (Option B):
  // Sleep: 23:30–06:30
  // Twilight: 06:30–09:00 + 17:00–23:30
  // Office: 09:00–17:00
  const bands = [{
      name: 'sleep',
      start: 23.5,
      end: 6.5,
      fill: 'var(--border2)',
      opacity: 0.18,
      icon: '🌙',
      iconHour: 2.0
    },
    {
      name: 'twilight',
      start: 6.5,
      end: 9.0,
      fill: 'var(--border2)',
      opacity: 0.10,
      icon: '',
      iconHour: 7.5
    },
    {
      name: 'office',
      start: 9.0,
      end: 17.0,
      fill: 'var(--border2)',
      opacity: 0.14,
      icon: '💼',
      iconHour: 13.0
    },
    {
      name: 'twilight',
      start: 17.0,
      end: 23.5,
      fill: 'var(--border2)',
      opacity: 0.10,
      icon: '',
      iconHour: 20.0
    },
  ];

  // The radial “data bars” opacity curve (keep your existing feel)
  function periodOpacity(h) {
    // keep subtle rhythm even without the bands
    if (h >= 23 || h < 6) return 0.50;
    if (h >= 6 && h < 9) return 0.78;
    if (h >= 9 && h < 17) return 1.0; // office hours
    if (h >= 17 && h < 23) return 0.72;
    return 0.65;
  }

  let clockSVG =
    `<svg width="${W}" height="${H2}" viewBox="0 0 ${W} ${H2}" xmlns="http://www.w3.org/2000/svg" style="display:block">`;

  // Outer ring
  clockSVG += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="var(--bg)" stroke="var(--border)" stroke-width="1"/>`;

  // background bands (subtle donut segments just inside the rim)
  const bandOuter = R - 2;
  const bandInner = R - 14;
  for (const b of bands) {
    const p = arcSegmentPath(CX, CY, bandInner, bandOuter, b.start, b.end);
    if (p) clockSVG += `<path d="${p}" fill="${b.fill}" opacity="${b.opacity}"></path>`;
  }

  // reference rings
  [0.33, 0.66, 1].forEach(f => {
    clockSVG +=
      `<circle cx="${CX}" cy="${CY}" r="${innerR + f * (outerMaxR - innerR)}" fill="none" stroke="var(--border2)" stroke-width="0.5"/>`;
  });

  // quarter lines
  [0, 6, 12, 18].forEach(h => {
    const a = (h / 24) * TAU - Math.PI / 2;
    const x2 = CX + Math.cos(a) * R,
      y2 = CY + Math.sin(a) * R;
    clockSVG +=
      `<line x1="${CX}" y1="${CY}" x2="${x2}" y2="${y2}" stroke="var(--border2)" stroke-width="0.6" opacity="0.7"/>`;
  });

  // readable 24h labels, moved inward so they don't clip
  const labelR = R - 18;
  const lbls = [{
      h: 0,
      t: '00'
    },
    {
      h: 6,
      t: '06'
    },
    {
      h: 12,
      t: '12'
    },
    {
      h: 18,
      t: '18'
    },
  ];
  lbls.forEach(({
    h,
    t
  }) => {
    const a = (h / 24) * TAU - Math.PI / 2;
    const p = polar(CX, CY, labelR, a);
    clockSVG +=
      `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle"
    font-family="IBM Plex Mono,monospace" font-size="9" fill="var(--muted)">${t}</text>`;
  });

  // iconography (subtle, inside the band)
  function iconAt(hourFloat, glyph) {
    if (!glyph) return '';
    const a = angleForHour(hourFloat);
    const p = polar(CX, CY, R - 28, a);
    return `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle"
  font-size="12" opacity="0.55">${glyph}</text>`;
  }
  clockSVG += iconAt(13.0, '💼'); // office midpoint
  clockSVG += iconAt(2.0, '🌙'); // sleep midpoint

  // data wedges
  for (let h = 0; h < 24; h++) {
    const val = hourly[h];
    const barR = innerR + (val / maxH) * (outerMaxR - innerR);

    const aStart = ((h / 24) * TAU) - Math.PI / 2;
    const aEnd = (((h + 1) / 24) * TAU) - Math.PI / 2;
    const gap = 0.03;

    const x1 = CX + Math.cos(aStart + gap) * innerR,
      y1 = CY + Math.sin(aStart + gap) * innerR;
    const x2 = CX + Math.cos(aEnd - gap) * innerR,
      y2 = CY + Math.sin(aEnd - gap) * innerR;
    const x3 = CX + Math.cos(aEnd - gap) * barR,
      y3 = CY + Math.sin(aEnd - gap) * barR;
    const x4 = CX + Math.cos(aStart + gap) * barR,
      y4 = CY + Math.sin(aStart + gap) * barR;

    const isPeak = h === peakHour;
    const opacity = periodOpacity(h) * (val > 0 ? 1 : 0.12);

    if (val > 0) {
      clockSVG +=
        `<path d="M${x1},${y1} A${innerR},${innerR} 0 0,1 ${x2},${y2} L${x3},${y3} A${barR},${barR} 0 0,0 ${x4},${y4} Z"
      fill="${color}" opacity="${opacity}"
      stroke="${isPeak ? color : 'none'}" stroke-width="${isPeak ? 1.5 : 0}"/>`;
    }
  }

  clockSVG += `<circle cx="${CX}" cy="${CY}" r="4" fill="${color}" opacity="0.75"/>`;
  clockSVG += `</svg>`;

  // 24-hour bar labels
  const hourLabels = Array.from({
    length: 24
  }, (_, h) => `${hourLabel24(h)}:00`);

  const barRows = hourly.map((v, h) => {
    const w = (v / maxH * 100).toFixed(1);
    const isPeak = h === peakHour;
    const op = periodOpacity(h);
    return `<div class="hour-bar-row mb-[3px] flex items-center gap-2">
  <div class="hour-bar-label w-12 flex-shrink-0 text-right font-mono text-[0.58rem] text-muted"
       style="${isPeak ? 'color:var(--ink);font-weight:600' : ''}">${hourLabels[h]}</div>
  <div class="hour-bar-track relative h-2.5 flex-1 overflow-hidden rounded-[1px] bg-c0">
    <div class="hour-bar-fill h-full rounded-[1px] transition-[width] duration-300 ease-out"
         style="width:${w}%;background:${color};opacity:${op}"></div>
  </div>
  <div class="hour-bar-count w-8 flex-shrink-0 font-mono text-[0.55rem] text-muted">${v > 0 ? v : ''}</div>
</div>`;
  }).join('');

  const peakLabel = `${hourLabel24(peakHour)}:00–${hourLabel24((peakHour + 1) % 24)}:00`;

  container.innerHTML = `
<div class="hour-chart-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Hour-of-day activity (local time)</div>
<div class="hour-chart-inner flex flex-wrap items-center gap-7">
  <div class="clock-face-wrap flex-shrink-0">${clockSVG}</div>
  <div class="hour-bars-wrap min-w-[300px] flex-1">${barRows}</div>
</div>

<div class="hour-peak-label mt-2.5 font-mono text-[0.62rem] text-muted">
  Peak: <strong class="text-ink">${peakLabel}</strong> (${hourly[peakHour]} commits)
  <span style="opacity:.75">·</span>
  <span title="Common office hours">💼 <strong class="text-ink">09:00–17:00</strong></span>
  <span style="opacity:.75">·</span>
  <span title="Common sleeping hours">🌙 <strong class="text-ink">23:30–06:30</strong></span>
  <span style="opacity:.75">·</span>
  <span title="Transition bands">dawn/dusk <strong class="text-ink">06:30–09:00</strong> & <strong class="text-ink">17:00–23:30</strong></span>
</div>
  `;
}

function renderDowChart(c, ci, color) {
  const container = document.getElementById(`dc-${ci}`);

  const dow = new Array(7).fill(0);
  const yearPrefix = activeYear === 'all' ? null : String(activeYear);

  const commitDates = Object.keys(c.commits || {});
  for (const dateStr of commitDates) {
    if (yearPrefix && !dateStr.startsWith(yearPrefix)) continue;

    const v = c.commits[dateStr] || 0;
    if (!v) continue;

    const d = new Date(dateStr + 'T12:00:00').getDay();
    dow[d] += v;
  }

  const totalD = dow.reduce((a, b) => a + b, 0);
  if (!totalD) {
    container.innerHTML =
      `<div class="dow-chart-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Day-of-week activity</div>
     <div class="dowhour-no-data font-mono text-[0.68rem] italic text-muted">No commits in this ${activeYear === 'all' ? 'range' : 'year'}.</div>`;
    return;
  }

  const maxD = Math.max(...dow, 1);
  const peakDow = dow.indexOf(maxD);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const isWeekend = d => d === 0 || d === 6;

  const wdTotal = dow.slice(1, 6).reduce((a, b) => a + b, 0);
  const weTotal = dow[0] + dow[6];
  const wdPct = Math.round(wdTotal / totalD * 100);
  const wePct = 100 - wdPct;

  const bars = dow.map((v, d) => {
    const isPeak = d === peakDow;
    const weekend = isWeekend(d);
    const barH = Math.max(v > 0 ? 4 : 0, (v / maxD) * 60);
    return `<div class="dow-col flex flex-1 flex-col items-center gap-1.5">
    <div class="dow-count font-mono text-[0.58rem] text-muted" style="${isPeak ? 'color:var(--ink);font-weight:600' : ''}">${v || ''}</div>
    <div class="dow-bar-wrap flex w-full flex-1 items-end justify-center">
      <div class="dow-bar w-full max-w-[48px] rounded-t-[2px] transition-[height] duration-300 ease-[cubic-bezier(.22,.61,.36,1)] ${weekend ? 'opacity-60' : ''}"
           style="height:${barH}px;background:${color};opacity:${weekend ? 0.45 : 0.85};color:${color}${isPeak ? ';outline:2px solid currentColor;outline-offset:1px' : ''}"></div>
    </div>
    <div class="dow-label font-mono text-[0.6rem] text-muted ${weekend ? 'opacity-70' : ''}" style="${isPeak ? 'color:var(--ink);font-weight:600' : ''}">${DAYS[d]}</div>
  </div>`;
  }).join('');

  container.innerHTML = `
  <div class="dow-chart-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Day-of-week activity</div>
  <div class="dow-bars flex h-[72px] items-end gap-1.5">${bars}</div>
  <div class="dow-peak-label mt-3 font-mono text-[0.62rem] text-muted">
    Peak: <strong class="text-ink">${DAYS[peakDow]}</strong> (${dow[peakDow]} commits) ·
    Weekday <strong class="text-ink">${wdPct}%</strong> vs Weekend <strong class="text-ink">${wePct}%</strong>
  </div>
`;
}

function renderDowHourChart(c, ci, color) {
  const container = document.getElementById(`dhc-${ci}`);

  if (!c.hasHourData) {
    container.innerHTML =
      `<div class="dowhour-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Hour × Day heatmap</div>
     <div class="dowhour-no-data font-mono text-[0.68rem] italic text-muted">No time data — use the updated git command above.</div>`;
    return;
  }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const isWeekend = d => d === 0 || d === 6;

  const matrix = Array.from({
    length: 7
  }, () => new Array(24).fill(0));
  const yearPrefix = activeYear === 'all' ? null : String(activeYear);

  let anyTimed = false;
  for (const [dateStr, info] of Object.entries(c.timedByDate || {})) {
    if (yearPrefix && !dateStr.startsWith(yearPrefix)) continue;
    anyTimed = true;

    const dow = info.dow;
    for (const [hStr, cnt] of Object.entries(info.hours || {})) {
      const h = +hStr;
      if (h >= 0 && h < 24) matrix[dow][h] += cnt;
    }
  }

  if (!anyTimed) {
    container.innerHTML =
      `<div class="dowhour-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Hour × Day heatmap</div>
     <div class="dowhour-no-data font-mono text-[0.68rem] italic text-muted">No timed commits in this ${activeYear === 'all' ? 'range' : 'year'}.</div>`;
    return;
  }

  const maxVal = Math.max(...matrix.flatMap(row => row), 1);
  const totalCommits = matrix.flatMap(r => r).reduce((a, b) => a + b, 0) || 1;

  const hourLabel = h => {
    if (h === 0) return '12a';
    if (h === 12) return '12p';
    if (h < 12) return `${h}a`;
    return `${h - 12}p`;
  };

  function cellOpacity(val) {
    if (!val) return 0;
    const t = val / maxVal;
    return 0.08 + t * 0.92;
  }

  let gridHTML = `<div class="dowhour-day-header corner"></div>`;
  for (let d = 0; d < 7; d++) {
    gridHTML +=
      `<div class="dowhour-day-header font-mono text-[0.62rem] font-semibold text-muted text-center pb-1.5 ${isWeekend(d) ? 'opacity-60' : ''}">${DAYS[d]}</div>`;
  }

  for (let h = 0; h < 24; h++) {
    const showLabel = (h % 3 === 0);
    gridHTML +=
      `<div class="dowhour-hour-label h-[14px] pr-1.5 text-right font-mono text-[0.55rem] text-muted flex items-center justify-end">${showLabel ? hourLabel(h) : ''}</div>`;

    for (let d = 0; d < 7; d++) {
      const val = matrix[d][h];
      const op = cellOpacity(val);
      const pct = (val / totalCommits * 100).toFixed(1);

      gridHTML += `<div class="dowhour-cell"
      style="background:${color};opacity:${op};"
      data-dh-tip data-dow="${d}" data-hour="${h}" data-value="${val}" data-pct="${pct}" data-day-name="${DAYS[d]}" data-committer-index="${ci}"
    ></div>`;
    }
  }

  let peakDow = 0,
    peakHour = 0,
    peakVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (matrix[d][h] > peakVal) {
        peakVal = matrix[d][h];
        peakDow = d;
        peakHour = h;
      }
    }
  }

  const peakPct = (peakVal / totalCommits * 100).toFixed(1);
  const fmtHour = h => {
    const ap = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 || 12;
    return `${h12}:00${ap}`;
  };

  container.innerHTML = `
  <div class="dowhour-title mb-3 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">Hour × Day heatmap — each cell is a unique (day, hour) bucket</div>
  <div class="dowhour-wrap overflow-x-auto">
    <div class="dowhour-grid grid min-w-[420px] w-full gap-0" style="grid-template-columns:36px repeat(7, 1fr);" id="dh-grid-${ci}">
      ${gridHTML}
    </div>
  </div>
  <div class="dowhour-peak-label mt-2.5 font-mono text-[0.62rem] text-muted">
    Peak slot: <strong class="text-ink">${DAYS[peakDow]} ${fmtHour(peakHour)}–${fmtHour(peakHour + 1)}</strong>
    — ${peakVal} commits (${peakPct}% of timed activity)
  </div>
`;
}

// Shared floating tooltip for dow-hour cells
const _dhTipEl = (() => {
  const el = document.createElement('div');
  el.className = 'dowhour-tooltip';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  return el;
})();

function dhTip(e, dow, hour, val, dayName, ci) {
  const fmtH = h => {
    const ap = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 || 12;
    return `${h12}:00${ap}`;
  };
  const c = parsedData && parsedData.committers[ci];
  const total = c ? c.dowHourly.flatMap(r => r).reduce((a, b) => a + b, 0) || 1 : 1;
  const pct = (val / total * 100).toFixed(1);
  _dhTipEl.innerHTML =
    `<strong>${dayName}, ${fmtH(hour)}–${fmtH(hour + 1)}</strong><br>${val} commit${val !== 1 ? 's' : ''}${val ? ` · ${pct}% of timed activity` : ''}`;
  _dhTipEl.style.display = 'block';
  _dhTipEl.style.left = (e.clientX + 14) + 'px';
  _dhTipEl.style.top = (e.clientY - 10) + 'px';
}

function hideDhTip() {
  _dhTipEl.style.display = 'none';
}
document.addEventListener('scroll', hideDhTip, {
  passive: true
});

function metricMap(c) {
  if (currentMetric === 'active_days') {
    const m = {};
    c.activeDays.forEach(d => m[d] = 1);
    return m;
  }
  return c[currentMetric === 'files' ? 'files' : currentMetric] || c.commits;
}

function maxForMetric(map) {
  if (activeYear === 'all') return Math.max(...Object.values(map || {}), 1);
  const p = String(activeYear);
  const vals = Object.entries(map || {}).filter(([d]) => d.startsWith(p)).map(([, v]) => v);
  return Math.max(...vals, 1);
}

function refreshCells() {
  if (!parsedData) return;
  parsedData.committers.forEach((c, ci) => {
    const mm = metricMap(c),
      mx = maxForMetric(mm);
    document.querySelectorAll(`#cs-${ci} .heatmap-cell:not(.faded)`).forEach(cell => {
      const v = mm[cell.dataset.date] || 0;
      cell.dataset.level = level(v, mx);
      cell.dataset.val = v;
    });
  });
}

function renderTable(committers) {
  const mc = Math.max(...committers.map(c => yrSum(c.commits)), 1);
  document.getElementById('summary-tbody').innerHTML = committers.map(c => {
    const color = COLORS[c.colorIndex];
    const tc = yrSum(c.commits);
    const ta = yrSum(c.lines_added);
    const td = yrSum(c.lines_deleted);
    const tf = yrSum(c.files);
    const tr = yrSum(c.releases);
    const tad = activeYear === 'all' ? c.totalActiveDays : [...c.activeDays].filter(d => d.startsWith(String(
      activeYear))).length;
    const bw = Math.round((tc / mc) * 80);

    return `<tr class="hover:bg-bg">
    <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">
      <span class="inline-flex items-center gap-2">
        <span class="avatar inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[0.6rem] font-semibold text-white" style="background:${color}">${c.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        ${esc(c.displayName)}
        ${c.emails.length > 1 ? `<span class="text-[0.6rem] text-muted">(${c.emails.length} emails)</span>` : ''}
      </span>
    </td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">
      ${tc.toLocaleString()}
      <span class="bar-inline ml-2 inline-block h-2 align-middle opacity-60" style="width:${bw}px;background:${color};border-radius:1px;"></span>
    </td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle" style="color:var(--added)">+${ta.toLocaleString()}</td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle" style="color:var(--deleted)">−${td.toLocaleString()}</td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${tf.toLocaleString()}</td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${tad}</td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${tr.toLocaleString()}</td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${c.firstCommit || '—'}</td>
    <td class="border-b border-border2 px-3 py-2.5 align-middle text-ink">${c.lastCommit || '—'}</td>
  </tr>`;
  }).join('');
}

function jumpToCommitter(gi) {
  const idx = parsedData.committers.findIndex(c => c.gi === gi);
  if (idx < 0) return;

  const el = document.getElementById(`cs-${idx}`);
  if (!el) return;

  el.classList.remove('collapsed');
  el.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

const tooltip = document.getElementById('tooltip');

function tip(e) {
  const cell = e.currentTarget;
  const d2 = cell.dataset.date;
  const ci = +cell.dataset.ci;
  const c = parsedData.committers[ci];
  const color = COLORS[c.colorIndex];

  const dt = new Date(d2 + 'T00:00:00');
  const dow = dt.toLocaleDateString('en', {
    weekday: 'long'
  });
  const dateStr = dt.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const nCommits = c.commits[d2] || 0;
  const nAdded = c.lines_added[d2] || 0;
  const nDeleted = c.lines_deleted[d2] || 0;
  const nFiles = c.files[d2] || 0;

  let html = `<div class="tip-header" style="padding:10px 14px 8px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:baseline;justify-content:space-between;gap:10px">
  <span class="tip-date" style="font-size:0.7rem;font-weight:600;color:#f5f2eb;letter-spacing:0.02em">${dateStr}</span>
  <span class="tip-dow" style="font-size:0.58rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.08em">${dow}</span>
</div>`;

  html += `<div class="tip-summary" style="padding:6px 14px 8px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:14px;align-items:center">
  <div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
    <span class="tip-stat-val" style="font-size:0.72rem;font-weight:600;color:${color}">${nCommits}</span>
    <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">commit${nCommits !== 1 ? 's' : ''}</span>
  </div>`;

  if (nAdded || nDeleted) {
    html += `<div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
    <span class="tip-stat-val added" style="font-size:0.72rem;font-weight:600;color:#7ec87e">+${nAdded.toLocaleString()}</span>
    <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">added</span>
  </div>
  <div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
    <span class="tip-stat-val deleted" style="font-size:0.72rem;font-weight:600;color:#e08080">−${nDeleted.toLocaleString()}</span>
    <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">deleted</span>
  </div>`;
  }

  if (nFiles) {
    html += `<div class="tip-stat" style="display:flex;flex-direction:column;gap:1px">
    <span class="tip-stat-val" style="font-size:0.72rem;font-weight:600">${nFiles}</span>
    <span class="tip-stat-lbl" style="font-size:0.52rem;color:rgba(245,242,235,0.45);text-transform:uppercase;letter-spacing:0.07em">file${nFiles !== 1 ? 's' : ''}</span>
  </div>`;
  }
  html += `</div>`;

  const emailSet = new Set(c.emails);
  const dayCommits = (commitsByDate[d2] || []).filter(rc => emailSet.has(rc.email));
  dayCommits.sort((a, b) => {
    const at = a.hour >= 0 ? a.hour * 60 + (a.minute >= 0 ? a.minute : 0) : 9999;
    const bt = b.hour >= 0 ? b.hour * 60 + (b.minute >= 0 ? b.minute : 0) : 9999;
    return at - bt;
  });

  const byAuthor = new Map();
  for (const rc of dayCommits) {
    const key = rc.email || '?';
    if (!byAuthor.has(key)) byAuthor.set(key, []);
    byAuthor.get(key).push(rc);
  }

  const MAX_COMMITS_TOTAL = 8;
  const MAX_FILES_PER_COMMIT = 3;
  let shownTotal = 0;

  html += `<div class="tip-commits">`;

  for (const [authorEmail, commits] of byAuthor) {
    const penalisedCount = penaliseReverts ? commits.filter(x => x.isRevert).length : 0;

    html += `<div class="tip-author-header" style="padding:7px 14px 4px;display:flex;align-items:center;gap:7px">
    <div class="tip-author-dot" style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${color}"></div>
    <span class="tip-author-name" style="font-size:0.62rem;color:rgba(245,242,235,0.8);font-weight:600">${esc(authorEmail)}</span>
    ${penalisedCount ? `<span class="tip-revert-pill" style="margin-left:6px">penalised×${penalisedCount}</span>` : ''}
    <span class="tip-author-sub" style="font-size:0.55rem;color:rgba(245,242,235,0.3);margin-left:auto">${commits.length} commit${commits.length !== 1 ? 's' : ''}</span>
  </div>`;

    for (const rc of commits) {
      if (shownTotal >= MAX_COMMITS_TOTAL) break;
      shownTotal++;

      const hash = rc.hash ? rc.hash.slice(0, 7) : '';
      const timeStr = rc.hour >= 0 ?
        `${String(rc.hour).padStart(2, '0')}:${String(rc.minute >= 0 ? rc.minute : 0).padStart(2, '0')}` :
        '';

      const fa = rc.files.reduce((s, f) => s + f.added, 0);
      const fd = rc.files.reduce((s, f) => s + f.deleted, 0);

      const subj = rc.subject ?
        (rc.subject.length > 48 ? rc.subject.slice(0, 47) + '…' : rc.subject) :
        '';

      const topFiles = [...rc.files]
        .sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted))
        .slice(0, MAX_FILES_PER_COMMIT);

      html += `<div class="tip-commit-row" style="padding:4px 14px 6px 27px">
      <div class="tip-commit-meta" style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px">
        <span class="tip-hash" style="font-size:0.57rem;color:rgba(245,242,235,0.3);letter-spacing:0.04em">${hash}</span>
        ${timeStr ? `<span class="tip-time" style="font-size:0.57rem;color:rgba(245,242,235,0.3)">${timeStr}</span>` : ''}
        <span class="tip-changes" style="font-size:0.57rem;display:flex;gap:6px;margin-left:auto">
          ${fa ? `<span class="a" style="color:#7ec87e">+${fa}</span>` : ''}
          ${fd ? `<span class="d" style="color:#e08080">−${fd}</span>` : ''}
        </span>
      </div>
      ${subj ? `<div class="tip-subject" style="font-size:0.63rem;color:rgba(245,242,235,0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px">
        ${esc(subj)}
        ${rc.isMerge ? '<span class="tip-merge-pill">merge</span>' : ''}
        ${rc.touchesVersion ? `<span class="tip-release-pill">release${rc.releaseVersion ? ' v' + esc(rc.releaseVersion) : ''}</span>` : ''}
        ${(penaliseReverts && rc.isRevert) ? '<span class="tip-revert-pill">penalised</span>' : ''}
      </div>` : ''}
      <div class="tip-files" style="display:flex;flex-direction:column;gap:1px">`;

      for (const f of topFiles) {
        const pathParts = f.path.split('/');
        const basename = pathParts[pathParts.length - 1];
        const dir = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') + '/' : '';
        const chgA = f.added ?
          `<span class="tip-file-chg a" style="color:rgba(126,200,126,0.6)">+${f.added}</span>` : '';
        const chgD = f.deleted ?
          `<span class="tip-file-chg d" style="color:rgba(224,128,128,0.6)">−${f.deleted}</span>` : '';
        html += `<div class="tip-file" style="font-size:0.55rem;color:rgba(245,242,235,0.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px">
        <span class="tip-file-name" title="${esc(f.path)}" style="overflow:hidden;text-overflow:ellipsis"><span style="opacity:0.4">${esc(dir)}</span>${esc(basename)}</span>
        ${chgA}${chgD}
      </div>`;
      }

      if (rc.files.length > MAX_FILES_PER_COMMIT) {
        html +=
          `<div class="tip-file" style="font-style:italic">+${rc.files.length - MAX_FILES_PER_COMMIT} more file${(rc.files.length - MAX_FILES_PER_COMMIT) !== 1 ? 's' : ''}</div>`;
      }

      html += `</div></div>`;
    }
    html += `</div>`;
  }

  const hiddenCount = dayCommits.length - shownTotal;
  if (hiddenCount > 0) {
    html +=
      `<div class="tip-more">+${hiddenCount} more commit${hiddenCount !== 1 ? 's' : ''} — scroll up to see all</div>`;
  }

  html += `</div>`;

  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  tooltip.setAttribute('aria-hidden', 'false');
  moveTip(e);
}


function hideTooltip() {
  tooltip.style.display = 'none';
  tooltip.setAttribute('aria-hidden', 'true');
}
function moveTip(e) {
  const tw = tooltip.offsetWidth || 300;
  const th = tooltip.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = e.clientX + 16;
  let y = e.clientY - 12;
  if (x + tw > vw - 8) x = e.clientX - tw - 12;
  if (y + th > vh - 8) y = vh - th - 8;
  if (y < 8) y = 8;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}
document.addEventListener('mousemove', e => {
  if (tooltip.style.display === 'block') moveTip(e);
});

function toggleCS(ci, trigger) {
  const section = document.getElementById(`cs-${ci}`);
  if (!section) return;
  const collapsed = section.classList.toggle('collapsed');
  trigger?.setAttribute('aria-expanded', String(!collapsed));
}

function setMetric(m) {
  currentMetric = m;

  refreshCells();
  renderTable(parsedData.committers);
  renderComparisonPanel();

  // One call to redraw all sidebar UI that depends on metric
  renderSidebarDock();
}

function setYear(y) {
  activeYear = y === 'all' ? 'all' : Number(y);
  render();
}

function loadDemo() {
  const range = document.getElementById('range-select');
  const input = document.getElementById('log-input');

  range.value = '3';
  input.value = generateDemoLog({ years: 3 });
  updateCmd();
  parseStep();
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
}

function mkInit(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Keep the pinned + active sidebar renderer (and remove the duplicate that overwrote it)
function renderSidebarContributors() {
  const pinnedSlot = document.getElementById('sticky-contrib-pinned');
  const activeSlot = document.getElementById('sticky-contrib-active');
  const metaEl = document.getElementById('sidebar-contrib-meta');
  if (!pinnedSlot || !activeSlot) return;

  if (!parsedData) {
    pinnedSlot.innerHTML = '';
    activeSlot.innerHTML = '';
    if (metaEl) metaEl.textContent = '';
    return;
  }

  const {
    committers
  } = parsedData;

  const pinnedList = committers
    .filter(c => pinnedContributors.has(c.gi))
    .sort((a, b) => metricValueForContributor(b, currentMetric) - metricValueForContributor(a, currentMetric));

  const activeList = (activeYear === 'all' ? committers : committers.filter(c => metricValueForContributor(c,
      currentMetric) > 0))
    .filter(c => !pinnedContributors.has(c.gi))
    .sort((a, b) => metricValueForContributor(b, currentMetric) - metricValueForContributor(a, currentMetric));

  if (metaEl) {
    const count = (activeYear === 'all') ? committers.length : committers.filter(c => metricValueForContributor(c,
      currentMetric) > 0).length;
    metaEl.textContent = activeYear === 'all' ? `${count} total` : `${count} active in ${activeYear}`;
  }

  const rowHTML = (c, isPinned) => {
    const color = COLORS[c.colorIndex];
    const label = shortName(c.displayName);

    const v = metricValueForContributor(c, currentMetric);
    const unit = (currentMetric === 'active_days') ?
      'days' :
      metricLabel(currentMetric).toLowerCase();

    const sub = `${v.toLocaleString()} ${unit}` + (activeYear === 'all' ? '' : ` · ${activeYear}`);

    return `
      <div class="sidebar-contributor-row">
        <button type="button" class="sidebar-btn" data-action="jump-contributor" data-contributor-id="${c.gi}" title="${esc(c.displayName)}">
          <span class="sidebar-mini" style="background:${color}">${mkInit(c.displayName)}</span>
          <span class="sidebar-main">
            <span class="sidebar-name">${esc(label)}</span>
            <span class="sidebar-subtxt">${esc(sub)}</span>
          </span>
        </button>
        <button type="button" class="sidebar-pin ${isPinned ? 'pinned' : ''}"
                title="${isPinned ? 'Unpin' : 'Pin'}"
                aria-label="${isPinned ? 'Unpin contributor' : 'Pin contributor'}"
                aria-pressed="${isPinned}"
                data-action="toggle-pin" data-contributor-id="${c.gi}">
          ${isPinned ? '★' : '☆'}
        </button>
      </div>
    `;
  };

  if (!pinnedList.length) {
    pinnedSlot.innerHTML = `<div class="sidebar-empty">Pin contributors to keep them visible across years.</div>`;
  } else {
    pinnedSlot.innerHTML = pinnedList.map(c => rowHTML(c, true)).join('');
  }

  if (!activeList.length) {
    activeSlot.innerHTML =
      `<div class="sidebar-empty">No active contributors in this ${activeYear === 'all' ? 'range' : 'year'}.</div>`;
  } else {
    activeSlot.innerHTML = activeList.map(c => rowHTML(c, false)).join('');
  }
}

function toggleContributorPin(gi) {
  gi = +gi;
  if (!Number.isFinite(gi)) return;

  if (pinnedContributors.has(gi)) pinnedContributors.delete(gi);
  else pinnedContributors.add(gi);

  savePinnedContributors();
  renderSidebarContributors();
}

// ── EXPORT ───────────────────────────────────────────────────
function exportToFile() {
  if (!rawCommits.length) {
    alert('Nothing to export yet.');
    return;
  }
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    rangeYears: +document.getElementById('range-select').value,
    rawLog: document.getElementById('log-input').value,
    mergeGroups: mergeGroups.map(g => ({
      displayName: g.displayName,
      emails: [...g.emails],
      suggested: g.suggested || false
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = parsedData && parsedData.committers.length ?
    parsedData.committers[0].displayName.toLowerCase().replace(/\s+/g, '-') :
    'repo';
  a.download = `git-activity-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

// ── IMPORT ───────────────────────────────────────────────────
function importFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch (err) {
      alert('Could not parse file — make sure it is a git-activity JSON export.');
      return;
    }
    if (!payload.rawLog || !payload.mergeGroups) {
      alert('File is missing required fields (rawLog, mergeGroups).');
      return;
    }

    document.getElementById('log-input').value = payload.rawLog;
    if (payload.rangeYears) {
      const sel = document.getElementById('range-select');
      sel.value = String(payload.rangeYears);
      updateCmd();
    }

    let commits;
    try {
      commits = parseGitLog(payload.rawLog);
    } catch (err) {
      alert('Log data in file could not be parsed: ' + err.message);
      return;
    }
    rawCommits = commits;

    commitsByDate = {};
    for (const c of rawCommits) {
      if (c.date) {
        if (!commitsByDate[c.date]) commitsByDate[c.date] = [];
        commitsByDate[c.date].push(c);
      }
    }

    mergeGroups = payload.mergeGroups.map(g => ({
      displayName: g.displayName,
      emails: [...g.emails],
      suggested: g.suggested || false
    }));

    const knownEmails = new Set(rawCommits.map(c => c.email));
    mergeGroups = mergeGroups
      .map(g => ({
        ...g,
        emails: g.emails.filter(em => knownEmails.has(em))
      }))
      .filter(g => g.emails.length > 0);

    const coveredEmails = new Set(mergeGroups.flatMap(g => g.emails));
    rawCommits.forEach(c => {
      if (!coveredEmails.has(c.email)) {
        mergeGroups.push({
          displayName: c.name || c.email,
          emails: [c.email],
          suggested: false
        });
        coveredEmails.add(c.email);
      }
    });

    document.getElementById('import-banner-filename').textContent = file.name;
    document.getElementById('import-banner').hidden = false;

    applyAndRender();
  };
  reader.readAsText(file);
  event.target.value = '';
}

function dismissImportBanner() {
  document.getElementById('import-banner').hidden = true;
}

function mountStickyDock() {
  renderSidebarDock();
  syncStickyTogglesFromMain();
}

function syncStickyTogglesFromMain() {
  const mMain = document.getElementById('include-merges');
  const rMain = document.getElementById('penalise-reverts');

  const mSticky = document.getElementById('include-merges-sticky');
  const rSticky = document.getElementById('penalise-reverts-sticky');

  if (mMain && mSticky) mSticky.checked = !!mMain.checked;
  if (rMain && rSticky) rSticky.checked = !!rMain.checked;
}

function renderSidebarMetricList() {
  const slot = document.getElementById('sticky-metric-slot');
  if (!slot) return;

  const items = [{
      key: 'commits',
      label: 'Commits'
    },
    {
      key: 'lines_added',
      label: 'Lines Added'
    },
    {
      key: 'lines_deleted',
      label: 'Lines Deleted'
    },
    {
      key: 'files',
      label: 'Files Changed'
    },
    {
      key: 'active_days',
      label: 'Active Days'
    },
    {
      key: 'releases',
      label: 'Releases'
    }
  ];

  slot.innerHTML = items.map(it => `
  <button type="button" class="sidebar-btn ${currentMetric === it.key ? 'active' : ''}" data-action="set-metric" data-metric="${it.key}" aria-pressed="${currentMetric === it.key}">
    <span class="sidebar-dot" style="background:${currentMetric === it.key ? 'rgba(245,242,235,0.35)' : 'rgba(26,24,20,0.18)'}"></span>
    <span class="sidebar-name">${esc(it.label)}</span>
  </button>
`).join('');
}

function renderSidebarYearPills() {
  const slot = document.getElementById('sticky-year-slot');
  if (!slot || !parsedData) return;

  const {
    minDate,
    maxDate
  } = parsedData;
  const minY = +minDate.slice(0, 4);
  const maxY = +maxDate.slice(0, 4);

  let html =
    `<button type="button" class="sidebar-pill ${activeYear === 'all' ? 'active' : ''}" data-action="set-year" data-year="all" aria-pressed="${activeYear === 'all'}">All</button>`;
  for (let y = minY; y <= maxY; y++) {
    html +=
      `<button type="button" class="sidebar-pill ${activeYear == y ? 'active' : ''}" data-action="set-year" data-year="${y}" aria-pressed="${activeYear == y}">${y}</button>`;
  }
  slot.innerHTML = html;
}

function renderSidebarDock() {
  renderSidebarContributors();
  renderSidebarMetricList();
  renderSidebarYearPills();
}

const ACTIONS = {
  'choose-import': () => document.getElementById('file-import-input')?.click(),
  export: exportToFile,
  'dismiss-import-banner': dismissImportBanner,
  'copy-command': copyCmd,
  analyse: parseStep,
  'load-demo': loadDemo,
  'add-merge-group': addEmptyGroup,
  'render-dashboard': applyAndRender,
  'skip-merge': skipMerge,
  'set-comparison': (_event, trigger) => setCompTab(trigger.dataset.tab),
  'split-out': (_event, trigger) => splitOut(Number(trigger.dataset.groupIndex), trigger.dataset.email),
  'merge-into': (_event, trigger) => mergeInto(Number(trigger.dataset.groupIndex)),
  'split-all': (_event, trigger) => splitAll(Number(trigger.dataset.groupIndex)),
  'toggle-series': (_event, trigger) => toggleSeries(Number(trigger.dataset.contributorId)),
  'toggle-committer': (_event, trigger) => toggleCS(Number(trigger.dataset.committerIndex), trigger),
  'toggle-commit-day-heatmap': (event, trigger) => {
    event.stopPropagation();
    toggleCommitDayHeatmap(Number(trigger.dataset.contributorId));
  },
  'jump-contributor': (_event, trigger) => jumpToCommitter(Number(trigger.dataset.contributorId)),
  'toggle-pin': (event, trigger) => {
    event.stopPropagation();
    toggleContributorPin(Number(trigger.dataset.contributorId));
  },
  'set-metric': (_event, trigger) => setMetric(trigger.dataset.metric),
  'set-year': (_event, trigger) => setYear(trigger.dataset.year),
};

function runAction(event, trigger) {
  const handler = ACTIONS[trigger?.dataset.action];
  if (handler) handler(event, trigger);
}

function handleDocumentClick(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  runAction(event, trigger);
}



function handleDocumentKeydown(event) {
  const tab = event.target.closest('[role="tab"][data-tab]');
  if (!tab) return;

  const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"][data-tab]')];
  const index = tabs.indexOf(tab);
  let nextIndex = null;

  if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else return;

  event.preventDefault();
  const next = tabs[nextIndex];
  setCompTab(next.dataset.tab);
  next.focus();
}

function handleDocumentChange(event) {
  const { target } = event;
  switch (target.id) {
    case 'file-import-input':
      importFromFile(event);
      break;
    case 'range-select':
      updateCmd();
      break;
    case 'include-merges':
      onMergeToggle();
      break;
    case 'penalise-reverts':
      onRevertToggle();
      break;
    case 'include-merges-sticky': {
      const main = document.getElementById('include-merges');
      if (main) main.checked = target.checked;
      onMergeToggle();
      break;
    }
    case 'penalise-reverts-sticky': {
      const main = document.getElementById('penalise-reverts');
      if (main) main.checked = target.checked;
      onRevertToggle();
      break;
    }
    case 'h2h-a':
    case 'h2h-b':
      renderH2H();
      break;
  }
}

function handleDocumentInput(event) {
  const input = event.target.closest('[data-merge-name-index]');
  if (!input) return;
  const index = Number(input.dataset.mergeNameIndex);
  if (mergeGroups[index]) mergeGroups[index].displayName = input.value;
}

function handleDayHourPointerOver(event) {
  const cell = event.target.closest('[data-dh-tip]');
  if (!cell || cell.contains(event.relatedTarget)) return;
  dhTip(
    event,
    Number(cell.dataset.dow),
    Number(cell.dataset.hour),
    Number(cell.dataset.value),
    cell.dataset.dayName,
    Number(cell.dataset.committerIndex),
  );
}

function handleDayHourPointerOut(event) {
  const cell = event.target.closest('[data-dh-tip]');
  if (!cell || cell.contains(event.relatedTarget)) return;
  hideDhTip();
}

function init() {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleDocumentKeydown);
  document.addEventListener('change', handleDocumentChange);
  document.addEventListener('input', handleDocumentInput);
  document.addEventListener('pointerover', handleDayHourPointerOver);
  document.addEventListener('pointerout', handleDayHourPointerOut);

  pinnedContributors = loadPinnedContributors();
  updateCmd();
  setCompTab(activeCompTab);
}

init();
