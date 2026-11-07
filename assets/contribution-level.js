/**
 * Observable contribution level, distinct from Momentum (change of pace).
 *
 * Uses the same full-history, policy-filtered authored / release evidence as
 * Momentum. Unlike its bounded trend inputs, the log-scaled level deliberately
 * preserves differences above ordinary thresholds. Shared day/month scales and
 * selected-cohort peer comparisons reveal sustained, unusually high levels.
 * No score is a measure of work hours, output quality or individual performance.
 */
import {dayNumber,dateAtDay,validDate} from './domain.js?v=git-working-patterns-20261107-1';
import {dailyEvidence} from './momentum.js?v=git-working-patterns-20261107-1';
import {temporalActivityByPerson,emptyTemporalDay,temporalOptions,isWorkday} from './temporal-activity.js?v=git-working-patterns-20261107-1';

export const LEVEL_WINDOWS = Object.freeze([5,10,20]);
export const DEFAULT_LEVEL_WINDOW = 10;
const round=value=>Math.round(value*1000)/1000;
const logLevel=(value,baseline)=>Math.log1p(value)/Math.log1p(baseline);
const isValid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

/** Uncapped (but diminishing-return) evidence units, to preserve real scale. */
export function contributionLevelUnits({commits=0,churn=0,releaseLines=0,distribution=null}={}) {
  if(![commits,churn,releaseLines].every(isValid) ||
     (distribution!==null && (!isValid(distribution)||distribution>1)))return null;
  return 0.25*logLevel(commits,4)+0.45*logLevel(churn,200)+
    0.20*logLevel(releaseLines,200)+0.10*(distribution??0);
}

export function median(values) {
  const sorted=values.filter(isValid).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}

/** Peers exclude the subject, and a zero denominator is never made infinite. */
export function relativeLevel(value,peers) {
  const reference=median(peers);
  return {reference,ratio:reference>0&&isValid(value)?round(value/reference):null,
    peers:peers.filter(isValid).length};
}

const monthBucket=month=>({month,days:0,total:0,score:null,commits:0,churn:0,
  releaseLines:0,meaningfulDays:0,distributedDays:0,weekdayDays:0});
/** Comparisons are descriptive: each reference excludes the current person. */
export const LEVEL_EVIDENCE = Object.freeze([
  {key:'commits',label:'Authored commits'},
  {key:'churn',label:'Non-VERSION changed lines'},
  {key:'releaseLines',label:'Authored lines included in releases'},
  {key:'consistency',label:'Meaningful-day consistency'},
  {key:'distributedConsistency',label:'Distributed-day consistency'},
]);

function compareRows(rows) {
  for(const row of rows) {
    const peers=rows.filter(other=>other!==row);
    // Recent pace and selected-window mean are separate denominators. Never
    // present one period's reference as though it described the other.
    row.peer=relativeLevel(row.recentLevel,peers.map(other=>other.recentLevel));
    row.periodPeer=relativeLevel(row.averageLevel,peers.map(other=>other.averageLevel));
    row.evidencePeers=Object.fromEntries(LEVEL_EVIDENCE.map(({key})=>
      [key,relativeLevel(row[key],peers.map(other=>other[key]))]));
  }
}

/** Comparison for the *visible date selection*, not the trailing rolling window. */
export function periodLevelDistribution(rows) {
  const validRows=rows.filter(row=>isValid(row.averageLevel)&&row.coveredDays>0);
  const sorted=[...validRows].sort((a,b)=>b.averageLevel-a.averageLevel||a.name.localeCompare(b.name));
  return {rows:sorted,median:median(validRows.map(row=>row.averageLevel)),
    max:sorted[0]?.averageLevel??0,comparable:validRows.length>1};
}

export function contributionLevelMatrix(index,contributors,window,options={}) {
  const workdays=LEVEL_WINDOWS.includes(Number(options.workdays))?Number(options.workdays):DEFAULT_LEVEL_WINDOW;
  const temporal=temporalOptions(options.temporal);
  const start=window?.from,end=window?.to;
  const valid=validDate(start)&&validDate(end)&&start<=end;
  const coverageStart=index?.bounds?.min,coverageEnd=index?.bounds?.max;
  const hasHistory=Array.isArray(index?.activity)&&validDate(coverageStart)&&validDate(coverageEnd)&&coverageStart<=coverageEnd;
  const activity=Array.isArray(index?.activity)?dailyEvidence(index):new Map();
  const timing=temporalActivityByPerson(index,temporal);
  const rows=[],byId=new Map();
  if(valid) for(const person of contributors||[]) {
    const source=activity.get(String(person.id))||new Map(),clocks=timing.get(String(person.id));
    const daily=new Map(),months=new Map(),rolling=[];
    let total=0,days=0,commits=0,churn=0,releaseLines=0,meaningfulDays=0,
      distributedDays=0,coveredWorkdays=0,latestWindow=null;
    // Include earlier evidence for the trailing working-day pace, even when
    // only a day or a month is currently selected for display.
    const first=hasHistory?Math.min(dayNumber(start),dayNumber(coverageStart)):dayNumber(start);
    for(let d=first,last=dayNumber(end);d<=last;d++) {
      const date=dateAtDay(d),inCoverage=hasHistory&&date>=coverageStart&&date<=coverageEnd;
      const original=source.get(date)||{commits:0,churn:0,releaseLines:0,releases:[]};
      const time=clocks?.get(date)||emptyTemporalDay(temporal);
      const level=inCoverage?contributionLevelUnits({...original,distribution:time.distribution}):null;
      const weekday=isWorkday(date);
      if(inCoverage&&weekday) {
        rolling.push({level,meaningful:time.meaningful,date});
        if(rolling.length>workdays)rolling.shift();
        if(rolling.length===workdays) {
          const average=rolling.reduce((n,item)=>n+item.level,0)/workdays;
          const consistency=rolling.filter(item=>item.meaningful).length/workdays;
          latestWindow={asOf:date,workdays,level:0.8*average+0.2*consistency,
            average,consistency};
        }
      }
      if(date<start)continue;
      const item={date,level,reason:inCoverage?'scored':'outside-history',
        commits:original.commits,churn:original.churn,releaseLines:original.releaseLines,
        releases:original.releases,temporal:time,weekday,peer:null};
      daily.set(date,item);
      if(level===null)continue;
      const month=date.slice(0,7);
      if(!months.has(month))months.set(month,monthBucket(month));
      const bucket=months.get(month);
      bucket.days++;bucket.total+=level;bucket.commits+=original.commits;
      bucket.churn+=original.churn;bucket.releaseLines+=original.releaseLines;
      days++;total+=level;commits+=original.commits;churn+=original.churn;releaseLines+=original.releaseLines;
      if(weekday) {
        coveredWorkdays++;bucket.weekdayDays++;
        meaningfulDays+=Number(time.meaningful);distributedDays+=Number(time.distributed);
        bucket.meaningfulDays+=Number(time.meaningful);bucket.distributedDays+=Number(time.distributed);
      }
    }
    for(const bucket of months.values())bucket.score=bucket.days?bucket.total/bucket.days:null;
    const row={id:String(person.id),name:person.displayName,daily,months,
      averageLevel:days?total/days:null,coveredDays:days,coveredWorkdays,
      recentLevel:latestWindow?.level??null,recent:latestWindow,
      commits,churn,releaseLines,meaningfulDays,distributedDays,
      consistency:coveredWorkdays?meaningfulDays/coveredWorkdays:null,
      distributedConsistency:coveredWorkdays?distributedDays/coveredWorkdays:null,
      peer:null,periodPeer:null,evidencePeers:null};
    rows.push(row);byId.set(row.id,row);
  }
  compareRows(rows);
  // One cohort sort per date/month, not one peer scan per person.
  // The daily and monthly peer reference is the median of *other* selected
  // people on that date/month. Unknown records cannot create zero references.
  function decoratePeers(mapName,key,field) {
    const ordered=rows.map(row=>row[mapName].get(key)).filter(Boolean)
      .filter(item=>isValid(item[field])).sort((a,b)=>a[field]-b[field]);
    const n=ordered.length;
    for(let i=0;i<n;i++) {
      const item=ordered[i],value=item[field],count=n-1;
      const excludedAt=k=>ordered[k+(k>=i?1:0)][field];
      const reference=!count?null:count%2
        ?excludedAt(Math.floor(count/2))
        :(excludedAt(count/2-1)+excludedAt(count/2))/2;
      item.peer={reference,ratio:reference>0?round(value/reference):null,peers:count};
    }
  }
  if(rows.length) {
    for(const date of rows[0].daily.keys())decoratePeers('daily',date,'level');
    for(const month of rows[0].months.keys())decoratePeers('months',month,'score');
  }
  return {rows,byId,distribution:periodLevelDistribution(rows),from:start,to:end,temporal,workdays,
    comparable:rows.length>1&&rows.some(row=>row.recentLevel!==null),
    available:rows.some(row=>row.coveredDays>0),metricLabels:LEVEL_EVIDENCE};
}
