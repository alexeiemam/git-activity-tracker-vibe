/**
 * Contribution continuity is an observation of Git records, not performance.
 *
 * The selected window includes quiet dates matching the configured contributor
 * working-day pattern. Count-first weekly balances measure whether the total
 * number of qualifying dates meets that reference, even on different weekdays.
 * Exact scheduled-day misses and off-pattern substitutions remain the breakdown.
 * Surpluses in one week never erase shortfalls in another. Tagged releases
 * use a separate denominator. Author
 * dates and release-event dates are intentionally never conflated. Import
 * bounds, missing tags and incomplete release ancestry stay visible.
 */
import {dayNumber,dateAtDay,validDate} from './domain.js?v=git-ingest-input-20261113-1';
import {dailyEvidence} from './momentum.js?v=git-ingest-input-20261113-1';
import {normalizeWorkingDays,isScheduledDay,continuityScheduleStatus,continuityCountBalance} from './working-patterns.js?v=git-ingest-input-20261113-1';

export const CONTINUITY_WINDOWS=Object.freeze([8,12,20]);
export const DEFAULT_CONTINUITY_WINDOW=20;
const round=value=>Math.round(value*1000)/1000;
const validLines=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export const mondayOfDate=date=>dateAtDay(dayNumber(date)-(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7);

function newBucket(key,from,to) {
  return {key,from,to,observedDays:0,coveredDays:0,observedWeekendDays:0,
    expectedDays:0,onScheduleDays:0,missedDays:0,extraDays:0,
    shortfallDays:0,overageDays:0,substitutionDays:0,
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
function finalize(bucket,releaseAvailable,weeklyBalance=null) {
  bucket.coverage=bucket.expectedDays?round(bucket.meaningfulDays/bucket.expectedDays):null;
  // Weekly/period cells use the count of meaningful dates, not weekday matching.
  // Calendar-month and selected-window totals sum separate weekly balances,
  // so 3/4 one week + 5/4 the next never becomes an unqualified 8/8 "met".
  const primary=weeklyBalance||continuityCountBalance(bucket);
  bucket.shortfallDays=primary.shortfallDays;
  bucket.overageDays=primary.overageDays;
  bucket.substitutionDays=weeklyBalance?.substitutionDays??Math.min(bucket.missedDays,bucket.extraDays);
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
 * denominator; qualifying off-pattern dates can substitute for missed planned
 * dates. Exact weekday adherence remains inspectable separately. Weekly
 * shortfall and overage are never netted across different weeks.
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
    // Monthly status sums the separate *calendar-week slices inside that month*
    // instead of disguising quiet weeks with busy weeks. Raw monthly activity
    // and release evidence keep their actual calendar dates.
    const monthWeekSlices=new Map();
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
    const rollingCache=new Map();
    const rollingAt=day=>{
      if(rollingCache.has(day))return rollingCache.get(day);
      const earliest=day-weeks*7+1,latest=dateAtDay(day);
      if(!hasActivity||earliest<dayNumber(bounds.min)||latest>bounds.max)return null;
      const a=earliest===prefixFrom?0:prefixAt.get(earliest-1),b=prefixAt.get(day);
      if(a===undefined||b===undefined)return null;
      const expectedDays=coveredPrefix[b]-coveredPrefix[a];
      const meaningfulDays=meaningfulPrefix[b]-meaningfulPrefix[a];
      const scheduledMeaningfulDays=scheduledMeaningfulPrefix[b]-scheduledMeaningfulPrefix[a];
      const missedDays=expectedDays-scheduledMeaningfulDays;
      const extraDays=extraPrefix[b]-extraPrefix[a];
      // Assess each calendar-week segment separately, including the two partial
      // edge weeks of a rolling lookback. Never net an overage in a different
      // week against an earlier shortfall.
      let shortfallDays=0,overageDays=0,substitutionDays=0;
      let weeksMet=0,weeksUnder=0,weeksOver=0;
      const firstMonday=earliest-(new Date(`${dateAtDay(earliest)}T12:00:00Z`).getUTCDay()+6)%7;
      for(let w=firstMonday;w<=day;w+=7){
        const start=Math.max(earliest,w),end=Math.min(day,w+6);
        const before=start===prefixFrom?0:prefixAt.get(start-1),after=prefixAt.get(end);
        if(before===undefined||after===undefined)continue;
        const expected=coveredPrefix[after]-coveredPrefix[before];
        const actual=meaningfulPrefix[after]-meaningfulPrefix[before];
        const scheduled=scheduledMeaningfulPrefix[after]-scheduledMeaningfulPrefix[before];
        const surplus=extraPrefix[after]-extraPrefix[before];
        const balance=continuityCountBalance({expectedDays:expected,meaningfulDays:actual,observedDays:end-start+1});
        shortfallDays+=balance.shortfallDays;
        overageDays+=balance.overageDays;
        substitutionDays+=Math.min(expected-scheduled,surplus);
        if(expected>0){
          if(balance.shortfallDays)weeksUnder++;
          else if(balance.overageDays)weeksOver++;
          else weeksMet++;
        }
      }
      const result={expectedDays,meaningfulDays,missedDays,extraDays,
        shortfallDays,overageDays,substitutionDays,weeksMet,weeksUnder,weeksOver,
        coverage:expectedDays?round(meaningfulDays/expectedDays):null};
      rollingCache.set(day,result);
      return result;
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
        rollingShortfallDays:rolling?.shortfallDays??null,rollingOverageDays:rolling?.overageDays??null,
        rollingWeeksMet:rolling?.weeksMet??null,rollingWeeksUnder:rolling?.weeksUnder??null,
        rollingWeeksOver:rolling?.weeksOver??null,
        releaseAvailable,partialOpportunities:release?.partial||0};
      daily.set(date,item);
      const weekKey=mondayOfDate(date),monthKey=date.slice(0,7);
      if(!weekly.has(weekKey))weekly.set(weekKey,newBucket(weekKey,date,date));
      if(!monthly.has(monthKey))monthly.set(monthKey,newBucket(monthKey,date,date));
      append(weekly.get(weekKey),item);
      weekly.get(weekKey).to=date;
      append(monthly.get(monthKey),item);
      monthly.get(monthKey).to=date;
      if(!monthWeekSlices.has(monthKey))monthWeekSlices.set(monthKey,new Map());
      const slices=monthWeekSlices.get(monthKey);
      if(!slices.has(weekKey))slices.set(weekKey,newBucket(weekKey,date,date));
      append(slices.get(weekKey),item);
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
    const sumWeeklyBalances=buckets=>[...buckets].reduce((total,b)=>({
      shortfallDays:total.shortfallDays+b.shortfallDays,
      overageDays:total.overageDays+b.overageDays,
      substitutionDays:total.substitutionDays+b.substitutionDays,
    }),{shortfallDays:0,overageDays:0,substitutionDays:0});
    const attachRolling=(bucket,rolling)=>{
      bucket.rollingCoverage=rolling?.coverage??null;
      bucket.rollingMissingDays=rolling?.missedDays??null;
      bucket.rollingExtraDays=rolling?.extraDays??null;
      bucket.rollingShortfallDays=rolling?.shortfallDays??null;
      bucket.rollingOverageDays=rolling?.overageDays??null;
      bucket.rollingWeeksMet=rolling?.weeksMet??null;
      bucket.rollingWeeksUnder=rolling?.weeksUnder??null;
      bucket.rollingWeeksOver=rolling?.weeksOver??null;
    };
    for(const bucket of weekly.values()){
      attachRolling(bucket,rollingAt(Math.min(endingDay,dayNumber(bucket.to))));
      finalize(bucket,releaseAvailable);
    }
    for(const [monthKey,bucket] of monthly){
      attachRolling(bucket,rollingAt(Math.min(endingDay,dayNumber(bucket.to))));
      const slices=[...monthWeekSlices.get(monthKey).values()].map(slice=>finalize(slice,releaseAvailable));
      finalize(bucket,releaseAvailable,sumWeeklyBalances(slices));
    }
    finalize(row,releaseAvailable,sumWeeklyBalances(weekly.values()));
    for(const item of daily.values()){
      const week=weekly.get(mondayOfDate(item.date));
      item.weeklyMeaningfulDays=week?.meaningfulDays??null;
      item.weeklyExpectedDays=week?.expectedDays??null;
      item.weeklyShortfallDays=week?.shortfallDays??null;
      item.weeklyOverageDays=week?.overageDays??null;
      item.weeklyStatus=week?.status??'unknown';
      item.weeklySubstitutionDays=week?.substitutionDays??null;
    }
    const observedWeeks=[...weekly.values()].filter(bucket=>bucket.observedDays>0);
    const meaningfulWeeks=observedWeeks.filter(bucket=>bucket.meaningfulDays>0).length;
    const releaseWeeks=[...weekly.values()].filter(bucket=>bucket.participations>0).length;
    const result={...row,id,name:person.displayName,daily,weeks:weekly,months:monthly,
      meaningfulWeeks,observedWeeks:observedWeeks.length,releaseWeeks,longestGap,
      rollingCoverage:rollingAt(endingDay)?.coverage??null,
      rollingMissingDays:rollingAt(endingDay)?.missedDays??null,
      rollingExtraDays:rollingAt(endingDay)?.extraDays??null,
      rollingShortfallDays:rollingAt(endingDay)?.shortfallDays??null,
      rollingOverageDays:rollingAt(endingDay)?.overageDays??null,
      rollingWeeksMet:rollingAt(endingDay)?.weeksMet??null,
      rollingWeeksUnder:rollingAt(endingDay)?.weeksUnder??null,
      rollingWeeksOver:rollingAt(endingDay)?.weeksOver??null,
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
