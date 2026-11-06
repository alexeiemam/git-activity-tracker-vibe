/**
 * Observable contribution level, distinct from Momentum (change of pace).
 *
 * Uses the same full-history, policy-filtered authored / release evidence as
 * Momentum. Unlike its bounded trend inputs, the log-scaled level deliberately
 * preserves differences above ordinary thresholds. Shared day/month scales and
 * selected-cohort peer comparisons reveal sustained, unusually high levels.
 * No score is a measure of work hours, output quality or individual performance.
 */
import {dayNumber,dateAtDay,validDate} from './domain.js?v=git-contribution-level-20261106-1';
import {dailyEvidence} from './momentum.js?v=git-contribution-level-20261106-1';
import {temporalActivityByPerson,emptyTemporalDay,temporalOptions,isWorkday} from './temporal-activity.js?v=git-contribution-level-20261106-1';

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
const metrics=[
  ['commits','Authored commits'],['churn','Non-VERSION changed lines'],
  ['releaseLines','Tagged-release changed lines'],['consistency','Meaningful-day consistency'],
  ['distributedConsistency','Distributed-day consistency'],
];

/** Compare one contributor only with other people in the currently selected cohort. */
function compareRows(rows) {
  for(const row of rows) {
    const peers=rows.filter(other=>other!==row);
    row.peer=relativeLevel(row.recentLevel,peers.map(other=>other.recentLevel));
    row.rank=row.recentLevel===null?null:1+rows.filter(other=>other.recentLevel!==null&&other.recentLevel>row.recentLevel+1e-9).length;
    row.uniqueLeader=row.recentLevel!==null&&row.recentLevel>0&&peers.length>0&&
      peers.every(other=>other.recentLevel!==null&&row.recentLevel>other.recentLevel+1e-9);
    row.leadingSignals=[];
    for(const [key,label] of metrics) {
      const own=row[key];
      if(!isValid(own)||own===0||!peers.length||!peers.every(p=>isValid(p[key])))continue;
      if(peers.every(p=>own>p[key]+1e-9))row.leadingSignals.push(label);
    }
    row.broadLead=row.uniqueLeader&&row.leadingSignals.length>=3;
  }
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
        releases:original.releases,temporal:time,weekday,peer:null,rank:null,leader:false};
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
      peer:null,rank:null,leadingSignals:[],uniqueLeader:false,broadLead:false};
    rows.push(row);byId.set(row.id,row);
  }
  compareRows(rows);
  // One cohort sort per date/month, not one peer scan *per contributor*.
  // This keeps decade-scale imports and larger reconciled identity groups fast.
  // All selected people share the same display dates and history coverage.
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
      // Ties share the same rank, with zero never flagged as a standout.
      let upper=i+1;
      while(upper<n&&ordered[upper][field]<=value+1e-9)upper++;
      item.rank=1+n-upper;
      item.leader=n===rows.length&&n>1&&value>0&&i===n-1&&
        value>ordered[n-2][field]+1e-9;
    }
  }
  if(rows.length) {
    for(const date of rows[0].daily.keys())decoratePeers('daily',date,'level');
    for(const month of rows[0].months.keys())decoratePeers('months',month,'score');
  }
  const leader=rows.find(row=>row.broadLead)||rows.find(row=>row.uniqueLeader)||null;
  return {rows,byId,leader,from:start,to:end,temporal,workdays,
    comparable:rows.length>1&&rows.some(row=>row.recentLevel!==null),
    available:rows.some(row=>row.coveredDays>0),metricLabels:metrics};
}
