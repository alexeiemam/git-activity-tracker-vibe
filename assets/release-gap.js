/**
 * A descriptive, per-contributor overlay for the authored-day Pulse.
 *
 * The release clock comes from the COMPLETE, policy-filtered release index,
 * rather than the date-filtered Impact Explorer. Only a positive authored
 * contribution to an incremental tagged release resets the clock; a release
 * driver, a baseline tag, and a VERSION edit do not by themselves count.
 *
 * The combined signal is NOT a rating of a person or their performance.
 * Commit frequency misses reviews, design, pairing, leave, and other work.
 */
import { dayNumber, dateAtDay, validDate } from './domain.js?v=git-release-gap-20261105-1';

export const GAP_HORIZONS = Object.freeze([30, 60, 90]);
export const BUSY_DAY_THRESHOLDS = Object.freeze([2, 4, 6]);
export const ATTENTION_THRESHOLD = 50;
export const DEFAULT_GAP_HORIZON = 60;
export const DEFAULT_BUSY_DAY = 4;

const rounded = value => Math.round(value * 10) / 10;

/** Zero at a release and on a busy day; more time and fewer commits raise it. */
export function releaseGapScore(daysSinceRelease, authoredCommits, {
  horizon = DEFAULT_GAP_HORIZON,
  busyDay = DEFAULT_BUSY_DAY,
} = {}) {
  if (!Number.isFinite(daysSinceRelease) || daysSinceRelease < 0 ||
      !Number.isFinite(authoredCommits) || authoredCommits < 0 ||
      !(horizon > 0) || !(busyDay > 0)) return null;
  const recency = Math.min(1, daysSinceRelease / horizon);
  const quiet = Math.max(0, 1 - authoredCommits / busyDay);
  return rounded(100 * recency * quiet);
}

/**
 * @param {Object} index Full-history buildEvidenceIndex result (not date trimmed)
 * @param {Array} contributors Current globally selected contributors from buildAnalysis
 * @param {Object} window Inclusive authored date range
 */
export function releaseGapMatrix(index, contributors, window, options = {}) {
  const horizon = GAP_HORIZONS.includes(Number(options.horizon)) ? Number(options.horizon) : DEFAULT_GAP_HORIZON;
  const busyDay = BUSY_DAY_THRESHOLDS.includes(Number(options.busyDay)) ? Number(options.busyDay) : DEFAULT_BUSY_DAY;
  const start = window?.from, end = window?.to;
  const valid = validDate(start) && validDate(end) && start <= end;
  const releasesById = new Map();
  for (const release of index?.releases || []) {
    // A baseline inherits all earlier history; it cannot establish a new
    // incremental contribution on its date.
    if (release.baseline || !validDate(release.date)) continue;
    for (const member of release.members || []) {
      if (!(member.commits > 0)) continue; // driver alone is not authorship
      const id = String(member.id);
      if (!releasesById.has(id)) releasesById.set(id, []);
      releasesById.get(id).push({date:release.date,tag:release.tag,hash:release.hash,
        lineageComplete:release.lineageComplete !== false});
    }
  }
  for (const events of releasesById.values()) events.sort((a,b)=>a.date.localeCompare(b.date) || a.tag.localeCompare(b.tag));
  const rows = [];
  const byId = new Map();
  if (valid) for (const person of contributors || []) {
    const events = releasesById.get(String(person.id)) || [];
    const daily = new Map(), months = new Map();
    const authored = person.daily?.commits || {};
    let cursor = 0, lastRelease = null, scoredDays = 0, attentionDays = 0, scoreSum = 0;
    for (let d = dayNumber(start), last = dayNumber(end); d <= last; d++) {
      const date = dateAtDay(d);
      while (cursor < events.length && events[cursor].date <= date) lastRelease = events[cursor++];
      const commits = Number(authored[date] || 0);
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const inCoverage = (!index?.bounds?.min || date >= index.bounds.min) &&
        (!index?.bounds?.max || date <= index.bounds.max);
      const reason = !inCoverage ? 'outside-history' : weekday === 0 || weekday === 6 ? 'weekend' :
        !lastRelease ? 'no-prior-contribution' : 'scored';
      const daysSinceRelease = lastRelease ? d - dayNumber(lastRelease.date) : null;
      const score = reason === 'scored' ? releaseGapScore(daysSinceRelease, commits, {horizon,busyDay}) : null;
      const item = {date,commits,daysSinceRelease,score,reason,lastRelease};
      daily.set(date,item);
      if (score !== null) {
        scoredDays++;scoreSum+=score;
        if (score >= ATTENTION_THRESHOLD) attentionDays++;
        const month=date.slice(0,7);
        if (!months.has(month)) months.set(month,{month,score:0,total:0,days:0,attentionDays:0,lastRelease:null,lastGap:null});
        const bucket=months.get(month);
        bucket.total+=score;bucket.days++;
        if (score >= ATTENTION_THRESHOLD)bucket.attentionDays++;
        bucket.lastRelease=lastRelease;bucket.lastGap=daysSinceRelease;
      }
    }
    for (const bucket of months.values())bucket.score=rounded(bucket.total/bucket.days);
    const row={id:String(person.id),name:person.displayName,daily,months,latestRelease:lastRelease,
      latestGap:lastRelease ? dayNumber(end)-dayNumber(lastRelease.date) : null,
      scoredDays,attentionDays,averageScore:scoredDays?rounded(scoreSum/scoredDays):null};
    rows.push(row);byId.set(row.id,row);
  }
  return {rows,byId,horizon,busyDay,from:start,to:end,available:!!releasesById.size};
}
