/**
 * Evidence-led stories from the exact buildAnalysis + impactAnalysis scope.
 * This module is intentionally pure and runs in the analysis worker.
 * Findings are descriptive, deterministic and sample-gated. No inferred
 * employment, effort, productivity, deployment or missing-branch outcomes.
 */
import { dateAtDay, dayNumber, dayOfWeek, fileArea, validDate } from './domain.js?v=git-incremental-activity-20261113-1';

const DAY_MS = 86_400_000;
const min = (a,b) => a < b ? a : b;
const max = (a,b) => a > b ? a : b;
const ratio = (after,before) => before ? after / before : null;
const fraction = (count,total) => total ? count / total : null;
const round = n => n == null || !Number.isFinite(n) ? null : Math.round(n*100)/100;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const unique = arr => [...new Set(arr)];

export function percentile(values,p) {
  if (!values.length) return null;
  const ordered=[...values].sort((a,b)=>a-b);
  const at=(ordered.length-1)*p, a=Math.floor(at), b=Math.ceil(at);
  return ordered[a]+(ordered[b]-ordered[a])*(at-a);
}
export function calendarGapStats(commits,from,to) {
  const dates=unique(commits.map(c=>c.date).filter(d=>validDate(d) && d>=from && d<=to)).sort();
  const gaps=[];
  for(let i=1;i<dates.length;i++) gaps.push({
    from:dates[i-1],to:dates[i],days:dayNumber(dates[i])-dayNumber(dates[i-1])-1,
  });
  const internal=gaps.map(g=>g.days);
  return { activeDays:dates.length, first:dates[0]??null,last:dates.at(-1)??null,
    median:percentile(internal,.5),p90:percentile(internal,.9),
    longest:gaps.length?gaps.reduce((best,g)=>g.days>best.days?g:best):null,
    gapCount:internal.length,
  };
}
function studyWindows(from,to) {
  if(!validDate(from)||!validDate(to)||to<from)return null;
  const days=dayNumber(to)-dayNumber(from)+1;
  if(days<120)return null;
  const length=Math.min(365,Math.floor(days/2));
  if(length<60)return null;
  const endDay=dayNumber(to), priorEnd=endDay-length;
  return {length,prior:{from:dateAtDay(priorEnd-length+1),to:dateAtDay(priorEnd)},
    recent:{from:dateAtDay(priorEnd+1),to:to}};
}
function yearMonth(date) {return date?.slice(0,7)||null;}
function periodStats(commits,from,to) {
  const activeDays=new Set(),areas=new Map(),touches=[];
  let weekend=0,timed=0;
  const filtered=[];
  for(const c of commits) {
    if(c.date<from || c.date>to)continue;
    filtered.push(c);
    activeDays.add(c.date);
    if(dayOfWeek(c.date)>=5)weekend++;
    if(Number.isInteger(c.hour))timed++;
    for(const file of c.files) {
      const area=fileArea(file.path);
      areas.set(area,(areas.get(area)||0)+1);
      touches.push(area);
    }
  }
  const days=dayNumber(to)-dayNumber(from)+1;
  const count=filtered.length;
  return {from,to,calendarDays:days,commits:count,activeDays:activeDays.size,
    activeDaysPerWeek:round(activeDays.size*7/days),
    commitsPerActiveDay:round(activeDays.size?count/activeDays.size:null),
    commitsPerWeek:round(count*7/days),
    weekendShare:round(fraction(weekend,count)),timed,areas,
    fileTouches:touches.length,dominantArea:[...areas.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null};
}
function releaseStats(releases,id,from,to) {
  let eligible=0,participated=0,driven=0,both=0,shipped=0;
  const tags=[];
  for(const r of releases) {
    if(!r.date||r.date<from||r.date>to)continue;
    if(!r.lineageComplete || r.baseline)continue;
    eligible++;
    const included=id==='selection' ? (r.selectedFootprint?.commits||0) : (r.cells.find(c=>c.id===id)?.footprint.commits||0);
    const isDriver=id!=='selection' && r.driver?.groupId===id;
    if(included){participated++;shipped+=included;tags.push(r.tag);}
    if(isDriver)driven++;
    if(included&&isDriver)both++;
  }
  return {eligible,participated,driven,both,shipped,coverage:fraction(participated,eligible),tags};
}
function areaShift(a,b) {
  const all=new Set([...a.areas.keys(),...b.areas.keys()]);
  if(a.fileTouches<12||b.fileTouches<12||all.size<2)return null;
  let distance=0,most=null;
  for(const area of all) {
    const p=(a.areas.get(area)||0)/a.fileTouches;
    const q=(b.areas.get(area)||0)/b.fileTouches;
    const difference=q-p;
    distance+=Math.abs(difference);
    if(!most||Math.abs(difference)>Math.abs(most.difference))most={area,prior:p,recent:q,difference};
  }
  return {distance:round(distance/2),most};
}
function monthSeries(commits,releases,from,to,id) {
  if(!validDate(from)||!validDate(to)||to<from)return [];
  const months=new Map();
  let year=Number(from.slice(0,4)),month=Number(from.slice(5,7));
  while(year*12+month <= Number(to.slice(0,4))*12+Number(to.slice(5,7))) {
    const key=`${year}-${String(month).padStart(2,'0')}`;
    months.set(key,{month:key,commits:0,activeDays:0,releases:0,driven:0,tags:[]});
    month++;if(month>12){month=1;year++;}
  }
  const actives=new Map();
  for(const c of commits){const key=yearMonth(c.date);const bucket=months.get(key);if(!bucket)continue;bucket.commits++;if(!actives.has(key))actives.set(key,new Set());actives.get(key).add(c.date);}
  for(const [key,dates] of actives)months.get(key).activeDays=dates.size;
  for(const r of releases){const key=yearMonth(r.date),bucket=months.get(key);if(!bucket||r.baseline||!r.lineageComplete)continue;
    const included=id==='selection' ? r.selectedFootprint?.commits||0 : r.cells.find(c=>c.id===id)?.footprint.commits||0;
    if(included){bucket.releases++;bucket.tags.push({hash:r.hash,tag:r.tag,date:r.date,role:'contributed'});}
    if(id!=='selection' && r.driver?.groupId===id){bucket.driven++;if(!included)bucket.tags.push({hash:r.hash,tag:r.tag,date:r.date,role:'drove'});}
  }
  return [...months.values()];
}
function yearsFromMonths(months) {
  const years=new Map();
  for(const item of months){const year=item.month.slice(0,4);
    if(!years.has(year))years.set(year,{year,commits:0,activeDays:0,releases:0,driven:0,months:0});
    const r=years.get(year);r.commits+=item.commits;r.activeDays+=item.activeDays;r.releases+=item.releases;r.driven+=item.driven;r.months++;
  }
  return [...years.values()];
}
function makeFinding({id,subject,type,title,summary,evidence,period,score=1,context=false,link='trend-heading',releaseHash=null,compare=null,limitations=[],basis='Author timestamp',unit='commits',why=null}) {
  return {id:`${subject}:${id}`,subject,type,title,summary,evidence,period,score:round(score),context,link,releaseHash,compare,
    limitations,basis,unit,why};
}
function findingForChanges(subject,commits,windows) {
  if(!windows)return [];
  const a=periodStats(commits,windows.prior.from,windows.prior.to);
  const b=periodStats(commits,windows.recent.from,windows.recent.to);
  const findings=[];
  const base={subject,period:{prior:windows.prior,recent:windows.recent},compare:windows};
  if(a.activeDays>=8 && b.activeDays>=8) {
    const change=ratio(b.activeDaysPerWeek,a.activeDaysPerWeek);
    if(change!=null && (change>=1.5||change<=.65))findings.push(makeFinding({...base,id:'activity-frequency',type:'activity',
      title:change>1?'Authored days have become more frequent':'Authored days have become less frequent',
      summary:`Recorded authored activity occurred on ${a.activeDaysPerWeek} versus ${b.activeDaysPerWeek} days per calendar week across equivalent ${windows.length}-day windows.`,
      evidence:[{label:'Earlier active days/week',value:a.activeDaysPerWeek},{label:'Recent active days/week',value:b.activeDaysPerWeek},{label:'Authored commits',value:`${a.commits} → ${b.commits}`}],
      score:Math.abs(Math.log(change))+0.35,
      limitations:['These are dates with authored commits, not days worked. No activity on other repositories, branches or uncommitted work is observable.'],
      why:'Two equal-duration observed calendar windows, including quiet days.'}));
    const burst=ratio(b.commitsPerActiveDay,a.commitsPerActiveDay);
    if(burst && (burst>=1.65||burst<=.6) && a.commits>=20&&b.commits>=20)
      findings.push(makeFinding({...base,id:'commit-concentration',type:'rhythm',
        title:burst>1?'Authored changes are more concentrated into active days':'Authored changes are spread across more active days',
        summary:`Commits per authored-active day changed from ${a.commitsPerActiveDay} to ${b.commitsPerActiveDay}; this says nothing about effort or change quality.`,
        evidence:[{label:'Earlier commits/active day',value:a.commitsPerActiveDay},{label:'Recent commits/active day',value:b.commitsPerActiveDay},{label:'Active days',value:`${a.activeDays} → ${b.activeDays}`}],
        score:Math.abs(Math.log(burst)),link:'rhythm-heading',
        limitations:['Commit sizes and recording habits vary; counts are not hours or productivity.'],
        why:'A comparable per-active-day denominator in equal-duration windows.'}));
  }
  const shift=areaShift(a,b);
  if(shift&&shift.distance>=.35&&Math.abs(shift.most.difference)>=.20) {
    findings.push(makeFinding({...base,id:'codebase-focus',type:'focus',
      title:'The codebase areas receiving authored changes have shifted',
      summary:`The share of file touches in ${shift.most.area} changed from ${Math.round(shift.most.prior*100)}% to ${Math.round(shift.most.recent*100)}% between comparable periods.`,
      evidence:[{label:'Largest area change',value:shift.most.area},{label:'Earlier share of file touches',value:`${Math.round(shift.most.prior*100)}%`},{label:'Recent share',value:`${Math.round(shift.most.recent*100)}%`},{label:'File touches',value:`${a.fileTouches} → ${b.fileTouches}`}],
      score:shift.distance+0.45,link:'areas-heading',unit:'file touches',
      limitations:['A file touch is not effort, ownership or a shipped change; top-level folders are imperfect component boundaries.'],
      why:'Shares within each author-period, not raw path counts.'}));
  }
  if(a.commits>=24 && b.commits>=24 && a.weekendShare!=null&&b.weekendShare!=null && Math.abs(a.weekendShare-b.weekendShare)>=.18){
    findings.push(makeFinding({...base,id:'weekend-pattern',type:'rhythm',
      title:'The distribution of authored weekdays has changed',
      summary:`The proportion of authored commits dated Saturday or Sunday changed from ${Math.round(a.weekendShare*100)}% to ${Math.round(b.weekendShare*100)}%.`,
      evidence:[{label:'Earlier weekend share',value:`${Math.round(a.weekendShare*100)}%`},{label:'Recent weekend share',value:`${Math.round(b.weekendShare*100)}%`},{label:'Timed / all authored commits',value:`${a.commits} / ${b.commits}`}],
      score:Math.abs(a.weekendShare-b.weekendShare)+.35,link:'rhythm-heading',unit:'authored commit share',
      limitations:['Author-local dates do not establish working schedules or hours; contributors may be in different time zones.'],
      why:'Weekday proportions calculated over all authored commits in each period.'}));
  }
  return findings;
}
function releaseFindings(subject,id,releases,windows) {
  if(!windows)return [];
  const a=releaseStats(releases,id,windows.prior.from,windows.prior.to),
    b=releaseStats(releases,id,windows.recent.from,windows.recent.to);
  const common={subject,period:{prior:windows.prior,recent:windows.recent},compare:windows,
    link:'impact-explorer',basis:'Release event date for opportunities; author date for included commits',unit:'tagged releases',
    limitations:['Only ancestry-complete, non-baseline tagged snapshots are eligible. A single-branch history can miss unmerged, squashed or otherwise unreachable work.']};
  const findings=[];
  if(a.eligible>=5&&b.eligible>=5 && id!=='selection' && a.coverage!=null&&b.coverage!=null&&Math.abs(a.coverage-b.coverage)>=.22){
    findings.push(makeFinding({...common,id:'release-participation',type:'delivery',
      title:b.coverage>a.coverage?'Release participation has become more frequent':'Release participation has become less frequent',
      summary:`Authored changes entered ${a.participated} of ${a.eligible} eligible tagged releases earlier, versus ${b.participated} of ${b.eligible} recently.`,
      evidence:[{label:'Earlier releases with contributions',value:`${a.participated} / ${a.eligible}`},{label:'Recent releases with contributions',value:`${b.participated} / ${b.eligible}`},{label:'Change in coverage',value:`${Math.round((b.coverage-a.coverage)*100)>0?'+':''}${Math.round((b.coverage-a.coverage)*100)} percentage points`}],
      score:Math.abs(b.coverage-a.coverage)+.52,
      why:'Release opportunities are counted, not just elapsed calendar days.'}));
  }
  if(a.eligible>=4&&b.eligible>=4&&id!=='selection' && Math.abs(b.driven-a.driven)>=3 && a.driven!==b.driven) {
    findings.push(makeFinding({...common,id:'release-driving',type:'delivery',
      title:b.driven>a.driven?'Release publishing involvement has increased':'Release publishing involvement has decreased',
      summary:`Matched publication/tagger records attribute ${a.driven} releases to this contributor earlier and ${b.driven} recently.`,
      evidence:[{label:'Earlier releases driven',value:a.driven},{label:'Recent releases driven',value:b.driven},{label:'Eligible tagged releases',value:`${a.eligible} / ${b.eligible}`}],
      score:Math.abs(b.driven-a.driven)/Math.max(4,b.eligible)+.4,
      limitations:[...common.limitations,'A release publisher is assumed to have driven the release; this is not verification of deployment responsibility. Unmatched publishers remain unattributed.'],
      why:'Compared over the same elapsed calendar window using observed publisher/tagger identities.'}));
  }
  return findings;
}
function gapFinding(subject,commits,from,to) {
  const gaps=calendarGapStats(commits,from,to);
  if(gaps.gapCount<8 || !gaps.longest || gaps.longest.days<14)return null;
  // A true outlier must exceed the rest of that contributor's *observed*
  // inter-activity gaps, not a fabricated expectation of daily work.
  const others=[];
  const dates=unique(commits.map(c=>c.date).filter(d=>d>=from && d<=to)).sort();
  for(let i=1;i<dates.length;i++){
    const days=dayNumber(dates[i])-dayNumber(dates[i-1])-1;
    if(dates[i-1]!==gaps.longest.from||dates[i]!==gaps.longest.to)others.push(days);
  }
  const baseline=percentile(others,.9);
  if(baseline==null || gaps.longest.days<Math.max(14,baseline*1.75,baseline+7))return null;
  return makeFinding({subject,id:'unusual-gap',type:'activity',
    title:'An unusually long interval between authored-active days',
    summary:`There were ${gaps.longest.days} calendar days without an authored commit between ${gaps.longest.from} and ${gaps.longest.to}. The 90th percentile of the other observed gaps is ${round(baseline)} days.`,
    evidence:[{label:'Longest internal quiet interval',value:`${gaps.longest.days} days`},{label:'Other-gap 90th percentile',value:`${round(baseline)} days`},{label:'Other observed gaps',value:others.length}],
    period:{from:gaps.longest.from,to:gaps.longest.to},score:Math.log1p(gaps.longest.days/(baseline+1))+.4,
    basis:'Authored calendar dates',link:'pulse-heading',
    limitations:['A missing authored commit is not an absence from work. Only dates between two observed active days are measured; boundaries are excluded.'],
    why:'Compared with this contributor’s own other internal activity gaps, not a universal inactivity threshold.'});
}
function releaseGapFinding(subject,id,releases,from,to) {
  if(id==='selection')return null;
  const eligible=releases.filter(r=>r.lineageComplete&&!r.baseline && validDate(r.date) && r.date>=from && r.date<=to);
  const first=eligible.findIndex(r=>r.cells.some(c=>c.id===id&&c.footprint.commits>0));
  // Never count releases *before the first observed contribution* as a
  // contributor's absence. They may not have joined or worked on this branch.
  if(first<0)return null;
  const observed=eligible.slice(first);
  if(observed.length<9)return null;
  let longest=null,run=0,at=-1,participated=0;
  for(let i=0;i<observed.length;i++) {
    const involved=observed[i].cells.some(c=>c.id===id&&c.footprint.commits>0);
    if(involved){participated++;run=0;continue;}
    run++;
    if(!longest||run>longest.count){longest={count:run,from:observed[i-run+1].date,to:observed[i].date,lastIndex:i};at=i;}
  }
  if(!longest||!participated||longest.count<Math.max(5,Math.round(observed.length*.25)))return null;
  const isCurrent=at===observed.length-1;
  return makeFinding({subject,id:'release-gap',type:'delivery',
    title:isCurrent?'A sustained run of releases without authored contributions':'A prolonged gap in observed release participation',
    summary:`${longest.count} consecutive eligible tagged releases${isCurrent?' at the end of the selected scope':''} contained no authored commits from this contributor after their first observed release contribution. This is ${longest.count} releases, not an inferred gap in work.`,
    evidence:[{label:'Consecutive releases without contribution',value:longest.count},{label:'First / last release date',value:`${longest.from} – ${longest.to}`},{label:'Eligible releases since first participation',value:observed.length},{label:'Releases with contributions',value:participated}],
    period:{from:longest.from,to:longest.to},score:longest.count/observed.length+.55,
    basis:'Tagged release events and author-scoped commit ancestry',link:'impact-explorer',unit:'tagged releases',
    limitations:['The imported branch may omit development elsewhere, including squashed or unmerged commits. Releasing less often is not necessarily reduced responsibility.','Release events before the first observed contribution are deliberately excluded; that is not evidence of someone’s employment start.'],
    why:'Consecutive release opportunities after the first observed contribution, rather than only calendar days.'});
}
function seasonalFinding(subject,commits,from,to) {
  const byYear=new Map();
  for(const c of commits) {
    const year=c.date.slice(0,4);
    if(!byYear.has(year))byYear.set(year,Array(12).fill(0));
    byYear.get(year)[Number(c.date.slice(5,7))-1]++;
  }
  const years=[...byYear].filter(([year])=>`${year}-01-01`>=from && `${year}-12-31`<=to)
    .filter(([,months])=>months.reduce((n,x)=>n+x,0)>=24);
  if(years.length<3)return null;
  let winner=null;
  for(let m=0;m<12;m++){
    const indices=years.map(([year,months])=>{
      const days=new Date(Date.UTC(Number(year),m+1,0)).getUTCDate();
      const annualDays=(Number(year)%4===0&&(Number(year)%100!==0||Number(year)%400===0))?366:365;
      const mean=months.reduce((n,x)=>n+x,0)/annualDays;
      return mean?months[m]/days/mean:null;
    }).filter(x=>x!=null);
    if(indices.length<3)continue;
    const strong=indices.filter(v=>v>=1.4).length;
    const avg=indices.reduce((x,y)=>x+y,0)/indices.length;
    if(strong>=3&&avg>=1.5&&(!winner||avg>winner.average))winner={month:m,average:avg,years:indices.length,matching:strong};
  }
  if(!winner)return null;
  const label=new Date(Date.UTC(2024,winner.month,1)).toLocaleDateString('en-GB',{month:'long',timeZone:'UTC'});
  return makeFinding({subject,id:'seasonality',type:'seasonality',
    title:`A recurring ${label} concentration appears in authored activity`,
    summary:`Across ${winner.years} complete, sufficiently active calendar years, ${label} ran at an average ${round(winner.average)}× each year's daily author-commit baseline; ${winner.matching} years exceeded 1.4×.`,
    evidence:[{label:'Full comparable years',value:winner.years},{label:'Above 1.4× baseline',value:`${winner.matching} years`},{label:'Mean relative activity',value:`${round(winner.average)}×`}],
    period:{from,to},score:(winner.average-1)*.5+.35,link:'rhythm-heading',basis:'Authored calendar months',unit:'commits per observed calendar day',
    limitations:['Three recurring observations describe a pattern, not its cause or statistical proof. Calendar variation and changing release cycles can affect it.'],
    why:'Each full year is normalised by its own daily commit rate to avoid mistaking annual volume for seasonality.'});
}
function contextFindings(subject,commits,releases,from,to) {
  const span=dayNumber(to)-dayNumber(from)+1;
  const activeDays=new Set(commits.map(c=>c.date).filter(d=>d>=from && d<=to)).size;
  const rate=span>0?round(activeDays*7/span):null;
  const areas=new Map(),paths=new Set();
  for(const c of commits)for(const file of c.files){
    paths.add(file.path);const area=fileArea(file.path);
    areas.set(area,(areas.get(area)||0)+1);
  }
  const top=[...areas.entries()].sort((a,b)=>b[1]-a[1])[0];
  const scope={subject,period:{from,to},score:-1,context:true,
    limitations:['Only the selected, imported Git history is observed. These are descriptive measurements, not evidence of someone’s working hours or effectiveness.']};
  const findings=[];
  if(span>=7&&commits.length)findings.push(makeFinding({...scope,id:'context-activity',type:'context',
    title:'The observed activity rhythm, at a glance',
    summary:`Authored changes appear on ${activeDays} calendar dates in this ${span}-day observable window — ${rate} active dates per calendar week.`,
    evidence:[{label:'Authored commits',value:commits.length},{label:'Distinct authored dates',value:activeDays},{label:'Active dates per calendar week',value:rate},{label:'Observable days',value:span}],
    basis:'Authored calendar dates',unit:'active days',link:'pulse-heading',
    why:'A descriptive starting point for exploring consistency. No substantial change is implied.'}));
  const eligible=releases.eligible;
  if(eligible>0)findings.push(makeFinding({...scope,id:'context-delivery',type:'context',
    title:'How often authored changes appear in observed releases',
    summary:`Authored contributions entered ${releases.participated} of ${eligible} ancestry-complete, non-baseline tagged release increments in the observed scope${subject==='selection'?' for the selected group':''}.`,
    evidence:[{label:'Eligible tagged release increments',value:eligible},{label:'With authored contribution',value:releases.participated},{label:'Participation share',value:releases.coverage==null?'Undefined':`${Math.round(releases.coverage*100)}%`},{label:'Releases driven',value:subject==='selection'?'Individual attribution only':releases.driven}],
    basis:'Tag ancestry, author-scoped contributions and release event dates',unit:'tagged releases',link:'impact-explorer',
    limitations:[...scope.limitations,'Observing one branch cannot measure the proportion of all work that was ever shipped. A published release is not proof of a deployment.'],
    why:'Descriptive release coverage, not a score or a claim about change quality.'}));
  if(paths.size)findings.push(makeFinding({...scope,id:'context-reach',type:'context',
    title:'The areas visible in the authored change footprint',
    summary:`The selected authored commits touch ${paths.size} distinct file paths across ${areas.size} top-level codebase areas.${top?` ${top[0]} has the largest number of recorded touches.`:''}`,
    evidence:[{label:'Distinct file paths',value:paths.size},{label:'Top-level areas',value:areas.size},
      {label:'Most frequently touched area',value:top?.[0]||'—'},{label:'File touches in that area',value:top?.[1]||0}],
    basis:'Author-scoped file numstat entries',unit:'file paths and file touches',link:'areas-heading',
    why:'A descriptive map of source files represented in this import; touches can overlap across contributors.'}));
  return findings;
}

/** Timing evidence uses author-local day and hour from the same scoped commits. */
function weekShape(commits) {
  const counts=Array(168).fill(0);
  let timed=0;
  for(const c of commits) {
    if(!validDate(c.date) || !Number.isInteger(c.hour) || c.hour<0 || c.hour>23)continue;
    counts[dayOfWeek(c.date)*24+c.hour]++;
    timed++;
  }
  return {counts,timed,unknown:commits.length-timed};
}

function storyForPerson(view,impact,id) {
  const group=id==='selection'?null:view.byId.get(id);
  if(id!=='selection' && (!group || !view.selectedIds.has(id)))return null;
  const commits=id==='selection'?view.selectedCommits:group.commits;
  const releases=impact?.releases||[];
  const from=max(view.start,view.min),to=min(view.end,view.max);
  if(!validDate(from)||!validDate(to)||to<from)return null;
  // A contributor’s observed participation cannot begin before their first
  // recorded event. This is a coverage boundary, NOT a start-of-employment date.
  const first=commits.reduce((a,c)=>!a||c.date<a?c.date:a,null);
  const exposureStart=id==='selection'?from:max(from,first||from);
  const earliestDriven=releases.filter(r=>r.driver?.groupId===id&&r.date).map(r=>r.date).sort()[0];
  const releaseStart=id==='selection'?from:max(from,[first,earliestDriven].filter(Boolean).sort()[0]||from);
  const windows=studyWindows(exposureStart,to);
  const gaps=calendarGapStats(commits,exposureStart,to);
  // The journey covers any earlier observed release-driving activity, but may
  // never extend beyond the globally selected release-event date window.
  const lastRelease=releases.reduce((date,r)=>validDate(r.date)&&r.date>date?r.date:date,to);
  const monthly=monthSeries(commits,releases,releaseStart,min(view.end,max(to,lastRelease)),id);
  const years=yearsFromMonths(monthly);
  const rStats=releaseStats(releases,id,releaseStart,view.end);
  const recent=windows?periodStats(commits,windows.recent.from,windows.recent.to):null;
  const prior=windows?periodStats(commits,windows.prior.from,windows.prior.to):null;
  const releasePrior=windows?releaseStats(releases,id,windows.prior.from,windows.prior.to):null;
  const releaseRecent=windows?releaseStats(releases,id,windows.recent.from,windows.recent.to):null;
  const findings=[...findingForChanges(id,commits,windows),...releaseFindings(id,id,releases,windows)];
  const gap=gapFinding(id,commits,exposureStart,to);if(gap)findings.push(gap);
  const releaseGap=releaseGapFinding(id,id,releases,from,view.end);if(releaseGap)findings.push(releaseGap);
  const seasonal=seasonalFinding(id,commits,exposureStart,to);if(seasonal)findings.push(seasonal);
  findings.push(...contextFindings(id,commits,rStats,exposureStart,to));
  findings.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  return {id,name:id==='selection'?'Selected contributors':group.displayName,
    from:exposureStart,to,earliestObservedAuthored:first,activeDays:gaps.activeDays,
    commits:commits.length,gaps:{median:round(gaps.median),p90:round(gaps.p90),longest:gaps.longest,observed:gaps.gapCount},
    months:monthly,years,rhythm:weekShape(commits),releaseStats:rStats,prior,recent,releasePrior,releaseRecent,
    windows,findings};
}
export function buildStoryAnalysis(view,impact) {
  const people=[storyForPerson(view,impact,'selection'),...view.contributors.map(c=>storyForPerson(view,impact,c.id))].filter(Boolean);
  const allFindings=people.flatMap(p=>p.findings).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const selected=people.filter(p=>p.id!=='selection');
  const releases=(impact?.releases||[]).filter(r=>r.lineageComplete&&!r.baseline);
  const coverage={
    observedAuthorFrom:view.min,observedAuthorTo:view.max,scopeStart:view.start,scopeEnd:view.end,
    selectedPeople:view.contributors.length,authorCommits:view.selectedCommits.length,
    releasesInScope:impact?.releases?.length||0,releasesEligible:releases.length,
    incompleteReleases:(impact?.releases||[]).filter(r=>!r.lineageComplete).length,
    publishedReleases:(impact?.releases||[]).filter(r=>r.published).length,
    driversMapped:(impact?.releases||[]).filter(r=>r.driver?.groupId!=null).length,
    timelineLimitedToImportedHistory:true,
  };
  return {people,allFindings,coverage,comparison:selected.map(p=>({
    id:p.id,name:p.name,commits:p.commits,activeDays:p.activeDays,
    activeDaysPerWeek:p.from<=p.to?round(p.activeDays*7/(dayNumber(p.to)-dayNumber(p.from)+1)):null,
    medianGap:p.gaps.median,p90Gap:p.gaps.p90,
    releaseCoverage:p.releaseStats.coverage,releases:p.releaseStats.participated,
    releasesEligible:p.releaseStats.eligible,driven:p.releaseStats.driven,
    topArea:p.recent?.dominantArea||p.prior?.dominantArea||null,
    observationStart:p.from,
  }))};
}
