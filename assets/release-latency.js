/**
 * Time to release: how long an authored commit waits before a tagged release
 * first ships it (release event time − author time). This is elapsed calendar
 * time, not effort or review time. Commits that no tag has shipped yet are
 * still waiting, so they are reported separately rather than in percentiles.
 */
const DAY = 86400000;

export const RELEASE_AGE_BUCKETS = Object.freeze([
  {key:'day', label:'< 1 day', max:1},
  {key:'days', label:'1–3 days', max:3},
  {key:'week', label:'3–7 days', max:7},
  {key:'fortnight', label:'1–2 weeks', max:14},
  {key:'month', label:'2–4 weeks', max:28},
  {key:'quarter', label:'1–3 months', max:91},
  {key:'half', label:'3–6 months', max:182},
  {key:'older', label:'6+ months', max:Infinity},
]);

/** Elapsed days, or null when either time is unknown or the release predates authorship. */
export function releaseAgeDays(authoredAt, releasedAt) {
  if (!Number.isFinite(authoredAt) || !Number.isFinite(releasedAt) || releasedAt < authoredAt) return null;
  return (releasedAt - authoredAt) / DAY;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q, low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/**
 * Summarise released ages (days) and, optionally, the current waiting age of
 * unreleased commits. `undated` counts commits whose age cannot be measured.
 */
export function releaseAgeDistribution(ages, {waiting = [], undated = 0} = {}) {
  const sorted = ages.filter(Number.isFinite).sort((a, b) => a - b);
  const waits = waiting.filter(Number.isFinite).sort((a, b) => a - b);
  const counts = RELEASE_AGE_BUCKETS.map(() => 0);
  for (const age of sorted) counts[RELEASE_AGE_BUCKETS.findIndex(bucket => age < bucket.max)]++;
  return {
    released: sorted.length,
    buckets: RELEASE_AGE_BUCKETS.map((bucket, index) => ({key:bucket.key, label:bucket.label, count:counts[index],
      share:sorted.length ? counts[index] / sorted.length : null})),
    median: quantile(sorted, .5), p75: quantile(sorted, .75), p90: quantile(sorted, .9),
    unreleased: waits.length, medianWaiting: quantile(waits, .5), oldestWaiting: waits.at(-1) ?? null,
    undated,
  };
}

/** Each commit's first shipping release, by release time, across all tag lineages. */
export function firstReleaseByCommit(releases) {
  const first = new Map();
  for (const release of releases) {
    if (!Number.isFinite(release.timestamp)) continue;
    for (const hash of release.commits) {
      const prior = first.get(hash);
      if (!prior || release.timestamp < prior.timestamp) first.set(hash, release);
    }
  }
  return first;
}

/**
 * Time to release for a set of authored commits. Commits not shipped by any
 * release are waiting as of `asOf` (the end of the imported history).
 */
export function commitReleaseAges(commits, firstRelease, asOf) {
  const ages = [], waiting = [];
  let undated = 0;
  for (const commit of commits) {
    const release = firstRelease.get(commit.hash);
    if (release) {
      const age = releaseAgeDays(commit.authoredAt, release.timestamp);
      if (age == null) undated++;
      else ages.push(age);
    } else {
      const wait = releaseAgeDays(commit.authoredAt, asOf);
      if (wait == null) undated++;
      else waiting.push(wait);
    }
  }
  return releaseAgeDistribution(ages, {waiting, undated});
}
