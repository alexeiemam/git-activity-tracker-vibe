/**
 * Release-first evidence index for Observatory, Periods and Contributors.
 * Pure, DOM-free and built off the main thread. A release always means the
 * complete introduced Git ancestry (subject only to the explicitly declared
 * merge/revert policy); an authored period is a different observation clock.
 */
import { dayNumber, dateAtDay, dayOfWeek, fileArea, validDate } from './domain.js?v=git-working-patterns-20261107-1';
import { changeCategory, fileKind } from './impact.js?v=git-working-patterns-20261107-1';

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
  hash:c.hash,groupId:c.groupId,date:c.date,hour:c.hour,minute:c.minute,offsetMinutes:c.offsetMinutes,subject:c.subject,
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
    github:r.github?{title:r.github.name||r.tag,url:r.github.url||'',body:(r.github.body||'').slice(0,30000),publisher:r.github.publisher||''}:null,
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

export function releaseDetails(index,hash) {
  const release=index.releases.find(r=>r.hash===hash);
  if(!release)return null;
  const byHash=new Map(index.activity.map(c=>[c.hash,c]));
  const included=release.commits.map(h=>byHash.get(h)).filter(Boolean);
  return {release,commits:included.slice(-40).reverse(),
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
  };
}

export function codebasePortrait(index,window,selectedArea=null) {
  const releases=index.releases.filter(r=>r.date&&r.date>=window.from&&r.date<=window.to);
  const areas=new Map();
  for(const r of releases)for(const [area,touches] of r.areaTouches){
    if(!areas.has(area))areas.set(area,{area,touches:0,releases:new Set(),people:new Map(),versions:[]});
    const a=areas.get(area);a.touches+=touches;a.releases.add(r.hash);a.versions.push({hash:r.hash,tag:r.tag});
    for(const m of r.members){const count=new Map(m.areaTouches).get(area)||0;if(count)appendMap(a.people,m.id,count);}
  }
  return {areas:[...areas.values()].sort((a,b)=>b.touches-a.touches).map(a=>({...a,releases:a.releases.size,people:sortCount(a.people),versions:a.versions.slice(-18).reverse()})),
    selectedArea};
}

export function briefingText(index,digest) {
  if(!digest)return '';
  const {window,summary,events,comparison}=digest;
  const lines=[`git:signals — Period briefing (${window.from} to ${window.to})`,
    `Authored: ${summary.commits} matching commits, ${summary.people.length} contributors, ${summary.activeDays} calendar dates with authored activity.`,
    `Delivery: ${events.releases} tagged release events, ${events.drivers} matched release publishers. Release contents are untrimmed by author dates.`,
    `Codebase: ${summary.areas.length} top-level areas, ${summary.distinctPaths} distinct paths, ${summary.fileTouches} file touches.`,
    `Leading areas: ${summary.areas.slice(0,6).map(([a,n])=>`${a} (${n} touches)`).join(', ')||'none recorded'}.`,
    `Releases: ${digest.releases.map(r=>r.tag).join(', ')||'none in the interval'}.`];
  if(comparison)lines.push(`Comparison (${comparison.window.from} to ${comparison.window.to}): ${comparison.summary.commits} authored commits and ${comparison.events.releases} release events.`);
  lines.push('Interpretation limits: authored commits are not working hours; release events use tag/GitHub publication dates; only imported reachable Git history is visible.');
  return lines.join('\n');
}
