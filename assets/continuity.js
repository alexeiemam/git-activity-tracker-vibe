/**
 * Contribution continuity is an observation of Git records, not performance.
 *
 * The selected window includes quiet dates matching the configured contributor
 * working-day pattern. Meaningful off-pattern dates earn extra credit, but
 * never cancel a missing scheduled day. Tagged releases use a separate denominator. Author
 * dates and release-event dates are intentionally never conflated. Import
 * bounds, missing tags and incomplete release ancestry stay visible.
 */
import {dayNumber,dateAtDay,validDate} from './domain.js?v=git-working-patterns-20261107-1';
import {dailyEvidence} from './momentum.js?v=git-working-patterns-20261107-1';
import {normalizeWorkingDays,isScheduledDay,continuityScheduleStatus} from './working-patterns.js?v=git-working-patterns-20261107-1';

export const CONTINUITY_WINDOWS=Object.freeze([8,12,20]);
export const DEFAULT_CONTINUITY_WINDOW=20;
const round=value=>Math.round(value*1000)/1000;
const validLines=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export const mondayOfDate=date=>dateAtDay(dayNumber(date)-(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7);

function newBucket(key,from,to) {
  return {key,from,to,observedDays:0,coveredDays:0,observedWeekendDays:0,
    expectedDays:0,onScheduleDays:0,missedDays:0,extraDays:0,
    meaningfulDays:0,weekdayMeaningfulDays:0,weekendMeaningfulDays:0,
    smallDays:0,weekendSmallDays:0,authoredDays:0,
    commits:0,churn:0,opportunities:0,participations:0,releasedCommits:0,
    releasedLines:0,linesKnown:true,partialReleases:0,events:[],unknownDays:0,
    rollingCoverage:null};
}
function append(bucket,day) {
  if(!bucket||!day)return;
  bucket.unknownDays+=Number(!day.observed);
  if(day.observed){
    if(day.workday){
      bucket.expectedDays++;
      if(day.meaningful)bucket.onScheduleDays++;
      else bucket.missedDays++;
    } else if(day.meaningful)bucket.extraDays++;
    bucket.observedDays++;
    if(day.workday) bucket.coveredDays++;
    if(day.calendarWeekend) bucket.observedWeekendDays++;
    if(day.meaningful){
      bucket.meaningfulDays++;
      if(day.calendarWeekend)bucket.weekendMeaningfulDays++;
      else bucket.weekdayMeaningfulDays++;
    } else if(day.authored){
      if(day.calendarWeekend)bucket.weekendSmallDays++;
      else bucket.smallDays++;
    }
    bucket.authoredDays+=Number(day.authored);
    bucket.commits+=day.commits;
    bucket.churn+=day.churn;
  }
  bucket.opportunities+=day.opportunities||0;
  bucket.participations+=day.events.length;
  for(const event of day.events){
    bucket.events.push(event);
    bucket.releasedCommits+=event.commits;
    if(event.lines===null)bucket.linesKnown=false;
    else bucket.releasedLines+=event.lines;
    bucket.partialReleases+=Number(event.partial);
  }
}
function finalize(bucket,releaseAvailable) {
  bucket.coverage=bucket.expectedDays?round(bucket.meaningfulDays/bucket.expectedDays):null;
  bucket.status=continuityScheduleStatus(bucket);
  bucket.releaseParticipation=releaseAvailable&&bucket.opportunities>0?
    round(bucket.participations/bucket.opportunities):null;
  if(!bucket.linesKnown)bucket.releasedLines=null;
  delete bucket.linesKnown;
  return bucket;
}

/**
 * A rolling lookback is only scored if its *entire* calendar period is inside
 * observed import bounds. Each contributor has their own scheduled-day
 * denominator; qualifying off-pattern dates count as extras. Missing scheduled
 * days and extras are reported independently, even when their net counts agree.
 */
export function continuityMatrix(index,contributors,window,options={}) {
  const weeks=CONTINUITY_WINDOWS.includes(Number(options.weeks))?Number(options.weeks):DEFAULT_CONTINUITY_WINDOW;
  const meaningfulLines=validLines(Number(options.meaningfulLines))&&Number(options.meaningfulLines)>0?
    Number(options.meaningfulLines):20;
  const from=window?.from,to=window?.to;
  const valid=validDate(from)&&validDate(to)&&from<=to;
  const bounds=index?.bounds||{};
  const hasActivity=Array.isArray(index?.activity)&&validDate(bounds.min)&&validDate(bounds.max)&&bounds.min<=bounds.max;
  const releases=Array.isArray(index?.releases)?index.releases.filter(r=>!r.baseline&&validDate(r.date)):[];
  const releaseAvailable=releases.length>0;
  const releaseDays=new Map();
  if(valid)for(const release of releases){
    if(release.date<from||release.date>to)continue;
    const memberEvents=new Map();
    for(const member of release.members||[]){
      if(!(validLines(member.commits)&&member.commits>0)||member.id==null)continue;
      const lines=validLines(member.releaseLineChurn)?member.releaseLineChurn:null;
      const id=String(member.id);
      // Canonical indexed tags represent one release; membership is authored,
      // not publishing/driver attribution. Preserve unknown numstat lines.
      const event={tag:release.tag,date:release.date,commits:member.commits,lines,
        partial:release.lineageComplete===false};
      if(!memberEvents.has(id))memberEvents.set(id,event);
    }
    if(!releaseDays.has(release.date))releaseDays.set(release.date,{opportunities:0,members:new Map(),partial:0});
    const day=releaseDays.get(release.date);
    day.opportunities++;
    day.partial+=Number(release.lineageComplete===false);
    for(const [id,event] of memberEvents){
      if(!day.members.has(id))day.members.set(id,[]);
      day.members.get(id).push(event);
    }
  }
  const source=hasActivity?dailyEvidence(index):new Map();
  const patterns=options.workingDaysById||{};
  const rows=[],byId=new Map();
  if(valid)for(const person of contributors||[]){
    const id=String(person.id);
    const workingDays=normalizeWorkingDays(Object.hasOwn(patterns,id)?patterns[id]:person.workingDays);
    const authored=source.get(id)||new Map();
    const daily=new Map(),monthly=new Map(),weekly=new Map();
    const row=newBucket('selected',from,to);
    row.workingDays=workingDays;
    row.expectedPerWeek=workingDays.length;
    let currentGap=0,firstGap=null,lastGap=null;
    let longestGap={workdays:0,from:null,to:null};
    const startingDay=dayNumber(from),endingDay=dayNumber(to);
    // Prefix counts cover the selected dates plus the longest lookback;
    // no repeated scans over activity records or individual commits.
    const prefixFrom=hasActivity?Math.max(dayNumber(bounds.min),startingDay-weeks*7-1):startingDay;
    const coveredPrefix=[0],meaningfulPrefix=[0],scheduledMeaningfulPrefix=[0],extraPrefix=[0];
    const prefixAt=new Map();
    for(let d=prefixFrom;d<=endingDay;d++){
      const date=dateAtDay(d);
      const observed=hasActivity&&date>=bounds.min&&date<=bounds.max;
      const covered=observed&&isScheduledDay(date,workingDays);
      const item=authored.get(date);
      const meaningful=observed&&(item?.churn||0)>=meaningfulLines;
      coveredPrefix.push(coveredPrefix.at(-1)+Number(covered));
      meaningfulPrefix.push(meaningfulPrefix.at(-1)+Number(meaningful));
      scheduledMeaningfulPrefix.push(scheduledMeaningfulPrefix.at(-1)+Number(covered&&meaningful));
      extraPrefix.push(extraPrefix.at(-1)+Number(meaningful&&!covered));
      prefixAt.set(d,coveredPrefix.length-1);
    }
    const rollingAt=day=>{
      const earliest=day-weeks*7+1,latest=dateAtDay(day);
      if(!hasActivity||earliest<dayNumber(bounds.min)||latest>bounds.max)return null;
      const a=earliest===prefixFrom?0:prefixAt.get(earliest-1),b=prefixAt.get(day);
      if(a===undefined||b===undefined)return null;
      const expectedDays=coveredPrefix[b]-coveredPrefix[a];
      const meaningfulDays=meaningfulPrefix[b]-meaningfulPrefix[a];
      const scheduledMeaningfulDays=scheduledMeaningfulPrefix[b]-scheduledMeaningfulPrefix[a];
      return {expectedDays,meaningfulDays,missedDays:expectedDays-scheduledMeaningfulDays,
        extraDays:extraPrefix[b]-extraPrefix[a],
        coverage:expectedDays?round(meaningfulDays/expectedDays):null};
    };
    for(let d=startingDay;d<=endingDay;d++){
      const date=dateAtDay(d),observed=hasActivity&&date>=bounds.min&&date<=bounds.max;
      const record=authored.get(date);
      const commits=observed?(record?.commits||0):0;
      const churn=observed?(record?.churn||0):0;
      const release=releaseDays.get(date);
      const events=release?.members.get(id)||[];
      const rolling=rollingAt(d);
      const workday=isScheduledDay(date,workingDays);
      const meaningful=observed&&churn>=meaningfulLines;
      const item={date,observed,workday,calendarWeekend:[0,6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()),
        expected:observed&&workday,missing:observed&&workday&&!meaningful,extra:observed&&!workday&&meaningful,
        commits,churn,authored:commits>0,meaningful,
        opportunities:release?.opportunities||0,events,rollingCoverage:rolling?.coverage??null,
        rollingMissingDays:rolling?.missedDays??null,rollingExtraDays:rolling?.extraDays??null,
        releaseAvailable,partialOpportunities:release?.partial||0};
      daily.set(date,item);
      const weekKey=mondayOfDate(date),monthKey=date.slice(0,7);
      if(!weekly.has(weekKey))weekly.set(weekKey,newBucket(weekKey,date,date));
      if(!monthly.has(monthKey))monthly.set(monthKey,newBucket(monthKey,date,date));
      append(weekly.get(weekKey),item);
      weekly.get(weekKey).to=date;
      append(monthly.get(monthKey),item);
      monthly.get(monthKey).to=date;
      append(row,item);
      // Meaningful activity on an unscheduled date breaks a quiet-date streak,
      // but an unscheduled date without qualifying activity has no effect.
      if(item.meaningful || (item.workday&&!item.observed)){
        currentGap=0;firstGap=null;lastGap=null;
      } else if(item.workday){
        currentGap++;
        firstGap??=date;
        lastGap=date;
        if(currentGap>longestGap.workdays)longestGap={workdays:currentGap,from:firstGap,to:lastGap};
      }
    }
    for(const bucket of weekly.values()){
      const rolling=rollingAt(Math.min(endingDay,dayNumber(bucket.to)));
      bucket.rollingCoverage=rolling?.coverage??null;
      bucket.rollingMissingDays=rolling?.missedDays??null;
      bucket.rollingExtraDays=rolling?.extraDays??null;
      finalize(bucket,releaseAvailable);
    }
    for(const bucket of monthly.values()){
      const rolling=rollingAt(Math.min(endingDay,dayNumber(bucket.to)));
      bucket.rollingCoverage=rolling?.coverage??null;
      bucket.rollingMissingDays=rolling?.missedDays??null;
      bucket.rollingExtraDays=rolling?.extraDays??null;
      finalize(bucket,releaseAvailable);
    }
    finalize(row,releaseAvailable);
    const observedWeeks=[...weekly.values()].filter(bucket=>bucket.observedDays>0);
    const meaningfulWeeks=observedWeeks.filter(bucket=>bucket.meaningfulDays>0).length;
    const releaseWeeks=[...weekly.values()].filter(bucket=>bucket.participations>0).length;
    const result={...row,id,name:person.displayName,daily,weeks:weekly,months:monthly,
      meaningfulWeeks,observedWeeks:observedWeeks.length,releaseWeeks,longestGap,
      rollingCoverage:rollingAt(endingDay)?.coverage??null,
      rollingMissingDays:rollingAt(endingDay)?.missedDays??null,
      rollingExtraDays:rollingAt(endingDay)?.extraDays??null,
      partialHistory:row.unknownDays>0,
      releaseAvailable};
    rows.push(result);byId.set(id,result);
  }
  const eligibleReleases=[...releaseDays.values()].reduce((total,d)=>total+d.opportunities,0);
  const partialReleases=[...releaseDays.values()].reduce((total,d)=>total+d.partial,0);
  return {rows,byId,from,to,weeks,meaningfulLines,available:hasActivity,
    releaseAvailable,eligibleReleases,partialReleases};
}

/** Fixed, non-cohort-normalised colours: quiet days remain visibly quiet. */
export function continuityAuthoredColour(coverage,small=false,weekendOnly=false) {
  if(coverage===null||!Number.isFinite(coverage))return weekendOnly?'#c5dfd3':null;
  if(coverage<=0)return small?'#c9dbe8':'#eef0ed';
  if(coverage>1)return '#0e5148'; // Qualifying weekend days exceed the five-day baseline.
  const palette=['#c5dfd3','#96cbb8','#6cae9a','#368a77','#176955'];
  return palette[Math.min(4,Math.max(0,Math.ceil(coverage*5)-1))];
}
export function continuityReleaseColour(releases,opportunities,available=true) {
  if(!available)return null;
  if(!opportunities)return '#e5e9e7';
  if(!releases)return '#e8ded3';
  const palette=['#abc8d0','#82aab8','#598d9f','#2e6d82','#194d69'];
  return palette[Math.min(4,Math.max(0,Math.ceil(releases/opportunities*5)-1))];
}
