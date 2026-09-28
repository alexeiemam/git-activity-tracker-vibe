/**
 * Pure parsing and aggregation logic for Git Activity Tracker.
 * This module intentionally has no DOM or storage dependencies.
 */

function parseVersionFromSubject(subject) {
  const s = String(subject || '');
  const re = /\bv?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b/;
  const m = s.match(re);
  return m ? m[1] : null;
}

export function parseGitLog(raw) {
  const commits = [];
  let cur = null;
  for (const line of raw.trim().split('\n')) {
    const t = line.trim();
    if (!t) continue;

    if (t.startsWith('COMMIT|')) {
      if (cur) commits.push(cur);
      const p = t.split('|');

      // Support both ISO datetime (new: %aI → 2024-03-15T14:32:00+01:00) and short date (old: %ad --date=short → 2024-03-15)
      const rawDate = (p[4] || '').trim();
      let date = '',
        hour = -1,
        minute = -1;

      if (rawDate.includes('T')) {
        // ISO 8601 full timestamp
        date = rawDate.slice(0, 10);
        const timePart = rawDate.slice(11, 19); // HH:MM:SS
        hour = parseInt(timePart.slice(0, 2), 10);
        minute = parseInt(timePart.slice(3, 5), 10);
        // Keep local time as-is (user's timezone is most meaningful)
      } else {
        date = rawDate;
        hour = -1;
        minute = -1; // no time info
      }

      const subject = (p[5] || '').trim();

      const isRevert =
        /^revert\b/i.test(subject) || // "Revert ..."
        /this reverts commit\b/i.test(subject);

      // Detect merge commits: subject matches common merge patterns
      const isMerge =
        /^Merge (branch|pull request|remote|tag|commit)/i.test(subject) ||
        /^Merged? /i.test(subject);

      cur = {
        hash: p[1] || '',
        email: (p[2] || '?').toLowerCase().trim(),
        name: (p[3] || '?').trim(),
        date,
        hour,
        minute,
        subject,
        isMerge,
        isRevert,
        touchesVersion: false, // NEW
        releaseVersion: null, // NEW
        files: []
      };

    } else if (cur) {
      const m = t.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (m) {
        const path = m[3].trim();
        cur.files.push({
          added: m[1] === '-' ? 0 : +m[1],
          deleted: m[2] === '-' ? 0 : +m[2],
          path
        });

        //  mark release commits if VERSION file is included
        if (path === 'VERSION' || path.endsWith('/VERSION')) {
          cur.touchesVersion = true;
        }
      }
    }
  }

  if (cur) commits.push(cur);
  if (!commits.length) throw new Error('No commits found — check format.');
  return commits;
}

export function sum(obj) {
  return Object.values(obj || {}).reduce((a, b) => a + b, 0);
}

export function aggregate(commits, groups, { includeMerges = false, penaliseReverts = false, colorCount = 1 } = {}) {
  const emailMap = {};
  groups.forEach((g, gi) => g.emails.forEach(e => emailMap[e] = gi));

  const byGroup = {};
  const dates = [];

  for (const c of commits) {
    if (!c.date) continue;
    if (!includeMerges && c.isMerge) continue; // skip merge commits unless opted in

    dates.push(c.date);

    const gi = emailMap[c.email];
    if (gi === undefined) continue;

    if (!byGroup[gi]) byGroup[gi] = {
      gi,
      displayName: groups[gi].displayName,
      emails: groups[gi].emails,
      commits: {},
      lines_added: {},
      lines_deleted: {},
      files: {},
      activeDays: new Set(),
      hourly: new Array(24).fill(0),
      hasHourData: false,
      dowly: new Array(7).fill(0),
      dowHourly: Array.from({
        length: 7
      }, () => new Array(24).fill(0)),

      releases: {}, // NEW
      releaseVersions: {}, // NEW

      //  time data indexed by date so all time-based charts can respect activeYear
      // date -> { dow: 0..6, hours: { [0..23]: count } }
      timedByDate: {},

      // revert bookkeeping (internal)
      _rawCommitCounts: {}, // date -> raw commits count (before penalties)
      _revertDays: new Set(),
      _revertAdded: {},
      _revertDeleted: {},
    };

    const r = byGroup[gi];
    const d = c.date;

    // --- raw commit count always increments (used for the "only 2 commits that day" rule)
    r._rawCommitCounts[d] = (r._rawCommitCounts[d] || 0) + 1;

    // --- compute file stats for this commit
    let fa = 0,
      fd = 0;
    c.files.forEach(f => {
      fa += f.added;
      fd += f.deleted;
    });

    const isPenalisedRevert = penaliseReverts && c.isRevert;

    // commits:
    // normal commit: +1
    // revert commit when penalising: -2 (net reduction by 2)
    r.commits[d] = (r.commits[d] || 0) + (isPenalisedRevert ? -2 : 1);

    // active day:
    r.activeDays.add(d);

    // lines:
    // normal: +fa/+fd
    // penalised revert: subtract 2×(fa/fd)
    if (isPenalisedRevert) {
      r._revertDays.add(d);
      r._revertAdded[d] = (r._revertAdded[d] || 0) + fa;
      r._revertDeleted[d] = (r._revertDeleted[d] || 0) + fd;

      r.lines_added[d] = (r.lines_added[d] || 0) - (2 * fa);
      r.lines_deleted[d] = (r.lines_deleted[d] || 0) - (2 * fd);
    } else {
      r.lines_added[d] = (r.lines_added[d] || 0) + fa;
      r.lines_deleted[d] = (r.lines_deleted[d] || 0) + fd;
    }

    // files changed (unchanged by spec)
    r.files[d] = (r.files[d] || 0) + c.files.length;

    // day-of-week (all commits)
    const dow = new Date(c.date + 'T12:00:00').getDay();
    r.dowly[dow]++; // keep legacy all-time tally

    // time buckets (only commits that have hour)
    if (c.hour >= 0 && c.hour < 24) {
      r.hasHourData = true;

      // keep legacy all-time charts
      r.hourly[c.hour]++;
      r.dowHourly[dow][c.hour]++;

      //  by-date time data (for year-filtered hour/dow/dowhour charts)
      if (!r.timedByDate[d]) r.timedByDate[d] = {
        dow,
        hours: {}
      };
      r.timedByDate[d].hours[c.hour] = (r.timedByDate[d].hours[c.hour] || 0) + 1;
    }

    //  Releases metric (commit touches VERSION file)
    if (c.touchesVersion) {
      const ver = parseVersionFromSubject(c.subject);
      c.releaseVersion = ver; // store on raw commit for tooltip pills

      r.releases[d] = (r.releases[d] || 0) + 1;

      if (!r.releaseVersions[d]) r.releaseVersions[d] = [];
      // keep unique versions per day (best effort)
      if (ver && !r.releaseVersions[d].includes(ver)) r.releaseVersions[d].push(ver);
    }
  }

  // Post-pass: "if only 2 commits on the day of the revert for that individual, do not count it as an active day"
  for (const r of Object.values(byGroup)) {
    if (!penaliseReverts) break;

    for (const d of r._revertDays) {
      const rawCount = r._rawCommitCounts[d] || 0;
      if (rawCount === 2) {
        r.activeDays.delete(d);
        // if commits[d] is <= 0, drop the key entirely (avoids weird negatives)
        if ((r.commits[d] || 0) <= 0) delete r.commits[d];
      }
    }

    // cleanup internal fields
    delete r._rawCommitCounts;
    delete r._revertDays;
    delete r._revertAdded;
    delete r._revertDeleted;
  }

  const committers = Object.values(byGroup).map(r => ({
    ...r,
    colorIndex: r.gi % Math.max(colorCount, 1),
    totalCommits: sum(r.commits),
    totalAdded: sum(r.lines_added),
    totalDeleted: sum(r.lines_deleted),
    totalFiles: sum(r.files),
    totalActiveDays: r.activeDays.size,
    firstCommit: [...r.activeDays].sort()[0],
    lastCommit: [...r.activeDays].sort().pop(),
    totalReleases: sum(r.releases), // NEW
  })).filter(c => c.totalCommits > 0);

  committers.sort((a, b) => b.totalCommits - a.totalCommits);

  const sorted = [...dates].sort();
  const hasAnyHourData = committers.some(c => c.hasHourData);

  return {
    committers,
    minDate: sorted[0],
    maxDate: sorted[sorted.length - 1],
    hasAnyHourData
  };
}

export function longestStreak(days) {
  const sorted = [...days].sort();
  if (!sorted.length) return 0;
  let max = 1,
    cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00');
    const curr = new Date(sorted[i] + 'T00:00:00');
    if ((curr - prev) / 86400000 === 1) {
      cur++;
      max = Math.max(max, cur);
    } else cur = 1;
  }
  return max;
}

export function longestConsecutiveWorkdays(days) {
  const CUTOVER = '2024-08-01';
  const uniqSorted = [...new Set(days)].sort();
  if (!uniqSorted.length) return 0;

  const dowOf = d => new Date(d + 'T12:00:00').getDay();
  const daysDiff = (a, b) => (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000;

  const isCounted = (dateStr, dow) => {
    if (dateStr < CUTOVER) return dow >= 1 && dow <= 5; // pre: Mon–Fri
    return dow >= 1 && dow <= 4; // post: Mon–Thu
  };

  const isNextWorkday = (prevDate, prevDow, curDate, curDow) => {
    const diff = daysDiff(prevDate, curDate);

    if (prevDate < CUTOVER) {
      if (prevDow >= 1 && prevDow <= 4) return diff === 1 && curDow === prevDow + 1;
      if (prevDow === 5) return diff === 3 && curDow === 1; // Fri->Mon
      return false;
    } else {
      if (prevDow >= 1 && prevDow <= 3) return diff === 1 && curDow === prevDow + 1;
      if (prevDow === 4) return diff === 4 && curDow === 1; // Thu->Mon
      return false;
    }
  };

  const workdays = uniqSorted.filter(d => isCounted(d, dowOf(d)));
  if (!workdays.length) return 0;

  let max = 1,
    cur = 1;
  for (let i = 1; i < workdays.length; i++) {
    const prev = workdays[i - 1];
    const currD = workdays[i];
    const prevDow = dowOf(prev);
    const currDow = dowOf(currD);

    if (isNextWorkday(prev, prevDow, currD, currDow)) {
      cur++;
      if (cur > max) max = cur;
    } else cur = 1;
  }
  return max;
}

