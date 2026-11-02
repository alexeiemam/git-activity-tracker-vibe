/**
 * Source-of-truth for every dashboard slice. No DOM, browser storage or rendering.
 * A contributor/day is counted once for active_days; a team's contributor-days
 * are additive, unlike the number of calendar dates with any team activity.
 */

import { decodeHerokuBatch, DEPLOYMENT_ENVS } from './deployments.js?v=git-heroku-ux-20261102-2';

export const METRICS = Object.freeze({
  commits: { label: 'Commits', unit: 'commits', note: 'Commit records, not an estimate of impact' },
  active_days: { label: 'Active days', unit: 'contributor-days', note: 'Distinct author dates per contributor' },
  lines_added: { label: 'Lines added', unit: 'lines', note: 'Text lines added in numstat' },
  lines_deleted: { label: 'Lines deleted', unit: 'lines', note: 'Text lines removed in numstat' },
  churn: { label: 'Line churn', unit: 'lines', note: 'Lines added + deleted; not code quality' },
  files: { label: 'File touches', unit: 'touches', note: 'File entries across commits; not distinct file paths' },
  releases: { label: 'VERSION touches', unit: 'commits', note: 'Commits touching a VERSION file; not verified releases' },
  reverts: { label: 'Revert commits', unit: 'commits', note: 'Detected by commit subject' },
  merges: { label: 'Merge commits', unit: 'commits', note: 'Detected from parents when supplied, otherwise from subject' },
});

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TIME_BANDS = [
  { label: '00–05', start: 0, end: 6 },
  { label: '06–11', start: 6, end: 12 },
  { label: '12–17', start: 12, end: 18 },
  { label: '18–23', start: 18, end: 24 },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY_TOTALS = () => Object.fromEntries(Object.keys(METRICS).map(key => [key, 0]));

export function validDate(date) {
  if (!DATE_RE.test(String(date))) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

export function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

export function dateAtDay(index) {
  return new Date(index * 86400000).toISOString().slice(0, 10);
}

export function mondayOf(date) {
  const day = dayNumber(date);
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return dateAtDay(day - weekday);
}

export function dayOfWeek(date) {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * The capture format is deliberately newline-oriented, copy/paste friendly and
 * backwards-compatible with the original COMMIT|...|subject[|parents] rows.
 * TAG rows are metadata, not commits. Do not fabricate tag dates or ancestry.
 */
/** GitHub Release metadata arrives as base64 UTF-8 JSON, one record per line.
 * Notes may contain newlines, vertical bars and Unicode; never split that JSON.
 * Git tags/ancestry remain independent of this optional enrichment.
 */
export function decodeGithubRelease(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 4_000_000) return null;
  try {
    const binary = atob(value);
    const json = new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    const item = JSON.parse(json);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const tag = String(item.tag_name || '').trim();
    if (!tag || tag.length > 300) return null;
    const publishedText = String(item.published_at || '');
    const publishedAt = publishedText && Number.isFinite(Date.parse(publishedText)) ? Date.parse(publishedText) : null;
    const login = typeof item.author?.login === 'string' ? item.author.login.trim() : '';
    return {
      tag, title:String(item.name || '').slice(0,400), notes:String(item.body || '').slice(0,120_000),
      publisher:login.slice(0,150), publisherType:String(item.author?.type || '').slice(0,40),
      publishedAt, publishedDate:publishedAt===null?null:new Date(publishedAt).toISOString().slice(0,10),
      draft:item.draft === true, prerelease:item.prerelease === true,
      url:typeof item.html_url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/tag\//i.test(item.html_url) ? item.html_url.slice(0,2000) : null,
    };
  } catch { return null; }
}

export function parseGitHistory(raw) {
  const commits = [];
  const tags = [];
  const githubReleases = [];
  const herokuReleases = [];
  const herokuStatus = Object.fromEntries(DEPLOYMENT_ENVS.map(env=>[env,'not-captured']));
  const captureWarnings = [];
  const historyEnrichment=[];
  const shallowBoundaries=new Set();
  let githubStatus = 'not-captured';
  let current = null;
  const flush = () => { if (current) commits.push(current); current = null; };

  for (const original of String(raw || '').split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    if(line.startsWith('HISTORYSHALLOW|')){
      flush();const hash=line.slice('HISTORYSHALLOW|'.length).trim().toLowerCase();
      if(/^[a-f0-9]{40,64}$/.test(hash))shallowBoundaries.add(hash);
      continue;
    }
    if(line.startsWith('HISTORYENRICH|')){
      flush();
      const parts=line.split('|');
      if(/^[a-f0-9]{7,64}$/i.test(parts[1]||'')&&['complete','bounded','unavailable'].includes(parts[2])&&/^\d+$/.test(parts[3]||''))
        historyEnrichment.push({sha:parts[1].toLowerCase(),status:parts[2],limitCount:Math.min(176,Number(parts[3]))});
      continue;
    }
    if (line.startsWith('HEROKU|')) {
      flush();
      const match=line.match(/^HEROKU\|(STAG|BETA|PROD)\|(.+)$/);
      const decoded=match?decodeHerokuBatch(match[2],match[1]):null;
      if(decoded)herokuReleases.push(...decoded);
      else captureWarnings.push('A Heroku deployment batch could not be decoded.');
      continue;
    }
    if (line.startsWith('HEROKUSTATUS|')) {
      flush();
      const match=line.match(/^HEROKUSTATUS\|(STAG|BETA|PROD)\|(ok|partial|unavailable|missing-cli|missing-remote)$/);
      if(match)herokuStatus[match[1]]=match[2];
      continue;
    }
    if (line.startsWith('GHRELEASE|')) {
      flush();
      const record=decodeGithubRelease(line.slice('GHRELEASE|'.length));
      if(record) githubReleases.push(record);
      else captureWarnings.push('A GitHub Release metadata record could not be decoded.');
      continue;
    }
    if (line.startsWith('GHSTATUS|')) {
      flush();
      const status=line.slice('GHSTATUS|'.length);
      if (['ok','unavailable','missing-cli','unsupported-origin'].includes(status)) githubStatus=status;
      continue;
    }
    if (line.startsWith('TAG|')) {
      flush();
      const parts = line.split('|');
      // TAG|name|peeled-hash|object-hash|object-type|creator-date
      const objectType = parts[4] || 'commit';
      if (!['commit', 'tag'].includes(objectType)) continue;
      const commitHash = (objectType === 'tag' ? parts[2] : parts[3])?.trim();
      if (!commitHash || !/^[a-f0-9]{7,64}$/i.test(commitHash)) continue;
      const timeText = (parts[5] || '').trim();
      tags.push({ name: (parts[1] || '').trim(), hash: commitHash,
        taggedAt: Number.isFinite(Date.parse(timeText)) ? Date.parse(timeText) : null,
        taggedDate: validDate(timeText.slice(0, 10)) ? timeText.slice(0, 10) : null,
        timestampSource: objectType === 'tag' ? 'tagger' : 'tagged-commit',
        annotated: objectType === 'tag',
        taggerName:objectType === 'tag' ? String(parts[6] || '').trim() : '',
        taggerEmail:objectType === 'tag' ? String(parts[7] || '').trim().replace(/^<|>$/g,'').toLowerCase() : '',
      });
      continue;
    }
    if (line.startsWith('COMMIT|')) {
      flush();
      const parts = line.split('|');
      const hasParents = parts.length >= 7 && (/^(?:[a-f0-9]{7,64})(?:\s+[a-f0-9]{7,64})*$/i.test(parts.at(-1)) || parts.at(-1) === '');
      const parents = hasParents ? parts.at(-1).trim().split(/\s+/).filter(Boolean) : [];
      const modern = /^\d{4}-\d\d-\d\dT/.test(parts[5] || '');
      const subjectStart = modern ? 6 : 5;
      const authored = (parts[4] || '').trim();
      const committed = modern ? (parts[5] || '').trim() : '';
      const date = authored.slice(0, 10);
      const timeMatch = authored.match(/^\d{4}-\d\d-\d\dT(\d\d):(\d\d):\d\d(?:Z|[+-]\d\d:\d\d)$/);
      const hour = timeMatch ? Number(timeMatch[1]) : null;
      const minute = timeMatch ? Number(timeMatch[2]) : null;
      const subject = parts.slice(subjectStart, hasParents ? -1 : undefined).join('|').trim();
      current = {
        hash: (parts[1] || '').trim(),
        email: (parts[2] || '?').trim().toLowerCase(),
        name: (parts[3] || '?').trim(),
        date: validDate(date) ? date : null,
        authoredAt: Number.isFinite(Date.parse(authored)) ? Date.parse(authored) : null,
        committedAt: Number.isFinite(Date.parse(committed)) ? Date.parse(committed) : null,
        hour: Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null,
        minute: Number.isInteger(minute) && minute >= 0 && minute < 60 ? minute : null,
        parents, parentsKnown: hasParents,
        subject,
        isMerge: hasParents ? parents.length > 1 : /^merge(?:d)?\s+(?:branch|pull request|remote|tag|commit|#)/i.test(subject),
        isRevert: /^revert\b/i.test(subject),
        touchesVersion: false,
        releaseVersion: null,
        files: [],
      };
    } else if (current) {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!match) continue;
      const path = match[3];
      current.files.push({
        added: match[1] === '-' ? 0 : Number(match[1]),
        deleted: match[2] === '-' ? 0 : Number(match[2]),
        path, binary: match[1] === '-' || match[2] === '-',
      });
      if (/(^|\/)VERSION$/.test(path)) current.touchesVersion = true;
    }
  }
  flush();
  for(const c of commits)if(shallowBoundaries.has(c.hash.toLowerCase()))c.parentsKnown=false;
  const seen = new Set();
  const unique = commits.filter(commit => {
    if (!commit.date) return false;
    if (!commit.hash) return true;
    if (seen.has(commit.hash)) return false;
    seen.add(commit.hash);
    return true;
  });
  if (!unique.length) throw new Error('No dated commits found. Use the generated git log command.');
  return { commits: unique, tags: tags.filter(t => t.name), githubReleases, githubStatus, herokuReleases, herokuStatus, historyEnrichment, captureWarnings };
}

export function parseGitLog(raw) { return parseGitHistory(raw).commits; }

/**
 * Move any number of known email identities into one contributor in a single
 * operation. Only the group mapping changes: commit records are never edited.
 * Unknown identities are ignored and each email remains owned by one group.
 */
export function moveContributorIdentities(groups, targetIndex, emails) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= groups.length ||
      !Array.isArray(emails)) return groups;
  const requested = new Set(emails.filter(e => typeof e === 'string').map(e => e.toLowerCase().trim()));
  const available = new Set(groups.flatMap((g, i) => i === targetIndex ? [] : g.emails));
  const moving = [...requested].filter(e => available.has(e));
  if (!moving.length) return groups;
  const moved = new Set(moving);
  return groups.map((group, i) => ({
    ...group,
    emails: i === targetIndex
      ? [...new Set([...group.emails, ...moving])]
      : group.emails.filter(e => !moved.has(e)),
  })).filter((group, i) => group.emails.length || i === targetIndex || !groups[i].emails.length);
}

export function getDateBounds(commits) {
  const dates = commits.map(c => c.date).filter(validDate).sort();
  return { min: dates[0] ?? null, max: dates.at(-1) ?? null };
}

/** Shared calendar scope spans authored commits AND the Git tag events being
 * visualised. This does not change the author-based attribution of commits. */
export function getHistoryDateBounds(commits, tags = [], githubReleases = [], herokuReleases = []) {
  const bounds=getDateBounds(commits);
  for (const tag of tags) if (validDate(tag.taggedDate)) {
    if (!bounds.min || tag.taggedDate < bounds.min) bounds.min=tag.taggedDate;
    if (!bounds.max || tag.taggedDate > bounds.max) bounds.max=tag.taggedDate;
  }
  const knownTags=new Set(tags.map(t=>t.name));
  for(const release of githubReleases) if (!release.draft && release.publishedDate && knownTags.has(release.tag)) {
    if (!bounds.min || release.publishedDate < bounds.min) bounds.min=release.publishedDate;
    if (!bounds.max || release.publishedDate > bounds.max) bounds.max=release.publishedDate;
  }
  for(const record of herokuReleases)if(validDate(record.date)){
    if(!bounds.min||record.date<bounds.min)bounds.min=record.date;
    if(!bounds.max||record.date>bounds.max)bounds.max=record.date;
  }
  return bounds;
}

export function periodForPreset(commits, preset = 'all', bounds = null) {
  // A caller may include tag dates in the global date-window boundaries.
  // Commit-only analysis continues using authored dates by default.
  const { min, max } = bounds ?? getDateBounds(commits);
  if (!min || !max) return { start: null, end: null };
  if (preset === '90d' || preset === '365d' || preset === '730d') {
    const days = Number(preset.slice(0, -1));
    return { start: dateAtDay(dayNumber(max) - days + 1), end: max };
  }
  if (/^year-\d{4}$/.test(preset)) {
    const year = preset.slice(5);
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  return { start: min, end: max };
}

export function longestStreak(days) {
  const sorted = [...new Set(days)].filter(validDate).sort();
  let best = 0, current = 0, previous = null;
  for (const date of sorted) {
    current = previous !== null && dayNumber(date) - previous === 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = dayNumber(date);
  }
  return best;
}

export function longestConsecutiveWorkdays(days, allowedDays = [0, 1, 2, 3, 4]) {
  const workdays = [...new Set(days)].filter(d => validDate(d) && allowedDays.includes(dayOfWeek(d))).sort();
  const allowed = new Set(allowedDays);
  let best = 0, current = 0;
  let previous = null;
  for (const date of workdays) {
    if (previous === null) current = 1;
    else {
      let expected = dayNumber(previous) + 1;
      while (!allowed.has(dayOfWeek(dateAtDay(expected))) && expected <= dayNumber(date)) expected++;
      current = expected === dayNumber(date) ? current + 1 : 1;
    }
    best = Math.max(best, current);
    previous = date;
  }
  return best;
}

export function commitMetric(commit, key) {
  switch (key) {
    case 'commits': return 1;
    case 'lines_added': return commit.files.reduce((n, f) => n + f.added, 0);
    case 'lines_deleted': return commit.files.reduce((n, f) => n + f.deleted, 0);
    case 'churn': return commit.files.reduce((n, f) => n + f.added + f.deleted, 0);
    case 'files': return commit.files.length;
    case 'releases': return Number(commit.touchesVersion);
    case 'reverts': return Number(commit.isRevert);
    case 'merges': return Number(commit.isMerge);
    default: return 0;
  }
}

export function fileArea(path) {
  // The first directory is a meaningful, consistent architectural slice.
  // Root-level files are grouped together instead of creating one tiny row each.
  const plain = String(path || '').replace(/^\//, '');
  return plain.includes('/') ? `${plain.split('/')[0]}/` : '(root)';
}

function contributorStats(group, commits) {
  const totals = EMPTY_TOTALS();
  const daily = Object.fromEntries(Object.keys(METRICS).map(key => [key, {}]));
  const days = new Set();
  const weekdays = Array(7).fill(0);
  const hours = Array(24).fill(0);
  const timedWeekdays = Array(7).fill(0);
  const timeBands = Array(TIME_BANDS.length).fill(0);
  const areas = new Map();
  let timedCommits = 0;
  let weekendCommits = 0;
  let timedWeekendCommits = 0;

  for (const c of commits) {
    days.add(c.date);
    const dow = dayOfWeek(c.date);
    weekdays[dow]++;
    if (dow > 4) weekendCommits++;
    if (Number.isInteger(c.hour)) {
      timedCommits++;
      timedWeekdays[dow]++;
      if (dow > 4) timedWeekendCommits++;
      hours[c.hour]++;
      const band = TIME_BANDS.findIndex(t => c.hour >= t.start && c.hour < t.end);
      if (band >= 0) timeBands[band]++;
    }
    for (const key of Object.keys(METRICS)) {
      if (key === 'active_days') continue;
      const value = commitMetric(c, key);
      totals[key] += value;
      daily[key][c.date] = (daily[key][c.date] || 0) + value;
    }
    for (const file of c.files) {
      const area = fileArea(file.path);
      const row = areas.get(area) || { touches: 0, churn: 0 };
      row.touches++;
      row.churn += file.added + file.deleted;
      areas.set(area, row);
    }
  }
  totals.active_days = days.size;
  for (const day of days) daily.active_days[day] = 1;
  const dates = [...days].sort();
  return {
    id: group.id,
    displayName: group.displayName,
    emails: group.emails,
    commits,
    totals,
    daily,
    activeDays: days,
    weekdays,
    timedWeekdays,
    hours,
    timeBands,
    timedCommits,
    weekendCommits,
    timedWeekendCommits,
    areas,
    firstCommit: dates[0] || null,
    lastCommit: dates.at(-1) || null,
    longestStreak: longestStreak(days),
    longestWorkdayStreak: longestConsecutiveWorkdays(days),
  };
}

function teamSummary(commits, contributors) {
  const totals = EMPTY_TOTALS();
  for (const c of contributors) {
    for (const key of Object.keys(totals)) totals[key] += c.totals[key];
  }
  return {
    totals,
    commits: commits.length,
    contributingPeople: contributors.filter(c => c.totals.commits > 0).length,
    calendarDays: new Set(commits.map(c => c.date)).size,
    timedCommits: commits.filter(c => Number.isInteger(c.hour)).length,
  };
}

/**
 * The *only* filtering step used by the UI. All charts consume the selected
 * rows/stats and benchmark from this model, never their own hidden year rules.
 * The reference can include unselected people without changing the target.
 */
export function buildAnalysis(rawCommits, groups, scope = {}) {
  const { min, max } = getDateBounds(rawCommits);
  const start = scope.start ?? min;
  const end = scope.end ?? max;
  const includeMerges = !!scope.includeMerges;
  const includeReverts = scope.includeReverts !== false;
  const groupDefs = groups.map((g, i) => ({
    id: String(i),
    displayName: String(g.displayName || g.emails?.[0] || 'Unknown'),
    emails: (g.emails || []).map(e => String(e).toLowerCase()),
  })).filter(g => g.emails.length > 0);
  const emailToId = new Map();
  for (const group of groupDefs) {
    for (const email of group.emails) if (!emailToId.has(email)) emailToId.set(email, group.id);
  }
  const selected = scope.selectedIds == null
    ? new Set(groupDefs.map(g => g.id))
    : new Set([...scope.selectedIds].map(String));
  const selectedGroups = groupDefs.filter(g => selected.has(g.id));
  const selectedIds = new Set(selectedGroups.map(g => g.id));
  const eligibleCommits = rawCommits
    .filter(c => c.date && (!start || c.date >= start) && (!end || c.date <= end))
    .filter(c => (includeMerges || !c.isMerge) && (includeReverts || !c.isRevert))
    .map(c => ({ ...c, groupId: emailToId.get(c.email) }))
    .filter(c => c.groupId !== undefined);
  const selectedCommits = eligibleCommits.filter(c => selectedIds.has(c.groupId));
  const commitsByGroup = new Map(groupDefs.map(g => [g.id, []]));
  for (const commit of eligibleCommits) commitsByGroup.get(commit.groupId).push(commit);
  const allContributors = groupDefs.map(g => contributorStats(g, commitsByGroup.get(g.id)));
  const contributors = allContributors.filter(c => selectedIds.has(c.id));
  const referenceContributors = scope.denominator === 'selection' ? contributors : allContributors;
  const referenceCommits = scope.denominator === 'selection' ? selectedCommits : eligibleCommits;
  const metric = METRICS[scope.metric] ? scope.metric : 'commits';
  const byId = new Map(allContributors.map(c => [c.id, c]));
  const selectedSummary = teamSummary(selectedCommits, contributors);
  const referenceSummary = teamSummary(referenceCommits, referenceContributors);
  const weeks = [];
  if (validDate(start) && validDate(end) && start <= end) {
    for (let d = dayNumber(mondayOf(start)); d <= dayNumber(end); d += 7) {
      weeks.push(dateAtDay(d));
    }
  }
  const spanDays = validDate(start) && validDate(end) && start <= end ? dayNumber(end) - dayNumber(start) + 1 : 0;
  return withWeekAggregation({
    start, end, min, max, spanDays, weeks, metric,
    selectedIds, groupDefs, allContributors, contributors, byId,
    eligibleCommits, selectedCommits, referenceCommits, referenceContributors,
    selectedSummary, referenceSummary,
    denominator: scope.denominator === 'selection' ? 'selection' : 'repository',
    includeMerges, includeReverts,
    referenceTotal: referenceSummary.totals[metric],
  });
}

/** Reattach the tiny week-aggregation helper after a structured worker clone. */
export function withWeekAggregation(view) {
  const {weeks}=view;
  const sumsByWeek = (stats, key) => {
    const weekly = new Map(weeks.map(week => [week, 0]));
    for (const contributor of stats) {
      for (const [day, val] of Object.entries(contributor.daily[key])) {
        const week = mondayOf(day);
        if (weekly.has(week)) weekly.set(week, weekly.get(week) + val);
      }
    }
    return weekly;
  };
  view.sumsByWeek=sumsByWeek;
  return view;
}


/**
 * Author-local weekly timing profile for the *same filtered commits* used by
 * buildAnalysis. One timed commit belongs to precisely one of 168 slots and
 * exactly one weekday. Unknown authored hours are omitted from every timing
 * chart (not just from the hour chart), so totals reconcile across views.
 *
 * focusId='selection' aggregates the globally selected people. An individual
 * focus is only permitted for a person included in that selection.
 */
export function workingRhythm(view, focusId = 'selection') {
  const focus = String(focusId);
  if (focus !== 'selection' && !view.selectedIds.has(focus)) return null;
  const focused = focus === 'selection' ? view.selectedCommits : view.byId.get(focus)?.commits;
  if (!focused) return null;
  const bins = () => Array.from({length: 168}, (_, index) => ({
    index, day: Math.floor(index / 24), hour: index % 24,
    count: 0, dates: new Set(), added: 0, deleted: 0, fileTouches: 0, commits: [],
  }));
  const slots = bins();
  const reference = Array(168).fill(0);
  const referenceWeekdays = Array(7).fill(0);
  const dayTotals = Array(7).fill(0);
  const hourTotals = Array(24).fill(0);
  let timedCommits = 0;
  let referenceTimed = 0;

  for (const commit of focused) {
    if (!Number.isInteger(commit.hour) || commit.hour < 0 || commit.hour > 23) continue;
    const day = dayOfWeek(commit.date);
    const slot = slots[day * 24 + commit.hour];
    slot.count++;
    slot.dates.add(commit.date);
    slot.added += sum(commit.files.map(f => f.added));
    slot.deleted += sum(commit.files.map(f => f.deleted));
    slot.fileTouches += commit.files.length;
    slot.commits.push(commit);
    dayTotals[day]++;
    hourTotals[commit.hour]++;
    timedCommits++;
  }
  for (const commit of view.referenceCommits) {
    if (!Number.isInteger(commit.hour) || commit.hour < 0 || commit.hour > 23) continue;
    const day = dayOfWeek(commit.date);
    reference[day * 24 + commit.hour]++;
    referenceWeekdays[day]++;
    referenceTimed++;
  }
  const recent = commits => commits.sort((a, b) =>
    (b.authoredAt ?? -1) - (a.authoredAt ?? -1) || String(a.hash).localeCompare(String(b.hash)))
    .slice(0, 3).map(c => ({ hash: c.hash, subject: c.subject, date: c.date, hour: c.hour, minute: c.minute }));
  const cells = slots.map(slot => ({
    index: slot.index, day: slot.day, hour: slot.hour,
    count: slot.count, dates: slot.dates.size,
    added: slot.added, deleted: slot.deleted, fileTouches: slot.fileTouches,
    percentage: timedCommits ? 100 * slot.count / timedCommits : null,
    referenceCount: reference[slot.index],
    referenceShare: reference[slot.index] ? 100 * slot.count / reference[slot.index] : null,
    examples: recent(slot.commits),
  }));
  const weekdays = dayTotals.map((count, day) => ({
    day, count, percentage: timedCommits ? 100 * count / timedCommits : null,
    referenceCount: referenceWeekdays[day],
    referenceShare: referenceWeekdays[day] ? 100 * count / referenceWeekdays[day] : null,
    dates: new Set(slots.slice(day * 24, day * 24 + 24).flatMap(slot => [...slot.dates])).size,
    added: sum(slots.slice(day * 24, day * 24 + 24).map(slot => slot.added)),
    deleted: sum(slots.slice(day * 24, day * 24 + 24).map(slot => slot.deleted)),
    fileTouches: sum(slots.slice(day * 24, day * 24 + 24).map(slot => slot.fileTouches)),
    examples: recent(slots.slice(day * 24, day * 24 + 24).flatMap(slot => slot.commits)),
  }));
  const busiest = cells.reduce((best, cell) => !best || cell.count > best.count ? cell : best, null);
  const busiestDay = weekdays.reduce((best, day) => !best || day.count > best.count ? day : best, null);
  return {
    focusId: focus, isGroup: focus === 'selection',
    name: focus === 'selection' ? 'Selected contributors' : view.byId.get(focus).displayName,
    totalCommits: focused.length, timedCommits, missingTime: focused.length - timedCommits,
    referenceTimed, hourTotals, cells, weekdays,
    peakSlot: timedCommits ? busiest : null,
    peakDay: timedCommits ? busiestDay : null,
    peakHour: timedCommits ? hourTotals.indexOf(Math.max(...hourTotals)) : null,
    weekendShare: timedCommits ? (dayTotals[5] + dayTotals[6]) / timedCommits * 100 : null,
    referenceName: view.denominator === 'selection' ? 'selected group' : 'imported repository',
    showReference: focus === 'selection'
      ? !(view.denominator === 'selection' || view.selectedIds.size === view.allContributors.length)
      : !(view.referenceContributors.length === 1 && view.referenceContributors[0].id === focus),
  };
}

/**
 * A single authored day for one selected contributor, using exactly the
 * eligible commits and reference cohort from buildAnalysis. No second filter
 * path is introduced for the daily activity pulse or its details.
 */
export function pulseDayDetails(view, contributorId, date) {
  const id = String(contributorId);
  if (!validDate(date) || date < view.start || date > view.end || !view.selectedIds.has(id)) return null;
  const contributor = view.byId.get(id);
  if (!contributor) return null;

  const commits = contributor.commits.filter(c => c.date === date).sort((a, b) =>
    (b.authoredAt ?? -1) - (a.authoredAt ?? -1) || String(a.hash).localeCompare(String(b.hash)));
  const files = commits.flatMap(c => c.files);
  const added = sum(files.map(f => f.added));
  const deleted = sum(files.map(f => f.deleted));
  const areas = new Map();
  const byPath = new Map();
  for (const file of files) {
    const area = fileArea(file.path);
    areas.set(area, (areas.get(area) || 0) + 1);
    const prior = byPath.get(file.path) || { path:file.path, touches:0, added:0, deleted:0, binaryTouches:0 };
    prior.touches++;
    prior.added += file.added;
    prior.deleted += file.deleted;
    if (file.binary) prior.binaryTouches++;
    byPath.set(file.path, prior);
  }
  const times = commits.filter(c => Number.isInteger(c.hour))
    .map(c => `${String(c.hour).padStart(2, '0')}:${String(c.minute ?? 0).padStart(2, '0')}`).sort();
  const metricValue = contributor.daily[view.metric]?.[date] || 0;
  const referenceValue = sum(view.referenceContributors.map(c => c.daily[view.metric]?.[date] || 0));
  const referenceCommits = sum(view.referenceContributors.map(c => c.daily.commits[date] || 0));
  return {
    date, contributorId: id, contributorName: contributor.displayName,
    metric: view.metric, metricValue, referenceValue,
    reference: view.denominator, share: referenceValue ? metricValue / referenceValue * 100 : null,
    referenceCommits,
    commitsCount: commits.length,
    added, deleted, churn: added + deleted, net: added - deleted,
    fileTouches: files.length, uniqueFiles: new Set(files.map(f => f.path)).size,
    binaryTouches: files.filter(f => f.binary).length,
    merges: commits.filter(c => c.isMerge).length,
    reverts: commits.filter(c => c.isRevert).length,
    versionTouches: commits.filter(c => c.touchesVersion).length,
    firstLocalTime: times[0] ?? null, lastLocalTime: times.at(-1) ?? null,
    areas: [...areas].map(([name, touches]) => ({ name, touches }))
      .sort((a, b) => b.touches - a.touches || a.name.localeCompare(b.name)),
    fileChanges: [...byPath.values()].sort((a, b) =>
      b.touches - a.touches || (b.added + b.deleted) - (a.added + a.deleted) || a.path.localeCompare(b.path)),
    commits,
  };
}

export function sum(values) {
  return Array.isArray(values) ? values.reduce((a, b) => a + b, 0) : Object.values(values || {}).reduce((a, b) => a + b, 0);
}

export function valueInMode(value, { mode = 'total', reference = 0, activeDays = 0, calendarDays = 0 } = {}) {
  if (mode === 'share') return reference > 0 ? value / reference * 100 : 0;
  if (mode === 'per_active_day') return activeDays > 0 ? value / activeDays : 0;
  if (mode === 'per_week') return calendarDays > 0 ? value / (calendarDays / 7) : 0;
  return value;
}

export function displayModeLabel(mode) {
  return ({ total: 'Absolute', share: 'Share of reference', per_active_day: 'Per active day', per_week: 'Per calendar week' })[mode] || 'Absolute';
}

/** Plotting data with a consistent cohort, denominator and selection policy.
 * Every aggregation combines the numerator and denominator before dividing. */
export function seriesForAnalysis(view,{mode='total',trend='rolling'}={}) {
  const metric=view.metric, weeks=view.weeks;
  const reference=view.sumsByWeek(view.referenceContributors,metric);
  const periodDays=weeks.map(week=> {
    const from=Math.max(dayNumber(week), dayNumber(view.start));
    const to=Math.min(dayNumber(week)+6,dayNumber(view.end));
    return Math.max(0,to-from+1);
  });
  const lines=view.contributors.map(c=>{
    const own=view.sumsByWeek([c],metric);
    const active=view.sumsByWeek([c],'active_days');
    const vals=weeks.map((week,i)=>{
      // A rolling or cumulative *rate* must aggregate both its numerator and
      // denominator before dividing. Averaging percentages would be incorrect.
      const from=trend==='cumulative'?0:trend==='rolling'?Math.max(0,i-3):i;
      let value=0,referenceValue=0,activeDays=0,calendarDays=0;
      for(let k=from;k<=i;k++){
        value+=own.get(weeks[k])||0;
        referenceValue+=reference.get(weeks[k])||0;
        activeDays+=active.get(weeks[k])||0;
        calendarDays+=periodDays[k];
      }
      // Zero is a real total, but an activity-normalised rate or a share
      // without any events in its denominator is undefined, not 0%.
      if ((mode==='share' && !referenceValue) || (mode==='per_active_day' && !activeDays)) return null;
      return valueInMode(value,{
        mode,reference:referenceValue,activeDays,calendarDays,
      });
    });
    return {c,vals};
  });
  return {weeks,lines};
}


/**
 * Year/month and year/weekday-hour views from precisely the same globally
 * filtered author-date commits as the rest of the dashboard. Focus only
 * changes which already-selected people are shown, never the eligible cohort.
 *
 * Exposure is the overlap of the user's date scope with the imported
 * authored-date bounds. We cannot infer employment or unimported history
 * outside those bounds. Dates inside the imported span with no commits are
 * genuine zero counts in this dataset, not missing month records.
 */
export function seasonalityAnalysis(view, focusId = 'selection') {
  const focus = String(focusId);
  if (focus !== 'selection' && !view.selectedIds.has(focus)) return null;
  const focused = focus === 'selection' ? view.selectedCommits : view.byId.get(focus)?.commits;
  if (!focused) return null;
  const from = [view.start, view.min].filter(validDate).sort().at(-1);
  const to = [view.end, view.max].filter(validDate).sort()[0];
  const name = focus === 'selection' ? 'Selected contributors' : view.byId.get(focus).displayName;
  const emptyResult = { focusId: focus, name, from, to, years: [], comparisons: [], seasonalAverage: [], fullYears: 0, referenceName: view.denominator === 'selection' ? 'selected contributors' : 'imported repository' };
  if (!validDate(from) || !validDate(to) || from > to) return emptyResult;

  const byMonth = new Map();
  const referenceByMonth = new Map();
  for (const commit of focused) {
    const key = commit.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(commit);
  }
  for (const commit of view.referenceCommits) {
    const key = commit.date.slice(0, 7);
    referenceByMonth.set(key, (referenceByMonth.get(key) || 0) + 1);
  }
  const years = [];
  const daySpan = (a, b) => Math.max(0, dayNumber(b) - dayNumber(a) + 1);
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
    const start = from > yearStart ? from : yearStart;
    const end = to < yearEnd ? to : yearEnd;
    const exposureDays = daySpan(start, end);
    const months = Array.from({length: 12}, (_, month) => {
      const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const startDate = start > monthStart ? start : monthStart;
      const endDate = end < monthEnd ? end : monthEnd;
      const days = startDate <= endDate ? daySpan(startDate, endDate) : 0;
      const key = monthStart.slice(0, 7);
      const commits = days ? (byMonth.get(key) || []) : [];
      const activeDates = new Set(commits.map(c => c.date)).size;
      return { year, month, key, start: days ? startDate : null, end: days ? endDate : null,
        days, full: days === lastDay, calendarDays: lastDay,
        count: commits.length, activeDates, referenceCount: days ? referenceByMonth.get(key) || 0 : 0,
        commits, pace: days ? commits.length / days * 7 : null,
        share: null, index: null };
    });
    const commits = months.flatMap(m => m.commits);
    const count = commits.length;
    const timed = commits.filter(c => Number.isInteger(c.hour) && c.hour >= 0 && c.hour <= 23);
    const activeDays = new Set(commits.map(c => c.date)).size;
    const weekend = commits.filter(c => dayOfWeek(c.date) >= 5).length;
    const evening = timed.filter(c => c.hour >= 18 && c.hour <= 23).length;
    const slots = Array(168).fill(0);
    const weekdayExposures = Array(7).fill(0);
    for (let n = dayNumber(start); n <= dayNumber(end); n++) weekdayExposures[dayOfWeek(dateAtDay(n))]++;
    for (const commit of timed) slots[dayOfWeek(commit.date) * 24 + commit.hour]++;
    const avgDaily = exposureDays ? count / exposureDays : 0;
    for (const month of months) {
      month.share = count ? month.count / count * 100 : null;
      month.index = month.days && avgDaily ? month.count / month.days / avgDaily : null;
    }
    years.push({ year, start, end, exposureDays,
      full: exposureDays === daySpan(yearStart, yearEnd), months, commits, count, activeDays,
      pace: exposureDays ? count / exposureDays * 7 : null,
      activeFrequency: exposureDays ? activeDays / exposureDays * 100 : null,
      perActiveDay: activeDays ? count / activeDays : null,
      timedCount: timed.length, untimedCount: count - timed.length,
      timeCoverage: count ? timed.length / count * 100 : null,
      weekendShare: count ? weekend / count * 100 : null,
      eveningShare: timed.length ? evening / timed.length * 100 : null,
      slots, weekdayExposures,
    });
  }

  // For an honest year-over-year comparison, intersect the calendar dates
  // actually covered in both years (e.g. Jan–Oct vs Jan–Dec compares Jan–Oct).
  // Never extrapolate counts to an unobserved part of either year.
  for (const row of years) {
    const previous = years.find(y => y.year === row.year - 1);
    if (!previous) { row.yoy = null; continue; }
    const startMD = [row.start.slice(5), previous.start.slice(5)].sort().at(-1);
    const endMD = [row.end.slice(5), previous.end.slice(5)].sort()[0];
    if (startMD > endMD) { row.yoy = null; continue; }
    const subwindow = annual => annual.commits.filter(c => c.date.slice(5) >= startMD && c.date.slice(5) <= endMD);
    const thisCount = subwindow(row).length, lastCount = subwindow(previous).length;
    const inclusiveDays = annual => annual.months.reduce((n,m) => {
      if (!m.days) return n;
      const lo = `${annual.year}-${startMD}`, hi = `${annual.year}-${endMD}`;
      const a = m.start > lo ? m.start : lo;
      const b = m.end < hi ? m.end : hi;
      return n + (a <= b ? daySpan(a,b) : 0);
    }, 0);
    const thisDays = inclusiveDays(row), lastDays = inclusiveDays(previous);
    if (!thisDays || !lastDays) { row.yoy = null; continue; }
    const thisPace = thisCount / thisDays * 7, lastPace = lastCount / lastDays * 7;
    row.yoy = { from: startMD, to: endMD, currentCount: thisCount, priorCount: lastCount,
      currentDays: thisDays, priorDays: lastDays,
      currentPace: thisPace, priorPace: lastPace,
      change: lastPace ? (thisPace / lastPace - 1) * 100 : null };
  }
  // Only complete observed years enter a purported recurring seasonal mean.
  // At least three such years must exist before returning one.
  const fullYears = years.filter(y => y.full);
  const seasonalAverage = Array.from({length: 12}, (_, month) => {
    const eligible = fullYears.map(y => y.months[month]).filter(m => m.index !== null && m.full);
    return eligible.length >= 3
      ? { month, count: eligible.length, index: sum(eligible.map(m => m.index)) / eligible.length,
        pace: sum(eligible.map(m => m.pace)) / eligible.length }
      : { month, count: eligible.length, index: null, pace: null };
  });
  const comparisons = view.contributors.map(contributor => ({
    id: contributor.id, name: contributor.displayName,
    years: years.map(year => {
      const matching = contributor.commits.filter(c => c.date >= year.start && c.date <= year.end);
      const active = new Set(matching.map(c => c.date)).size;
      return { year: year.year, count: matching.length, pace: year.exposureDays ? matching.length / year.exposureDays * 7 : null,
        activeFrequency: year.exposureDays ? active / year.exposureDays * 100 : null,
        weekendShare: matching.length ? matching.filter(c => dayOfWeek(c.date) >= 5).length / matching.length * 100 : null };
    }),
  }));
  return { focusId: focus, name, from, to, years, comparisons, seasonalAverage,
    fullYears: fullYears.length,
    referenceName: view.denominator === 'selection' ? 'selected contributors' : 'imported repository' };
}

/** Every year×month display mode uses the same count and exposed date range. */
export function seasonalMonthValue(month, mode = 'rate') {
  if (mode === 'shape') return month.share;
  if (mode === 'index') return month.index;
  return month.pace;
}
