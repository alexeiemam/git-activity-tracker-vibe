/**
 * A descriptive, per-contributor overlay for the authored-day Pulse.
 *
 * Each authored incremental tagged release earns a proportional reduction of
 * the accumulated release-gap factor, based on that contributor's *absolute*
 * recorded text-line churn (additions + deletions, excluding VERSION files).
 * The clock is carried from the complete, policy-filtered release history:
 * date-window filters must not erase earlier credit. Driving a release, tag
 * baselines, and commits with no measurable non-VERSION lines earn no credit.
 *
 * This is NOT a rating of people or performance. Line counts miss pairing,
 * reviews, binary work, and many other kinds of contribution.
 */
import { dayNumber, dateAtDay, validDate } from './domain.js?v=git-contribution-momentum-20261106-1';

export const GAP_HORIZONS = Object.freeze([30, 60, 90]);
export const BUSY_DAY_THRESHOLDS = Object.freeze([2, 4, 6]);
export const RELEASE_LINE_THRESHOLDS = Object.freeze([50, 100, 200, 500]);
export const DAILY_CHURN_THRESHOLDS = Object.freeze([50, 100, 200, 500]);
export const ATTENTION_THRESHOLD = 50;
export const DEFAULT_GAP_HORIZON = 60;
export const DEFAULT_BUSY_DAY = 4;
export const DEFAULT_RELEASE_LINES = 200;
export const DEFAULT_DAILY_CHURN = 200;

const rounded = value => Math.round(value * 10) / 10;

/** Text churn from imported, policy-filtered commits, excluding VERSION markers. */
export function nonVersionChurn(commit) {
  return (commit?.files || []).reduce((total,file) =>
    total + (/(^|\/)VERSION$/.test(file.path || '') ? 0 :
      Math.max(0,Number(file.added) || 0) + Math.max(0,Number(file.deleted) || 0)),0);
}

/** Complete-history authored churn, shared with the trend lens. */
const textChurnCache = new WeakMap();
export function dailyTextChurn(index) {
  if (!Array.isArray(index?.activity)) return null;
  if (textChurnCache.has(index)) return textChurnCache.get(index);
  const byId = new Map();
  for (const commit of index.activity) {
    if (!validDate(commit.date) || commit.groupId === undefined || commit.groupId === null) continue;
    const id=String(commit.groupId), lines=nonVersionChurn(commit);
    if (!byId.has(id)) byId.set(id,new Map());
    const days=byId.get(id);
    days.set(commit.date,(days.get(commit.date)||0)+lines);
  }
  textChurnCache.set(index,byId);
  return byId;
}

/** Absolute per-person line churn earns 0–100% credit, regardless of release size. */
export function releaseContributionCredit(linesChanged, fullCreditLines = DEFAULT_RELEASE_LINES) {
  if (!Number.isFinite(linesChanged) || linesChanged < 0 ||
      !(Number.isFinite(fullCreditLines) && fullCreditLines > 0)) return null;
  return Math.min(1, linesChanged / fullCreditLines);
}

/** Effective-gap days already incorporate previous release credits. */
export function releaseGapScore(effectiveGapDays, authoredCommits, {
  horizon = DEFAULT_GAP_HORIZON,
  busyDay = DEFAULT_BUSY_DAY,
  churn = 0,
  busyChurn = DEFAULT_DAILY_CHURN,
} = {}) {
  if (!Number.isFinite(effectiveGapDays) || effectiveGapDays < 0 ||
      !Number.isFinite(authoredCommits) || authoredCommits < 0 ||
      !Number.isFinite(churn) || churn < 0 ||
      !(Number.isFinite(horizon) && horizon > 0) ||
      !(Number.isFinite(busyDay) && busyDay > 0) ||
      !(Number.isFinite(busyChurn) && busyChurn > 0)) return null;
  const recency = Math.min(1, effectiveGapDays / horizon);
  // Both authored commit frequency and substantive daily churn can independently
  // neutralise the concern signal. Do not count VERSION marker churn as relief.
  const quietCommits = Math.max(0, 1 - authoredCommits / busyDay);
  const quietLines = Math.max(0, 1 - churn / busyChurn);
  return rounded(100 * recency * quietCommits * quietLines);
}

/**
 * @param {Object} index Full-history buildEvidenceIndex result (not date trimmed)
 * @param {Array} contributors Current globally selected contributors from buildAnalysis
 * @param {Object} window Inclusive authored date range
 */
export function releaseGapMatrix(index, contributors, window, options = {}) {
  const horizon = GAP_HORIZONS.includes(Number(options.horizon)) ? Number(options.horizon) : DEFAULT_GAP_HORIZON;
  const busyDay = BUSY_DAY_THRESHOLDS.includes(Number(options.busyDay)) ? Number(options.busyDay) : DEFAULT_BUSY_DAY;
  const fullCreditLines = RELEASE_LINE_THRESHOLDS.includes(Number(options.fullCreditLines))
    ? Number(options.fullCreditLines) : DEFAULT_RELEASE_LINES;
  const busyChurn = DAILY_CHURN_THRESHOLDS.includes(Number(options.busyChurn))
    ? Number(options.busyChurn) : DEFAULT_DAILY_CHURN;
  const fullDayChurn = dailyTextChurn(index);
  const start = window?.from, end = window?.to;
  const valid = validDate(start) && validDate(end) && start <= end;
  const releasesById = new Map();
  for (const release of index?.releases || []) {
    // A baseline includes all earlier ancestry and is not incremental credit.
    if (release.baseline || !validDate(release.date)) continue;
    for (const member of release.members || []) {
      if (!(member.commits > 0)) continue; // publisher/driver alone is not authorship
      // releaseLineChurn excludes VERSION-file noise; legacy evidence supplies
      // member.churn. Missing/zero numstat cannot justify resetting the clock.
      const linesChanged = Number(member.releaseLineChurn ?? member.churn);
      const credit = releaseContributionCredit(linesChanged, fullCreditLines);
      if (!(credit > 0)) continue;
      const id = String(member.id);
      if (!releasesById.has(id)) releasesById.set(id, []);
      releasesById.get(id).push({date:release.date,tag:release.tag,hash:release.hash,
        lineageComplete:release.lineageComplete !== false,linesChanged,
        linesAdded:Number(member.releaseLinesAdded ?? member.additions ?? 0),
        linesDeleted:Number(member.releaseLinesDeleted ?? member.deletions ?? 0),credit});
    }
  }
  for (const events of releasesById.values()) events.sort((a,b)=>a.date.localeCompare(b.date) || a.tag.localeCompare(b.tag));
  const rows = [];
  const byId = new Map();
  if (valid) for (const person of contributors || []) {
    const events = releasesById.get(String(person.id)) || [];
    const daily = new Map(), months = new Map();
    const authored = person.daily?.commits || {};
    const dailyChurn = fullDayChurn?.get(String(person.id));
    let cursor = 0, lastRelease = null, lastEventDay = null, gapAtEvent = null;
    let scoredDays = 0, attentionDays = 0, scoreSum = 0, finalEffectiveGap = null;
    for (let d = dayNumber(start), last = dayNumber(end); d <= last; d++) {
      const date = dateAtDay(d);
      while (cursor < events.length && events[cursor].date <= date) {
        const event = events[cursor++];
        const eventDay = dayNumber(event.date);
        // Before the first measurable incremental release there is no known
        // release clock; at that first event, start from maximum uncertainty.
        // Small credit reduces it; substantial credit clears it entirely.
        const aged = lastEventDay === null ? 1 :
          Math.min(1, gapAtEvent + Math.max(0, eventDay - lastEventDay) / horizon);
        gapAtEvent = aged * (1 - event.credit);
        lastEventDay = eventDay;
        lastRelease = event;
      }
      const commits = Number(authored[date] || 0);
      const churn = fullDayChurn ? (dailyChurn?.get(date) || 0) : Number(person.daily?.churn?.[date] || 0);
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const inCoverage = (!index?.bounds?.min || date >= index.bounds.min) &&
        (!index?.bounds?.max || date <= index.bounds.max);
      const reason = !inCoverage ? 'outside-history' : weekday === 0 || weekday === 6 ? 'weekend' :
        !lastRelease ? 'no-prior-contribution' : 'scored';
      const daysSinceRelease = lastRelease ? d - lastEventDay : null;
      // Clamp the age *before* applying each release credit. Otherwise a tiny
      // release after years without an event would produce no visible relief.
      const gapFactor = lastRelease ? Math.min(1, gapAtEvent + Math.max(0, d - lastEventDay) / horizon) : null;
      const effectiveGapDays = gapFactor === null ? null : rounded(horizon * gapFactor);
      const score = reason === 'scored' ? releaseGapScore(horizon * gapFactor, commits, {horizon,busyDay,churn,busyChurn}) : null;
      const item = {date,commits,churn,daysSinceRelease,effectiveGapDays,score,reason,lastRelease};
      daily.set(date,item);
      if (score !== null) {
        scoredDays++;scoreSum+=score;
        if (score >= ATTENTION_THRESHOLD) attentionDays++;
        const month=date.slice(0,7);
        if (!months.has(month)) months.set(month,{month,score:0,total:0,days:0,attentionDays:0,lastRelease:null,lastGap:null,lastEffectiveGap:null});
        const bucket=months.get(month);
        bucket.total+=score;bucket.days++;
        if (score >= ATTENTION_THRESHOLD)bucket.attentionDays++;
        bucket.lastRelease=lastRelease;bucket.lastGap=daysSinceRelease;bucket.lastEffectiveGap=effectiveGapDays;
      }
      if (d === last && lastRelease) finalEffectiveGap = effectiveGapDays;
    }
    for (const bucket of months.values())bucket.score=rounded(bucket.total/bucket.days);
    const row={id:String(person.id),name:person.displayName,daily,months,latestRelease:lastRelease,
      latestGap:lastRelease ? dayNumber(end)-lastEventDay : null,
      latestEffectiveGap:finalEffectiveGap,
      scoredDays,attentionDays,averageScore:scoredDays?rounded(scoreSum/scoredDays):null};
    rows.push(row);byId.set(row.id,row);
  }
  return {rows,byId,horizon,busyDay,busyChurn,fullCreditLines,from:start,to:end,available:!!releasesById.size};
}
