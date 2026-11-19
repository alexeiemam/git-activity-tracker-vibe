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
/** Smallest age by which a q share of the total weight has been released. */
function weightedQuantile(pairs, q) {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  if (!total) return null;
  let seen = 0;
  for (const [age, weight] of pairs) {seen += weight;if (seen >= q * total) return age;}
  return pairs.at(-1)[0];
}

const bucketOf = age => RELEASE_AGE_BUCKETS.findIndex(bucket => age < bucket.max);

/**
 * Summarise released ages (days) and, optionally, the current waiting age of
 * unreleased commits. `undated` counts commits whose age cannot be measured.
 * With `weights` (e.g. lines changed, aligned to `ages`), shares and
 * percentiles describe weight rather than commit counts; `count` stays commits.
 */
export function releaseAgeDistribution(ages, {waiting = [], undated = 0, weights = null} = {}) {
  const pairs = ages.map((age, i) => [age, weights ? Math.max(0, weights[i] || 0) : 1])
    .filter(([age]) => Number.isFinite(age)).sort((a, b) => a[0] - b[0]);
  const sorted = pairs.map(([age]) => age);
  const waits = waiting.filter(Number.isFinite).sort((a, b) => a - b);
  const counts = RELEASE_AGE_BUCKETS.map(() => 0), amounts = RELEASE_AGE_BUCKETS.map(() => 0);
  for (const [age, weight] of pairs) {const i = bucketOf(age);counts[i]++;amounts[i] += weight;}
  const total = amounts.reduce((a, b) => a + b, 0);
  return {
    released: sorted.length, weighted: !!weights, total,
    buckets: RELEASE_AGE_BUCKETS.map((bucket, index) => ({key:bucket.key, label:bucket.label, count:counts[index],
      amount:amounts[index], share:total ? amounts[index] / total : null})),
    median: weights ? weightedQuantile(pairs, .5) : quantile(sorted, .5),
    p75: weights ? weightedQuantile(pairs, .75) : quantile(sorted, .75),
    p90: weights ? weightedQuantile(pairs, .9) : quantile(sorted, .9),
    unreleased: waits.length, medianWaiting: quantile(waits, .5), oldestWaiting: waits.at(-1) ?? null,
    undated,
  };
}

/**
 * Descriptive release shapes from commit-count percentiles. They are relative
 * to every commit shipped by this repository's incremental releases, pooled
 * together, so a quarterly project and a daily one each get meaningful labels.
 * They describe how old the shipped work was, not whether a release was good.
 */
export const RELEASE_SHAPES = Object.freeze([
  {key:'hotfix', label:'Hotfix-shaped'},
  {key:'steady', label:'Steady'},
  {key:'long-tail', label:'Long tail'},
  {key:'backlog', label:'Backlog flush'},
  {key:'initial', label:'Initial history'},
  {key:'unmeasured', label:'Unmeasured'},
]);
/** Without enough releases to compare, fall back to fixed calendar thresholds. */
const FIXED_REFERENCE = Object.freeze({median:15, p90:30, relative:false});
const MINIMUM_RELEASES = 5;

/**
 * The repository's release wait: the median and 90th percentile of all
 * commits shipped by incremental releases, pooled (`pooled` is their
 * releaseAgeDistribution; `releases` counts releases with measured commits).
 */
export function shapeReference(pooled, releases) {
  if (releases < MINIMUM_RELEASES || !pooled?.released) return {...FIXED_REFERENCE, releases, commits:pooled?.released || 0};
  return {median:pooled.median, p90:pooled.p90, relative:true, releases, commits:pooled.released};
}

export function releaseShape(dist, {baseline = false, reference = FIXED_REFERENCE} = {}) {
  if (baseline) return 'initial';
  if (!dist?.released) return 'unmeasured';
  if (dist.p90 <= reference.median / 2) return 'hotfix';
  if (dist.median >= reference.median * 2) return 'backlog';
  if (dist.p90 >= reference.p90 * 2 && dist.p90 >= 4 * Math.max(dist.median, 1 / 24)) return 'long-tail';
  return 'steady';
}

const days = v => v < 1 ? `${Math.round(v * 24)} hours` : `${Math.round(v * 10) / 10} days`;
/** Plain-language rule behind a shape, with this repository's thresholds. */
export function shapeNote(key, reference = FIXED_REFERENCE) {
  const basis = reference.relative ? 'all releases' : 'fixed thresholds (fewer than five releases to compare)';
  return {
    hotfix:`90% of commits under ${days(reference.median / 2)} old: half the median wait across ${basis}`,
    steady:`Close to the waits across ${basis}`,
    'long-tail':`Mostly fresh, but its oldest 10% waited over ${days(reference.p90 * 2)}: twice the 90th percentile across ${basis}`,
    backlog:`Median wait over ${days(reference.median * 2)}: twice the median across ${basis}`,
    initial:'First tag: ships everything authored before it',
    unmeasured:'No commits with a measurable age',
  }[key] || '';
}

/**
 * All releases together: bucket shares of every shipped commit (or line)
 * pooled, plus each release's own median for ranking how fresh one release is.
 */
export function allReleasesShape(pooled, dists) {
  const measured = dists.filter(d => d?.total > 0);
  return {
    releases: measured.length, pooled,
    shares: pooled.buckets.map(b => b.share),
    medians: measured.map(d => d.median).filter(Number.isFinite).sort((a, b) => a - b),
  };
}

/** Share of other releases whose median wait was longer (null when too few to compare). */
export function fresherThan(median, medians, minimum = 5) {
  if (!Number.isFinite(median) || medians.length < minimum) return null;
  return medians.filter(m => m > median).length / medians.length;
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
