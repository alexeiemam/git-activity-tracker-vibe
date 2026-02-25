/** @file aggregate.js */

import { COLORS } from "./constants.js";
import { sumMap, parseVersionFromSubject } from "./utils.js";
import { state } from "./state.js";

/** @param {Record<string, number>} map */
export function yrSum(map) {
  if (state.activeYear === "all") return sumMap(map);
  const p = String(state.activeYear);
  let s = 0;
  for (const [d, v] of Object.entries(map || {})) {
    if (d.startsWith(p)) s += v;
  }
  return s;
}

export function metricLabel(key) {
  const labels = {
    commits: "Commits",
    lines_added: "Lines Added",
    lines_deleted: "Lines Deleted",
    files: "Files Changed",
    active_days: "Active Days",
    releases: "Releases",
  };
  return labels[key] || key;
}

/** @param {any} c @param {string} key */
export function metricValueForContributor(c, key) {
  if (!c) return 0;

  if (key === "active_days") {
    if (state.activeYear === "all") return c.totalActiveDays || 0;
    const p = String(state.activeYear);
    let count = 0;
    for (const d of c.activeDays || []) if (String(d).startsWith(p)) count++;
    return count;
  }

  return yrSum(c[key] || {});
}

/**
 * Aggregate commits by merge groups into per-day maps.
 * Honors state.includeMerges and state.penaliseReverts.
 *
 * @param {Array<any>} commits
 * @param {Array<{displayName:string, emails:string[]}>} groups
 */
export function aggregate(commits, groups) {
  const emailMap = {};
  groups.forEach((g, gi) => g.emails.forEach(e => (emailMap[e] = gi)));

  const byGroup = {};
  const dates = [];

  for (const c of commits) {
    if (!c.date) continue;
    if (!state.includeMerges && c.isMerge) continue;

    dates.push(c.date);

    const gi = emailMap[c.email];
    if (gi === undefined) continue;

    if (!byGroup[gi]) {
      byGroup[gi] = {
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
        dowHourly: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        releases: {},
        releaseVersions: {},
        timedByDate: {},

        _rawCommitCounts: {},
        _revertDays: new Set(),
      };
    }

    const r = byGroup[gi];
    const d = c.date;

    r._rawCommitCounts[d] = (r._rawCommitCounts[d] || 0) + 1;

    // file stats
    let fa = 0, fd = 0;
    for (const f of c.files) {
      fa += f.added;
      fd += f.deleted;
    }

    const isPenalisedRevert = state.penaliseReverts && c.isRevert;

    r.commits[d] = (r.commits[d] || 0) + (isPenalisedRevert ? -2 : 1);
    r.activeDays.add(d);

    if (isPenalisedRevert) {
      r._revertDays.add(d);
      r.lines_added[d] = (r.lines_added[d] || 0) - 2 * fa;
      r.lines_deleted[d] = (r.lines_deleted[d] || 0) - 2 * fd;
    } else {
      r.lines_added[d] = (r.lines_added[d] || 0) + fa;
      r.lines_deleted[d] = (r.lines_deleted[d] || 0) + fd;
    }

    r.files[d] = (r.files[d] || 0) + c.files.length;

    // DOW
    const dow = new Date(c.date + "T12:00:00").getDay();
    r.dowly[dow]++;

    // timed buckets
    if (c.hour >= 0 && c.hour < 24) {
      r.hasHourData = true;
      r.hourly[c.hour]++;
      r.dowHourly[dow][c.hour]++;

      if (!r.timedByDate[d]) r.timedByDate[d] = { dow, hours: {} };
      r.timedByDate[d].hours[c.hour] = (r.timedByDate[d].hours[c.hour] || 0) + 1;
    }

    // releases: VERSION touched
    if (c.touchesVersion) {
      const ver = parseVersionFromSubject(c.subject);
      c.releaseVersion = ver;

      r.releases[d] = (r.releases[d] || 0) + 1;
      if (!r.releaseVersions[d]) r.releaseVersions[d] = [];
      if (ver && !r.releaseVersions[d].includes(ver)) r.releaseVersions[d].push(ver);
    }
  }

  // post pass: active day removal rule
  for (const r of Object.values(byGroup)) {
    if (!state.penaliseReverts) break;

    for (const d of r._revertDays) {
      const rawCount = r._rawCommitCounts[d] || 0;
      if (rawCount === 2) {
        r.activeDays.delete(d);
        if ((r.commits[d] || 0) <= 0) delete r.commits[d];
      }
    }
    delete r._rawCommitCounts;
    delete r._revertDays;
  }

  const committers = Object.values(byGroup)
    .map(r => ({
      ...r,
      colorIndex: r.gi % COLORS.length,
      totalCommits: sumMap(r.commits),
      totalAdded: sumMap(r.lines_added),
      totalDeleted: sumMap(r.lines_deleted),
      totalFiles: sumMap(r.files),
      totalActiveDays: r.activeDays.size,
      firstCommit: [...r.activeDays].sort()[0],
      lastCommit: [...r.activeDays].sort().pop(),
      totalReleases: sumMap(r.releases),
    }))
    .filter(c => c.totalCommits > 0);

  committers.sort((a, b) => b.totalCommits - a.totalCommits);

  const sorted = [...dates].sort();
  const hasAnyHourData = committers.some(c => c.hasHourData);

  return {
    committers,
    minDate: sorted[0],
    maxDate: sorted[sorted.length - 1],
    hasAnyHourData,
  };
}