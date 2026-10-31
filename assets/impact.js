/**
 * Git-only delivery evidence. Author dates define the dashboard's contributor
 * scope; tag (or tagged-commit) dates locate releases. Release membership is
 * commit DAG reachability, never the author date or a VERSION-file edit.
 *
 * No line-level survival, deploy date, customer value, or team productivity is
 * inferred from numstat; file revisitation is explicitly a proxy.
 */
import { fileArea } from './domain.js';

export const IMPACT_METRICS = Object.freeze({
  commits: 'Commits', churn: 'Line churn', paths: 'Distinct paths', areas: 'Codebase areas', share: 'Commit share',
});
export const FOLLOWUP_WINDOWS = [30, 90, 180];

const ALL_KIND = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'chore', 'ci', 'revert', 'other'];

export function parseTagVersion(name) {
  const match = String(name || '').match(/(?:^|[\/_-])v?(\d+)\.(\d+)\.(\d+)(?:-([\da-z][\da-z.-]*))?(?:\+[\da-z.-]+)?$/i);
  return match ? { major:Number(match[1]), minor:Number(match[2]), patch:Number(match[3]), prerelease:match[4] || null } : null;
}

export function releaseKind(current, previous) {
  if (!previous || !current) return 'unclassified';
  if (current.major < previous.major || (current.major === previous.major && current.minor < previous.minor) ||
      (current.major === previous.major && current.minor === previous.minor && current.patch < previous.patch)) return 'divergent';
  if (current.major > previous.major) return 'major';
  if (current.minor > previous.minor) return 'minor';
  if (current.patch > previous.patch) return 'patch';
  if (current.prerelease !== previous.prerelease) return 'prerelease';
  return 'same-version';
}

export function changeCategory(commit) {
  const subject = String(commit.subject || '');
  if (commit.isRevert) return 'revert';
  const conventional = subject.match(/^([a-z]+)(?:\([^)]+\))?!?:/i)?.[1]?.toLowerCase();
  if (conventional) return ALL_KIND.includes(conventional) ? conventional : 'other';
  if (/^(fix|repair|correct)\b/i.test(subject)) return 'fix';
  if (/^(add|introduce|implement)\b/i.test(subject)) return 'feat';
  if (/^(refactor|extract|simplify)\b/i.test(subject)) return 'refactor';
  if (/^(test|spec)\b/i.test(subject)) return 'test';
  if (/^(docs?|readme)\b/i.test(subject)) return 'docs';
  return 'other';
}

export function fileKind(path) {
  const value = String(path || '').toLowerCase();
  if (/(^|\/)(spec|test|tests|__tests__|test_helpers)(\/|$)|(?:^|[._\/-])(?:spec|test)\.[\da-z]+$/.test(value)) return 'test';
  if (/(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|rst|adoc|txt)$/.test(value) || /(?:^|\/)(readme|license|changelog)/.test(value)) return 'docs';
  return 'code'; // Includes configuration and build files; not all are executable code.
}

export function changeFootprint(commits) {
  const paths = new Set(), areas = new Set(), contributors = new Set();
  const kindCounts = Object.fromEntries(ALL_KIND.map(kind => [kind,0]));
  let additions = 0, deletions = 0, fileTouches = 0, codeCommits = 0, codeAndTestCommits = 0;
  let testTouches = 0, docTouches = 0, versionTouches = 0, reverts = 0;
  const areaTouches = new Map();
  for (const commit of commits) {
    contributors.add(commit.groupId);
    kindCounts[changeCategory(commit)]++;
    if (commit.touchesVersion) versionTouches++;
    if (commit.isRevert) reverts++;
    let code = false, test = false;
    for (const file of commit.files) {
      const kind = fileKind(file.path);
      if (kind === 'code') code = true;
      if (kind === 'test') { test = true; testTouches++; }
      if (kind === 'docs') docTouches++;
      paths.add(file.path);
      const area = fileArea(file.path);
      areas.add(area);
      areaTouches.set(area, (areaTouches.get(area) || 0) + 1);
      additions += file.added;
      deletions += file.deleted;
      fileTouches++;
    }
    if (code) { codeCommits++; if (test) codeAndTestCommits++; }
  }
  return {
    commits:commits.length, paths, areas, contributors, pathsCount:paths.size, areasCount:areas.size,
    additions, deletions, churn:additions+deletions, fileTouches,
    kindCounts, areaTouches, codeCommits, codeAndTestCommits, testTouches, docTouches, versionTouches, reverts,
    testAccompaniment:codeCommits ? 100*codeAndTestCommits/codeCommits : null,
  };
}

/**
 * Returns fully observed DAG ancestors when the import includes parent hashes.
 * Incomplete/shallow exports cannot be treated as a full release diff.
 */
function createGraph(commits) {
  const byHash = new Map(commits.filter(c => c.hash).map(c => [c.hash,c]));
  const cache = new Map();
  const children = new Map();
  for (const commit of commits) for (const parent of commit.parents || []) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(commit.hash);
  }
  const ancestry = (hash) => {
    if (cache.has(hash)) return cache.get(hash);
    const visited = new Set(), stack=[hash];
    let complete = true;
    while (stack.length) {
      const next = stack.pop();
      if (visited.has(next)) continue;
      visited.add(next);
      const commit = byHash.get(next);
      if (!commit || !commit.parentsKnown) { complete = false; continue; }
      for (const parent of commit.parents) if (!visited.has(parent)) stack.push(parent);
    }
    const result={hashes:visited,complete};
    cache.set(hash,result);
    // A large Git repository can have thousands of tags. Keeping a full
    // ancestor set for every tag grows quadratically with repository age.
    // Keep only the most recently queried release boundaries.
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return result;
  };
  const descendantsOf = hash => {
    const visited = new Set(), stack = [hash];
    while (stack.length) {
      const next = stack.pop();
      if (visited.has(next)) continue;
      visited.add(next);
      for (const child of children.get(next) || []) stack.push(child);
    }
    return visited; // computed per inspected tag, not cached for every commit
  };
  return {byHash,ancestry,descendantsOf};
}

function canonicalTag(tags) {
  return [...tags].sort((a,b) => {
    const score=t=> (parseTagVersion(t.name)?3:0) + (parseTagVersion(t.name)?.prerelease?0:1) + (t.annotated?1:0);
    return score(b)-score(a) || b.name.localeCompare(a.name);
  })[0];
}

function nearestTagAncestor(hash, releaseByHash, graph, timestamp) {
  const start=graph.byHash.get(hash);
  if (!start?.parentsKnown) return null;
  // Prefer the release line's first-parent chain: the closest tag on a
  // merged feature branch must not displace the mainline release baseline.
  // Fall back to nearest DAG ancestor for rebased, fast-forward or otherwise
  // untagged mainlines. Both paths still use the full DAG for release contents.
  let mainline=start.parents[0];
  const mainlineSeen=new Set([hash]);
  while(mainline && !mainlineSeen.has(mainline)) {
    mainlineSeen.add(mainline);
    const candidate=releaseByHash.get(mainline);
    if(candidate && (timestamp==null || candidate.timestamp==null || candidate.timestamp<=timestamp)) return candidate;
    const parent=graph.byHash.get(mainline);
    if(!parent?.parentsKnown) break;
    mainline=parent.parents[0];
  }
  const queue=start.parents.map(parent=>({hash:parent,depth:1})), visited=new Set([hash]);
  let nearest=null, nearestDepth=Infinity;
  for(let position=0; position<queue.length; position++) {
    const item=queue[position];
    if(item.depth>nearestDepth) break;
    if(visited.has(item.hash)) continue;
    visited.add(item.hash);
    const candidate=releaseByHash.get(item.hash);
    if(candidate && (timestamp==null || candidate.timestamp==null || candidate.timestamp<=timestamp)) {
      if(!nearest || item.depth<nearestDepth || candidate.timestamp>nearest.timestamp) {
        nearest=candidate;nearestDepth=item.depth;
      }
      continue;
    }
    const parent=graph.byHash.get(item.hash);
    if(parent?.parentsKnown) for(const p of parent.parents) queue.push({hash:p,depth:item.depth+1});
  }
  return nearest;
}

function releaseMetric(footprint, metric, referenceFootprint) {
  if (!footprint) return null;
  if (metric === 'share') return referenceFootprint?.commits ? 100*footprint.commits/referenceFootprint.commits : null;
  if (metric === 'paths') return footprint.pathsCount;
  if (metric === 'areas') return footprint.areasCount;
  return footprint[metric] ?? 0;
}

function leadTime(commits, taggedAt) {
  if (taggedAt == null) return null;
  const values=commits.filter(c=>c.authoredAt!=null).map(c=>(taggedAt-c.authoredAt)/86400000)
    .filter(n=>n>=0).sort((a,b)=>a-b);
  if (!values.length) return null;
  const half=Math.floor(values.length/2);
  return values.length%2 ? values[half] : (values[half-1]+values[half])/2;
}

function followUpInWindow(release, descendants, referenceCommits, days, knownEnd) {
  const total=release.selectedFootprint.pathsCount;
  if(!total || release.timestamp==null || knownEnd==null || knownEnd<release.timestamp+days*86400000)
    return {days,observed:false,count:null,share:null};
  const paths=release.selectedFootprint.paths;
  const changed=new Set();
  for(const commit of referenceCommits) {
    if(commit.committedAt==null || commit.committedAt<=release.timestamp || commit.committedAt>release.timestamp+days*86400000) continue;
    if(!descendants.has(commit.hash) || commit.hash===release.hash) continue;
    for(const file of commit.files) if(paths.has(file.path)) changed.add(file.path);
    if(changed.size===total) break;
  }
  return {days,observed:true,count:changed.size,share:100*changed.size/total};
}

/**
 * Releases appear when the *tag event* is within the global date window.
 * Contributors, footprint and evidence are all computed from buildAnalysis's
 * author-date scoped, merge/revert scoped eligible/selected/reference commits.
 * The two time bases are disclosed in the dashboard.
 */
export function impactAnalysis(view, allCommits, rawTags, options={}) {
  const metric=IMPACT_METRICS[options.metric] ? options.metric : 'commits';
  const days=FOLLOWUP_WINDOWS.includes(options.followupDays) ? options.followupDays : 90;
  const graph=createGraph(allCommits);
  const scopedByHash=new Map(view.eligibleCommits.map(c=>[c.hash,c]));
  const selectedIds=view.selectedIds;
  const referenceIds=new Set(view.referenceContributors.map(c=>c.id));
  const tagGroups=new Map();
  const unresolved=[];
  for(const tag of (rawTags || [])) {
    if(!graph.byHash.has(tag.hash)) {unresolved.push(tag);continue;}
    if(!tagGroups.has(tag.hash)) tagGroups.set(tag.hash,[]);
    tagGroups.get(tag.hash).push(tag);
  }
  const releases=[...tagGroups].map(([hash,tags])=>{
    const main=canonicalTag(tags);
    const commit=graph.byHash.get(hash);
    const timestamp=main.taggedAt ?? commit?.committedAt ?? null;
    const date=timestamp==null?null:(main.taggedAt!=null?main.taggedDate:new Date(timestamp).toISOString().slice(0,10));
    return { hash, tag:main.name, aliases:tags.map(t=>t.name), date, timestamp,
      timeSource:main.taggedAt==null?'fallback-commit':main.timestampSource,
      version:parseTagVersion(main.name), taggedAt:main.taggedAt, annotated:main.annotated };
  }).sort((a,b)=>(a.timestamp??0)-(b.timestamp??0)||a.tag.localeCompare(b.tag));
  const byReleaseHash=new Map(releases.map(r=>[r.hash,r]));
  const periodReleases=releases.filter(r=>r.date && (!view.start || r.date>=view.start) && (!view.end || r.date<=view.end));
  const referenceCommits=view.referenceCommits.filter(c=>c.committedAt!=null);
  // A complete follow-up requires visible graph descendants far enough after
  // the tag, not simply wall-clock time passing or unrelated branches moving.
  for(const release of periodReleases) {
    const previous=nearestTagAncestor(release.hash,byReleaseHash,graph,release.timestamp);
    const currentReach=graph.ancestry(release.hash);
    const oldReach=previous?graph.ancestry(previous.hash):{hashes:new Set(),complete:true};
    const introduced=[...currentReach.hashes].filter(hash=>!oldReach.hashes.has(hash) && graph.byHash.has(hash));
    const matched=introduced.map(hash=>scopedByHash.get(hash)).filter(Boolean);
    const selected=matched.filter(c=>selectedIds.has(c.groupId));
    const reference=matched.filter(c=>referenceIds.has(c.groupId));
    const cohorts=view.contributors.map(g=>({
      id:g.id,name:g.displayName,
      commits:selected.filter(c=>c.groupId===g.id),
    })).map(entry=>({ ...entry,footprint:changeFootprint(entry.commits) }));
    const referenceFootprint=changeFootprint(reference),selectedFootprint=changeFootprint(selected);
    Object.assign(release,{
      previousTag:previous?.tag ?? null, previousHash:previous?.hash ?? null,
      transition:previous ? releaseKind(release.version,previous.version) : 'baseline',
      lineageComplete:currentReach.complete && oldReach.complete,
      baseline:!previous, totalIntroduced:introduced.length, eligibleIntroduced:matched.length,
      selected,reference,cohorts,selectedFootprint,referenceFootprint,
      leadDays:leadTime(selected,release.timestamp),
      metricValue:releaseMetric(selectedFootprint,metric,referenceFootprint),
    });
    // Filtered windows and exclusions deliberately reduce eligibleIntroduced.
    // Do not present these counts as the complete, unfiltered release.
    release.cells=cohorts.map(c=>({
      ...c, value:releaseMetric(c.footprint,metric,referenceFootprint),
      share:releaseMetric(c.footprint,'share',referenceFootprint),
    }));
    const descendants=graph.descendantsOf(release.hash);
    const later=referenceCommits.filter(c=>c.committedAt>release.timestamp && descendants.has(c.hash));
    const knownEnd=later.length ? Math.max(...later.map(c=>c.committedAt)) : null;
    release.followup=FOLLOWUP_WINDOWS.map(window=>release.lineageComplete
      ? followUpInWindow(release,descendants,referenceCommits,window,knownEnd)
      : {days:window,observed:false,count:null,share:null});
    const next=releases.find(r=>r.timestamp>release.timestamp && descendants.has(r.hash));
    release.nextTag=next?.tag || null;
    release.nextTagFootprint=null;
    if(next && release.lineageComplete) {
      const nextReach=graph.ancestry(next.hash).hashes;
      const current=new Set(currentReach.hashes);
      const paths=new Set();
      for(const commit of view.referenceCommits) {
        if(!nextReach.has(commit.hash)||current.has(commit.hash)) continue;
        for(const file of commit.files) if(selectedFootprint.paths.has(file.path)) paths.add(file.path);
      }
      release.nextTagFootprint={ count:paths.size, share:selectedFootprint.pathsCount?100*paths.size/selectedFootprint.pathsCount:null };
    }
  }
  // All Impact breakdowns share *released* contributor evidence. The authored
  // activity strip alone intentionally includes unreleased commits (labelled).
  // Deduplicate across divergent tag lineages so totals do not double-credit.
  const releasedByHash=new Map();
  for(const release of periodReleases)for(const commit of release.selected)
    releasedByHash.set(commit.hash,commit);
  const allScoped=[...releasedByHash.values()];
  const overall=changeFootprint(allScoped);
  const categories=ALL_KIND.filter(k=>overall.kindCounts[k]);
  const areas=[...overall.areaTouches].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
  const peopleAreas=view.contributors.map(c=>{
    const f=changeFootprint(allScoped.filter(commit=>commit.groupId===c.id));
    return {id:c.id,name:c.displayName,footprint:f};
  });
  const visible=periodReleases;
  const maximum=Math.max(1,...visible.flatMap(r=>r.cells.map(c=>c.value??0)));
  const monthly=new Map();
  for(const commit of view.selectedCommits){
    const month=commit.date.slice(0,7);
    if(!monthly.has(month))monthly.set(month,{month,date:`${month}-01`,count:0,version:0});
    const bucket=monthly.get(month);
    bucket.count++;if(commit.touchesVersion)bucket.version++;
  }
  // Code-area co-change means two top-level areas were touched by the same
  // authored commit; it does NOT assert a dependency or reviewer influence.
  const cochanged=new Map();
  for(const commit of allScoped){
    const involved=[...new Set(commit.files.map(f=>fileArea(f.path)))].sort();
    for(let i=0;i<involved.length;i++)for(let j=i+1;j<involved.length;j++){
      const name=`${involved[i]} · ${involved[j]}`;
      cochanged.set(name,(cochanged.get(name)||0)+1);
    }
  }
  const cochanges=[...cochanged].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  return { activityMonths:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),
    versionEvents:view.selectedCommits.filter(c=>c.touchesVersion), cochanges,
    available:!!releases.length, releases:visible, allReleaseCount:releases.length,
    unresolved, metric,followupDays:days,maxCell:maximum,overall, categories,areas,peopleAreas,
    allCommits:allScoped, referenceLabel:view.denominator==='repository'?'all imported contributors':'selected contributors',
    scopedDateStart:view.start, scopedDateEnd:view.end };
}
