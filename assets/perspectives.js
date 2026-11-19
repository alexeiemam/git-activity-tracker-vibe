/**
 * Release-first evidence index for the Releases, People, Rhythm and Codebase tabs.
 * Pure, DOM-free and built off the main thread. A release always means the
 * complete introduced Git ancestry (subject only to the explicitly declared
 * merge/revert policy); an authored period is a different observation clock.
 */
import { dayNumber, dateAtDay, dayOfWeek, fileArea, validDate } from './domain.js?v=tails-20261119-3';
import { changeCategory, fileKind } from './impact.js?v=tails-20261119-3';
import { buildCodebaseMap, releaseFootprint, typicalFootprint, footprintReference, footprintShape, folderArea } from './release-footprint.js?v=tails-20261119-3';
import { releaseAgeDays, releaseAgeDistribution, firstReleaseByCommit, commitReleaseAges, releaseShape, allReleasesShape, shapeReference } from './release-latency.js?v=tails-20261119-3';

const unique = values => [...new Set(values)];
const sum = values => values.reduce((a,b)=>a+b,0);
const median = values => {const list=values.filter(Number.isFinite).sort((a,b)=>a-b);const n=list.length;return n ? n%2?list[(n-1)/2]:(list[n/2-1]+list[n/2])/2 : null;};
const rate=(value,denominator)=>denominator>0?value/denominator:null;
const sortCount=entries=>[...entries].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));
const days=(a,b)=>validDate(a)&&validDate(b)&&a<=b?dayNumber(b)-dayNumber(a)+1:0;
const appendMap=(map,key,n=1)=>map.set(key,(map.get(key)||0)+n);
const period=(from,to)=>({from,to,days:days(from,to)});
const member = (release,id) => release.members.find(m=>m.id===id);
export const windowOf=(index, length=14)=>{
  const end=index.bounds.max;
  return {from:dateAtDay(dayNumber(end)-Math.max(1,length)+1),to:end};
};
export function comparisonWindow(window,comparison='previous',custom=null) {
  const length=days(window.from,window.to);
  if(!length||comparison==='none')return null;
  if(comparison==='custom')return custom&&validDate(custom.from)&&validDate(custom.to)&&custom.from<=custom.to ? period(custom.from,custom.to) : null;
  if(comparison==='year'){
    const move=date=>{
      const [y,m,d]=date.split('-').map(Number);
      const target=new Date(Date.UTC(y-1,m-1,Math.min(d,new Date(Date.UTC(y-1,m,0)).getUTCDate())));
      return target.toISOString().slice(0,10);
    };
    return period(move(window.from),move(window.to));
  }
  return period(dateAtDay(dayNumber(window.from)-length),dateAtDay(dayNumber(window.from)-1));
}

// Absolute authored text-line changes in a release, excluding release-marker
// VERSION files. Binary files have no measurable numstat lines and therefore
// cannot inflate this credit. Other measured docs/config/test changes do count.
const releaseTextChanges = commits => {
  let added = 0, deleted = 0;
  for (const commit of commits) for (const file of commit.files || []) {
    if (/(^|\/)VERSION$/.test(file.path)) continue;
    added += file.added || 0;
    deleted += file.deleted || 0;
  }
  return {releaseLinesAdded:added, releaseLinesDeleted:deleted, releaseLineChurn:added+deleted};
};

const compactCommit = c=>({
  hash:c.hash,groupId:c.groupId,date:c.date,authoredAt:c.authoredAt,hour:c.hour,minute:c.minute,offsetMinutes:c.offsetMinutes,subject:c.subject,
  kind:changeCategory(c),merges:c.isMerge,reverts:c.isRevert,
  additions:c.files.reduce((v,f)=>v+(f.added||0),0),
  deletions:c.files.reduce((v,f)=>v+(f.deleted||0),0),
  files:c.files.map(f=>({path:f.path,area:fileArea(f.path),kind:fileKind(f.path),added:f.added||0,deleted:f.deleted||0})),
});

export function buildEvidenceIndex(fullView, fullImpact, bounds) {
  const activity=fullView.eligibleCommits.map(compactCommit);
  const names=new Map(fullView.groupDefs.map(g=>[g.id,g.displayName]));
  const releases=fullImpact.releases.map(r=>({
    hash:r.hash,tag:r.tag,aliases:r.aliases,date:r.date,timestamp:r.timestamp,
    dateSource:r.timeSource,kind:r.transition,previousTag:r.previousTag,
    baseline:r.baseline,lineageComplete:r.lineageComplete,
    published:r.published,driver:r.driver,
    github:r.github?{title:r.github.title||r.tag,url:r.github.url||'',body:(r.github.notes||'').slice(0,30000),publisher:r.github.publisher||''}:null,
    introduced:r.totalIntroduced,eligibleIntroduced:r.eligibleIntroduced,
    commits:r.reference.map(c=>c.hash),
    contributors:r.referenceFootprint.contributors.size,
    paths:r.referenceFootprint.pathsCount,areas:r.referenceFootprint.areasCount,
    fileTouches:r.referenceFootprint.fileTouches,churn:r.referenceFootprint.churn,
    additions:r.referenceFootprint.additions,deletions:r.referenceFootprint.deletions,
    areaTouches:[...r.referenceFootprint.areaTouches],categoryCounts:r.referenceFootprint.kindCounts,
    testAccompaniment:r.referenceFootprint.testAccompaniment,
    members:r.cells.filter(c=>c.footprint.commits>0||c.drove).map(c=>({
      id:c.id,name:c.name,drove:c.drove,commits:c.footprint.commits,
      share:c.share,paths:c.footprint.pathsCount,areas:c.footprint.areasCount,
      fileTouches:c.footprint.fileTouches,churn:c.footprint.churn,
      ...releaseTextChanges(c.commits),
      areaTouches:[...c.footprint.areaTouches],
    })),
  }));
  releases.sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (a.timestamp||0)-(b.timestamp||0) || a.tag.localeCompare(b.tag));
  return {groups:fullView.groupDefs.map(g=>({...g})),names:[...names],
    activity,releases,bounds:{min:bounds.min,max:bounds.max},
    policy:{includeMerges:fullView.includeMerges,includeReverts:fullView.includeReverts},
    importLimitations:['Only commits reachable from imported Git refs are observable.',
      'A tagged baseline is not a comparable incremental release.',
      'Squashed changes can obscure original authorship. GitHub publishers indicate release creation, not deployment.'],
  };
}

function summariseActivity(commits,from,to) {
  const people=new Map(), areas=new Map(), byPersonArea=new Map(), kinds=new Map(), dates=new Set(), pathNames=new Set();
  const daily=new Map();
  let fileTouches=0,testTouches=0,docsTouches=0,added=0,deleted=0;
  for(const c of commits) {
    dates.add(c.date);appendMap(people,c.groupId);appendMap(kinds,c.kind);
    if(!daily.has(c.date))daily.set(c.date,{date:c.date,commits:0,people:new Set(),fileTouches:0});
    const day=daily.get(c.date);day.commits++;day.people.add(c.groupId);
    for(const f of c.files){
      fileTouches++;day.fileTouches++;pathNames.add(f.path);appendMap(areas,f.area);
      if(!byPersonArea.has(c.groupId))byPersonArea.set(c.groupId,new Map());
      appendMap(byPersonArea.get(c.groupId),f.area);
      if(f.kind==='test')testTouches++;
      if(f.kind==='docs')docsTouches++;
      added+=f.added;deleted+=f.deleted;
    }
  }
  return {from,to,spanDays:days(from,to),commits:commits.length,activeDays:dates.size,
    people:sortCount(people),areas:sortCount(areas),personAreas:[...byPersonArea].map(([id,a])=>[id,sortCount(a)]),
    kinds:sortCount(kinds),fileTouches,testTouches,docsTouches,added,deleted,
    distinctPaths:pathNames.size,commitsPerWeek:rate(commits.length*7,days(from,to)),
    daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,people:d.people.size})),
  };
}

function timelineBuckets(index,window,activity,releases) {
  const length=days(window.from,window.to);
  const granularity=length<=45?'day':length<=180?'week':'month';
  const keyFor=date=>granularity==='day'?date:granularity==='week'?dateAtDay(dayNumber(date)-(new Date(`${date}T00:00:00Z`).getUTCDay()+6)%7):date.slice(0,7);
  const buckets=new Map();
  function ensure(date) {
    const key=keyFor(date);
    if(!buckets.has(key))buckets.set(key,{key,date,commits:0,people:new Set(),releases:[],drivers:new Set()});
    return buckets.get(key);
  }
  for(let d=dayNumber(window.from);d<=dayNumber(window.to);){
    const date=dateAtDay(d);ensure(date);
    if(granularity==='day')d++;
    else if(granularity==='week')d+=7;
    else {const [year,month]=date.split('-').map(Number);d=dayNumber(new Date(Date.UTC(year,month,1)).toISOString().slice(0,10));}
  }
  for(const c of activity){const b=ensure(c.date);b.commits++;b.people.add(c.groupId);}
  for(const r of releases){const b=ensure(r.date);b.releases.push({hash:r.hash,tag:r.tag});if(r.driver.groupId!=null)b.drivers.add(r.driver.groupId);}
  return {granularity,buckets:[...buckets.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(b=>({...b,people:b.people.size,drivers:b.drivers.size}))};
}

export function periodDigest(index,window,{comparison='previous',customComparison=null,selectedIds=null}={}) {
  const from=window.from,to=window.to;
  if(!validDate(from)||!validDate(to)||from>to)return null;
  const ids=selectedIds?new Set([...selectedIds].map(String)):null;
  const matching=c=>!ids||ids.has(c.groupId);
  const authored=index.activity.filter(c=>c.date>=from&&c.date<=to&&matching(c));
  // Published/tag event clock. Never trim a tagged release's introduced commits by authored dates.
  const releases=index.releases.filter(r=>r.date&&r.date>=from&&r.date<=to);
  const summary=summariseActivity(authored,from,to);
  const control=comparisonWindow(window,comparison,customComparison);
  const prior=control?periodDigest(index,control,{comparison:'none',selectedIds:ids}):null;
  const comparisonComparable=!!prior && control.from>=index.bounds.min && control.to<=index.bounds.max;
  const involved=new Map();
  for(const r of releases)for(const m of r.members) {
    if(ids&&!ids.has(m.id))continue;
    const item=involved.get(m.id)||{id:m.id,commits:0,releases:0,driven:0};
    item.commits+=m.commits;if(m.commits)item.releases++;if(m.drove)item.driven++;
    involved.set(m.id,item);
  }
  const eventSummary={
    releases:releases.length,drivers:unique(releases.map(r=>r.driver.groupId).filter(id=>id!=null)).length,
    includedCommits:sum(releases.map(r=>r.eligibleIntroduced)),
    participants:unique(releases.flatMap(r=>r.members.filter(m=>m.commits>0).map(m=>m.id))).length,
  };
  const timeline=timelineBuckets(index,window,authored,releases);
  return {window:{from,to,days:days(from,to)},summary,releases,events:eventSummary,
    involvement:sortCount([...involved].map(([id,r])=>[id,r.commits])).map(([id])=>involved.get(id)),
    timeline,comparison:prior?{window:prior.window,summary:prior.summary,events:prior.events}:null,
    comparisonType:comparison,comparisonComparable,coverage:{
      startsBeforeHistory:from<index.bounds.min,endsAfterHistory:to>index.bounds.max,
      limitedToReachable:true,
    },
    // Bounded, actionable evidence; never infer intent from these subjects.
    commits:authored.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,36),
  };
}

const fingerprintCache=new WeakMap();
/**
 * Each release's commit-age fingerprint (by commits and by lines changed),
 * its descriptive shape, and the repository's typical release shape.
 * Computed once per evidence index.
 */
export function releaseFingerprints(index) {
  if(fingerprintCache.has(index))return fingerprintCache.get(index);
  const byHash=new Map(index.activity.map(c=>[c.hash,c]));
  const releases=new Map();
  for(const release of index.releases){
    const entries=[];let undated=0;
    for(const hash of release.commits){
      const commit=byHash.get(hash);if(!commit)continue;
      const age=releaseAgeDays(commit.authoredAt,release.timestamp);
      if(age==null){undated++;continue;}
      entries.push({hash,groupId:commit.groupId,date:commit.date,subject:commit.subject,age,lines:commit.additions+commit.deletions});
    }
    const ages=entries.map(x=>x.age);
    const commits=releaseAgeDistribution(ages,{undated});
    const lines=releaseAgeDistribution(ages,{undated,weights:entries.map(x=>x.lines)});
    releases.set(release.hash,{entries,commits,lines});
  }
  // The first tag carries all earlier history, which would distort "typical".
  const incremental=index.releases.filter(r=>!r.baseline).map(r=>releases.get(r.hash));
  // Pool every commit shipped by an incremental release, so large releases count in proportion.
  const pooledEntries=incremental.flatMap(f=>f.entries);
  const pooled={commits:releaseAgeDistribution(pooledEntries.map(x=>x.age)),
    lines:releaseAgeDistribution(pooledEntries.map(x=>x.age),{weights:pooledEntries.map(x=>x.lines)})};
  const reference=shapeReference(pooled.commits,incremental.filter(f=>f.commits.released).length);
  for(const release of index.releases){
    const fp=releases.get(release.hash);
    fp.shape=releaseShape(fp.commits,{baseline:release.baseline,reference});
  }
  const result={releases,reference,typical:{commits:allReleasesShape(pooled.commits,incremental.map(f=>f.commits)),lines:allReleasesShape(pooled.lines,incremental.map(f=>f.lines))}};
  fingerprintCache.set(index,result);
  return result;
}

const footprintCache=new WeakMap();
/**
 * Each release's codebase footprint on one shared two-level directory map,
 * its relative footprint shape, and the typical incremental footprint.
 * Computed once per evidence index.
 */
export function releaseFootprints(index) {
  if(footprintCache.has(index))return footprintCache.get(index);
  const byHash=new Map(index.activity.map(c=>[c.hash,c]));
  const map=buildCodebaseMap(index.activity);
  const releases=new Map();
  for(const release of index.releases){
    const fp=releaseFootprint(release.commits.map(h=>byHash.get(h)).filter(Boolean),map);
    fp.baseline=release.baseline;
    releases.set(release.hash,fp);
  }
  const typical=typicalFootprint(index.releases.filter(r=>!r.baseline).map(r=>releases.get(r.hash)));
  const reference=footprintReference(typical);
  for(const fp of releases.values())fp.shape=footprintShape(fp,{baseline:fp.baseline,reference});
  const result={map,releases,typical,reference};
  footprintCache.set(index,result);
  return result;
}

export function releaseDetails(index,hash) {
  const release=index.releases.find(r=>r.hash===hash);
  if(!release)return null;
  const byHash=new Map(index.activity.map(c=>[c.hash,c]));
  const included=release.commits.map(h=>byHash.get(h)).filter(Boolean);
  const fingerprints=releaseFingerprints(index);
  return {release,commits:included.slice(-40).reverse(),
    fingerprint:fingerprints.releases.get(hash),typical:fingerprints.typical,reference:fingerprints.reference,
    releaseAge:fingerprints.releases.get(hash).commits,
    paths:sortCount(new Map(included.flatMap(c=>c.files.map(f=>[f.path,1]))
      .reduce((m,[path])=>(m.set(path,(m.get(path)||0)+1),m),new Map()))).slice(0,20),
  };
}

export function releaseLandscape(index,selection='all') {
  const releases=index.releases.filter(r=>r.date);
  const byPeriod=new Map();
  const earliest=releases[0]?.date,latest=releases.at(-1)?.date;
  const span=earliest&&latest?days(earliest,latest):0;
  const granularity=span>365*6?'quarter':span>730?'month':'week';
  for(const r of releases){
    const date=r.date;
    const key=granularity==='quarter'?`${date.slice(0,4)} Q${Math.floor((+date.slice(5,7)-1)/3)+1}`:
      granularity==='month'?date.slice(0,7):dateAtDay(dayNumber(date)-(new Date(`${date}T00:00:00Z`).getUTCDay()+6)%7);
    if(!byPeriod.has(key))byPeriod.set(key,{key,count:0,commits:0,areas:0,people:0,drivers:new Set(),tags:[]});
    const b=byPeriod.get(key);b.count++;b.commits+=r.eligibleIntroduced;b.areas+=r.areas;b.people+=r.contributors;
    if(r.driver.groupId!=null)b.drivers.add(r.driver.groupId);
    b.tags.push({hash:r.hash,tag:r.tag});
  }
  // Preserve the *time axis* even across months/weeks without a release.
  // Omitting empty buckets would make an 8-month lull look like one ordinary
  // interval between adjacent release bars.
  if(earliest && latest){
    let cursor;
    if(granularity==='week')cursor=dayNumber(dateAtDay(dayNumber(earliest)-(new Date(`${earliest}T00:00:00Z`).getUTCDay()+6)%7));
    else if(granularity==='month')cursor=dayNumber(`${earliest.slice(0,7)}-01`);
    else cursor=dayNumber(`${earliest.slice(0,4)}-${String(Math.floor((+earliest.slice(5,7)-1)/3)*3+1).padStart(2,'0')}-01`);
    const end=dayNumber(latest);
    for(;cursor<=end;){
      const date=dateAtDay(cursor);
      const key=granularity==='week'?date:granularity==='month'?date.slice(0,7):`${date.slice(0,4)} Q${Math.floor((+date.slice(5,7)-1)/3)+1}`;
      if(!byPeriod.has(key))byPeriod.set(key,{key,count:0,commits:0,areas:0,people:0,drivers:new Set(),tags:[]});
      if(granularity==='week')cursor+=7;
      else {const [year,month]=date.split('-').map(Number);cursor=dayNumber(new Date(Date.UTC(year,month-1+(granularity==='quarter'?3:1),1)).toISOString().slice(0,10));}
    }
  }
  const bins=[...byPeriod.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(v=>({...v,drivers:v.drivers.size}));
  const intervals=[];
  for(let i=1;i<releases.length;i++)intervals.push(Math.max(0,dayNumber(releases[i].date)-dayNumber(releases[i-1].date)));
  const types=sortCount(releases.reduce((m,r)=>(appendMap(m,r.kind),m),new Map()));
  const first=releases.slice(0,Math.floor(releases.length/2)),second=releases.slice(Math.floor(releases.length/2));
  const cadence=items=>median(items.slice(1).map((r,i)=>Math.max(0,dayNumber(r.date)-dayNumber(items[i].date))));
  return {releases,bins,granularity,total:releases.length,types,
    drivers:unique(releases.map(r=>r.driver.groupId).filter(id=>id!=null)).length,
    contributors:unique(releases.flatMap(r=>r.members.filter(m=>m.commits>0).map(m=>m.id))).length,
    medianInterval:median(intervals),previousCadence:cadence(first),recentCadence:cadence(second),
    selectedType:selection};
}

export function contributorPortrait(index,personId,window) {
  const person=index.groups.find(g=>g.id===personId);
  if(!person)return null;
  const activity=index.activity.filter(c=>c.groupId===personId&&c.date>=window.from&&c.date<=window.to);
  const included=index.releases.filter(r=>r.date&&r.date>=window.from&&r.date<=window.to);
  const contribution=included.filter(r=>(member(r,personId)?.commits||0)>0);
  const driven=included.filter(r=>r.driver.groupId===personId);
  const involvement=included.filter(r=>contribution.includes(r)||driven.includes(r));
  const seen=new Set(),shipped=[];
  const ownedHashes=new Set(index.activity.filter(c=>c.groupId===personId).map(c=>c.hash));
  for(const r of contribution)for(const hash of r.commits){
    if(seen.has(hash))continue;
    if(ownedHashes.has(hash)){seen.add(hash);shipped.push(hash);}
  }
  const profile=summariseActivity(activity,window.from,window.to);
  // Follow window-authored commits to their first release even if it ships after the window.
  const firstRelease=firstReleaseByCommit(index.releases);
  const asOf=Date.parse(`${index.bounds.max}T23:59:59.999Z`);
  const windowActivity=index.activity.filter(c=>c.date>=window.from&&c.date<=window.to);
  const months=new Map();
  const ensure=(date)=>{const key=date.slice(0,7);if(!months.has(key))months.set(key,{key,commits:0,releases:0,driven:0,areas:new Set()});return months.get(key);};
  for(const c of activity){const cell=ensure(c.date);cell.commits++;for(const f of c.files)cell.areas.add(f.area);}
  for(const r of contribution)ensure(r.date).releases++;
  for(const r of driven)ensure(r.date).driven++;
  const calendar=[];
  if(validDate(window.from)&&validDate(window.to))for(let y=+window.from.slice(0,4),m=+window.from.slice(5,7);y*12+m<=Number(window.to.slice(0,4))*12+Number(window.to.slice(5,7));m++){if(m>12){y++;m=1;}const key=`${y}-${String(m).padStart(2,'0')}`;const v=months.get(key)||{key,commits:0,releases:0,driven:0,areas:new Set()};calendar.push({...v,areas:v.areas.size});}
  const dates=unique(activity.map(c=>c.date)).sort();
  const gaps=dates.slice(1).map((date,i)=>dayNumber(date)-dayNumber(dates[i])-1);
  const slots=Array.from({length:7},()=>Array(24).fill(0));
  for(const c of activity)if(Number.isInteger(c.hour))slots[dayOfWeek(c.date)][c.hour]++;
  return {id:personId,name:person.displayName,emails:person.emails,
    window,profile,releaseCount:included.length,contributed:contribution.length,driven:driven.length,
    both:contribution.filter(r=>driven.includes(r)).length,participation:rate(contribution.length,included.length),
    shippedCommits:shipped.length,concentration:median(contribution.map(r=>member(r,personId)?.share)),
    medianGap:median(gaps),maxGap:gaps.length?Math.max(...gaps):null,
    involvement:involvement.slice().reverse(),months:calendar,slots,
    distinctAreas:profile.areas.length,
    driverWithOthers:median(driven.map(r=>r.contributors)),
    releaseAge:commitReleaseAges(activity,firstRelease,asOf),
    teamReleaseAge:commitReleaseAges(windowActivity,firstRelease,asOf),
  };
}

/**
 * The scope's changes in the codebase, on one of two clocks: `authored`
 * counts commits authored in the dates; `released` counts the commits
 * shipped by releases published in the dates (each commit once, however
 * many releases ship it). `ids` narrows both to some people.
 */
export function codebaseCommits(index,{from,to,ids=null,clock='authored'}) {
  const people=ids?new Set([...ids].map(String)):null;
  let commits;
  if(clock==='released'){
    const byHash=new Map(index.activity.map(c=>[c.hash,c])),seen=new Set();
    commits=[];
    for(const r of index.releases)if(r.date&&r.date>=from&&r.date<=to)for(const hash of r.commits){
      const commit=byHash.get(hash);
      if(commit&&!seen.has(hash)){seen.add(hash);commits.push(commit);}
    }
  } else commits=index.activity.filter(c=>c.date>=from&&c.date<=to);
  return people?commits.filter(c=>people.has(c.groupId)):commits;
}

/** File touches per person and top-level area, with each person's and area's total. */
/** File touches per person and area; `areaOf(path)` names the area (null leaves the file out), top-level by default. */
export function personAreaTouches(commits,areaOf=null) {
  const cells=new Map(),people=new Map(),areas=new Map();
  for(const c of commits)for(const file of c.files){
    const area=areaOf?areaOf(file.path):file.area;if(area==null)continue;
    const row=cells.get(c.groupId)||new Map();appendMap(row,area,1);cells.set(c.groupId,row);
    appendMap(people,c.groupId,1);appendMap(areas,area,1);
  }
  return {cells,people:sortCount(people),areas:sortCount(areas)};
}

/** One area's touches, people, releases and newest commits; `matches(path)` selects its files. */
export function areaPortrait(index,commits,matches) {
  const people=new Map(),hit=[];let touches=0;
  for(const c of commits){
    const n=c.files.filter(file=>matches(file.path)).length;
    if(n){touches+=n;appendMap(people,c.groupId,n);hit.push(c);}
  }
  const hashes=new Set(hit.map(c=>c.hash));
  const releases=index.releases.filter(r=>r.commits.some(hash=>hashes.has(hash)));
  return {touches,commits:hit.length,people:sortCount(people),releases:releases.length,
    recentReleases:releases.slice(-12).reverse(),
    recent:hit.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10)};
}

/**
 * The child of `folder` ('' for the repository root, otherwise `app/services/`)
 * that holds a path: a subfolder such as `app/services/billing/`, the file
 * itself when it sits directly in the folder, or null outside the folder.
 */
export function childOf(path,folder='') {
  const clean=String(path||'').replace(/^\/+/,'');
  if(!clean.startsWith(folder))return null;
  const rest=clean.slice(folder.length),slash=rest.indexOf('/');
  return !rest?null:slash<0?clean:folder+rest.slice(0,slash+1);
}
/** The folders above a path, outermost first: `app/services/x.rb` → `app/`, `app/services/`. */
export function folderTrail(path) {
  const parts=String(path||'').split('/');parts.pop();
  return parts.filter(Boolean).map((_,i,all)=>`${all.slice(0,i+1).join('/')}/`);
}

const touchCache=new WeakMap();
/** File touches per path across all history: every file the repository has recorded, for listing a folder. */
export function pathTouches(index) {
  if(touchCache.has(index))return touchCache.get(index);
  const totals=new Map();
  for(const c of index.activity||[])for(const file of c.files||[])appendMap(totals,file.path,1);
  touchCache.set(index,totals);
  return totals;
}

/** Files changed in the same commits as `file`, most often first; sweeping commits (renames, reformatting) are ignored. */
export function fileCompanions(commits,file,{maxFiles=SIGNAL_DEFAULTS.maxAreasPerCommit,limit=10}={}) {
  const counts=new Map();
  for(const c of commits){
    if(c.files.length>maxFiles||!c.files.some(f=>f.path===file))continue;
    for(const path of new Set(c.files.map(f=>f.path)))if(path!==file)appendMap(counts,path,1);
  }
  return sortCount(counts).slice(0,limit);
}

/** Files directly in a folder share one block on its map. */
export const FILES_HERE='files here';
/**
 * One folder as a map: a block per child folder holding its own children,
 * and one block for the files directly inside it, sized by all-time touches.
 * The busiest `maxCells` tiles are kept and the rest fold into one "… other"
 * tile per block, so a crowded folder stays legible. `locate(path)` gives a
 * path's tile key, or null outside the folder.
 */
export function folderMap(totals,folder='',{maxCells=150}={}) {
  const cellKey=path=>{const child=childOf(path,folder);return child&&(child.endsWith('/')?{group:child,key:childOf(path,child)}:{group:FILES_HERE,key:child});};
  const raw=new Map();
  for(const [path,touches] of totals){
    const at=cellKey(path);if(!at)continue;
    const cell=raw.get(at.key)||{key:at.key,group:at.group,touches:0};
    cell.touches+=touches;raw.set(at.key,cell);
  }
  const ranked=[...raw.values()].sort((a,b)=>b.touches-a.touches||a.key.localeCompare(b.key));
  const kept=new Set(ranked.slice(0,maxCells).map(cell=>cell.key));
  const groups=new Map(),fold=new Map();
  for(const cell of ranked){
    const group=groups.get(cell.group)||{key:cell.group,touches:0,cells:[]};
    groups.set(cell.group,group);group.touches+=cell.touches;
    if(kept.has(cell.key)){group.cells.push({...cell,folded:0});continue;}
    const key=`${cell.group}…`;fold.set(cell.key,key);
    let other=group.cells.find(c=>c.key===key);
    if(!other){other={key,group:cell.group,touches:0,folded:0};group.cells.push(other);}
    other.touches+=cell.touches;other.folded++;
  }
  const ordered=[...groups.values()].sort((a,b)=>(a.key===FILES_HERE)-(b.key===FILES_HERE)||b.touches-a.touches||a.key.localeCompare(b.key));
  return {folder,groups:ordered,keys:ordered.flatMap(g=>g.cells.map(c=>c.key)),
    locate:path=>{const at=cellKey(path);return at?fold.get(at.key)||at.key:null;}};
}

/** Folders two levels deep (`app/models/`): the grain codebase signals are judged at by default. */
export const SIGNAL_DEPTH=2;
const SIGNAL_DEFAULTS=Object.freeze({
  ownerShare:.8,        // an area relies on one person when they made this share of its changes…
  minimumTouches:20,    // …and it has enough changes for that to mean something.
  churnRatio:2,         // rising or fading: one half of the dates has this many times the other's changes…
  minimumChurn:10,      // …and the busier half has at least this many.
  minimumShared:3,      // a pair must share this many commits to count as changing together…
  maxAreasPerCommit:12, // …and sweeping commits (renames, reformatting) are ignored.
});

/**
 * Where attention is warranted in the code, from one set of commits:
 * knowledge concentration (who made an area's changes), churn moving
 * between the first and second half of the dates, and areas that change in
 * the same commits. Areas are folders two levels deep unless `areaOf(path)`
 * names them (null leaves a file out), as the folder browser does with a
 * folder's children. These describe
 * recorded changes, not ownership, quality or risk on their own.
 */
export function codebaseSignals(commits,{from,to,areaOf=path=>folderArea(path,SIGNAL_DEPTH),...options}={}) {
  const o={...SIGNAL_DEFAULTS,...options};
  const mid=dayNumber(from)+(dayNumber(to)-dayNumber(from)+1)/2;
  const spanDays=dayNumber(to)-dayNumber(from)+1,weekly=spanDays<=120;
  const binOf=date=>weekly?Math.floor((dayNumber(date)-dayNumber(from))/7):(Number(date.slice(0,4))*12+Number(date.slice(5,7)))-(Number(from.slice(0,4))*12+Number(from.slice(5,7)));
  const bins=binOf(to)+1;
  const areas=new Map(),pairs=new Map();
  const area=name=>{
    if(!areas.has(name))areas.set(name,{area:name,touches:0,commits:0,people:new Map(),first:0,second:0,series:Array(bins).fill(0),last:null});
    return areas.get(name);
  };
  for(const c of commits){
    const touched=new Set();
    for(const file of c.files){
      const name=areaOf(file.path);if(name==null)continue;
      const a=area(name);
      a.touches++;appendMap(a.people,c.groupId,1);if(!a.last||c.date>a.last)a.last=c.date;
      if(dayNumber(c.date)<mid)a.first++;else a.second++;
      const bin=binOf(c.date);if(bin>=0&&bin<bins)a.series[bin]++;
      touched.add(name);
    }
    for(const name of touched)areas.get(name).commits++;
    if(touched.size<2||touched.size>o.maxAreasPerCommit)continue;
    const list=[...touched].sort();
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)appendMap(pairs,`${list[i]}\u0000${list[j]}`,1);
  }
  const rows=[...areas.values()].map(a=>{
    const people=sortCount(a.people);
    let covered=0,half=0;
    for(const [,n] of people){covered+=n;half++;if(covered>=a.touches/2)break;}
    return {area:a.area,touches:a.touches,commits:a.commits,people,top:people[0]?.[0]??null,topShare:a.touches?(people[0]?.[1]||0)/a.touches:0,half,
      first:a.first,second:a.second,series:a.series,last:a.last};
  }).sort((a,b)=>b.touches-a.touches||a.area.localeCompare(b.area));
  const concentrated=rows.filter(r=>r.touches>=o.minimumTouches&&r.topShare>=o.ownerShare);
  const rising=rows.filter(r=>Math.max(r.first,r.second)>=o.minimumChurn&&r.second>=o.churnRatio*r.first&&r.second>r.first).sort((a,b)=>(b.second-b.first)-(a.second-a.first));
  const fading=rows.filter(r=>Math.max(r.first,r.second)>=o.minimumChurn&&r.first>=o.churnRatio*r.second&&r.first>r.second).sort((a,b)=>(b.first-b.second)-(a.first-a.second));
  const byArea=new Map(rows.map(r=>[r.area,r]));
  const coupled=[...pairs].filter(([,n])=>n>=o.minimumShared).map(([key,shared])=>{
    const [a,b]=key.split('\u0000'),x=byArea.get(a).commits,y=byArea.get(b).commits;
    const overlap=shared/(x+y-shared);
    // Strength weighs overlap by how often the pair changed: 50% of 200 commits outranks 60% of 5.
    return {a,b,shared,overlap,ofA:shared/x,ofB:shared/y,strength:overlap*Math.log2(1+shared)};
  }).sort((p,q)=>q.strength-p.strength||q.shared-p.shared||p.a.localeCompare(q.a));
  const substantial=rows.filter(r=>r.touches>=o.minimumTouches).length;
  return {areas:rows,concentrated,substantial,rising,fading,coupled,options:o,granularity:weekly?'week':'month',bins,mid:dateAtDay(Math.floor(mid))};
}

export function briefingText(index,digest) {
  if(!digest)return '';
  const {window,summary,events,comparison}=digest;
  const lines=[`git:signals — Scope summary (${window.from} to ${window.to})`,
    `Authored: ${summary.commits} matching commits, ${summary.people.length} contributors, ${summary.activeDays} calendar dates with authored activity.`,
    `Delivery: ${events.releases} tagged release events, ${events.drivers} matched release publishers. Release contents are untrimmed by author dates.`,
    `Codebase: ${summary.areas.length} top-level areas, ${summary.distinctPaths} distinct paths, ${summary.fileTouches} file touches.`,
    `Leading areas: ${summary.areas.slice(0,6).map(([a,n])=>`${a} (${n} touches)`).join(', ')||'none recorded'}.`,
    `Releases: ${digest.releases.map(r=>r.tag).join(', ')||'none in the interval'}.`];
  if(comparison)lines.push(`Comparison (${comparison.window.from} to ${comparison.window.to}): ${comparison.summary.commits} authored commits and ${comparison.events.releases} release events.`);
  lines.push('Interpretation limits: authored commits are not working hours; release events use tag/GitHub publication dates; only imported reachable Git history is visible.');
  return lines.join('\n');
}
