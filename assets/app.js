import {
  METRICS, DAY_NAMES, TIME_BANDS, buildAnalysis, getDateBounds, pulseDayDetails, workingRhythm, mondayOf, dayNumber, dateAtDay,
  periodForPreset, seriesForAnalysis, moveContributorIdentities,
  valueInMode, displayModeLabel, sum, seasonalityAnalysis, seasonalMonthValue,
  parseGitHistory, getHistoryDateBounds,
} from './domain.js?v=impact-20261031-2';
import { generateDemoLog } from './demo-data.js?v=impact-20261031-2';
import { impactAnalysis, IMPACT_METRICS } from './impact.js?v=impact-20261031-2';
import { impactSelectMessage, impactSummary, impactTimeline, impactReleasePicker, impactReleaseDetail, impactReleaseMatrix, impactReach, impactDurability } from './impact-view.js?v=impact-20261031-2';

const COLORS = ['#13735a','#dd7853','#5379ba','#9170ac','#b88b3c','#3f9a9a','#c66887','#687e41','#c07648','#5376a0','#8c5c79','#508e65'];
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const percent = n => `${decimal.format(n)}%`;
const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const color = id => COLORS[Number(id) % COLORS.length];
const style = id => `--person:${color(id)}`;
const empty = (msg) => `<div class="empty-state">${esc(msg)}</div>`;
const formatDate = d => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' }) : '—';
const metricValue = (c, key) => c?.totals[key] || 0;

let rawCommits = [];
let rawTags = [];
let impactModel = null;
// Tag events may be later than the newest authored commit. The shared
// window includes their dates, while all contributor counts remain author-based.
const sourceDateBounds=()=>getHistoryDateBounds(rawCommits,rawTags);
let mergeGroups = [];
let identityMeta = new Map();
let identityPicker = null; // { targetIndex, selected: Set, query } — staged until Apply
let mergeUndo = null;
let analysis = null;
let pendingImport = null;
let tableRows = [];
const state = {
  selectedIds: new Set(), search: '',
  period: 'all', start: null, end: null,
  includeMerges: false, includeReverts: true,
  metric: 'commits', mode: 'total', denominator: 'repository',
  trend: 'rolling', pulseMode: 'monthly', rhythmFocus: 'selection', rhythmDisplay: 'heatmap',
  rhythmTab: 'weekly', seasonMode: 'rate', seasonYears: null, sortKey: 'lens', sortDesc: true,
  impactTab:'timeline',impactMetric:'commits',impactAreaMode:'touches',impactReleaseHash:null,impactShowAll:false,
};

function setText(id, content) { $(id).textContent = content; }
// The capture command is static HTML, so it remains visible even if a
// previously cached JavaScript module fails before it can initialise the UI.
// The lookback selector affects only the dashboard's initial author-date scope.
function copyCommand() {
  if (!navigator.clipboard) return setText('parse-error', 'Clipboard unavailable. Select and copy the command manually.');
  navigator.clipboard.writeText($('git-cmd').textContent)
    .then(() => { setText('parse-error', 'Command copied.'); })
    .catch(() => setText('parse-error', 'Clipboard blocked. Select and copy the command manually.'));
}

// ---- Identity reconciliation: email is the durable identity key. ----
function makeIdentityCatalogue(commits) {
  const catalogue = new Map();
  for (const commit of commits) {
    if (!catalogue.has(commit.email)) catalogue.set(commit.email, {
      nameCounts: new Map(), commits: 0, date: commit.date,
    });
    const item = catalogue.get(commit.email);
    item.commits++;
    item.nameCounts.set(commit.name, (item.nameCounts.get(commit.name) || 0) + 1);
    if (commit.date > item.date) item.date = commit.date;
  }
  return new Map([...catalogue].map(([email, item]) => {
    const best = [...item.nameCounts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || email;
    return [email, { name: best, aliases: [...item.nameCounts.keys()], commits: item.commits, date: item.date }];
  }));
}
function makeMergeSuggestions() {
  const byName = new Map();
  for (const [email, meta] of identityMeta) {
    const key = meta.name.trim().toLocaleLowerCase();
    if (!byName.has(key)) byName.set(key, { displayName: meta.name, emails: [] });
    byName.get(key).emails.push(email);
  }
  return [...byName.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
function mergeCandidates(index, query = '') {
  const text = query.trim().toLocaleLowerCase();
  return mergeGroups.flatMap((g, i) => i === index ? [] : [{ index: i, group: g,
    emails: g.emails.filter(email => {
      const meta = identityMeta.get(email);
      return !text || [email, g.displayName, meta?.name, ...(meta?.aliases || [])]
        .some(value => String(value || '').toLocaleLowerCase().includes(text));
    }),
  }]).filter(entry => entry.emails.length);
}
function countWord(n, singular, plural = `${singular}s`) { return `${number.format(n)} ${n === 1 ? singular : plural}`; }
function renderMergeFeedback(message = '', canUndo = false) {
  const el = $('merge-feedback');
  el.hidden = !message;
  el.innerHTML = message ? `<span>${esc(message)}</span>${canUndo ? '<button type="button" data-action="undo-identity-merge" class="text-button">Undo merge</button>' : ''}` : '';
}
function forgetUndo() {
  mergeUndo = null;
  renderMergeFeedback();
}
function identityRows(index) {
  const picker = identityPicker;
  const groups = mergeCandidates(index, picker.query);
  if (!groups.length) return '<div class="identity-picker-empty">No matching identities. Try a name or email address.</div>';
  return groups.map(({group, emails}) => `<div class="identity-source" role="group" aria-label="Identities currently under ${esc(group.displayName)}">
    <div class="identity-source-head"><span>${esc(group.displayName)}</span><span>${countWord(emails.length, 'identity', 'identities')}</span></div>
    ${emails.map(email => {
      const meta = identityMeta.get(email);
      const checked = picker.selected.has(email);
      return `<label class="identity-option ${checked ? 'is-selected' : ''}">
        <input type="checkbox" data-identity-email="${esc(email)}" ${checked ? 'checked' : ''}>
        <span class="identity-option-text"><strong>${esc(meta?.name || group.displayName)}</strong><small title="${esc(email)}">${esc(email)}</small></span>
        <span class="identity-option-count">${countWord(meta?.commits || 0, 'commit')}</span>
      </label>`;
    }).join('')}
  </div>`).join('');
}
function renderIdentityPicker(index) {
  const all = mergeCandidates(index).flatMap(g => g.emails).length;
  return `<div id="identity-picker-${index}" class="identity-picker" aria-label="Add Git identities to ${esc(mergeGroups[index].displayName)}">
    <div class="identity-picker-heading"><div><span class="eyebrow">LINK GIT IDENTITIES</span><h3>Add multiple identities</h3><p>Choose any number of author emails. Only checked identities will move to this contributor.</p></div><button type="button" class="identity-picker-close" data-action="cancel-identity-picker" aria-label="Close identity picker">×</button></div>
    <label for="identity-search-${index}" class="identity-search-label">FIND IDENTITIES <span>${number.format(all)} available</span></label>
    <input id="identity-search-${index}" class="identity-search" type="search" data-identity-search placeholder="Search contributor or email…" autocomplete="off" spellcheck="false">
    <div class="identity-picker-utilities"><span id="identity-visible-${index}" class="helper">${countWord(all, 'identity', 'identities')} shown</span><div><button type="button" class="text-button" data-action="select-visible-identities">Select shown</button><button type="button" class="text-button" data-action="clear-identity-selection">Clear selection</button></div></div>
    <div class="identity-option-list" id="identity-list-${index}" role="group" aria-label="Available author identities">${identityRows(index)}</div>
    <div class="identity-picker-bottom"><div class="identity-picker-recap" id="identity-recap-${index}" role="status" aria-live="polite"></div><div class="identity-picker-buttons"><button type="button" class="button outline" data-action="cancel-identity-picker">Cancel</button><button type="button" class="button primary" id="identity-apply-${index}" data-action="apply-identity-picker" disabled>Move selected identities</button></div></div>
  </div>`;
}
function renderMergeUI() {
  $('merge-groups').innerHTML = mergeGroups.map((group, index) => {
    const open = identityPicker?.targetIndex === index;
    const available = mergeGroups.some((g, i) => i !== index && g.emails.length);
    const groupCommits = sum(group.emails.map(email => identityMeta.get(email)?.commits || 0));
    return `<article class="merge-group ${open ? 'merge-group-open' : ''}">
      <div class="merge-group-main">
        <div class="merge-group-name"><label for="merge-name-${index}">CONTRIBUTOR NAME</label><input id="merge-name-${index}" data-merge-name="${index}" value="${esc(group.displayName)}" placeholder="Name this contributor" maxlength="160"><p class="merge-group-caption">${countWord(groupCommits, 'commit')} in imported history</p></div>
        <div class="merge-group-identities"><div class="merge-identity-heading"><span>AUTHOR EMAILS</span><span class="merge-identity-total">${countWord(group.emails.length, 'identity', 'identities')}</span></div>
          <div class="identity-chips">${group.emails.length ? group.emails.map(email => `<span class="chip"><span title="${esc(email)}">${esc(email)}</span>${group.emails.length > 1 ? `<button type="button" data-action="split-email" data-group="${index}" data-email="${esc(email)}" aria-label="Separate ${esc(email)} from ${esc(group.displayName)}" title="Separate this identity">×</button>` : ''}</span>`).join('') : '<span class="merge-group-caption">No identities yet. Select author emails to build this contributor.</span>'}</div>
          <div class="merge-add"><button type="button" class="merge-add-trigger" data-action="toggle-identity-picker" data-group="${index}" aria-expanded="${open}" ${open ? `aria-controls="identity-picker-${index}"` : ''} ${!available ? 'disabled title="No other identities available"' : ''}><span class="merge-plus" aria-hidden="true">${open ? '−' : '+'}</span>${open ? 'Close selector' : 'Add identities'}<span class="merge-plus-chevron" aria-hidden="true">${open ? '⌃' : '⌄'}</span></button>${group.emails.length > 1 ? `<button class="mini-button" type="button" data-action="split-group" data-group="${index}">Separate all</button>` : ''}</div>
        </div>
      </div>
      ${open ? renderIdentityPicker(index) : ''}
    </article>`;
  }).join('');
  if (identityPicker) updateIdentityPickerSummary();
}
function requireResolvedIdentitySelection() {
  if (!identityPicker?.selected.size) return false;
  renderMergeFeedback('Apply or cancel the pending identity selection before another edit.');
  $(`identity-apply-${identityPicker.targetIndex}`)?.focus();
  return true;
}
function openIdentityPicker(index) {
  if (!mergeGroups[index] || !mergeCandidates(index).length) return;
  if (identityPicker?.targetIndex === index) return closeIdentityPicker();
  if (requireResolvedIdentitySelection()) return;
  identityPicker = {targetIndex:index, selected:new Set(), query:''};
  renderMergeUI();
  $(`identity-search-${index}`)?.focus();
}
function closeIdentityPicker({ restoreFocus = true } = {}) {
  if (!identityPicker) return;
  const index = identityPicker.targetIndex;
  identityPicker = null;
  renderMergeUI();
  if (restoreFocus) $('merge-groups').querySelector(`[data-action="toggle-identity-picker"][data-group="${index}"]`)?.focus({preventScroll:true});
}
function refreshIdentityOptions() {
  if (!identityPicker) return;
  const index = identityPicker.targetIndex;
  $(`identity-list-${index}`).innerHTML = identityRows(index);
  const shown = mergeCandidates(index, identityPicker.query).flatMap(g => g.emails).length;
  setText(`identity-visible-${index}`, `${countWord(shown, 'identity', 'identities')} shown`);
  updateIdentityPickerSummary();
}
function updateIdentityPickerSummary() {
  if (!identityPicker) return;
  const {targetIndex, selected} = identityPicker;
  const sourceEntries = mergeCandidates(targetIndex);
  const sourceGroups = sourceEntries.filter(entry => entry.emails.some(email => selected.has(email)));
  const removedGroups = sourceGroups.filter(entry => entry.emails.every(email => selected.has(email)));
  const commits = sum([...selected].map(email => identityMeta.get(email)?.commits || 0));
  const recap = $(`identity-recap-${targetIndex}`);
  recap.innerHTML = selected.size
    ? `<strong>${countWord(selected.size, 'identity', 'identities')} · ${countWord(commits, 'commit')}</strong><span>Move from ${countWord(sourceGroups.length, 'contributor')}${removedGroups.length ? ` · ${countWord(removedGroups.length, 'source group')} will be emptied` : ''}. Changes apply to every chart when you build the dashboard.</span>`
    : `<strong>No identities selected</strong><span>Select one or more author emails above. Your existing identities will be kept.</span>`;
  const apply = $(`identity-apply-${targetIndex}`);
  apply.disabled = !selected.size;
  apply.textContent = selected.size ? `Move ${countWord(selected.size, 'identity', 'identities')}` : 'Move selected identities';
}
function applyIdentityPicker() {
  if (!identityPicker?.selected.size) return;
  const {targetIndex, selected} = identityPicker;
  const target = mergeGroups[targetIndex];
  const original = mergeGroups.map(g => ({displayName:g.displayName, emails:[...g.emails]}));
  const moved = [...selected];
  // Reference the destination by email, not by its old array index: groups
  // before it may disappear as their final identities move.
  const targetEmail = target.emails[0] || moved[0];
  const next = moveContributorIdentities(mergeGroups, targetIndex, moved);
  if (next === mergeGroups) return closeIdentityPicker();
  mergeGroups = next;
  identityPicker = null;
  mergeUndo = original;
  renderMergeUI();
  const newIndex = mergeGroups.findIndex(g => g.emails.includes(targetEmail));
  const btn = $('merge-groups').querySelector(`[data-action="toggle-identity-picker"][data-group="${newIndex}"]`);
  btn?.focus({preventScroll:true});
  renderMergeFeedback(`Moved ${countWord(moved.length, 'identity', 'identities')} into ${mergeGroups[newIndex]?.displayName || 'the contributor'}.`, true);
}
function undoIdentityMerge() {
  if (!mergeUndo || requireResolvedIdentitySelection()) return;
  mergeGroups = mergeUndo;
  mergeUndo = null;
  identityPicker = null;
  renderMergeUI();
  renderMergeFeedback('Identity move undone.');
}
function splitEmail(index, email) {
  const group = mergeGroups[index];
  if (!group || group.emails.length <= 1 || !group.emails.includes(email) || requireResolvedIdentitySelection()) return;
  identityPicker = null;
  forgetUndo();
  group.emails = group.emails.filter(e => e !== email);
  if (!group.emails.length) mergeGroups.splice(index, 1);
  mergeGroups.push({displayName: identityMeta.get(email)?.name || email, emails:[email]});
  renderMergeUI();
}
function splitGroup(index) {
  const group = mergeGroups[index];
  if (!group || group.emails.length <= 1 || requireResolvedIdentitySelection()) return;
  identityPicker = null;
  forgetUndo();
  const emails = [...group.emails];
  mergeGroups.splice(index, 1);
  for (const email of emails) mergeGroups.push({displayName: identityMeta.get(email)?.name || email, emails:[email]});
  renderMergeUI();
}
function skipMerge() {
  const byEmail = new Map();
  for (const c of rawCommits) if (!byEmail.has(c.email)) byEmail.set(c.email,c.name);
  identityPicker = null;
  mergeUndo = null;
  mergeGroups = [...byEmail.entries()].map(([email,name])=>({ displayName:name, emails:[email] }));
  buildDashboard();
}
function analyse() {
  setText('parse-error','');
  const raw = $('log-input').value.trim();
  if (!raw) return setText('parse-error','Paste a git log or load the demo.');
  try { const history = parseGitHistory(raw); rawCommits = history.commits; rawTags = history.tags; }
  catch(error) { return setText('parse-error',error.message); }
  pendingImport = null;
  identityMeta = makeIdentityCatalogue(rawCommits);
  identityPicker = null;
  mergeUndo = null;
  renderMergeFeedback();
  mergeGroups = makeMergeSuggestions();
  $('merge-step').hidden = false;
  $('dashboard').hidden = true;
  $('export-btn').hidden = true;
  renderMergeUI();
  $('merge-step').scrollIntoView({ behavior:'smooth', block:'start' });
}
function loadDemo() {
  $('range-select').value='3';
  $('log-input').value=generateDemoLog({years:3,commits:720});
  analyse();
}
function syncScopeAfterLoad() {
  const { min,max } = sourceDateBounds();
  const years = Math.max(1, Math.min(5, Number($('range-select').value) || 3));
  const anchored = new Date(`${max}T12:00:00Z`);
  const y = anchored.getUTCFullYear() - years, m = anchored.getUTCMonth();
  const maxDay = new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const anniversary = new Date(Date.UTC(y,m,Math.min(anchored.getUTCDate(),maxDay))).toISOString().slice(0,10);
  const desiredStart = dateAtDay(dayNumber(anniversary)+1);
  const initialStart = min > desiredStart ? min : desiredStart;
  Object.assign(state, { period:initialStart===min?'all':'custom',start:initialStart,end:max,includeMerges:false,includeReverts:true,
    metric:'commits',mode:'total',denominator:'repository',trend:'rolling',pulseMode:'monthly',rhythmFocus:'selection',rhythmDisplay:'heatmap',rhythmTab:'weekly',seasonMode:'rate',seasonYears:null,sortKey:'lens',sortDesc:true,search:'',impactTab:'timeline',impactMetric:'commits',impactAreaMode:'touches',impactReleaseHash:null,impactShowAll:false });
  state.selectedIds = new Set(mergeGroups.map((_,i)=>String(i)));
  if (pendingImport?.scope) {
    const s = pendingImport.scope;
    if (METRICS[s.metric]) state.metric=s.metric;
    if (['total','share','per_active_day','per_week'].includes(s.mode)) state.mode=s.mode;
    if (['selection','repository'].includes(s.denominator)) state.denominator=s.denominator;
    state.includeMerges=!!s.includeMerges;
    state.includeReverts=s.includeReverts !== false;
    if (typeof s.period==='string') state.period=s.period;
    if (['rolling','weekly','cumulative'].includes(s.trend)) state.trend=s.trend;
    if (['monthly','daily'].includes(s.pulseMode)) state.pulseMode=s.pulseMode;
    if (['heatmap','clock','bars'].includes(s.rhythmDisplay)) state.rhythmDisplay=s.rhythmDisplay;
    if (['weekly','years','seasonal'].includes(s.rhythmTab)) state.rhythmTab=s.rhythmTab;
    if (['rate','shape','index'].includes(s.seasonMode)) state.seasonMode=s.seasonMode;
    if (['timeline','matrix','reach','durability'].includes(s.impactTab)) state.impactTab=s.impactTab;
    if (IMPACT_METRICS[s.impactMetric]) state.impactMetric=s.impactMetric;
    if (['touches','within'].includes(s.impactAreaMode)) state.impactAreaMode=s.impactAreaMode;
    if (typeof s.impactReleaseHash==='string') state.impactReleaseHash=s.impactReleaseHash;
    state.impactShowAll=!!s.impactShowAll;
    if (Array.isArray(s.seasonYears)) state.seasonYears=new Set(s.seasonYears.filter(y=>Number.isInteger(y)&&y>=1900&&y<=2200));
    if (s.start && s.end && s.start <= s.end && /^\d{4}-\d\d-\d\d$/.test(s.start) && /^\d{4}-\d\d-\d\d$/.test(s.end)) {
      state.start=s.start; state.end=s.end;
    }
    if (typeof s.rhythmFocusEmail === 'string') {
      const i=mergeGroups.findIndex(g=>g.emails.includes(s.rhythmFocusEmail));
      state.rhythmFocus=i<0?'selection':String(i);
    }
    if (Array.isArray(s.selectedEmails)) {
      const emails = new Set(s.selectedEmails);
      state.selectedIds = new Set(mergeGroups.flatMap((g,i)=>g.emails.some(e=>emails.has(e)) ? [String(i)] : []));
    }
  }
  pendingImport=null;
}
function buildDashboard() {
  if (requireResolvedIdentitySelection()) return;
  identityPicker = null;
  mergeUndo = null;
  mergeGroups=mergeGroups.filter(g=>g.emails.length);
  syncScopeAfterLoad();
  $('merge-step').hidden=true;
  $('dashboard').hidden=false;
  $('export-btn').hidden=false;
  $('source-details').open=false;
  setText('source-status',`${number.format(rawCommits.length)} commits · ${number.format(rawTags.length)} tags imported · identities reviewed`);
  $('contributor-search').value='';
  configureOptions();
  renderDashboard();
  $('dashboard').scrollIntoView({ behavior:'smooth',block:'start' });
}
function configureOptions() {
  const years=[...new Set([...rawCommits.map(c=>c.date?.slice(0,4)),...rawTags.map(t=>t.taggedDate?.slice(0,4))].filter(Boolean))].sort().reverse();
  $('period-select').innerHTML=`<option value="all">All imported dates</option><option value="90d">Latest 90 days</option><option value="365d">Latest 365 days</option><option value="730d">Latest 730 days</option>${years.map(y=>`<option value="year-${y}">Calendar year ${y}</option>`).join('')}<option value="custom">Custom date range</option>`;
  $('metric-select').innerHTML=Object.entries(METRICS).map(([key,m])=>`<option value="${key}">${esc(m.label)}</option>`).join('');
}
function updatePeriod(preset) {
  state.period=preset;
  if (preset !== 'custom') {
    const dates=periodForPreset(rawCommits,preset,sourceDateBounds());
    state.start=dates.start;state.end=dates.end;
  }
  renderDashboard();
}
function changeDate() {
  const start=$('date-from').value, end=$('date-to').value;
  if (!start || !end || start > end) {
    setText('scope-error','Please choose a valid start date on or before the end date. Previous valid range remains active.');
    // Avoid showing a date range on the controls which differs from the charts.
    $('date-from').value=state.start || '';
    $('date-to').value=state.end || '';
    return;
  }
  state.period='custom';state.start=start;state.end=end;
  setText('scope-error','');
  renderDashboard();
}
function resetFilters() {
  Object.assign(state,{ period:'all',start:sourceDateBounds().min,end:sourceDateBounds().max,
    includeMerges:false,includeReverts:true,metric:'commits',mode:'total',denominator:'repository',trend:'rolling',pulseMode:'monthly',rhythmFocus:'selection',rhythmDisplay:'heatmap',rhythmTab:'weekly',seasonMode:'rate',seasonYears:null,sortKey:'lens',sortDesc:true,search:'',impactTab:'timeline',impactMetric:'commits',impactAreaMode:'touches',impactReleaseHash:null,impactShowAll:false });
  state.selectedIds=new Set(mergeGroups.map((_,i)=>String(i)));
  $('contributor-search').value='';
  setText('scope-error','');
  renderDashboard();
}
function selectedCountText(view) {
  const name = view.selectedIds.size === 1 ? 'person' : 'people';
  return `${view.selectedIds.size} ${name} selected of ${view.groupDefs.length}`;
}
function renderPicker() {
  const query=state.search.trim().toLocaleLowerCase();
  const view=analysis;
  const oldScroll=$('contributor-picker').scrollTop;
  setText('people-count', `${view.selectedIds.size} / ${view.groupDefs.length} selected`);
  const groups=view.groupDefs.filter(g=>`${g.displayName} ${g.emails.join(' ')}`.toLocaleLowerCase().includes(query));
  $('contributor-picker').innerHTML = groups.length ? groups.map(g => {
    const checked=view.selectedIds.has(g.id);
    return `<div class="picker-person" style="${style(g.id)}"><label><input type="checkbox" data-person-id="${g.id}" ${checked?'checked':''}><i class="person-dot" aria-hidden="true"></i><span class="picker-person-name" title="${esc(g.displayName)}">${esc(g.displayName)}</span></label><button type="button" class="solo-button" data-action="solo" data-person-id="${g.id}" aria-label="Select only ${esc(g.displayName)}">Solo</button></div>`;
  }).join('') : `<div class="picker-empty">No matching names. Search only affects this picker.</div>`;
  $('contributor-picker').scrollTop=oldScroll;
}
function updateControls() {
  $('period-select').value=state.period;
  if ($('period-select').selectedIndex === -1) $('period-select').value='custom';
  $('date-from').value=state.start||'';$('date-to').value=state.end||'';
  $('filter-merges').checked=state.includeMerges;
  $('filter-reverts').checked=state.includeReverts;
  $('metric-select').value=state.metric;
  $('mode-select').value=state.mode;
  $('denominator-select').value=state.denominator;
  $('denominator-select').disabled=false;
  $('metric-explanation').textContent=`${METRICS[state.metric].note}. ${state.mode==='share' ? 'Share uses the reference selected below.' : 'Reference is used for percent context and hotspots.'}`;
  document.querySelectorAll('[data-trend]').forEach(btn=>{const yes=btn.dataset.trend===state.trend;btn.classList.toggle('active',yes);btn.setAttribute('aria-pressed',String(yes));});
  document.querySelectorAll('[data-pulse-mode]').forEach(btn=>{const yes=btn.dataset.pulseMode===state.pulseMode;btn.classList.toggle('active',yes);btn.setAttribute('aria-pressed',String(yes));});
}
function renderScope(view) {
  const policy=`${view.includeMerges?'merges included':'merges excluded'} · ${view.includeReverts?'reverts included':'reverts excluded'}`;
  const lens=`${METRICS[view.metric].label.toLowerCase()} · ${displayModeLabel(state.mode).toLowerCase()}`;
  const reference=` · reference: ${view.denominator==='repository'?'all contributors':'selected people'}`;
  setText('scope-description', `${selectedCountText(view)} · ${view.start} to ${view.end} · ${policy} · ${lens}${reference}`);
  const total = rawCommits.length;
  setText('data-coverage', `Dataset: ${number.format(total)} deduplicated, dated commits · ${formatDate(view.min)} – ${formatDate(view.max)} · ${view.groupDefs.length} reconciled identities`);
}
function formatLens(v, mode=state.mode) {return v==null?'—':mode==='share' ? percent(v) : decimal.format(v);}
function lensFor(c,view=analysis) {
  return valueInMode(metricValue(c,view.metric),{mode:state.mode,reference:view.referenceTotal,activeDays:c.totals.active_days,calendarDays:view.spanDays});
}
function renderStats(view) {
  const selected=view.selectedSummary, ref=view.referenceSummary;
  const selectedMetric=selected.totals[view.metric];
  const lens=(state.mode==='share' && !ref.totals[view.metric]) || (state.mode==='per_active_day' && !selected.totals.active_days)
    ? null : valueInMode(selectedMetric,{mode:state.mode,reference:ref.totals[view.metric],activeDays:selected.totals.active_days,calendarDays:view.spanDays});
  const lensFooter=lens===null?'No activity to form a valid denominator'
    :state.mode==='total'?'Across all selected contributors'
    :state.mode==='share'? `Of ${view.denominator==='repository'?'all repository':'selected'} ${METRICS[view.metric].unit}`
    :state.mode==='per_active_day'? `Per selected contributor-day · ${number.format(selected.totals.active_days)} days`
    : `Over ${view.spanDays} calendar days (including quiet days)`;
  const metrics=[
    ['PEOPLE WITH ACTIVITY',number.format(selected.contributingPeople),`${view.selectedIds.size} selected · ${view.groupDefs.length} in repository`,false],
    [METRICS[view.metric].label.toUpperCase() + (state.mode==='total'?'':` · ${displayModeLabel(state.mode).toUpperCase()}`),formatLens(lens),lensFooter,true],
    ['CONTRIBUTOR-DAYS',number.format(selected.totals.active_days),`${selected.calendarDays} distinct calendar dates with activity`,false],
    ['TOTAL LINE CHURN',number.format(selected.totals.churn),`${number.format(selected.totals.lines_added)} added / ${number.format(selected.totals.lines_deleted)} deleted`,false],
  ];
  $('overview-stats').innerHTML=metrics.map(([title,value,foot,featured])=>`<div class="stat-card ${featured?'emphasis':''}"><div class="eyebrow">${esc(title)}</div><div class="stat-number">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></div>`).join('');
  if (!view.selectedIds.size) return setText('insight-strip','Select one or more contributors above to reveal the comparisons.');
  if (!selected.commits) return setText('insight-strip','No commits match this exact scope. Try another date window or change the merge/revert policy.');
  if (!selectedMetric) return setText('insight-strip', `No ${METRICS[view.metric].label.toLowerCase()} were recorded in this scope. Choose another measure or broaden the selection.`);
  const ranked=[...view.contributors].sort((a,b)=>metricValue(b,view.metric)-metricValue(a,view.metric));
  const first=ranked[0];
  const second=ranked[1];
  const refMetric=view.referenceTotal;
  const figure=refMetric ? percent(metricValue(first,view.metric)/refMetric*100) : '0%';
  $('insight-strip').innerHTML=`<strong>${esc(first.displayName)}</strong> accounts for <strong>${esc(figure)}</strong> of ${esc(METRICS[view.metric].label.toLowerCase())} in the ${view.denominator==='repository'?'repository':'selected cohort'}${second?`; <strong>${esc(second.displayName)}</strong> follows at <strong>${esc(number.format(metricValue(second,view.metric)))}</strong>.`:'.'} These are measures of recorded activity, not a ranking of performance.`;
}
function renderRanking(view) {
  const label=METRICS[view.metric].label;
  setText('ranking-context',`${label.toUpperCase()} / ${displayModeLabel(state.mode).toUpperCase()}`);
  setText('ranking-scale',state.mode==='share'? view.referenceTotal ? 'Bar width: 100% = entire reference group' : 'No reference activity; shares are undefined' : 'Bar width: longest = largest selected value (same scale for all)');
  if(!view.contributors.length) return $('ranking').innerHTML=empty('No people selected. Select one or many above.');
  const ordered=[...view.contributors].sort((a,b)=>lensFor(b,view)-lensFor(a,view) || a.displayName.localeCompare(b.displayName));
  const maximum=state.mode==='share'?100:Math.max(...ordered.map(c=>lensFor(c,view)),1);
  $('ranking').innerHTML=ordered.map((c,i)=>{
    const metric=metricValue(c,view.metric);
    const share=view.referenceTotal ? metric/view.referenceTotal*100 : 0;
    const val=(state.mode==='share'&&!view.referenceTotal)||(state.mode==='per_active_day'&&!c.totals.active_days)?null:lensFor(c,view);
    const side=state.mode==='total'?(view.referenceTotal?`${percent(share)} of reference`:'No reference activity')
      :state.mode==='share'?`${number.format(metric)} ${METRICS[view.metric].unit}`
      :state.mode==='per_active_day'?`${number.format(metric)} / ${c.totals.active_days} active days`
      :`${number.format(metric)} over ${view.spanDays} days`;
    return `<div class="ranking-row" style="${style(c.id)}"><div class="ranking-person"><span class="ranking-index">${String(i+1).padStart(2,'0')}</span><i class="person-dot" aria-hidden="true"></i><span class="ranking-name" title="${esc(c.displayName)}">${esc(c.displayName)}</span></div><div class="ranking-track" title="${esc(c.displayName)}: ${esc(formatLens(val))}"><div class="ranking-fill" style="width:${maximum&&val!==null?Math.min(100,Math.max(0,val/maximum*100)):0}%"></div></div><div class="ranking-value">${esc(formatLens(val))}<small>${esc(side)}</small></div></div>`;
  }).join('');
}


function chartTicks(view,lines,axisMax) {
  const out=[];
  for(let i=0;i<=4;i++){
    const val=axisMax*i/4;
    out.push({ v:val,label:state.mode==='share'?`${number.format(val)}%`:val>=1000?new Intl.NumberFormat('en-GB',{notation:'compact',maximumFractionDigits:1}).format(val):decimal.format(val) });
  }
  return out;
}
function renderTrend(view) {
  setText('trend-axis-label',`${displayModeLabel(state.mode).toUpperCase()} / ${METRICS[view.metric].label.toUpperCase()}`);
  const note=state.trend==='rolling' ? 'Trailing 4 calendar weeks · totals or rates calculated from summed evidence'
    : state.trend==='weekly' ? 'Raw calendar weeks · edge weeks use only dates within the selection'
    : 'Cumulative from the start of the selected period';
  setText('trend-note',note+(state.mode==='per_week'?' · partial weeks annualised to 7-day equivalents':''));
  if(!view.contributors.length || !view.weeks.length || (state.mode==='share' && !view.referenceTotal)) {
    $('trend-chart').innerHTML=empty(state.mode==='share'&&!view.referenceTotal?'No reference events for this measure; a percentage cannot be calculated.':'No matching time series for this scope.');
    $('trend-legend').innerHTML='';return;
  }
  const {weeks,lines}=seriesForAnalysis(view,{mode:state.mode,trend:state.trend});
  const W=990,H=266,L=56,R=18,T=14,B=39;
  const cw=W-L-R,ch=H-T-B;
  const mx=state.mode==='share'?100:Math.max(1,...lines.flatMap(s=>s.vals.filter(v=>v!==null)));
  const x=i=>L+(weeks.length===1?.5:i/(weeks.length-1))*cw;
  const y=v=>T+ch-(v/mx)*ch;
  let svg=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(state.trend==='rolling'?'Trailing four-week':state.trend==='weekly'?'Weekly':'Cumulative')} ${esc(METRICS[view.metric].label)} for ${view.contributors.length} selected contributors">`;
  for(const tick of chartTicks(view,lines,mx)){
    const py=y(tick.v);
    svg+=`<line x1="${L}" y1="${py}" x2="${W-R}" y2="${py}" stroke="#e4e9e1" stroke-width="1"/><text x="${L-10}" y="${py}" fill="#697970" font-size="10" text-anchor="end" dominant-baseline="middle" font-family="IBM Plex Mono,monospace">${esc(tick.label)}</text>`;
  }
  const labelIndexes=new Set();
  const labels=Math.min(8,weeks.length);
  for(let i=0;i<labels;i++) labelIndexes.add(Math.round(i*(weeks.length-1)/Math.max(1,labels-1)));
  for(const index of labelIndexes){
    const week=weeks[index];
    const lbl=new Date(`${week}T12:00:00Z`).toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'});
    svg+=`<text x="${x(index)}" y="${H-15}" fill="#697970" font-size="10" text-anchor="middle" font-family="IBM Plex Mono,monospace">${esc(lbl)}</text>`;
  }
  for(const {c,vals} of lines){
    // Nulls are undefined ratios, not zero. Break the line across these
    // windows rather than drawing a deceptively continuous zero segment.
    const runs=[];let run=[];
    for(let i=0;i<vals.length;i++){
      if(vals[i]===null){if(run.length)runs.push(run);run=[];}
      else run.push({i,v:vals[i]});
    }
    if(run.length)runs.push(run);
    for(const points of runs){
      if(points.length>1)svg+=`<polyline points="${points.map(({i,v})=>`${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')}" stroke="${color(c.id)}" fill="none" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      else svg+=`<circle cx="${x(points[0].i)}" cy="${y(points[0].v)}" r="2.7" fill="${color(c.id)}"/>`;
    }
    const last=runs.at(-1)?.at(-1);
    if(last)svg+=`<circle cx="${x(last.i)}" cy="${y(last.v)}" r="3.4" fill="${color(c.id)}"/>`;
  }
  svg+=`<line id="chart-cursor" x1="${L}" x2="${L}" y1="${T}" y2="${T+ch}" stroke="#5b665e" stroke-dasharray="3 4" visibility="hidden"/><rect x="${L}" y="${T}" width="${cw}" height="${ch}" fill="transparent" data-chart-hit="true"/></svg><div class="trend-tip" id="chart-tip" role="tooltip" hidden></div>`;
  $('trend-chart').innerHTML=svg;
  $('trend-legend').innerHTML=lines.map(({c})=>`<span style="${style(c.id)}"><i class="person-dot" aria-hidden="true"></i>${esc(c.displayName)}</span>`).join('');
  const wrap=$('trend-chart'), chart=wrap.querySelector('svg'), tip=wrap.querySelector('#chart-tip'), cursor=chart.querySelector('#chart-cursor');
  chart.addEventListener('pointermove',event=>{
    const rect=chart.getBoundingClientRect();
    const rawX=(event.clientX-rect.left)*W/rect.width;
    if(rawX<L || rawX>W-R) {tip.hidden=true;cursor.setAttribute('visibility','hidden');return;}
    const i=Math.max(0,Math.min(weeks.length-1,Math.round((rawX-L)/cw*(weeks.length-1))));
    cursor.setAttribute('x1',x(i));cursor.setAttribute('x2',x(i));cursor.setAttribute('visibility','visible');
    const sorted=[...lines].sort((a,b)=>(b.vals[i]??-1)-(a.vals[i]??-1));
    tip.innerHTML=`<strong>${state.trend==='rolling'?'4-week window through week of':state.trend==='cumulative'?'Through week of':'Week of'} ${esc(formatDate(weeks[i]))}</strong>${sorted.map(({c,vals})=>`<div class="trend-tip-row"><span style="${style(c.id)}"><i></i>${esc(c.displayName)}</span><b>${esc(formatLens(vals[i]))}</b></div>`).join('')}`;
    tip.hidden=false;
    const tipWidth=tip.offsetWidth||210;
    const xPx=(event.clientX-rect.left);
    tip.style.left=`${Math.min(Math.max(4,xPx+14),Math.max(4,rect.width-tipWidth-4))}px`;
    tip.style.top='7px';
  });
  chart.addEventListener('pointerleave',()=>{tip.hidden=true;cursor.setAttribute('visibility','hidden');});
}

function sortedContributors(view) {
  const getters={
    lens: c=>lensFor(c,view),share:c=>view.referenceTotal?metricValue(c,view.metric)/view.referenceTotal*100:0,
    commits:c=>c.totals.commits,active_days:c=>c.totals.active_days,pace:c=>c.totals.active_days?c.totals.commits/c.totals.active_days:0,
    churn:c=>c.totals.churn,files:c=>c.totals.files,reverts:c=>c.totals.commits?c.totals.reverts/c.totals.commits*100:0,
    releases:c=>c.totals.releases,weekend:c=>c.totals.commits?c.weekendCommits/c.totals.commits*100:0,
  };
  const get=getters[state.sortKey]||getters.lens;
  return [...view.contributors].sort((a,b)=>(get(a)-get(b))*(state.sortDesc?-1:1) || a.displayName.localeCompare(b.displayName));
}
function makeTableData(view) {
  const reference=view.referenceTotal;
  const columns=[
    {key:'name',label:'Contributor',value:c=>c.displayName,show:c=>`<span style="${style(c.id)}"><i class="person-dot"></i>${esc(c.displayName)}</span>`},
    {key:'lens',label:`${METRICS[view.metric].label} · ${displayModeLabel(state.mode)}`,value:c=>(state.mode==='share'&&!reference)||(state.mode==='per_active_day'&&!c.totals.active_days)?null:lensFor(c,view),format:v=>formatLens(v)},
    {key:'share',label:'Share of reference',value:c=>reference?c.totals[view.metric]/reference*100:null,format:v=>v==null?'—':percent(v)},
    {key:'commits',label:'Commits',value:c=>c.totals.commits},
    {key:'active_days',label:'Active days',value:c=>c.totals.active_days},
    {key:'pace',label:'Commits / active day',value:c=>c.totals.active_days?c.totals.commits/c.totals.active_days:null,format:v=>v==null?'—':decimal.format(v)},
    {key:'churn',label:'Line churn',value:c=>c.totals.churn},
    {key:'files',label:'File touches',value:c=>c.totals.files},
    {key:'reverts',label:'Revert %',value:c=>c.totals.commits?c.totals.reverts/c.totals.commits*100:null,format:v=>v==null?'—':percent(v)},
    {key:'releases',label:'VERSION touches',value:c=>c.totals.releases},
    {key:'weekend',label:'Weekend %',value:c=>c.totals.commits?c.weekendCommits/c.totals.commits*100:null,format:v=>v==null?'—':percent(v)},
  ];
  const format=(col,raw)=>col.format?col.format(raw):number.format(raw);
  return {columns, rows:sortedContributors(view).map(c=>({ c, vals:columns.map(col=>col.value(c)) })), format};
}
function renderTable(view) {
  if(!view.contributors.length){ $('scorecard-wrap').innerHTML=empty('No selected contributors.');tableRows=[];return; }
  const data=makeTableData(view);
  tableRows=data.rows;
  $('scorecard-wrap').innerHTML=`<table class="data-table"><thead><tr>${data.columns.map((col,i)=>`<th class="${i?'right':''}" scope="col" ${col.key===state.sortKey?`aria-sort="${state.sortDesc?'descending':'ascending'}"`:''}>${col.key==='name'?esc(col.label):`<button type="button" class="sort-button" data-action="sort-table" data-sort="${col.key}">${esc(col.label)}${state.sortKey===col.key?(state.sortDesc?' ↓':' ↑'):''}</button>`}</th>`).join('')}</tr></thead><tbody>${data.rows.map(({c,vals})=>`<tr>${vals.map((val,i)=>`<td class="${i?'right':'name-cell'}">${i ? esc(data.format(data.columns[i],val)) : data.columns[i].show(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  setText('table-note',`Active days are distinct per person; their sum is contributor-days, not distinct team calendar dates. Weekend % is Saturday + Sunday. Share denominator: ${view.denominator==='repository'?'all imported contributors':'selected contributors'}.`);
}
function copyCsv() {
  if (!analysis) return;
  const data=makeTableData(analysis);
  const quote=value=>`"${String(value).replace(/"/g,'""')}"`;
  const content=[data.columns.map(c=>quote(c.label)).join(','),...data.rows.map(({vals})=>vals.map((v,i)=>quote(i===0?v:data.format(data.columns[i],v))).join(','))].join('\r\n');
  if(!navigator.clipboard) return setText('table-note','Clipboard unavailable in this context.');
  navigator.clipboard.writeText(content).then(()=>setText('table-note',`${data.rows.length} comparison rows copied as CSV. Includes only the selected people and scope.`)).catch(()=>setText('table-note','Clipboard access was blocked.'));
}

function monthIndex(date) { return Number(date.slice(0,4))*12+Number(date.slice(5,7))-1; }
let pulsePreviousMode = null;
let pulsePreviousRange = null;
let pulsePopoverOrigin = null;
let pulsePopoverPinned = false;
let pulseSuppressFocus = false;
let pulseSuppressHoverCell = null;

function closePulseAndRestoreFocus() {
  const origin=pulsePopoverOrigin;
  hidePulsePopover();
  pulseSuppressHoverCell=origin;
  if(origin){
    pulseSuppressFocus=true;
    origin.focus({preventScroll:true});
    pulseSuppressFocus=false;
  }
}

function hidePulsePopover() {
  const popup = $('pulse-popover');
  if (!popup) return;
  popup.hidden = true;
  popup.classList.remove('is-pinned');
  popup.setAttribute('role', 'tooltip');
  pulsePopoverOrigin = null;
  pulsePopoverPinned = false;
}

function pulseIntensity(maximum) {
  return value => !value || !maximum ? 0 : Math.max(1, Math.min(4, Math.ceil(value / maximum * 4)));
}

function renderMonthlyPulse(view, level) {
  const startMonth=monthIndex(view.start),endMonth=monthIndex(view.end);
  const months=Array.from({length:endMonth-startMonth+1},(_,i)=>startMonth+i);
  const byPerson=view.contributors.map(c=>{
    const map=new Map();
    for(const [d,val] of Object.entries(c.daily[view.metric])) {
      const mo=monthIndex(d);
      map.set(mo,(map.get(mo)||0)+val);
    }
    return {c,map};
  });
  const maximum=Math.max(0,...byPerson.flatMap(p=>[...p.map.values()]));
  const columns=`minmax(128px,160px) repeat(${months.length}, minmax(22px, 1fr))`;
  const yearHead=[];
  let i=0;
  while(i<months.length){
    const year=Math.floor(months[i]/12);
    let end=i;
    while(end<months.length && Math.floor(months[end]/12)===year) end++;
    yearHead.push(`<span class="pulse-year" style="grid-column:${i+2}/span ${end-i}">${year}</span>`);
    i=end;
  }
  const monthLabels=months.map(m=>`<span class="pulse-month">${new Date(Date.UTC(Math.floor(m/12),m%12,1)).toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'}).slice(0,1)}</span>`).join('');
  const cells=byPerson.map(({c,map})=>`<div class="pulse-label" title="${esc(c.displayName)}">${esc(c.displayName)}</div>${months.map(m=>{
    const v=map.get(m)||0;
    const ym=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
    return `<div class="pulse-cell" data-level="${level(maximum)(v)}" title="${esc(c.displayName)} · ${ym}: ${number.format(v)} ${esc(METRICS[view.metric].unit)}" role="img" aria-label="${esc(c.displayName)}, ${ym}: ${number.format(v)} ${esc(METRICS[view.metric].unit)}"></div>`;
  }).join('')}`).join('');
  $('pulse').innerHTML=`<div class="pulse-grid" style="grid-template-columns:${columns}"><span></span>${yearHead.join('')}<span></span>${monthLabels}${cells}</div>`;
  return maximum;
}

function dailyPulseMonths(view) {
  const markers=[];
  let previous=null;
  view.weeks.forEach((week,index)=>{
    const start=Math.max(dayNumber(week),dayNumber(view.start));
    // Label the first in-scope month and then each new month's first full
    // week; don't mislabel early-month days as the incoming month.
    const month=monthIndex(dateAtDay(start));
    if(month!==previous) {
      markers.push({index,label:new Date(`${dateAtDay(start)}T12:00:00Z`).toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'})});
      previous=month;
    }
  });
  return markers;
}

function renderDailyPulse(view, level) {
  const weeks=view.weeks;
  const max=Math.max(0,...view.contributors.flatMap(c=>Object.values(c.daily[view.metric])));
  const weekColumns=`repeat(${weeks.length}, var(--pulse-week-size))`;
  const months=dailyPulseMonths(view).map(m=>`<span class="pulse-daily-month" style="grid-column:${m.index+1}">${esc(m.label)}</span>`).join('');
  const weekdays=DAY_NAMES.map((day,i)=>`<span aria-hidden="true">${i%2===0?esc(day):''}</span>`).join('');
  const rows=view.contributors.map(c=>{
    const cells=weeks.flatMap(week=>Array.from({length:7},(_,i)=>{
      const day=dateAtDay(dayNumber(week)+i);
      if(day<view.start||day>view.end) return '<span class="pulse-daily-outside" aria-hidden="true"></span>';
      const value=c.daily[view.metric][day]||0;
      const label=`${c.displayName}, ${formatDate(day)}: ${number.format(value)} ${METRICS[view.metric].unit}. View day activity.`;
      return `<button type="button" class="pulse-cell pulse-daily-cell" data-level="${level(max)(value)}" data-action="pulse-day" data-pulse-day="${day}" data-person-id="${esc(c.id)}" aria-label="${esc(label)}" aria-haspopup="dialog" aria-controls="pulse-popover"></button>`;
    })).join('');
    return `<div class="pulse-daily-contributor"><div class="pulse-daily-person" title="${esc(c.displayName)}" style="${style(c.id)}"><i class="person-dot" aria-hidden="true"></i><span>${esc(c.displayName)}</span></div><div class="pulse-weekdays">${weekdays}</div><div class="pulse-day-cells" style="grid-template-columns:${weekColumns}">${cells}</div></div>`;
  }).join('');
  $('pulse').innerHTML=`<div class="pulse-daily-board" style="--pulse-week-count:${weeks.length}"><div class="pulse-daily-axis"><span class="pulse-daily-spacer"></span><span></span><div class="pulse-daily-months" style="grid-template-columns:${weekColumns}">${months}</div></div>${rows}</div>`;
  return max;
}

function renderPulse(view) {
  hidePulsePopover();
  const daily=state.pulseMode==='daily';
  const container=$('pulse');
  const oldScroll=container.scrollLeft;
  const range=`${view.start}|${view.end}`;
  const scrollToLatest=daily&&(pulsePreviousMode!=='daily'||pulsePreviousRange!==range);
  setText('pulse-hint', daily
    ? 'Each square is one authored day (Mon–Sun, top to bottom). Hover or focus for detailed activity; click/tap to keep it open. Scroll sideways for older weeks.'
    : 'One square per person and calendar month. Intensity shows absolute totals, even when the comparison lens above shows a rate or percentage.');
  if(!view.contributors.length || !view.spanDays){
    setText('pulse-context',`${METRICS[view.metric].label.toUpperCase()} / ${daily?'DAILY':'MONTHLY'} TOTALS · SHARED SCALE`);
    container.innerHTML=empty('Select contributors and a valid time window.');
  } else {
    const maximum=daily?renderDailyPulse(view,pulseIntensity):renderMonthlyPulse(view,pulseIntensity);
    setText('pulse-context',`${METRICS[view.metric].label.toUpperCase()} / ${daily?'DAILY':'MONTHLY'} ABSOLUTE TOTALS · SHARED 0–${number.format(maximum)} SCALE`);
    container.scrollLeft=scrollToLatest?container.scrollWidth:oldScroll;
  }
  pulsePreviousMode=state.pulseMode;
  pulsePreviousRange=range;
}

function pulseTime(c) {
  return Number.isInteger(c.hour) ? `${String(c.hour).padStart(2,'0')}:${String(c.minute??0).padStart(2,'0')}` : 'Time unknown';
}
function pulseFact(label,value,extraClass='') {
  return `<div class="pulse-fact ${extraClass}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
function pulseDayMarkup(d) {
  const measure=METRICS[d.metric];
  const signed=n=>`${n>0?'+':n<0?'−':''}${number.format(Math.abs(n))}`;
  const share=d.share===null?'— (no reference activity)':`${percent(d.share)} of ${d.reference==='repository'?'repository':'selected cohort'} for this day`;
  const areas=d.areas.length?d.areas.slice(0,6).map(a=>`<span>${esc(a.name)} <strong>${number.format(a.touches)}</strong></span>`).join(''):'<span>None</span>';
  const when=d.firstLocalTime ? d.firstLocalTime===d.lastLocalTime?d.firstLocalTime:`${d.firstLocalTime}–${d.lastLocalTime}`:'No authored clock recorded';
  const flags=[`${number.format(d.merges)} merges`,`${number.format(d.reverts)} reverts`,`${number.format(d.versionTouches)} VERSION touches`].join(' · ');
  const fileRows=d.fileChanges.map(f=>`<li><span title="${esc(f.path)}">${esc(f.path)}</span><span>${number.format(f.touches)}× · <span class="number-add">+${number.format(f.added)}</span> / <span class="number-del">−${number.format(f.deleted)}</span>${f.binaryTouches?` · ${number.format(f.binaryTouches)} binary`:''}</span></li>`).join('');
  const events=d.commits.map(c=>{
    const plus=sum(c.files.map(f=>f.added)),minus=sum(c.files.map(f=>f.deleted));
    return `<li class="pulse-commit"><span class="pulse-commit-line"><span>${esc(pulseTime(c))} · <code>${esc(c.hash?.slice(0,8)||'—')}</code></span><span><span class="number-add">+${number.format(plus)}</span> / <span class="number-del">−${number.format(minus)}</span> · ${c.files.length} files</span></span><span class="pulse-commit-subject">${esc(c.subject||'(No subject)')}${c.isMerge?'<span class="flag merge">merge</span>':''}${c.isRevert?'<span class="flag revert">revert</span>':''}${c.touchesVersion?'<span class="flag version">VERSION</span>':''}</span></li>`;
  }).join('');
  return `<div class="pulse-tip-heading"><div><span class="eyebrow">DAILY ACTIVITY · AUTHOR DATE</span><strong>${esc(new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}))}</strong><span>${esc(d.contributorName)}</span></div><button type="button" class="pulse-tip-close" data-action="close-pulse" aria-label="Close activity details">×</button></div>
    <div class="pulse-tip-focus"><strong>${number.format(d.metricValue)}</strong><div><span>${esc(measure.label)} · day total</span><small>${esc(share)} · reference: ${number.format(d.referenceValue)} ${esc(measure.unit)}</small></div></div>
    <div class="pulse-tip-facts">${pulseFact('COMMITS',number.format(d.commitsCount))}${pulseFact('LINES ADDED',`+${number.format(d.added)}`)}${pulseFact('LINES REMOVED',`−${number.format(d.deleted)}`)}${pulseFact('TOTAL CHURN',number.format(d.churn))}${pulseFact('FILE TOUCHES',number.format(d.fileTouches))}${pulseFact('DISTINCT FILES',number.format(d.uniqueFiles))}</div>
    <div class="pulse-tip-extra"><span><strong>Net line change</strong> ${signed(d.net)}</span><span><strong>Binary file touches</strong> ${number.format(d.binaryTouches)}</span><span><strong>Author-local hours</strong> ${esc(when)}</span><span><strong>Commit types</strong> ${esc(flags)}</span><span><strong>Reference commits</strong> ${number.format(d.referenceCommits)} on this day</span></div>
    <div class="pulse-tip-areas"><span class="eyebrow">TOP-LEVEL AREAS · FILE TOUCHES</span><div>${areas}</div></div>
    <div class="pulse-tip-files"><details><summary>All changed file paths · ${number.format(d.uniqueFiles)} distinct (${number.format(d.fileTouches)} touches)</summary>${d.fileChanges.length?`<ul>${fileRows}</ul>`:'<p>No recorded file changes.</p>'}</details></div>
    <div class="pulse-tip-events"><span class="eyebrow">ALL ${number.format(d.commitsCount)} COMMITS IN THIS SCOPE</span>${d.commitsCount?`<ol>${events}</ol>`:'<p>No commits for this person on this day. Other contributors may have activity in the reference group.</p>'}</div>
    <p class="pulse-tip-note">All figures follow the dashboard's people, dates and merge/revert filters. Days use each commit's authored local date; hours use its authored local clock. Counts describe recorded changes, not performance.</p>`;
}
function positionPulsePopover(cell) {
  const popup=$('pulse-popover');
  const rect=cell.getBoundingClientRect();
  const width=popup.getBoundingClientRect().width;
  const left=Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2));
  popup.style.left=`${left}px`;
  const height=popup.getBoundingClientRect().height;
  const below=rect.bottom+8;
  const above=rect.top-height-8;
  popup.style.top=`${below+height<=window.innerHeight-8 || above<8 ? Math.max(8,Math.min(below,window.innerHeight-height-8)) : above}px`;
}
function showPulsePopover(cell,{pin=false}={}) {
  if(state.pulseMode!=='daily'||!analysis || (pulsePopoverPinned && !pin)) return;
  const details=pulseDayDetails(analysis,cell.dataset.personId,cell.dataset.pulseDay);
  if(!details)return;
  const popup=$('pulse-popover');
  const same=pulsePopoverOrigin===cell;
  popup.innerHTML=pulseDayMarkup(details);
  popup.hidden=false;
  popup.classList.toggle('is-pinned',pin);
  popup.setAttribute('role',pin?'dialog':'tooltip');
  popup.setAttribute('aria-label',`Day activity: ${details.contributorName}, ${formatDate(details.date)}`);
  if(!same)popup.scrollTop=0;
  pulsePopoverOrigin=cell;
  pulsePopoverPinned=pin;
  positionPulsePopover(cell);
}
function onPulsePointerOver(event) {
  if(pulsePopoverPinned)return;
  const cell=event.target.closest('[data-pulse-day]');
  if(cell && cell===pulseSuppressHoverCell)return;
  if(cell!==pulseSuppressHoverCell)pulseSuppressHoverCell=null;
  if(cell && (!pulsePopoverOrigin || pulsePopoverOrigin!==cell))showPulsePopover(cell);
}
function onPulsePointerOut(event) {
  if(pulsePopoverPinned)return;
  const cell=event.target.closest('[data-pulse-day]');
  if(!cell)return;
  if(cell===pulseSuppressHoverCell)pulseSuppressHoverCell=null;
  const to=event.relatedTarget;
  if(to && (cell.contains(to)||$('pulse-popover').contains(to)))return;
  hidePulsePopover();
}
function onPulseFocusOut(event) {
  if(pulsePopoverPinned)return;
  const to=event.relatedTarget;
  if(!to || (!to.closest('[data-pulse-day]') && !$('pulse-popover').contains(to)))hidePulsePopover();
}

function microBars(values,labels,id,className='',maxPercent=100) {
  const total=sum(values);
  // Same percentage axis for every contributor in the quick comparison.
  return `<div class="rhythm-spark ${className}" style="${style(id)}">${values.map((v,i)=>{
    const pct=total?v/total*100:0;
    return `<div class="rhythm-piece" title="${esc(labels[i])}: ${v} timed commits (${percent(pct)})"><div class="rhythm-bar-wrap"><div class="rhythm-bar" style="height:${Math.min(100,pct/maxPercent*100)}%"></div></div><div class="rhythm-bar-label">${esc(labels[i])}</div></div>`;
  }).join('')}</div>`;
}

let rhythmModel = null;
let rhythmHover = null; // {kind:'slot'|'day',index} — ephemeral on hover / focus
let rhythmPinned = null; // same shape; click or keyboard activation pins

function rhythmFocus(view) {
  if (view.contributors.length === 1) return view.contributors[0].id;
  return view.selectedIds.has(String(state.rhythmFocus)) ? String(state.rhythmFocus) : 'selection';
}
function rhythmDatumKey(d) { return d ? `${d.kind}:${d.index}` : ''; }
function rhythmShade(accent, value, maximum) {
  if (!value) return '#edf1ed';
  const t = Math.max(.2, Math.pow(value / (maximum || 1), .75));
  const base = [226,239,230];
  const target = [1,3,5].map((n,i) => parseInt(accent.slice(n,n+2),16));
  return `rgb(${base.map((n,i)=>Math.round(n+(target[i]-n)*t)).join(',')})`;
}
function rhythmStyleFor(model) { return model.isGroup ? '#176b52' : color(model.focusId); }
function rhythmSlotTitle(cell) {
  return `${DAY_NAMES[cell.day]} ${String(cell.hour).padStart(2,'0')}:00–${String(cell.hour).padStart(2,'0')}:59 · ${cell.count} timed commits`;
}
function rhythmSlotLabel(cell, model) {
  return `${rhythmSlotTitle(cell)} · ${cell.dates} distinct authored dates · ${cell.percentage===null?'undefined':percent(cell.percentage)} of ${model.name}'s timed commits`;
}
function rhythmCellAttributes(cell,model) {
  return `data-rhythm-interactive data-rhythm-kind="slot" data-rhythm-index="${cell.index}" data-action="rhythm-inspect" aria-label="${esc(rhythmSlotLabel(cell,model))}" aria-pressed="false" title="${esc(rhythmSlotTitle(cell))}"`;
}
function rhythmWeekdayColumns(model,accent) {
  if (!model.timedCommits) return empty('No commits with authored hours in this scope. The weekday and hour charts share this same empty evidence.');
  const maximum=Math.max(1,...model.weekdays.map(d=>d.count));
  return `<div class="rhythm-weekday-chart" style="--rhythm-accent:${accent}" role="group" aria-label="Timed commits by weekday">
    ${model.weekdays.map(d=>`<button type="button" class="rhythm-weekday-column" data-rhythm-interactive data-rhythm-kind="day" data-rhythm-index="${d.day}" data-action="rhythm-inspect" aria-label="${esc(DAY_NAMES[d.day])}, ${d.count} timed commits, ${percent(d.percentage||0)} of timed commits" aria-pressed="false" title="${esc(`${DAY_NAMES[d.day]} · ${d.count} commits · ${percent(d.percentage||0)}`)}"><span class="rhythm-weekday-count">${number.format(d.count)}</span><span class="rhythm-weekday-track"><span class="rhythm-weekday-bar" style="height:${d.count/maximum*100}%"></span></span><span class="rhythm-weekday-label">${DAY_NAMES[d.day]}</span><span class="rhythm-weekday-pct">${percent(d.percentage||0)}</span></button>`).join('')}
  </div>`;
}

function rhythmHeatmap(model,accent) {
  const max=Math.max(1,...model.cells.map(c=>c.count));
  const ticks=Array.from({length:24},(_,h)=>`<span class="rhythm-grid-hour">${h%3===0?String(h).padStart(2,'0'):''}</span>`).join('');
  return `<div class="rhythm-grid-scroll" aria-label="Day by hour heatmap, scroll horizontally if needed"><div class="rhythm-grid-board" style="--rhythm-accent:${accent}"><div class="rhythm-grid-heading"><span>LOCAL</span><div class="rhythm-grid-hours">${ticks}</div></div>${DAY_NAMES.map((name,day)=>`<div class="rhythm-grid-row"><span class="rhythm-grid-day">${name}</span><div class="rhythm-grid-hours">${model.cells.slice(day*24, day*24+24).map(cell=>`<button type="button" class="rhythm-grid-cell" ${rhythmCellAttributes(cell,model)} style="background:${rhythmShade(accent,cell.count,max)}"></button>`).join('')}</div></div>`).join('')}<div class="rhythm-grid-tail"><span></span><div>00:00 <span>→</span> 23:00 · each square is one authored hour</div></div></div></div>`;
}
function rhythmArc(cx,cy,inner,outer,start,end) {
  const xy=(r,theta)=>[cx+r*Math.cos(theta),cy+r*Math.sin(theta)];
  const a=xy(outer,start),b=xy(outer,end),c=xy(inner,end),d=xy(inner,start);
  return `M${a[0].toFixed(2)},${a[1].toFixed(2)} A${outer},${outer} 0 0 1 ${b[0].toFixed(2)},${b[1].toFixed(2)} L${c[0].toFixed(2)},${c[1].toFixed(2)} A${inner},${inner} 0 0 0 ${d[0].toFixed(2)},${d[1].toFixed(2)} Z`;
}
function rhythmClock(model,accent) {
  const max=Math.max(1,...model.cells.map(c=>c.count));
  const cx=204,cy=199;
  const ticks=[0,6,12,18].map(h=>{
    const angle=h/24*Math.PI*2-Math.PI/2;
    const a=(r)=>[cx+Math.cos(angle)*r,cy+Math.sin(angle)*r];
    const inner=a(43),outer=a(168);
    return `<line x1="${inner[0]}" y1="${inner[1]}" x2="${outer[0]}" y2="${outer[1]}" class="rhythm-clock-guide"/>`;
  }).join('');
  const cells=model.cells.map(cell=>{
    const start=cell.hour/24*Math.PI*2-Math.PI/2+.016;
    const end=(cell.hour+1)/24*Math.PI*2-Math.PI/2-.016;
    const inner=48+cell.day*17;
    const outer=inner+12;
    return `<path d="${rhythmArc(cx,cy,inner,outer,start,end)}" fill="${rhythmShade(accent,cell.count,max)}" class="rhythm-clock-cell" ${rhythmCellAttributes(cell,model)} tabindex="0" role="button"><title>${esc(rhythmSlotTitle(cell))}</title></path>`;
  }).join('');
  const clockLabels=[[0,204,18],[6,395,203],[12,204,401],[18,11,203]].map(([h,x,y])=>`<text x="${x}" y="${y}" text-anchor="middle" class="rhythm-clock-label">${String(h).padStart(2,'0')}:00</text>`).join('');
  const legend=DAY_NAMES.map((d,i)=>`<span><i style="--ring:${i+1}"></i>${d}</span>`).join('');
  return `<div class="rhythm-clock-layout"><svg class="rhythm-clock" viewBox="0 0 408 412" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Circular 168-hour week. Monday is the innermost ring, Sunday the outermost, and hours advance clockwise from midnight at the top.">${ticks}${cells}<text x="${cx}" y="${cy-3}" class="rhythm-clock-centre" text-anchor="middle">WEEKLY</text><text x="${cx}" y="${cy+13}" class="rhythm-clock-centre-secondary" text-anchor="middle">CLOCK</text>${clockLabels}</svg><div class="rhythm-clock-explanation"><strong>Seven rings, one week.</strong><span>Monday on the inside; Sunday on the outside. Midnight starts at the top, then hours run clockwise.</span><div class="rhythm-clock-rings">${legend}</div></div></div>`;
}
function rhythmBars(model,accent) {
  const max=Math.max(1,...model.cells.map(c=>c.count));
  return `<div class="rhythm-bars-scroll" aria-label="Seven consecutive 24-hour bar charts, scroll horizontally if needed"><div class="rhythm-bars-week" style="--rhythm-accent:${accent}">${DAY_NAMES.map((name,day)=>`<div class="rhythm-bars-day"><span class="rhythm-bars-dayname">${name} <small>${number.format(model.weekdays[day].count)} commits</small></span><div class="rhythm-bars-bars">${model.cells.slice(day*24,day*24+24).map(cell=>`<button type="button" class="rhythm-bars-column" ${rhythmCellAttributes(cell,model)}><span class="rhythm-bars-fill" style="height:${cell.count/max*100}%;background:${rhythmShade(accent,cell.count,max)}"></span></button>`).join('')}</div><div class="rhythm-bars-hour-labels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>`).join('')}</div></div>`;
}
function rhythmDetailMarkup(model,datum) {
  if(!model.timedCommits) return `<div class="rhythm-detail-empty">No timed commit activity can be plotted. ${number.format(model.missingTime)} of ${number.format(model.totalCommits)} commits lack an authored hour.</div>`;
  const d=datum?.kind==='day' ? model.weekdays[datum.index] : model.cells[datum?.index ?? model.peakSlot.index];
  if(!d)return '';
  const byDay=datum?.kind==='day';
  const label=byDay?`${DAY_NAMES[d.day]} · all authored hours`:`${DAY_NAMES[d.day]} · ${String(d.hour).padStart(2,'0')}:00–${String(d.hour).padStart(2,'0')}:59`;
  const isPeak=!datum;
  const ratio=model.showReference && d.referenceCount
    ? `${number.format(d.count)} of ${number.format(d.referenceCount)} ${model.referenceName} commits (${percent(d.referenceShare)}) in this ${byDay?'weekday':'hour'}`
    : model.showReference ? (d.referenceCount===0?`No commits in this ${byDay?'weekday':'hour'} for the ${model.referenceName}`:'Reference share unavailable') : 'Reference and focused contributors are the same group';
  const examples=d.examples?.length ? `<div class="rhythm-evidence"><span class="eyebrow">MOST RECENT MATCHING COMMITS</span><ul>${d.examples.map(c=>`<li><span>${esc(`${c.date} ${String(c.hour).padStart(2,'0')}:${String(c.minute??0).padStart(2,'0')}`)} · <code>${esc(c.hash?.slice(0,8)||'—')}</code></span><strong>${esc(c.subject||'(No subject)')}</strong></li>`).join('')}</ul></div>` : '';
  return `<div class="rhythm-detail-head"><div><span class="eyebrow">${rhythmPinned?'PINNED INSPECTION':isPeak?'PEAK HOUR · HOVER, FOCUS OR CLICK TO EXPLORE':'HOUR-BY-HOUR EVIDENCE'}</span><h5>${esc(label)}</h5><p>${esc(model.name)} · ${number.format(d.count)} recorded ${d.count===1?'commit':'commits'} at ${byDay?'these weekday hours':'this weekday and hour'} across the filtered period.</p></div>${rhythmPinned?'<button type="button" class="rhythm-unpin" data-action="rhythm-unpin">Unpin <span aria-hidden="true">×</span></button>':'<span class="rhythm-detail-help">Click any cell to pin ↗</span>'}</div><div class="rhythm-detail-facts"><div><span>COMMITS</span><strong>${number.format(d.count)}</strong></div><div><span>SHARE OF TIMED</span><strong>${d.percentage===null?'—':percent(d.percentage)}</strong></div><div><span>ACTIVE AUTHOR DATES</span><strong>${number.format(d.dates)}</strong></div><div><span>FILE TOUCHES</span><strong>${number.format(d.fileTouches)}</strong></div><div><span>TEXT LINES + / −</span><strong><em class="number-add">+${number.format(d.added)}</em> / <em class="number-del">−${number.format(d.deleted)}</em></strong></div></div><p class="rhythm-detail-reference">${esc(ratio)}</p>${examples}`;
}
function renderRhythmDetail() {
  if(!rhythmModel) return;
  const datum=rhythmPinned || rhythmHover;
  $('rhythm-detail').innerHTML=rhythmDetailMarkup(rhythmModel,datum);
  const current=rhythmDatumKey(datum || (rhythmModel.peakSlot ? {kind:'slot',index:rhythmModel.peakSlot.index} : null));
  document.querySelectorAll('#rhythm-explorer [data-rhythm-interactive]').forEach(node=>{
    const active=rhythmDatumKey({kind:node.dataset.rhythmKind,index:Number(node.dataset.rhythmIndex)})===current;
    node.classList.toggle('is-active',active);
    node.setAttribute('aria-pressed',String(Boolean(rhythmPinned && active)));
  });
}
function renderRhythmExplorer(view) {
  const target=$('rhythm-explorer');
  target.hidden = !view.contributors.length;
  if (!view.contributors.length) {rhythmModel=null;return;}
  const focus=rhythmFocus(view);
  if(rhythmModel?.focusId!==focus){rhythmHover=null;rhythmPinned=null;}
  state.rhythmFocus=focus;
  rhythmModel=workingRhythm(view,focus);
  const model=rhythmModel;
  const accent=rhythmStyleFor(model);
  const picker=[...(view.contributors.length>1 ? [{id:'selection',displayName:'All selected'}] : []),...view.contributors].map(c=>{
    const active=focus===c.id;
    return `<button type="button" data-action="rhythm-focus" data-rhythm-focus="${c.id}" class="rhythm-focus-chip ${active?'is-active':''}" ${c.id!=='selection'?`style="${style(c.id)}"`:''} aria-pressed="${active}">${c.id!=='selection'?'<i class="person-dot" aria-hidden="true"></i>':''}${esc(c.displayName)}</button>`;
  }).join('');
  $('rhythm-focus-picker').innerHTML=picker;
  setText('rhythm-focus-name',model.isGroup?'The selected group’s week':`${model.name}'s week`);
  setText('rhythm-focus-caption',`${view.start} to ${view.end} · ${view.includeMerges?'merges included':'merges excluded'} · ${view.includeReverts?'reverts included':'reverts excluded'} · ${model.isGroup?'all selected contributors':'one selected contributor'}. Changing this focus only affects this explorer.`);
  const peak=model.peakSlot;
  const mini=(label,value,desc)=>`<div class="rhythm-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(desc)}</small></div>`;
  $('rhythm-kpis').innerHTML=mini('TIMED COMMITS',number.format(model.timedCommits),`${number.format(model.totalCommits)} total · ${model.totalCommits?percent(model.timedCommits/model.totalCommits*100):'—'} recorded times`)+
    mini('BUSIEST WEEKDAY',model.peakDay?DAY_NAMES[model.peakDay.day]:'—',model.peakDay?`${number.format(model.peakDay.count)} commits · ${percent(model.peakDay.percentage)}`:'No authored hours recorded')+
    mini('BUSIEST WEEK-HOUR',peak?`${DAY_NAMES[peak.day]} ${String(peak.hour).padStart(2,'0')}:00`:'—',peak?`${number.format(peak.count)} commits across ${number.format(peak.dates)} dates`:'No authored hours recorded')+
    mini('WEEKEND SHARE',model.weekendShare===null?'—':percent(model.weekendShare),'Of timed commits · Sat + Sun');
  $('rhythm-weekday-columns').innerHTML=rhythmWeekdayColumns(model,accent);
  const captions={
    heatmap:'Day × hour · 7 rows × 24 hourly slots. Colour shows commit counts; scroll sideways for all hours on small screens.',
    clock:'Circular week · seven weekday rings × 24 hours. Monday is innermost; hours run clockwise.',
    bars:'Continuous hour-of-week · 168 hourly bars grouped into seven days. One shared scale; scroll sideways on small screens.',
  };
  setText('rhythm-display-caption',captions[state.rhythmDisplay]);
  document.querySelectorAll('[data-rhythm-display]').forEach(btn=>{
    const active=btn.dataset.rhythmDisplay===state.rhythmDisplay;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
  $('rhythm-week-chart').innerHTML=!model.timedCommits?empty('No timed commits in this selection. No hours are inferred from date-only Git records.')
    :state.rhythmDisplay==='clock'?rhythmClock(model,accent)
    :state.rhythmDisplay==='bars'?rhythmBars(model,accent):rhythmHeatmap(model,accent);
  const top=Math.max(0,...model.cells.map(c=>c.count));
  $('rhythm-legend').innerHTML=`<div class="rhythm-scale"><span>0 commits</span>${[0,.25,.5,.75,1].map(t=>`<i style="background:${rhythmShade(accent,t*Math.max(top,1),Math.max(top,1))}"></i>`).join('')}<span>${number.format(top)} / hour (max)</span></div><span>${number.format(model.missingTime)} commits without authored hours omitted · all views share these ${number.format(model.timedCommits)} timed events</span>`;
  renderRhythmDetail();
  renderSeasonality(view);
}
function renderRhythm(view) {
  $('rhythm-comparison-details').hidden=view.contributors.length<=1;
  if(!view.contributors.length){$('rhythm').innerHTML=empty('No contributors selected.');renderRhythmExplorer(view);return;}
  const sharedScale=(accessor,total)=>{
    const highest=Math.max(0,...view.contributors.flatMap(c=>{
      const n=total(c);return accessor(c).map(v=>n?v/n*100:0);
    }));
    return Math.min(100,Math.max(10,Math.ceil(highest/10)*10));
  };
  const weekdayMax=sharedScale(c=>c.timedWeekdays,c=>c.timedCommits);
  const timeMax=sharedScale(c=>c.timeBands,c=>c.timedCommits);
  const heading=`<div class="rhythm-header"><span>CONTRIBUTOR</span><span>DAY OF WEEK · % TIMED · 0–${weekdayMax}%</span><span>LOCAL HOUR · % TIMED · 0–${timeMax}%</span><span>WEEKEND / COVERAGE</span></div>`;
  const focus=rhythmFocus(view);
  const rows=view.contributors.map(c=>{
    const count=c.totals.commits;
    const weekend=c.timedCommits?percent(c.timedWeekendCommits/c.timedCommits*100):'—';
    const timed=count?percent(c.timedCommits/count*100):'—';
    return `<div class="rhythm-row ${focus===c.id?'is-focused':''}"><div class="rhythm-name"><strong style="${style(c.id)}"><i class="person-dot"></i> ${esc(c.displayName)}</strong><small>${number.format(count)} commits · ${number.format(c.timedCommits)} timed</small><button type="button" data-action="rhythm-focus" data-rhythm-focus="${c.id}" class="rhythm-explore-link" aria-label="Explore the weekly timing of ${esc(c.displayName)}">Explore ↗</button></div><div class="rhythm-mobile-label">Weekday share · timed commits · scale 0–${weekdayMax}%</div>${c.timedCommits?microBars(c.timedWeekdays,DAY_NAMES,c.id,'',weekdayMax):'<div class="helper">No timed commits.</div>'}<div class="rhythm-mobile-label">Time band share · timed commits · scale 0–${timeMax}%</div>${c.timedCommits?microBars(c.timeBands,TIME_BANDS.map(b=>b.label),c.id,'time',timeMax):'<div class="helper">No timed commits.</div>'}<div class="rhythm-summary">${weekend}<small>${timed} time coverage</small></div></div>`;
  }).join('');
  $('rhythm').innerHTML=`<div class="rhythm-list-wrap">${heading}${rows}</div>`;
  renderRhythmExplorer(view);
}


// Historical behaviour is a second representation of the same authored-date
// evidence; year chips and contributor focus change only this explorer's view.
const SEASON_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let seasonModel = null;
let seasonHover = null;
let seasonPinned = null;
function seasonKey(d) { return d ? `${d.kind}:${d.year}:${d.index}` : ''; }
function seasonValueText(value, mode=state.seasonMode) {
  if (value == null || !Number.isFinite(value)) return '—';
  return mode === 'rate' ? `${decimal.format(value)}/wk` : mode === 'shape' ? percent(value) : `${decimal.format(value)}×`;
}
function seasonModeTitle() {
  return state.seasonMode === 'rate' ? 'Commits per calendar week'
    : state.seasonMode === 'shape' ? 'Share of authored commits within that year'
    : 'Monthly intensity vs that year’s average daily rate';
}
function seasonShownYears(model) {
  if (!model) return [];
  if (state.seasonYears) {
    const valid = new Set(model.years.map(y => y.year));
    state.seasonYears = new Set([...state.seasonYears].filter(y => valid.has(y)));
    if (!state.seasonYears.size) state.seasonYears = null;
  }
  return model.years.filter(y => !state.seasonYears || state.seasonYears.has(y.year));
}
function seasonEmpty(message) { return `<div class="season-empty">${esc(message)}</div>`; }
function seasonColour(value,max) { return rhythmShade('#176b52',Math.max(0,value??0),Math.max(1e-6,max)); }
function monthTitle(month) {
  return `${SEASON_MONTHS[month.month]} ${month.year} · ${month.count} authored commits · ${month.days} observed calendar days · ${month.full?'complete':'partial'} month · ${seasonValueText(seasonalMonthValue(month),state.seasonMode)}`;
}
function seasonCellAttributes(kind,year,index,title) {
  return `data-season-cell data-season-kind="${kind}" data-season-year="${year}" data-season-index="${index}" data-action="season-inspect" aria-pressed="false" aria-label="${esc(title)}" title="${esc(title)}"`;
}
function renderSeasonYearPicker(model) {
  const displayed = seasonShownYears(model);
  const all = state.seasonYears === null;
  $('season-year-picker').innerHTML=`<span class="eyebrow">YEARS IN VIEW</span><button type="button" class="season-year-chip ${all?'is-active':''}" data-action="season-all-years" aria-pressed="${all}">All years</button>${model.years.map(y=>`<button type="button" class="season-year-chip ${displayed.includes(y)?'is-active':''}" data-action="season-toggle-year" data-season-year="${y.year}" aria-pressed="${displayed.includes(y)}">${y.year}${y.full?'':' <span aria-hidden="true">◔</span>'}</button>`).join('')}<span class="season-years-note">${displayed.length} of ${model.years.length} · ◔ partial-year coverage</span>`;
}
function renderSeasonMonthMatrix(model,years) {
  const values = years.flatMap(y=>y.months.filter(m=>m.days).map(m=>seasonalMonthValue(m)));
  const maximum = Math.max(1e-6, ...values.filter(v=>v!==null));
  const heading = `<div class="season-month-head"><span>YEAR</span><div class="season-month-labels">${SEASON_MONTHS.map(m=>`<span>${m}</span>`).join('')}</div><span>CALENDAR COVERAGE</span></div>`;
  const lines = [...years].reverse().map(y=>{
    const maxYearDays=new Date(Date.UTC(y.year+1,0,1))-new Date(Date.UTC(y.year,0,1));
    return `<div class="season-month-row"><span class="season-month-year"><strong>${y.year}</strong><small>${number.format(y.count)} commits</small></span><div class="season-month-cells">${y.months.map(m=>m.days?`<button type="button" class="season-month-cell ${m.full?'':'is-partial'} ${(seasonalMonthValue(m)??0)/maximum>.55?'is-strong':''}" ${seasonCellAttributes('month',y.year,m.month,monthTitle(m))} style="background:${seasonColour(seasonalMonthValue(m),maximum)}"><span>${esc(seasonValueText(seasonalMonthValue(m)))}</span></button>`:`<span class="season-month-missing" title="${SEASON_MONTHS[m.month]} ${y.year}: outside imported author dates or global scope" aria-label="${SEASON_MONTHS[m.month]} ${y.year}: not observed">—</span>`).join('')}</div><span class="season-month-coverage"><strong>${y.exposureDays}d</strong><small>${y.full?'Full year':`${Math.round(y.exposureDays/(maxYearDays/86400000)*100)}% of year`}</small></span></div>`;
  }).join('');
  const legend=`<div class="season-chart-key"><span>Zero activity</span><div class="season-swatch">${[0,.25,.5,.75,1].map(t=>`<i style="background:${seasonColour(t*maximum,maximum)}"></i>`).join('')}</div><span>${seasonValueText(maximum)} (highest cell)</span><em>Dashed outline = partial month; — = outside selected/imported dates.</em></div>`;
  $('season-month-matrix').innerHTML = years.length ? `<p class="season-scroll-hint">Swipe sideways to see all 12 months ↔</p><div class="season-month-scroll"><div class="season-month-board">${heading}${lines}</div></div>${legend}` : seasonEmpty('Select at least one year to compare.');
}
function seasonYoYText(year, years) {
  if (!year.yoy || !years.some(y=>y.year===year.year-1)) return '<span class="season-dash">—</span>';
  const a=year.yoy;
  const value=a.change === null ? (a.currentCount ? 'New activity' : 'No baseline') : `${a.change>=0?'+':''}${percent(a.change)}`;
  const cls=a.change===null?'':a.change>0?'season-up':a.change<0?'season-down':'';
  return `<span class="${cls}">${esc(value)}</span><small>${esc(a.from)} → ${esc(a.to)} · ${a.currentDays}/${a.priorDays} days · vs ${year.year-1}</small>`;
}
function renderSeasonAnnualScorecard(years) {
  if(!years.length){$('season-annual-scorecard').innerHTML='';return;}
  const th=['YEAR / OBSERVED', 'COMMITS', 'COMMITS / WEEK', 'ACTIVE DAY FREQUENCY', 'COMMITS / ACTIVE DAY', 'WEEKEND SHARE', 'EVENING SHARE', 'HOUR COVERAGE', 'YEAR-ON-YEAR PACE'];
  const tr=[...years].reverse().map(y=>`<tr><th scope="row"><strong>${y.year}</strong><small>${y.exposureDays} calendar days${y.full?'':' · partial'}</small></th><td>${number.format(y.count)}</td><td><strong>${decimal.format(y.pace)}</strong></td><td>${percent(y.activeFrequency)}<small>${y.activeDays} distinct dates</small></td><td>${y.perActiveDay===null?'—':decimal.format(y.perActiveDay)}</td><td>${y.weekendShare===null?'—':percent(y.weekendShare)}</td><td>${y.eveningShare===null?'—':percent(y.eveningShare)}</td><td>${y.timeCoverage===null?'—':percent(y.timeCoverage)}<small>${y.timedCount} timed / ${y.count} total</small></td><td>${seasonYoYText(y,years)}</td></tr>`).join('');
  $('season-annual-scorecard').innerHTML=`<table class="season-annual-table"><thead><tr>${th.map(t=>`<th scope="col">${t}</th>`).join('')}</tr></thead><tbody>${tr}</tbody></table><p class="season-table-footnote">Year-on-year changes compare identical calendar-day portions of adjacent years, using commits per calendar week. Active day frequency = distinct authored dates / observed calendar days; evening = 18:00–23:59 author-local among timed commits. “—” means undefined or outside scope. These are activity measures, not performance scores.</p>`;
}
function renderSeasonRhythmYears(model,years) {
  if (!years.length) { $('season-rhythm-years').innerHTML='';return; }
  const maximum = Math.max(1e-6,...years.flatMap(y=>y.slots.map(v=>y.timedCount?v/y.timedCount*100:0)));
  const hours=Array.from({length:24},(_,i)=>`<span>${i%3===0?String(i).padStart(2,'0'):''}</span>`).join('');
  $('season-rhythm-years').innerHTML=`<div class="season-rhythm-gallery">${[...years].reverse().map(y=>`<div class="season-rhythm-year"><div class="season-rhythm-heading"><strong>${y.year}</strong><span>${number.format(y.timedCount)} timed · ${y.timeCoverage===null?'—':percent(y.timeCoverage)} coverage ${y.full?'':'· partial year'}</span></div>${y.timedCount?`<div class="season-rhythm-scroll"><div class="season-rhythm-board"><div class="season-rhythm-labelrow"><span>LOCAL</span><div>${hours}</div></div>${DAY_NAMES.map((d,day)=>`<div class="season-rhythm-row"><span>${d}</span><div>${y.slots.slice(day*24,day*24+24).map((count,h)=>{const idx=day*24+h;const share=count/y.timedCount*100;return `<button type="button" ${seasonCellAttributes('slot',y.year,idx,`${y.year} ${d} ${String(h).padStart(2,'0')}:00 · ${count} timed commits · ${percent(share)} of that year's timed commits`)} class="season-rhythm-cell" style="background:${seasonColour(share,maximum)}"></button>`;}).join('')}</div></div>`).join('')}</div></div>`:seasonEmpty('No authored hours in this year; no time slots inferred.')}</div>`).join('')}</div><div class="season-chart-key"><span>0% of year’s timed commits</span><div class="season-swatch">${[0,.25,.5,.75,1].map(t=>`<i style="background:${seasonColour(t*maximum,maximum)}"></i>`).join('')}</div><span>${percent(maximum)} per slot (shared max)</span><em>Same axes and colour scale across years · shape, not total volume.</em></div>`;
}
function renderSeasonPeople(model,years) {
  const target=$('season-person-comparison');
  if(model.comparisons.length<=1 || !years.length){target.innerHTML='';return;}
  const order=[...years].reverse();
  const rows=model.comparisons.map(person=>`<tr><th scope="row"><span style="${style(person.id)}"><i class="person-dot"></i> ${esc(person.name)}</span></th>${order.map(y=>{const row=person.years.find(p=>p.year===y.year);return `<td><strong>${row?.pace===null?'—':decimal.format(row.pace)}</strong><small>${row.count} commits · ${row.weekendShare===null?'—':percent(row.weekendShare)} weekend</small></td>`;}).join('')}</tr>`).join('');
  target.innerHTML=`<div class="season-section-head"><div><span class="eyebrow">04 / ONE OR MANY CONTRIBUTORS</span><h5>Individual annual trajectories.</h5></div><span class="helper">Commits per calendar week · selected contributors only</span></div><div class="season-table-scroll"><table class="season-annual-table season-person-table"><thead><tr><th>CONTRIBUTOR</th>${order.map(y=>`<th>${y.year}${y.full?'':' · PARTIAL'}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><p class="season-table-footnote">Each person uses the same calendar exposure as every other person in that year, including inactive dates. Cell details give total commits and weekend share; focus on a contributor above to inspect their complete historical rhythms.</p>`;
}
function seasonalSeriesPath(points, x, y) {
  const runs=[];let run=[];
  for (let i=0;i<12;i++) {
    if(points[i]===null){if(run.length)runs.push(run);run=[];}
    else run.push(i);
  }
  if(run.length) runs.push(run);
  return runs.filter(r=>r.length>1).map(run=>`<polyline points="${run.map(i=>`${x(i)},${y(points[i])}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}
function renderSeasonOverlay(model,years) {
  const target=$('season-overlay');
  if (!years.length){target.innerHTML=seasonEmpty('Select years to overlay.');return;}
  const visible=[...years].sort((a,b)=>a.year-b.year);
  const yearsData=visible.map((year,i)=>({year,colour:COLORS[i%COLORS.length],points:year.months.map(m=>m.days?seasonalMonthValue(m):null)}));
  const baseline=Array.from({length:12},(_,month)=>{
    const eligible=visible.filter(y=>y.full&&y.count>0).map(y=>y.months[month]);
    return eligible.length>=3?sum(eligible.map(m=>seasonalMonthValue(m)))/eligible.length:null;
  });
  const allValues=yearsData.flatMap(d=>d.points).concat(baseline).filter(v=>v!==null);
  const max=Math.max(state.seasonMode==='index'?1.5:1,...allValues)*1.1;
  const W=960,H=330,L=62,R=24,T=18,B=48,cw=W-L-R,ch=H-T-B;
  const x=i=>L+cw*i/11, y=n=>T+ch-(n/max)*ch;
  let svg=`<svg class="season-overlay-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Monthly seasonal lines from January to December, each line one selected year">`;
  for(let i=0;i<=4;i++){
    const v=max*i/4;
    svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" class="season-axis-line"/><text x="${L-12}" y="${y(v)+3.5}" text-anchor="end" class="season-axis-label">${esc(seasonValueText(v))}</text>`;
  }
  if(state.seasonMode==='index') svg+=`<line x1="${L}" x2="${W-R}" y1="${y(1)}" y2="${y(1)}" stroke="#a56f4b" stroke-width="1.3" stroke-dasharray="5 4"/>`;
  for(let m=0;m<12;m++) svg+=`<text x="${x(m)}" y="${H-15}" text-anchor="middle" class="season-axis-label">${SEASON_MONTHS[m]}</text>`;
  for(const {year,colour,points} of yearsData){
    svg+=`<g style="color:${colour}">${seasonalSeriesPath(points,x,y)}`;
    for(let i=0;i<12;i++){
      if(points[i]===null)continue;
      const month=year.months[i];
      const title=monthTitle(month);
      svg+=`<circle cx="${x(i)}" cy="${y(points[i])}" r="${month.full?5:5.5}" class="season-overlay-point ${month.full?'':'is-partial'}" stroke="${colour}" fill="${month.full?colour:'#fffefa'}" ${seasonCellAttributes('month',year.year,i,title)} role="button" tabindex="0"><title>${esc(title)}</title></circle>`;
    }
    svg+='</g>';
  }
  if(baseline.some(n=>n!==null))svg+=`<g style="color:#273c31"><path d="${baseline.map((v,i)=>v===null?'':`${i===0||baseline[i-1]===null?'M':'L'}${x(i)} ${y(v)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="6 5"/></g>`;
  svg+='</svg>';
  const legend=yearsData.map(({year,colour})=>`<span class="season-legend-item"><i style="background:${colour}"></i>${year.year}${year.full?'':' · partial'}</span>`).join('');
  const hasBaseline=baseline.some(n=>n!==null);
  target.innerHTML=`<p class="season-scroll-hint">Swipe sideways to compare Jul–Dec ↔</p><div class="season-overlay-scroll">${svg}</div><div class="season-legend">${legend}${hasBaseline?'<span class="season-legend-item"><i class="season-baseline-marker"></i>Mean · 3+ complete years</span>':''}</div><p class="season-table-footnote">Filled dots: complete calendar months. Hollow dots: partial months inside the global authored-date window. Lines never bridge unobserved months. The ${state.seasonMode==='index'?'1× dashed baseline is the year’s average rate; an actual multi-year seasonal mean appears only with ≥3 complete years.':'line values reflect the selected measure and observed days; no extrapolation is performed.'}</p>`;
}
function renderSeasonSignals(model,years) {
  const target=$('season-signals');
  const full=years.filter(y=>y.full&&y.count>0);
  const completeMonthRates=SEASON_MONTHS.map((name,month)=>{
    const eligible=years.map(y=>y.months[month]).filter(m=>m.full);
    return {name,month,count:eligible.length,average:eligible.length?sum(eligible.map(m=>m.pace))/eligible.length:null};
  }).filter(m=>m.count);
  const sorted=[...completeMonthRates].sort((a,b)=>b.average-a.average);
  const busiest=sorted[0],quietest=sorted.at(-1);
  const recurring=full.length>=3;
  const metric=(label,value,desc)=>`<div class="season-signal"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(desc)}</small></div>`;
  target.innerHTML=`<div class="season-section-head"><div><span class="eyebrow">02 / WHAT CAN WE CONCLUDE?</span><h5>${recurring?'Repeated signals, with caveats.':'Patterns to investigate, not proven seasonality.'}</h5></div></div><div class="season-signal-grid">${metric('FULL YEARS',`${full.length}`,recurring?'Enough for a descriptive seasonal mean':'Three or more complete years recommended')}${metric('HIGHEST RECORDED MONTH',busiest?busiest.name:'—',busiest?`${decimal.format(busiest.average)} commits/week · ${busiest.count} complete months`:'No complete months')}${metric('LOWEST RECORDED MONTH',quietest?quietest.name:'—',quietest?`${decimal.format(quietest.average)} commits/week · ${quietest.count} complete months`:'No complete months')}</div><p class="season-table-footnote">${recurring?'The overlaid profile supports a descriptive multi-year baseline, not a prediction.':'The lines are exploratory; a repeated month in only one or two years cannot establish seasonality.'} High/low months summarise calendar-week rates for <em>complete observed months only</em>. Different amounts of imported history, changes in team size and release cycles may explain these patterns.</p>`;
}
function seasonDetailMarkup(model,selection) {
  if(!selection) return `<div class="season-inspector-placeholder"><strong>Pick a month or an hourly square to inspect.</strong><span>Hover or focus for a quick breakdown. Click to pin the evidence and inspect individual authored commits. This does not alter dashboard filters.</span></div>`;
  const year=model.years.find(y=>y.year===selection.year);
  if(!year) return seasonDetailMarkup(model,null);
  let items=[],title='',sub='',referenceCount=0,exposure='';
  if(selection.kind==='month'){
    const m=year.months[selection.index];
    if(!m?.days)return seasonDetailMarkup(model,null);
    items=m.commits;
    title=`${SEASON_MONTHS[m.month]} ${m.year}`;
    sub=`${m.days} of ${m.calendarDays} calendar days in scope · ${m.full?'complete':'partial'} month · ${model.name}`;
    exposure=`${decimal.format(m.pace)} commits/week · ${m.share===null?'undefined':percent(m.share)} of ${m.year} commits · ${m.index===null?'undefined':decimal.format(m.index)+'×'} annual daily baseline`;
    referenceCount=m.referenceCount;
  } else if(selection.kind==='slot'){
    const day=Math.floor(selection.index/24),hour=selection.index%24;
    items=year.commits.filter(c=>Number.isInteger(c.hour)&&dayOfWeek(c.date)===day&&c.hour===hour);
    title=`${year.year} · ${DAY_NAMES[day]} ${String(hour).padStart(2,'0')}:00–${String(hour).padStart(2,'0')}:59`;
    sub=`${year.timedCount} timed commits in ${year.year} · ${year.untimedCount} without an authored hour`;
    exposure=`${year.timedCount?percent(items.length/year.timedCount*100):'undefined'} of ${year.year} timed commits · ${number.format(year.weekdayExposures[day])} observed ${DAY_NAMES[day]} occurrences`;
    referenceCount=analysis.referenceCommits.filter(c=>Number(c.date.slice(0,4))===year.year&&Number.isInteger(c.hour)&&dayOfWeek(c.date)===day&&c.hour===hour).length;
  } else return seasonDetailMarkup(model,null);
  const uniqueDates=new Set(items.map(c=>c.date)).size;
  const files=items.flatMap(c=>c.files);
  const added=sum(files.map(f=>f.added)),deleted=sum(files.map(f=>f.deleted));
  const evidence=[...items].sort((a,b)=>(b.authoredAt??-1)-(a.authoredAt??-1)).slice(0,8);
  const share=referenceCount ? `${percent(items.length/referenceCount*100)} of ${model.referenceName} activity in this slice` : 'No commits in reference slice; percentage undefined';
  const facts=(label,value)=>`<div><span>${label}</span><strong>${esc(value)}</strong></div>`;
  const m=selection.kind==='month'?year.months[selection.index]:null;
  return `<div class="season-detail-header"><div><span class="eyebrow">${seasonPinned?'PINNED EVIDENCE':'HOVER OR FOCUS · CLICK TO PIN'} / AUTHOR DATES</span><h5>${esc(title)}</h5><p>${esc(sub)}</p></div><div class="season-detail-actions">${m?`<button type="button" class="season-detail-scope" data-action="season-apply-month" data-season-year="${year.year}" data-season-index="${selection.index}">View this month across dashboard ↗</button>`:''}${seasonPinned?'<button type="button" class="rhythm-unpin" data-action="season-unpin">Unpin ×</button>':''}</div></div><div class="season-detail-facts">${facts('COMMITS',number.format(items.length))}${facts('AUTHOR DATES',number.format(uniqueDates))}${facts('FILE TOUCHES',number.format(files.length))}${facts('TEXT + / −',`+${number.format(added)} / −${number.format(deleted)}`)}${facts('REFERENCE SHARE',referenceCount?percent(items.length/referenceCount*100):'—')}</div><p class="season-detail-description">${esc(exposure)} · ${esc(share)}</p>${evidence.length?`<div class="season-evidence"><span class="eyebrow">${evidence.length} MOST RECENT OF ${items.length} MATCHING COMMITS</span><ol>${evidence.map(c=>`<li><span>${esc(`${c.date}${Number.isInteger(c.hour)?' '+String(c.hour).padStart(2,'0')+':'+String(c.minute??0).padStart(2,'0'):''}`)} · ${esc(c.hash?.slice(0,8)||'—')}</span><strong>${esc(c.subject||'(No subject)')}</strong></li>`).join('')}</ol></div>`:'<p class="season-table-footnote">No authored commits in this observed slice.</p>'}`;
}
function renderSeasonDetail() {
  if (!seasonModel || state.rhythmTab==='weekly') return;
  const selection=seasonPinned||seasonHover;
  $('season-detail').innerHTML=seasonDetailMarkup(seasonModel,selection);
  const key=seasonKey(selection);
  $('season-explorer').querySelectorAll('[data-season-cell]').forEach(node=>{
    const active=key===seasonKey({kind:node.dataset.seasonKind,year:Number(node.dataset.seasonYear),index:Number(node.dataset.seasonIndex)});
    node.classList.toggle('is-active',active);
    node.setAttribute('aria-pressed',String(Boolean(seasonPinned && active)));
  });
}
function renderSeasonality(view) {
  const shown = state.rhythmTab !== 'weekly';
  $('rhythm-weekly-content').hidden = shown;
  $('season-explorer').hidden = !shown;
  document.querySelectorAll('[data-rhythm-tab]').forEach(button=>{
    const active=button.dataset.rhythmTab===state.rhythmTab;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  if (!shown) return;
  const focus=rhythmFocus(view);
  if(seasonModel?.focusId!==focus){seasonPinned=null;seasonHover=null;}
  seasonModel=seasonalityAnalysis(view,focus);
  const model=seasonModel;
  const years=seasonShownYears(model);
  $('season-year-content').hidden=state.rhythmTab!=='years';
  $('season-seasonal-content').hidden=state.rhythmTab!=='seasonal';
  setText('rhythm-focus-name',model.focusId==='selection'?`Selected contributors, across time`:`${model.name}, across time`);
  setText('season-view-title',state.rhythmTab==='years'?'Across years':'Recurring seasonal patterns');
  setText('season-explanation',state.rhythmTab==='years'?'Separate changes in activity level from changes in timing and composition.': 'Compare January with January and examine whether seasonal swings recur.');
  document.querySelectorAll('[data-season-mode]').forEach(button=>{
    const active=button.dataset.seasonMode===state.seasonMode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  const descriptions={
    rate:'Commits per seven calendar days, including quiet days, normalised by observed dates. Each cell also retains its original commit count.',
    shape:'Percentage of that year’s authored commits. Compares the distribution, not volume; partial years are explicitly marked.',
    index:'Monthly daily rate ÷ that same year’s daily average. 1× means typical for the observed portion of the year; undefined when a year has no commits.',
  };
  setText('season-mode-help',`${seasonModeTitle()}. ${descriptions[state.seasonMode]} All three modes use the same global scope and contributor focus.`);
  renderSeasonYearPicker(model);
  if(!model.years.length){$('season-month-matrix').innerHTML=seasonEmpty('No authored dates in the selected and imported period.');$('season-overlay').innerHTML=seasonEmpty('No historic data in scope.');return;}
  if(state.rhythmTab==='years') {
    renderSeasonMonthMatrix(model,years);
    renderSeasonAnnualScorecard(years);
    renderSeasonRhythmYears(model,years);
    renderSeasonPeople(model,years);
  } else {
    renderSeasonOverlay(model,years);
    renderSeasonSignals(model,years);
  }
  renderSeasonDetail();
}

// Independent behaviour slice from the exact same commit cohort. Commit
// footprint is categorical and so intentionally ignores the metric-rate lens.
const SIZE_BANDS=[
  {label:'0 text lines',min:0,max:0,color:'#c6d3c9'},
  {label:'1–19 lines',min:1,max:19,color:'#84b5a4'},
  {label:'20–199 lines',min:20,max:199,color:'#36886f'},
  {label:'200+ lines',min:200,max:Infinity,color:'#d47c56'},
];
function renderImpact(view) {
  impactModel=impactAnalysis(view,rawCommits,rawTags,{metric:state.impactMetric});
  const model=impactModel;
  $('impact-empty').innerHTML=impactSelectMessage(model);
  $('impact-panels').hidden=!model.releases.length;
  if(!model.releases.length)return;
  if(!model.releases.some(r=>r.hash===state.impactReleaseHash)) state.impactReleaseHash=model.releases.at(-1).hash;
  const selected=model.releases.find(r=>r.hash===state.impactReleaseHash);
  $('impact-summary').innerHTML=impactSummary(model);
  setText('impact-scope',`Tag dates: ${view.start}–${view.end} · Author dates: same range · ${view.includeMerges?'Merges included':'Merges excluded'} · ${view.includeReverts?'Reverts included':'Reverts excluded'} · ${model.referenceLabel} reference · ${model.allReleaseCount-model.releases.length} tagged snapshots outside the selected tag-date window${model.unresolved.length?` · ${model.unresolved.length} unresolved tag refs`:''}. Tag boundaries are graph-based.`);
  $('impact-timeline').innerHTML=impactTimeline(model,state.impactReleaseHash,state.impactShowAll);
  $('impact-release-control').innerHTML=impactReleasePicker(model,state.impactReleaseHash);
  document.querySelectorAll('[data-impact-tab]').forEach(btn=>{const active=btn.dataset.impactTab===state.impactTab;btn.classList.toggle('is-active',active);btn.setAttribute('aria-pressed',String(active));});
  const titles={timeline:'A release, under the microscope.',matrix:'Who contributed to which release?',reach:'Where did the changes reach?',durability:'What happened after the release?'};
  setText('impact-tab-title',titles[state.impactTab]);

  $('impact-area-toolbar').hidden=state.impactTab!=='reach';
  if(state.impactTab==='timeline') $('impact-content').innerHTML=impactReleaseDetail(selected,model.referenceLabel,state.impactMetric);
  else if(state.impactTab==='matrix') $('impact-content').innerHTML=impactReleaseMatrix(model,state.impactShowAll);
  else if(state.impactTab==='reach') $('impact-content').innerHTML=impactReach(model,state.impactAreaMode);
  else $('impact-content').innerHTML=impactDurability(model,state.impactReleaseHash,state.impactShowAll);
  if($('impact-metric-select'))$('impact-metric-select').value=state.impactMetric;
  document.querySelectorAll('[data-impact-area-mode]').forEach(btn=>{const active=btn.dataset.impactAreaMode===state.impactAreaMode;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});
}

function renderFootprint(view) {
  if(!view.contributors.length){$('footprint').innerHTML=empty('No contributors selected.');return;}
  const rows=view.contributors.map(c=>{
    const sizes=c.commits.map(commit=>sum(commit.files.map(f=>f.added+f.deleted))).sort((a,b)=>a-b);
    const counts=SIZE_BANDS.map(b=>sizes.filter(n=>n>=b.min&&n<=b.max).length);
    const median=sizes.length?(sizes.length%2?sizes[(sizes.length-1)/2]:(sizes[sizes.length/2-1]+sizes[sizes.length/2])/2):null;
    const segments=counts.map((n,i)=>n?`<div class="footprint-segment" style="width:${n/sizes.length*100}%;background:${SIZE_BANDS[i].color}" title="${esc(SIZE_BANDS[i].label)}: ${n} commits (${percent(n/sizes.length*100)})"></div>`:'').join('');
    const labels=counts.map((n,i)=>`${SIZE_BANDS[i].label}: ${n}`).join('; ');
    return `<div class="footprint-row"><span class="footprint-person" style="${style(c.id)}"><i class="person-dot"></i>${esc(c.displayName)}</span><div class="footprint-bar" role="img" aria-label="${esc(c.displayName)}: ${esc(labels)}">${segments}</div><span class="footprint-value">${number.format(sizes.length)} commits <small>median ${median===null?'—':number.format(median)} lines</small></span></div>`;
  }).join('');
  const legend=SIZE_BANDS.map(b=>`<span><i style="background:${b.color}"></i>${esc(b.label)}</span>`).join('');
  $('footprint').innerHTML=`<div class="footprint-rows">${rows}</div><div class="footprint-legend">${legend}</div>`;
}

function renderAreas(view) {
  if(!view.contributors.length) { $('areas').innerHTML=empty('No contributors selected.');return; }
  const allAreaNames=new Set();
  for(const c of view.referenceContributors) for(const name of c.areas.keys()) allAreaNames.add(name);
  const selectedAreas=new Map();
  const refAreas=new Map();
  for(const name of allAreaNames){
    const selected=sum(view.contributors.map(c=>c.areas.get(name)?.touches||0));
    if(!selected) continue;
    selectedAreas.set(name,selected);
    refAreas.set(name,sum(view.referenceContributors.map(c=>c.areas.get(name)?.touches||0)));
  }
  const top=[...selectedAreas.keys()].sort((a,b)=>selectedAreas.get(b)-selectedAreas.get(a)||a.localeCompare(b)).slice(0,10);
  if(!top.length){$('areas').innerHTML=empty('No file changes in this filtered set (some commits have no numstat records).');return;}
  const mx=Math.max(...top.map(name=>refAreas.get(name)),1);
  const rows=top.map(name=>{
    const selected=selectedAreas.get(name), ref=refAreas.get(name);
    const blocks=view.contributors.map(c=>({id:c.id,name:c.displayName,n:c.areas.get(name)?.touches||0})).filter(b=>b.n);
    const others=Math.max(0,ref-selected);
    return `<div class="area-row"><span class="area-name" title="${esc(name)}">${esc(name)}</span><div class="area-track" aria-label="${esc(name)}: ${selected} selected file touches of ${ref} reference"><div class="area-segment" style="width:${(ref/mx)*100}%;display:flex">${blocks.map(b=>`<div style="width:${b.n/ref*100}%;background:${color(b.id)}" title="${esc(b.name)}: ${b.n} touches"></div>`).join('')}${others?`<div class="area-segment other" style="width:${others/ref*100}%" title="Unselected contributors: ${others} touches"></div>`:''}</div></div><span class="area-value" title="Selected / reference file touches">${number.format(selected)}${view.denominator==='repository'?` / ${number.format(ref)}`:''}</span></div>`;
  }).join('');
  const legend=view.contributors.map(c=>`<span style="${style(c.id)}"><i></i>${esc(c.displayName)}</span>`).join('');
  $('areas').innerHTML=`<div class="viz-top"><span class="eyebrow">FILE TOUCHES BY TOP-LEVEL AREA</span><span class="helper">${view.denominator==='repository'?'Selected / entire repository':'Selected contributor totals'}</span></div>${rows}<div class="area-legend">${legend}${view.denominator==='repository'&&view.referenceContributors.length>view.contributors.length?'<span><i style="background:#c6cdc6"></i>Other contributors</span>':''}</div>`;
}
function renderRecent(view) {
  const commits=[...view.selectedCommits].sort((a,b)=>(b.authoredAt??0)-(a.authoredAt??0)||b.date.localeCompare(a.date)).slice(0,18);
  if(!commits.length){$('recent-commits').innerHTML=empty('No commits in this scope.');return;}
  $('recent-commits').innerHTML=`<table class="data-table"><thead><tr><th scope="col">AUTHORED</th><th scope="col">CONTRIBUTOR</th><th scope="col">COMMIT / SUBJECT</th><th scope="col" class="right">LINES + / −</th><th scope="col" class="right">FILES</th></tr></thead><tbody>${commits.map(c=>{
    const author=view.byId.get(c.groupId);
    const added=sum(c.files.map(f=>f.added)),deleted=sum(c.files.map(f=>f.deleted));
    const hour=c.hour===null?'':` ${String(c.hour).padStart(2,'0')}:${String(c.minute??0).padStart(2,'0')}`;
    return `<tr><td>${esc(c.date+hour)}</td><td class="name-cell"><span style="${style(c.groupId)}"><i class="person-dot"></i>${esc(author?.displayName||c.name)}</span></td><td><span class="commit-subject" title="${esc(c.subject)}">${esc(c.hash?.slice(0,7)||'—')} · ${esc(c.subject)}${c.isMerge?'<span class="flag merge">merge</span>':''}${c.isRevert?'<span class="flag revert">revert</span>':''}${c.touchesVersion?'<span class="flag version">VERSION</span>':''}</span></td><td class="right"><span class="number-add">+${number.format(added)}</span> / <span class="number-del">−${number.format(deleted)}</span></td><td class="right">${c.files.length}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderDashboard() {
  if(!rawCommits.length || $('dashboard').hidden) return;
  analysis=buildAnalysis(rawCommits,mergeGroups,{
    selectedIds:state.selectedIds, start:state.start,end:state.end,
    includeMerges:state.includeMerges,includeReverts:state.includeReverts,
    metric:state.metric,denominator:state.denominator,
  });
  updateControls();renderPicker();renderScope(analysis);
  renderStats(analysis);renderRanking(analysis);renderTrend(analysis);renderTable(analysis);
  renderPulse(analysis);renderRhythm(analysis);
  try { renderImpact(analysis); }
  catch (error) {
    console.error('Impact Explorer rendering failed', error);
    impactModel = null;
    $('impact-panels').hidden = true;
    $('impact-empty').innerHTML = `<div class="impact-empty" role="alert"><strong>Impact Explorer could not render</strong><p>The other charts remain available. Try reloading the latest application, then re-importing Git history. Diagnostic: ${esc(error?.message || 'Unknown error')}</p></div>`;
  }
  renderFootprint(analysis);renderAreas(analysis);renderRecent(analysis);
}

function exportSession() {
  if(!rawCommits.length) return;
  const selectedEmails=mergeGroups.flatMap((g,i)=>state.selectedIds.has(String(i))?g.emails:[]);
  const payload={version:2,exportedAt:new Date().toISOString(),rangeYears:Number($('range-select').value),rawLog:$('log-input').value,
    mergeGroups:mergeGroups.map(g=>({displayName:g.displayName,emails:[...g.emails]})),
    scope:{selectedEmails,period:state.period,start:state.start,end:state.end,metric:state.metric,mode:state.mode,denominator:state.denominator,
      includeMerges:state.includeMerges,includeReverts:state.includeReverts,trend:state.trend,pulseMode:state.pulseMode,
      rhythmDisplay:state.rhythmDisplay,rhythmTab:state.rhythmTab,seasonMode:state.seasonMode,seasonYears:state.seasonYears?[...state.seasonYears]:null,
      rhythmFocusEmail:analysis?.byId.get(state.rhythmFocus)?.emails[0]||null,
      impactTab:state.impactTab,impactMetric:state.impactMetric,impactAreaMode:state.impactAreaMode,
      impactReleaseHash:state.impactReleaseHash,impactShowAll:state.impactShowAll}};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const uri=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=uri;a.download=`git-signals-${new Date().toISOString().slice(0,10)}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(uri),1000);
}
async function importSession(event) {
  const file=event.target.files?.[0];event.target.value='';
  if(!file) return;
  let payload;
  try {payload=JSON.parse(await file.text());}
  catch {return setText('parse-error','Could not parse JSON export.');}
  if(typeof payload?.rawLog!=='string' || !Array.isArray(payload.mergeGroups)) return setText('parse-error','Invalid session: rawLog and mergeGroups required.');
  let history;
  try {history=parseGitHistory(payload.rawLog);}catch(err){return setText('parse-error',err.message);}
  rawCommits=history.commits;rawTags=history.tags;
  identityMeta = makeIdentityCatalogue(rawCommits);
  identityPicker = null;
  mergeUndo = null;
  renderMergeFeedback();
  $('log-input').value=payload.rawLog;
  if(Number.isInteger(Number(payload.rangeYears)) && +payload.rangeYears>=1 && +payload.rangeYears<=5) $('range-select').value=String(payload.rangeYears);
  const emails=new Set(rawCommits.map(c=>c.email));
  const used=new Set();
  mergeGroups=payload.mergeGroups.flatMap(g=>{
    if(!g || !Array.isArray(g.emails)) return [];
    const local=new Set();
    const valid=g.emails.filter(e=>{if(typeof e!=='string')return false;const key=e.toLowerCase();if(!emails.has(key)||used.has(key)||local.has(key))return false;local.add(key);return true;}).map(e=>e.toLowerCase());
    valid.forEach(e=>used.add(e));
    return valid.length?[{displayName:String(g.displayName||valid[0]),emails:valid}]:[];
  });
  for(const c of rawCommits){if(used.has(c.email))continue;mergeGroups.push({displayName:c.name||c.email,emails:[c.email]});used.add(c.email);}
  pendingImport=payload;
  buildDashboard();
  setText('source-status',`${number.format(rawCommits.length)} commits · ${number.format(rawTags.length)} tags restored from ${file.name}`);
  setText('parse-error','');
}

const ACTIONS={
  'choose-import':()=> $('file-import-input').click(),
  'export':exportSession,'copy-command':copyCommand,'analyse':analyse,'load-demo':loadDemo,
  'add-merge-group':()=>{if(requireResolvedIdentitySelection())return;forgetUndo();mergeGroups.push({displayName:'New contributor',emails:[]});identityPicker=null;renderMergeUI();openIdentityPicker(mergeGroups.length-1);},
  'split-email':(_e,t)=>splitEmail(Number(t.dataset.group),t.dataset.email),
  'split-group':(_e,t)=>splitGroup(Number(t.dataset.group)),
  'toggle-identity-picker':(_e,t)=>openIdentityPicker(Number(t.dataset.group)),
  'cancel-identity-picker':()=>closeIdentityPicker(),
  'select-visible-identities':()=>{if(!identityPicker)return;mergeCandidates(identityPicker.targetIndex,identityPicker.query).forEach(entry=>entry.emails.forEach(email=>identityPicker.selected.add(email)));refreshIdentityOptions();},
  'clear-identity-selection':()=>{if(!identityPicker)return;identityPicker.selected.clear();refreshIdentityOptions();},
  'apply-identity-picker':applyIdentityPicker,
  'undo-identity-merge':undoIdentityMerge,
  'skip-merge':skipMerge,'render-dashboard':buildDashboard,
  'select-all':()=>{state.selectedIds=new Set(mergeGroups.map((_,i)=>String(i)));renderDashboard();},
  'select-none':()=>{state.selectedIds=new Set();renderDashboard();},
  'solo':(_e,t)=>{state.selectedIds=new Set([t.dataset.personId]);renderDashboard();},
  'reset-filters':resetFilters,
  'trend-mode':(_e,t)=>{state.trend=t.dataset.trend;renderDashboard();},
  'pulse-mode':(_e,t)=>{state.pulseMode=t.dataset.pulseMode;renderDashboard();},
  'rhythm-tab':(_e,t)=>{state.rhythmTab=t.dataset.rhythmTab;seasonHover=null;seasonPinned=null;renderRhythmExplorer(analysis);},
  'season-mode':(_e,t)=>{state.seasonMode=t.dataset.seasonMode;seasonHover=null;seasonPinned=null;renderSeasonality(analysis);},
  'season-all-years':()=>{state.seasonYears=null;seasonHover=null;seasonPinned=null;renderSeasonality(analysis);},
  'season-toggle-year':(_e,t)=>{
    const year=Number(t.dataset.seasonYear);
    const all=seasonModel?.years.map(y=>y.year)||[];
    if(!all.includes(year))return;
    const selected=state.seasonYears?new Set(state.seasonYears):new Set(all);
    if(selected.has(year)){if(selected.size===1)return;selected.delete(year);}
    else selected.add(year);
    state.seasonYears=selected.size===all.length?null:selected;
    seasonHover=null;seasonPinned=null;renderSeasonality(analysis);
  },
  'season-inspect':(_e,t)=>{
    const next={kind:t.dataset.seasonKind,year:Number(t.dataset.seasonYear),index:Number(t.dataset.seasonIndex)};
    seasonPinned=seasonKey(next)===seasonKey(seasonPinned)?null:next;
    seasonHover=next;renderSeasonDetail();
  },
  'season-unpin':()=>{seasonPinned=null;seasonHover=null;renderSeasonDetail();},
  'season-apply-month':(_e,t)=>{
    const year=seasonModel?.years.find(y=>y.year===Number(t.dataset.seasonYear));
    const month=year?.months[Number(t.dataset.seasonIndex)];
    if(!month?.days)return;
    state.start=month.start;state.end=month.end;state.period='custom';
    state.seasonYears=null;seasonPinned=null;seasonHover=null;
    renderDashboard();$('pulse-heading').scrollIntoView({behavior:'smooth',block:'start'});
  },
  'impact-tab':(_e,t)=>{state.impactTab=t.dataset.impactTab;renderImpact(analysis);},
  'impact-release':(event,t)=>{state.impactReleaseHash=t.dataset.impactHash;state.impactTab='timeline';renderImpact(analysis);if(event.type==='keydown')$('impact-release-select')?.focus();else $('impact-content').scrollIntoView({behavior:'smooth',block:'nearest'});},
  'impact-toggle-all':()=>{state.impactShowAll=!state.impactShowAll;renderImpact(analysis);},
  'impact-area-mode':(_e,t)=>{state.impactAreaMode=t.dataset.impactAreaMode;renderImpact(analysis);},
  'rhythm-focus':(_e,t)=>{state.rhythmFocus=t.dataset.rhythmFocus;rhythmHover=null;rhythmPinned=null;renderRhythm(analysis);if(t.classList.contains('rhythm-explore-link'))$('rhythm-explorer').scrollIntoView({behavior:'smooth',block:'start'});},
  'rhythm-display':(_e,t)=>{state.rhythmDisplay=t.dataset.rhythmDisplay;rhythmHover=null;renderRhythmExplorer(analysis);},
  'rhythm-inspect':(_e,t)=>{const next={kind:t.dataset.rhythmKind,index:Number(t.dataset.rhythmIndex)};rhythmPinned=rhythmDatumKey(rhythmPinned)===rhythmDatumKey(next)?null:next;rhythmHover=next;renderRhythmDetail();},
  'rhythm-unpin':()=>{rhythmPinned=null;rhythmHover=null;renderRhythmDetail();},
  'pulse-day':(_e,t)=>{if(pulsePopoverPinned&&pulsePopoverOrigin===t)hidePulsePopover();else showPulsePopover(t,{pin:true});},
  'close-pulse':closePulseAndRestoreFocus,
  'sort-table':(_e,t)=>{const key=t.dataset.sort;state.sortDesc=state.sortKey===key?!state.sortDesc:true;state.sortKey=key;renderTable(analysis);},
  'copy-csv':copyCsv,
};
function handleDocumentClick(event) {
  const trigger=event.target.closest('[data-action]');
  if(trigger){const fn=ACTIONS[trigger.dataset.action];if(fn)fn(event,trigger);}
  else if(pulsePopoverPinned && !$('pulse-popover').contains(event.target))hidePulsePopover();
}
function handleDocumentChange(event) {
  const t=event.target;
  if(t.dataset.mergeName!==undefined) {
    const group=mergeGroups[Number(t.dataset.mergeName)];
    if (group) {
      group.displayName=t.value.trim() || identityMeta.get(group.emails[0])?.name || 'New contributor';
      t.value=group.displayName;
    }
    return;
  }
  if(t.matches('[data-identity-email]') && identityPicker) {
    const email = t.dataset.identityEmail;
    if (t.checked) identityPicker.selected.add(email);
    else identityPicker.selected.delete(email);
    t.closest('.identity-option')?.classList.toggle('is-selected', t.checked);
    updateIdentityPickerSummary();
    return;
  }
  if(t.dataset.personId!==undefined && t.type==='checkbox') {
    if(t.checked)state.selectedIds.add(t.dataset.personId);else state.selectedIds.delete(t.dataset.personId);
    renderDashboard();return;
  }
  switch(t.id){
    case 'file-import-input':importSession(event);break;
    case 'period-select':updatePeriod(t.value);break;
    case 'date-from':case 'date-to':changeDate();break;
    case 'filter-merges':state.includeMerges=t.checked;renderDashboard();break;
    case 'filter-reverts':state.includeReverts=t.checked;renderDashboard();break;
    case 'metric-select':state.metric=t.value;state.sortKey='lens';state.sortDesc=true;renderDashboard();break;
    case 'impact-metric-select':state.impactMetric=t.value;renderImpact(analysis);break;
    case 'impact-release-select':state.impactReleaseHash=t.value;renderImpact(analysis);break;
    case 'mode-select':state.mode=t.value;state.sortKey='lens';state.sortDesc=true;renderDashboard();break;
    case 'denominator-select':state.denominator=t.value;renderDashboard();break;
  }
}
function handleDocumentInput(event) {
  const t=event.target;
  if(t.dataset.mergeName!==undefined){const g=mergeGroups[Number(t.dataset.mergeName)];if(g){g.displayName=t.value; if(mergeUndo)forgetUndo();}}
  if(t.matches('[data-identity-search]') && identityPicker){identityPicker.query=t.value;refreshIdentityOptions();}
  if(t.id==='contributor-search'){state.search=t.value;renderPicker();}
}
function init() {
  document.addEventListener('click',handleDocumentClick);
  document.addEventListener('change',handleDocumentChange);
  document.addEventListener('input',handleDocumentInput);
  $('rhythm-explorer').addEventListener('pointerover',event=>{
    if (rhythmPinned) return;
    const target=event.target.closest('[data-rhythm-interactive]');
    if (!target) return;
    const next={kind:target.dataset.rhythmKind,index:Number(target.dataset.rhythmIndex)};
    if (rhythmDatumKey(next)!==rhythmDatumKey(rhythmHover)) {rhythmHover=next;renderRhythmDetail();}
  });
  $('rhythm-explorer').addEventListener('pointerout',event=>{
    if (rhythmPinned || !event.target.closest('[data-rhythm-interactive]')) return;
    if (event.relatedTarget?.closest?.('[data-rhythm-interactive]')) return;
    rhythmHover=null;renderRhythmDetail();
  });
  $('rhythm-explorer').addEventListener('focusin',event=>{
    if (rhythmPinned) return;
    const target=event.target.closest('[data-rhythm-interactive]');
    if (target){rhythmHover={kind:target.dataset.rhythmKind,index:Number(target.dataset.rhythmIndex)};renderRhythmDetail();}
  });
  $('rhythm-explorer').addEventListener('keydown',event=>{
    const target=event.target.closest('[data-rhythm-kind="slot"]');
    if (!target) return;
    if (target.matches('svg *') && (event.key==='Enter' || event.key===' ')) {
      event.preventDefault();ACTIONS['rhythm-inspect'](event,target);return;
    }
    const shifts={ArrowLeft:-1,ArrowRight:1,ArrowUp:-24,ArrowDown:24};
    const delta=shifts[event.key];
    if (delta===undefined) return;
    const next=Math.max(0,Math.min(167,Number(target.dataset.rhythmIndex)+delta));
    const matching=$('rhythm-week-chart').querySelector(`[data-rhythm-index="${next}"]`);
    if(matching){event.preventDefault();matching.focus();}
  });
  $('impact-timeline').addEventListener('keydown',event=>{
    const dot=event.target.closest('[data-impact-hash]');
    if(dot && (event.key==='Enter'||event.key===' ')) {event.preventDefault();ACTIONS['impact-release'](event,dot);return;}
    if(dot && (event.key==='ArrowLeft'||event.key==='ArrowRight')) {
      event.preventDefault();const dots=[...$('impact-timeline').querySelectorAll('[data-impact-hash]')];
      const index=dots.indexOf(dot);dots[Math.max(0,Math.min(dots.length-1,index+(event.key==='ArrowRight'?1:-1)))].focus();
    }
  });
  $('season-explorer').addEventListener('pointerover',event=>{
    if(seasonPinned)return;
    const target=event.target.closest('[data-season-cell]');
    if(!target)return;
    const next={kind:target.dataset.seasonKind,year:Number(target.dataset.seasonYear),index:Number(target.dataset.seasonIndex)};
    if(seasonKey(next)!==seasonKey(seasonHover)){seasonHover=next;renderSeasonDetail();}
  });
  $('season-explorer').addEventListener('pointerout',event=>{
    if(seasonPinned||!event.target.closest('[data-season-cell]'))return;
    if(event.relatedTarget?.closest?.('[data-season-cell]'))return;
    seasonHover=null;renderSeasonDetail();
  });
  $('season-explorer').addEventListener('focusin',event=>{
    if(seasonPinned)return;
    const target=event.target.closest('[data-season-cell]');
    if(target){seasonHover={kind:target.dataset.seasonKind,year:Number(target.dataset.seasonYear),index:Number(target.dataset.seasonIndex)};renderSeasonDetail();}
  });
  $('season-explorer').addEventListener('keydown',event=>{
    const target=event.target.closest('[data-season-cell]');
    if(!target)return;
    if(target.matches('svg *')&&(event.key==='Enter'||event.key===' ')){
      event.preventDefault();ACTIONS['season-inspect'](event,target);return;
    }
    const shift={ArrowLeft:-1,ArrowRight:1,ArrowUp:target.dataset.seasonKind==='slot'?-24:-1,ArrowDown:target.dataset.seasonKind==='slot'?24:1}[event.key];
    if(shift===undefined)return;
    const max=target.dataset.seasonKind==='slot'?167:11;
    const next=Math.max(0,Math.min(max,Number(target.dataset.seasonIndex)+shift));
    const match=$('season-explorer').querySelector(`[data-season-kind="${target.dataset.seasonKind}"][data-season-year="${target.dataset.seasonYear}"][data-season-index="${next}"]`);
    if(match){event.preventDefault();match.focus();}
  });
  $('pulse').addEventListener('pointerover',onPulsePointerOver);
  $('pulse').addEventListener('pointerout',onPulsePointerOut);
  $('pulse').addEventListener('focusin',event=>{const cell=event.target.closest('[data-pulse-day]');if(cell&&!pulsePopoverPinned&&!pulseSuppressFocus)showPulsePopover(cell);});
  $('pulse').addEventListener('focusout',onPulseFocusOut);
  $('pulse').addEventListener('scroll',()=>hidePulsePopover(),{passive:true});
  $('pulse-popover').addEventListener('pointerleave',event=>{if(!pulsePopoverPinned&&!pulsePopoverOrigin?.contains(event.relatedTarget))hidePulsePopover();});
  document.addEventListener('keydown',event=>{
    if (event.key !== 'Escape') return;
    if (seasonPinned) {event.preventDefault();seasonPinned=null;seasonHover=null;renderSeasonDetail();}
    else if (rhythmPinned) {event.preventDefault();rhythmPinned=null;rhythmHover=null;renderRhythmDetail();}
    else if (identityPicker) {event.preventDefault();closeIdentityPicker();}
    else if (!$('pulse-popover').hidden) closePulseAndRestoreFocus();
  });
}
init();
