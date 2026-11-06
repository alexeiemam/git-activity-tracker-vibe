/**
 * Descriptive change in a person's own observable Git throughput.
 *
 * Compare the most recent N weekdays (including the day in question) with
 * the preceding N weekdays. Day evidence is deliberately capped so a single
 * generated-file edit or a burst of tiny commits cannot dominate the trend.
 * This is a directional signal, not a forecast or a performance measure.
 *
 * Uses full-history, policy-filtered evidence. Selected date windows only
 * control what is displayed; they never remove the prior comparison period.
 */
import { dayNumber, dateAtDay, validDate } from './domain.js?v=git-absolute-velocity-20261106-1';
import { nonVersionChurn, releaseContributionCredit } from './release-gap.js?v=git-absolute-velocity-20261106-1';
import { temporalActivityByPerson, emptyTemporalDay, temporalOptions } from './temporal-activity.js?v=git-absolute-velocity-20261106-1';

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
const isWeekday = date => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};
const nextWorkday = date => {
  let day=dayNumber(date);
  while (!isWeekday(dateAtDay(day))) day++;
  return dateAtDay(day);
};

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
    const creditedDate=nextWorkday(release.date);
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

function periodEvidence(days) {
  const total={commits:0,churn:0,releaseLines:0,units:0,meaningfulDays:0,distributedDays:0};
  for (const day of days) {
    total.commits+=day.commits;
    total.churn+=day.churn;
    total.releaseLines+=day.releaseLines;
    total.units+=day.units;
    total.meaningfulDays+=Number(day.temporal.meaningful);
    total.distributedDays+=Number(day.temporal.distributed);
  }
  total.average=total.units/days.length;
  total.consistency=total.meaningfulDays/days.length;
  total.distributedConsistency=total.distributedDays/days.length;
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
    const daily=new Map(),months=new Map(),buffer=[];
    let sum=0,scoredDays=0,buildingDays=0,coolingDays=0,latest=null;
    const first=completeCoverage ? Math.min(dayNumber(start),dayNumber(coverageStart)) : dayNumber(start);
    for (let d=first,last=dayNumber(end);d<=last;d++) {
      const date=dateAtDay(d);
      const inCoverage=completeCoverage&&date>=coverageStart&&date<=coverageEnd;
      const weekday=isWeekday(date);
      const source=evidence.get(date)||empty();
      const temporal=timing?.get(date)||emptyTemporalDay(timeSettings);
      // Never include weekend authored activity in weekday averages. Weekend
      // release tags are credited on the next eligible workday instead.
      if (weekday&&inCoverage) {
        const units=contributionUnits({...source,distribution:temporal.distribution});
        buffer.push({...source,temporal,units,date});
        if(buffer.length>workdays*2)buffer.shift();
      }
      if(date<start)continue;
      const reason=!inCoverage?'outside-history':!weekday?'weekend':
        buffer.length<workdays*2?'insufficient-history':'scored';
      let score=null,recent=null,previous=null;
      if (reason==='scored') {
        previous=periodEvidence(buffer.slice(0,workdays));
        recent=periodEvidence(buffer.slice(workdays));
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
    const row={id:String(person.id),name:person.displayName,daily,months,
      latest,averageScore:scoredDays?rounded(sum/scoredDays):null,
      scoredDays,buildingDays,coolingDays};
    rows.push(row);byId.set(row.id,row);
  }
  return {rows,byId,workdays,temporal:timeSettings,from:start,to:end,available:rows.some(row=>row.scoredDays>0)};
}
