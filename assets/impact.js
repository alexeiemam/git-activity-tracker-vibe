/**
 * Git-only delivery evidence. Author dates define the dashboard's contributor
 * scope; GitHub publication dates locate published releases, with tag or
 * tagged-commit dates as fallbacks. Release membership is
 * commit DAG reachability, never the author date or a VERSION-file edit.
 *
 * No line-level survival, deploy date, customer value, or team productivity is
 * inferred from numstat; file revisitation is explicitly a proxy.
 */
import { fileArea } from './domain.js?v=story-explorer-20261102-1';

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
  const byHash = new Map(commits.filter(c => c.hash).map(c => [c.hash, c]));
  const hashes = [...byHash.keys()];
  const index = new Map(hashes.map((hash, i) => [hash, i]));
  const children = new Map();
  for (const commit of commits) for (const parent of commit.parents || []) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(commit.hash);
  }

  // Each tagged release needs ancestry membership, not a separate Set of
  // thousands of hashes. Packed bits use ~1/8 byte per commit per tag and
  // make comparisons O(1); the previous tiny Set cache repeatedly traversed
  // the entire graph for each release and became quadratic on real histories.
  const releaseCache = new Map();
  const bytes = Math.ceil(hashes.length / 8);
  function ancestry(hash) {
    if (releaseCache.has(hash)) return releaseCache.get(hash);
    const bits = new Uint8Array(bytes), stack = [hash];
    let complete = true, size = 0;
    while (stack.length) {
      const next = stack.pop();
      const i = index.get(next);
      if (i === undefined) { complete = false; continue; }
      const mask = 1 << (i & 7), byte = i >> 3;
      if (bits[byte] & mask) continue;
      bits[byte] |= mask;
      size++;
      const commit = byHash.get(next);
      if (!commit?.parentsKnown) { complete = false; continue; }
      for (const parent of commit.parents) stack.push(parent);
    }
    const result = {bits, complete, size};
    releaseCache.set(hash, result);
    return result;
  }
  const contains = (reach, hash) => {
    const i = index.get(hash);
    return i !== undefined && !!(reach.bits[i >> 3] & (1 << (i & 7)));
  };
  function difference(current, previous) {
    const result = [];
    for (let i = 0; i < hashes.length; i++) {
      const mask = 1 << (i & 7), byte = i >> 3;
      if ((current.bits[byte] & mask) && !(previous?.bits[byte] & mask)) result.push(hashes[i]);
    }
    return result;
  }
  const descendantsOf = hash => {
    const visited = new Set(), stack = [hash];
    while (stack.length) {
      const next = stack.pop();
      if (visited.has(next)) continue;
      visited.add(next);
      for (const child of children.get(next) || []) stack.push(child);
    }
    return visited;
  };
  return {byHash, ancestry, contains, difference, descendantsOf};
}

/**
 * Match GitHub logins only to unambiguous, already-merged Git author identities.
 * An explicit choice always wins. We accept exact GitHub noreply handles,
 * unique exact email local-parts, or exact existing contributor/author aliases.
 * Similar-looking names and cross-group collisions are never silently assigned.
 */
export function autoMatchGithubPublishers(githubReleases, groups, commits, overrides = {}) {
  const byEmail = new Map();
  for (const group of groups) for (const email of group.emails) byEmail.set(email.toLowerCase(), group);
  const namesByEmail = new Map();
  for (const commit of commits) {
    const email = String(commit.email || '').toLowerCase();
    if (!namesByEmail.has(email)) namesByEmail.set(email, new Set());
    if (commit.name) namesByEmail.get(email).add(commit.name.trim().toLowerCase());
  }
  const logins = [...new Set(githubReleases.filter(r => !r.draft && r.publishedAt != null && r.publisher)
    .map(r => r.publisher.toLowerCase()))].sort();
  const candidates = (login, kind) => {
    const matches = new Map();
    for (const [email, group] of byEmail) {
      const local = email.split('@')[0];
      const noreply = email.endsWith('@users.noreply.github.com') &&
        (local === login || local.match(/^[0-9]+\+(.+)$/)?.[1] === login);
      const emailMatch = local === login;
      const nameMatch = group.displayName.trim().toLowerCase() === login || namesByEmail.get(email)?.has(login);
      if ((kind === 'github-noreply' && noreply) ||
          (kind === 'email-local' && emailMatch) ||
          (kind === 'author-name' && nameMatch)) {
        if (!matches.has(group.id)) matches.set(group.id, {group, email});
      }
    }
    return [...matches.values()];
  };
  return new Map(logins.map(login => {
    const explicit = Object.hasOwn(overrides, login) ? String(overrides[login] || '').toLowerCase() : null;
    if (explicit !== null) {
      const group = byEmail.get(explicit);
      // An explicit empty value means 'do not attribute' and overrides inference.
      return [login, {group:group || null, email:group ? explicit : null, source:group?'manual':'excluded'}];
    }
    for (const kind of ['github-noreply','email-local','author-name']) {
      const found = candidates(login, kind);
      if (found.length === 1) return [login, {group:found[0].group,email:found[0].email,source:kind}];
      // Do not fall back to a weaker clue when a stronger clue is ambiguous.
      if (found.length > 1) return [login, {group:null,email:null,source:'ambiguous'}];
    }
    return [login, {group:null,email:null,source:'unmatched'}];
  }));
}

function canonicalTag(tags) {
  return [...tags].sort((a,b) => {
    const score=t=> (parseTagVersion(t.name)?3:0) + (parseTagVersion(t.name)?.prerelease?0:1) + (t.annotated?1:0);
    return score(b)-score(a) || b.name.localeCompare(a.name);
  })[0];
}

function nearestTagAncestor(hash, releaseByHash, graph) {
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
    if(candidate) return candidate;
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
    if(candidate) {
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

function followUpInWindow(release, laterCommits, days, knownEnd) {
  const total=release.selectedFootprint.pathsCount;
  if(!total || release.timestamp==null || knownEnd==null || knownEnd<release.timestamp+days*86400000)
    return {days,observed:false,count:null,share:null};
  const paths=release.selectedFootprint.paths;
  const changed=new Set();
  for(const commit of laterCommits) {
    if(commit.committedAt>release.timestamp+days*86400000)continue;
    for(const file of commit.files) if(paths.has(file.path)) changed.add(file.path);
    if(changed.size===total)break;
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
  const githubReleases=Array.isArray(options.githubReleases) ? options.githubReleases : [];
  const githubByTag=new Map(githubReleases.filter(item=>item?.tag).map(item=>[item.tag,item]));
  // Explicit mappings survive identity merges; automatic matches are derived
  // from the same consolidated author groups, never stored as separate credit.
  const actorMap=options.actorMap && typeof options.actorMap==='object' ? options.actorMap : {};
  const groupForEmail=email=>view.allContributors.find(group=>group.emails.includes(String(email||'').toLowerCase())) || null;
  const actorMatches=autoMatchGithubPublishers(githubReleases,view.allContributors,allCommits,actorMap);
  const mappedActor=login=>actorMatches.get(String(login||'').toLowerCase())?.group || null;
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
    // Prefer a GitHub-published tag over alias tags on the same commit.
    const publishedTags=tags.filter(tag=>{
      const gh=githubByTag.get(tag.name);
      return gh && !gh.draft && gh.publishedAt!=null;
    });
    const main=canonicalTag(publishedTags.length ? publishedTags : tags);
    const github=githubByTag.get(main.name) || tags.map(t=>githubByTag.get(t.name)).find(Boolean) || null;
    const published=!!github && !github.draft && github.publishedAt!=null;
    const commit=graph.byHash.get(hash);
    const timestamp=published ? github.publishedAt : main.taggedAt ?? commit?.committedAt ?? null;
    const date=timestamp==null?null:(published ? github.publishedDate : main.taggedAt!=null ? main.taggedDate : new Date(timestamp).toISOString().slice(0,10));
    const login=published ? github.publisher : '';
    const publisherGroup=login ? mappedActor(login) : null;
    const taggerGroup=!login && main.taggerEmail ? groupForEmail(main.taggerEmail) : null;
    const driver=login ? {source:'github-publisher',login,name:login,groupId:publisherGroup?.id??null,groupName:publisherGroup?.displayName??null,matchSource:actorMatches.get(login.toLowerCase())?.source||'unmatched'}
      : main.taggerEmail ? {source:'annotated-tagger',login:null,name:main.taggerName||main.taggerEmail,groupId:taggerGroup?.id??null,groupName:taggerGroup?.displayName??null}
      : {source:'unknown',login:null,name:null,groupId:null,groupName:null};
    return { hash, tag:main.name, aliases:tags.map(t=>t.name), date, timestamp,
      timeSource:published?'github-published':main.taggedAt==null?'fallback-commit':main.timestampSource,
      version:parseTagVersion(main.name), taggedAt:main.taggedAt, annotated:main.annotated,
      github:github&&!github.draft?github:null,githubDraft:github?.draft===true, published,
      driver,taggerName:main.taggerName,taggerEmail:main.taggerEmail };
  }).sort((a,b)=>(a.timestamp??0)-(b.timestamp??0)||a.tag.localeCompare(b.tag));
  const byReleaseHash=new Map(releases.map(r=>[r.hash,r]));
  const periodReleases=releases.filter(r=>r.date && (!view.start || r.date>=view.start) && (!view.end || r.date<=view.end));
  const referenceCommits=view.referenceCommits.filter(c=>c.committedAt!=null);
  // Cache only compact ancestry bitsets for tagged snapshots (not every commit).
  // This includes tagged siblings, whose relationships cannot be inferred from dates.
  const reachByHash = new Map(releases.map(r => [r.hash, graph.ancestry(r.hash)]));
  const emptyReach = {bits: new Uint8Array(Math.ceil(graph.byHash.size / 8)), complete:true, size:0};
  // A complete follow-up requires visible graph descendants far enough after
  // the tag, not simply wall-clock time passing or unrelated branches moving.
  for(const [releaseIndex, release] of periodReleases.entries()) {
    if (releaseIndex % Math.max(1, Math.ceil(periodReleases.length / 25)) === 0)
      options.progress?.({phase:'release-analysis', current:releaseIndex, total:periodReleases.length});
    // Release publication can be delayed, recreated or backdated. Membership
    // always follows ancestry, even when publication chronology disagrees.
    const previous=nearestTagAncestor(release.hash,byReleaseHash,graph);
    const currentReach=reachByHash.get(release.hash);
    const oldReach=previous?reachByHash.get(previous.hash):emptyReach;
    const introduced=graph.difference(currentReach,oldReach);
    const matched=introduced.map(hash=>scopedByHash.get(hash)).filter(Boolean);
    const selected=matched.filter(c=>selectedIds.has(c.groupId));
    const reference=matched.filter(c=>referenceIds.has(c.groupId));
    const cohorts=view.contributors.map(g=>({
      id:g.id,name:g.displayName,
      drove:release.driver.groupId===g.id,
      commits:selected.filter(c=>c.groupId===g.id),
    })).map(entry=>({ ...entry,footprint:changeFootprint(entry.commits) }));
    const referenceFootprint=changeFootprint(reference),selectedFootprint=changeFootprint(selected);
    Object.assign(release,{
      previousTag:previous?.tag ?? null, previousHash:previous?.hash ?? null,
      chronologyWarning:previous?.timestamp!=null && release.timestamp!=null && previous.timestamp>release.timestamp,
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
      drove:c.drove,
    }));
    const descendants=graph.descendantsOf(release.hash);
    const later=referenceCommits.filter(c=>c.committedAt>release.timestamp && descendants.has(c.hash));
    const knownEnd=later.length ? later.reduce((max,c)=>Math.max(max,c.committedAt),-Infinity) : null;
    release.followup=FOLLOWUP_WINDOWS.map(window=>release.lineageComplete
      ? followUpInWindow(release,later,window,knownEnd)
      : {days:window,observed:false,count:null,share:null});
    const next=releases.filter(r=>r.hash!==release.hash && descendants.has(r.hash))
      .sort((a,b)=>reachByHash.get(a.hash).size-reachByHash.get(b.hash).size)[0];
    release.nextTag=next?.tag || null;
    release.nextTagFootprint=null;
    if(next && release.lineageComplete) {
      const nextReach=reachByHash.get(next.hash);
      const paths=new Set();
      for(const commit of view.referenceCommits) {
        if(!graph.contains(nextReach,commit.hash)||graph.contains(currentReach,commit.hash))continue;
        for(const file of commit.files) if(selectedFootprint.paths.has(file.path)) paths.add(file.path);
      }
      release.nextTagFootprint={ count:paths.size, share:selectedFootprint.pathsCount?100*paths.size/selectedFootprint.pathsCount:null };
    }
  }
  options.progress?.({phase:'release-analysis',current:periodReleases.length,total:periodReleases.length});
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
  const maximum=visible.reduce((max,r)=>r.cells.reduce((local,c)=>Math.max(local,c.value??0),max),1);
  const monthly=new Map(), daily=new Map();
  for(const commit of view.selectedCommits){
    const month=commit.date.slice(0,7);
    if(!monthly.has(month))monthly.set(month,{month,date:`${month}-01`,count:0,version:0});
    const bucket=monthly.get(month);
    bucket.count++;if(commit.touchesVersion)bucket.version++;
    if(!daily.has(commit.date))daily.set(commit.date,{date:commit.date,count:0,version:0});
    const day=daily.get(commit.date);
    day.count++;if(commit.touchesVersion)day.version++;
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
  const ghActors=[...actorMatches].map(([login, match])=>({
    login, groupId:match.group?.id??null,
    groupName:match.group?.displayName??null,
    matchSource:match.source, matchEmail:match.email,
    releases:periodReleases.filter(r=>r.driver.login?.toLowerCase()===login).length,
  }));
  const profiles=view.contributors.map(person=>{
    const participation=periodReleases.filter(r=>r.cells.some(c=>c.id===person.id && c.footprint.commits>0));
    const driving=periodReleases.filter(r=>r.driver.groupId===person.id);
    const both=driving.filter(r=>participation.includes(r));
    const ownReleased=allScoped.filter(c=>c.groupId===person.id);
    const shares=participation.map(r=>r.cells.find(c=>c.id===person.id)?.share).filter(v=>v!=null).sort((a,b)=>a-b);
    const middle=Math.floor(shares.length/2);
    const medianShare=shares.length ? shares.length%2 ? shares[middle] : (shares[middle-1]+shares[middle])/2 : null;
    const footprint=changeFootprint(ownReleased);
    const median=items=>{
      const values=items.filter(Number.isFinite).sort((a,b)=>a-b);
      if(!values.length)return null;
      const index=Math.floor(values.length/2);
      return values.length%2?values[index]:(values[index-1]+values[index])/2;
    };
    const medianCoordination=median(driving.map(r=>r.referenceFootprint.contributors.size));
    const leadDays=median(participation.flatMap(r=>
      (r.cells.find(c=>c.id===person.id)?.commits||[]).map(c=>c.authoredAt==null||r.timestamp==null?null:(r.timestamp-c.authoredAt)/86400000)
    ).filter(days=>days!=null&&days>=0));
    const releaseMix=Object.fromEntries(['major','minor','patch','prerelease','baseline','unclassified','divergent','same-version'].map(k=>[k,driving.filter(r=>r.transition===k).length]));
    const years=new Map();
    for(const r of periodReleases){
      if(!r.date)continue;
      const didDrive=r.driver.groupId===person.id;
      const contributed=r.cells.some(c=>c.id===person.id&&c.footprint.commits>0);
      if(!didDrive&&!contributed)continue;
      const year=r.date.slice(0,4);
      if(!years.has(year))years.set(year,{year,drivenOnly:0,contributedOnly:0,both:0});
      const value=years.get(year);
      if(didDrive&&contributed)value.both++;
      else if(didDrive)value.drivenOnly++;
      else value.contributedOnly++;
    }
    return {id:person.id,name:person.displayName,emails:person.emails,
      driven:driving.length,contributed:participation.length,both:both.length,
      drivenOnly:driving.length-both.length,contributedOnly:participation.length-both.length,
      shippedCommits:ownReleased.length,medianShare,footprint,
      medianCoordination,leadDays,releaseMix,years:[...years.values()].sort((a,b)=>b.year.localeCompare(a.year))};
  });
  return { activityMonths:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),
    activityDays:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    versionEvents:view.selectedCommits.filter(c=>c.touchesVersion), cochanges,
    available:!!releases.length, releases:visible, allReleaseCount:releases.length,
    unresolved, metric,followupDays:days,maxCell:maximum,overall, categories,areas,peopleAreas,
    githubStatus:options.githubStatus||'not-captured',githubCount:githubReleases.length,
    githubPublishedCount:githubReleases.filter(r=>!r.draft && r.publishedAt!=null).length,
    githubLinkedCount:periodReleases.filter(r=>r.published).length,
    githubUnresolvedCount:githubReleases.filter(r=>!r.draft && !rawTags.some(t=>t.name===r.tag)).length,
    captureWarningsCount:Number(options.captureWarningsCount)||0,
    groups:view.allContributors.map(g=>({id:g.id,name:g.displayName,emails:g.emails})),ghActors,profiles,
    allCommits:allScoped, referenceLabel:view.denominator==='repository'?'all imported contributors':'selected contributors',
    scopedDateStart:view.start, scopedDateEnd:view.end };
}
