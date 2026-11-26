/**
 * Descriptive change in a person's own observable Git throughput.
 *
 * Compare the most recent N working days (including the day in question) with
 * the preceding N working days, by each identity's own working days (every
 * day when none are set). Work on non-working days inside a window's span
 * counts towards that window rather than being dropped. Day evidence is deliberately capped so a single
 * generated-file edit or a burst of tiny commits cannot dominate the trend.
 * This is a directional signal, not a forecast or a performance measure.
 *
 * Uses full-history, policy-filtered evidence. Selected date windows only
 * control what is displayed; they never remove the prior comparison period.
 */
import { dayNumber, dateAtDay, validDate } from './domain.js?v=personas-20261126-19';
import { nonVersionChurn, releaseContributionCredit } from './release-gap.js?v=personas-20261126-19';
import { temporalActivityByPerson, emptyTemporalDay, temporalOptions } from './temporal-activity.js?v=personas-20261126-19';
import { scheduleById, countAgainstSchedule } from './working-patterns.js?v=personas-20261126-19';

export const MOMENTUM_WINDOWS = Object.freeze([5,10,20]);
export const DEFAULT_MOMENTUM_WINDOW = 10;
export const MOMENTUM_COMMIT_CAP = 4;
export const MOMENTUM_CHURN_CAP = 200;
export const MOMENTUM_RELEASE_CAP = 200;
export const MOMENTUM_SMOOTHING = 0.1;
export const MOMENTUM_DIRECTION_THRESHOLD = 15;
const rounded = value => Math.round(value * 10) / 10;
const clamp01 = value => Math.max(0,Math.min(1,value));
const empty = () => ({commits:0,churn:0,releaseLines:0,releases:[]});

/** Balanced mix: recorded churn 45%, commits 25%, distribution 15%, shipped 15%. */
export function contributionUnits({commits=0,churn=0,releaseLines=0,distribution=null}={}) {
  if (![commits,churn,releaseLines].every(v=>Number.isFinite(v) && v>=0) ||
      (distribution!==null && (!Number.isFinite(distribution)||distribution<0||distribution>1))) return null;
  return 0.25*clamp01(commits/MOMENTUM_COMMIT_CAP) +
    0.45*clamp01(churn/MOMENTUM_CHURN_CAP) +
    0.15*(distribution??0) +
    0.15*clamp01(releaseLines/MOMENTUM_RELEASE_CAP);
}

/** Symmetric, bounded relative change with a small low-volume stabiliser. */
export function momentumScore(recentAverage,previousAverage) {
  if (![recentAverage,previousAverage].every(v=>Number.isFinite(v) && v>=0)) return null;
  return rounded(100*(recentAverage-previousAverage)/
    (recentAverage+previousAverage+MOMENTUM_SMOOTHING));
}

export function momentumDirection(score,hasActivity=true) {
  if (score === null) return 'unknown';
  if (!hasActivity) return 'no-observed-activity';
  return score>=MOMENTUM_DIRECTION_THRESHOLD?'building':
    score<=-MOMENTUM_DIRECTION_THRESHOLD?'cooling':'steady';
}

const evidenceCache=new WeakMap();
export function dailyEvidence(index) {
  if(evidenceCache.has(index))return evidenceCache.get(index);
  const byId=new Map();
  const at=(id,date)=>{
    if (id===null||id===undefined)return null;
    const key=String(id);
    if(!byId.has(key))byId.set(key,new Map());
    const days=byId.get(key);
    if(!days.has(date))days.set(date,empty());
    return days.get(date);
  };
  if (Array.isArray(index?.activity)) {
    for (const commit of index.activity) {
      if (!validDate(commit.date)) continue;
      const item=at(commit.groupId,commit.date);
      if (!item) continue;
      item.commits++;
      item.churn+=nonVersionChurn(commit);
    }
  }
  for (const release of index?.releases||[]) {
    if (release.baseline || !validDate(release.date)) continue;
    // Credited on the release's own date: windows include every day's activity.
    const creditedDate=release.date;
    for (const member of release.members||[]) {
      if (!(member.commits>0)) continue;
      const lines=Number(member.releaseLineChurn??member.churn);
      if (!(releaseContributionCredit(lines,MOMENTUM_RELEASE_CAP)>0)) continue;
      const item=at(member.id,creditedDate);
      if (!item) continue;
      item.releaseLines+=lines;
      item.releases.push({tag:release.tag,date:release.date,lines,complete:release.lineageComplete!==false});
    }
  }
  evidenceCache.set(index,byId);
  return byId;
}

/**
 * One window: N working days plus any non-working days inside its span. Its
 * average is all the window's units over its N working days, so work on a
 * non-working day adds to the window instead of being diluted or dropped.
 */
function periodEvidence(days,workingDays,isWorkingDay) {
  const total={commits:0,churn:0,releaseLines:0,units:0,nonWorkingDays:0};
  for (const day of days) {
    total.commits+=day.commits;
    total.churn+=day.churn;
    total.releaseLines+=day.releaseLines;
    total.units+=day.units;
    total.nonWorkingDays+=Number(!isWorkingDay(day.date)&&day.commits>0);
  }
  const meaningful=countAgainstSchedule(days.map(day=>({date:day.date,hit:day.temporal.meaningful})),isWorkingDay);
  const distributed=countAgainstSchedule(days.map(day=>({date:day.date,hit:day.temporal.distributed})),isWorkingDay);
  total.meaningfulDays=meaningful.met;total.extraDays=meaningful.extra;total.distributedDays=distributed.met;
  total.average=total.units/workingDays;
  total.consistency=total.meaningfulDays/workingDays;
  total.distributedConsistency=total.distributedDays/workingDays;
  // Consistency is intentionally a stronger ingredient than day spread.
  total.pace=0.75*total.average+0.25*total.consistency;
  return total;
}

export function momentumMatrix(index,contributors,window,options={}) {
  const workdays=MOMENTUM_WINDOWS.includes(Number(options.workdays)) ? Number(options.workdays) : DEFAULT_MOMENTUM_WINDOW;
  const start=window?.from,end=window?.to;
  const valid=validDate(start)&&validDate(end)&&start<=end;
  const coverageStart=index?.bounds?.min,coverageEnd=index?.bounds?.max;
  const completeCoverage=Array.isArray(index?.activity)&&validDate(coverageStart)&&
    validDate(coverageEnd)&&coverageStart<=coverageEnd;
  const byDay=Array.isArray(index?.activity)?dailyEvidence(index):new Map();
  const timeSettings=temporalOptions(options.temporal);
  const temporalDays=temporalActivityByPerson(index,timeSettings);
  const rows=[],byId=new Map();
  if (valid) for (const person of contributors||[]) {
    const evidence=byDay.get(String(person.id))||new Map();
    const timing=temporalDays.get(String(person.id));
    const schedule=scheduleById(options.workingDaysById,person.id,person.workingDays,person.leave);
    const daily=new Map(),months=new Map(),buffer=[];
    let sum=0,scoredDays=0,buildingDays=0,coolingDays=0,latest=null,working=0;
    const first=completeCoverage ? Math.min(dayNumber(start),dayNumber(coverageStart)) : dayNumber(start);
    for (let d=first,last=dayNumber(end);d<=last;d++) {
      const date=dateAtDay(d);
      const inCoverage=completeCoverage&&date>=coverageStart&&date<=coverageEnd;
      const workingDay=schedule.isWorkingDay(date);
      const source=evidence.get(date)||empty();
      const temporal=timing?.get(date)||emptyTemporalDay(timeSettings);
      // Every covered day joins the windows; only working days count towards N.
      if (inCoverage) {
        const units=contributionUnits({...source,distribution:temporal.distribution});
        buffer.push({...source,temporal,units,date,workingDay});
        if(workingDay)working++;
        while(working>workdays*2||(buffer.length&&!buffer[0].workingDay)){if(buffer.shift().workingDay)working--;}
      }
      if(date<start)continue;
      const reason=!inCoverage?'outside-history':!workingDay?'non-working-day':
        working<workdays*2?'insufficient-history':'scored';
      let score=null,recent=null,previous=null;
      if (reason==='scored') {
        // The recent window starts at its first working day; non-working days before it belong to the earlier window.
        let seen=0,split=buffer.length;
        for(let i=buffer.length-1;i>=0;i--){if(buffer[i].workingDay&&++seen===workdays){split=i;break;}}
        previous=periodEvidence(buffer.slice(0,split),workdays,schedule.isWorkingDay);
        recent=periodEvidence(buffer.slice(split),workdays,schedule.isWorkingDay);
        score=momentumScore(recent.pace,previous.pace);
        scoredDays++;sum+=score;
        if(score>=MOMENTUM_DIRECTION_THRESHOLD)buildingDays++;
        if(score<=-MOMENTUM_DIRECTION_THRESHOLD)coolingDays++;
      }
      const direction=momentumDirection(score,!!((recent?.commits||0)+(previous?.commits||0)+
        (recent?.releaseLines||0)+(previous?.releaseLines||0)));
      const item={date,commits:source.commits,churn:source.churn,releaseLines:source.releaseLines,temporal,
        releases:source.releases,score,direction,reason,recent,previous};
      daily.set(date,item);
      if (reason==='scored') {
        latest=item;
        const month=date.slice(0,7);
        if (!months.has(month))months.set(month,{month,total:0,score:0,days:0,buildingDays:0,coolingDays:0,distributedDays:0,latest:null});
        const bucket=months.get(month);
        bucket.days++;bucket.total+=score;bucket.latest=item;
        bucket.distributedDays+=Number(temporal.distributed);
        if (direction==='building')bucket.buildingDays++;
        if (direction==='cooling')bucket.coolingDays++;
      }
    }
    for(const bucket of months.values())bucket.score=rounded(bucket.total/bucket.days);
    const row={id:String(person.id),name:person.displayName,daily,months,schedule,
      latest,averageScore:scoredDays?rounded(sum/scoredDays):null,
      scoredDays,buildingDays,coolingDays};
    rows.push(row);byId.set(row.id,row);
  }
  return {rows,byId,workdays,temporal:timeSettings,from:start,to:end,available:rows.some(row=>row.scoredDays>0)};
}
