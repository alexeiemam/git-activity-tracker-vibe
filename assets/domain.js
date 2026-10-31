/**
 * Source-of-truth for every dashboard slice. No DOM, browser storage or rendering.
 * A contributor/day is counted once for active_days; a team's contributor-days
 * are additive, unlike the number of calendar dates with any team activity.
 */

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

export function parseGitLog(raw) {
  const commits = [];
  let current = null;
  const flush = () => { if (current) commits.push(current); };

  for (const original of String(raw || '').split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    if (line.startsWith('COMMIT|')) {
      flush();
      const parts = line.split('|');
      // New command ends with %P. Older exports had only 6 fields. Preserve
      // literal pipes in subjects instead of silently truncating the message.
      const hasParents = parts.length >= 7 && (/^(?:[a-f0-9]{7,64})(?:\s+[a-f0-9]{7,64})*$/i.test(parts.at(-1)) || parts.at(-1) === '');
      const subject = parts.slice(5, hasParents ? -1 : undefined).join('|').trim();
      const authored = (parts[4] || '').trim();
      const date = authored.slice(0, 10);
      const parents = hasParents ? parts.at(-1).trim().split(/\s+/).filter(Boolean) : [];
      const timeMatch = authored.match(/^\d{4}-\d\d-\d\dT(\d\d):(\d\d):\d\d(?:Z|[+-]\d\d:\d\d)$/);
      const hour = timeMatch ? Number(timeMatch[1]) : null;
      const minute = timeMatch ? Number(timeMatch[2]) : null;
      current = {
        hash: (parts[1] || '').trim(),
        email: (parts[2] || '?').trim().toLowerCase(),
        name: (parts[3] || '?').trim(),
        date: validDate(date) ? date : null,
        authoredAt: Number.isFinite(Date.parse(authored)) ? Date.parse(authored) : null,
        hour: Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null,
        minute: Number.isInteger(minute) && minute >= 0 && minute < 60 ? minute : null,
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
        path,
        binary: match[1] === '-' || match[2] === '-',
      });
      if (/(^|\/)VERSION$/.test(path)) current.touchesVersion = true;
    }
  }
  flush();

  // A pasted log can contain duplicate revs (for example multiple git-log runs).
  // Counting the same object twice produces misleading comparisons.
  const seen = new Set();
  const unique = commits.filter(commit => {
    if (!commit.date) return false;
    if (!commit.hash) return true;
    if (seen.has(commit.hash)) return false;
    seen.add(commit.hash);
    return true;
  });
  if (!unique.length) throw new Error('No dated commits found. Use the generated git log command.');
  return unique;
}

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

export function periodForPreset(commits, preset = 'all') {
  const { min, max } = getDateBounds(commits);
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
  const timeBands = Array(TIME_BANDS.length).fill(0);
  const areas = new Map();
  let timedCommits = 0;
  let weekendCommits = 0;

  for (const c of commits) {
    days.add(c.date);
    const dow = dayOfWeek(c.date);
    weekdays[dow]++;
    if (dow > 4) weekendCommits++;
    if (Number.isInteger(c.hour)) {
      timedCommits++;
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
    hours,
    timeBands,
    timedCommits,
    weekendCommits,
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
  return {
    start, end, min, max, spanDays, weeks, metric,
    selectedIds, groupDefs, allContributors, contributors, byId,
    eligibleCommits, selectedCommits, referenceCommits, referenceContributors,
    selectedSummary, referenceSummary,
    denominator: scope.denominator === 'selection' ? 'selection' : 'repository',
    includeMerges, includeReverts,
    sumsByWeek,
    referenceTotal: referenceSummary.totals[metric],
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

