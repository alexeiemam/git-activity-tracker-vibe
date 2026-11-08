/**
 * Authored-clock distribution and workday consistency for one contributor.
 *
 * This is descriptive Git evidence, NOT hours worked, effort, availability,
 * quality, or a performance score. A Git commit has a local authored date and
 * clock; that clock is not necessarily in a common timezone across commits.
 * Missing clock data never turns into an observed zero or removes churn credit.
 *
 * Days, identities and merge/revert inclusion come from the full-history,
 * policy-filtered evidence index. Display windows do not trim earlier context.
 */
import {dayNumber,dateAtDay,validDate} from './domain.js?v=git-quadrant-inspection-20261108-1';

export const TEMPORAL_PERIODS = Object.freeze([60,90,120]);
export const TEMPORAL_PERIOD_DEFAULT = 90;
export const TEMPORAL_CHURN_CAPS = Object.freeze([25,50,100]);
export const TEMPORAL_CHURN_DEFAULT = 50;
export const MEANINGFUL_CHURN_THRESHOLDS = Object.freeze([10,20,50]);
export const MEANINGFUL_CHURN_DEFAULT = 20;
export const SPAN_TARGET_MINUTES = 360;
export const ACTIVE_PERIOD_TARGET = 4;
export const DISTRIBUTED_DAY_THRESHOLD = 0.04;
export const MAX_GAP_DISTRIBUTION_RELIEF = 0.15;

const rounded=value=>Math.round(value*1000)/1000;
const clamp01=value=>Math.max(0,Math.min(1,value));
export const isWorkday=date=>validDate(date) && ![0,6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
export function temporalOptions(options={}) {
  const period=Number(options.period),churnCap=Number(options.churnCap),meaningfulLines=Number(options.meaningfulLines);
  return {
    period:TEMPORAL_PERIODS.includes(period)?period:TEMPORAL_PERIOD_DEFAULT,
    churnCap:TEMPORAL_CHURN_CAPS.includes(churnCap)?churnCap:TEMPORAL_CHURN_DEFAULT,
    meaningfulLines:MEANINGFUL_CHURN_THRESHOLDS.includes(meaningfulLines)?meaningfulLines:MEANINGFUL_CHURN_DEFAULT,
  };
}

/** Only numstat text lines, never VERSION-only or binary-only changes. */
export function nonVersionChurn(commit) {
  const nonnegative=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
  return (commit?.files||[]).reduce((total,file)=>
    total+(/(^|\/)VERSION$/.test(file.path||'') ? 0 :
      nonnegative(file.added)+nonnegative(file.deleted)),0);
}

function clockMinute(commit) {
  return Number.isInteger(commit.hour)&&commit.hour>=0&&commit.hour<24 &&
    Number.isInteger(commit.minute)&&commit.minute>=0&&commit.minute<60
    ? commit.hour*60+commit.minute : null;
}

/** Pure daily fingerprint; call with commits that share one author-local date. */
export function temporalDay(commits,options={}) {
  const {period,churnCap,meaningfulLines}=temporalOptions(options);
  const periods=new Map();
  let churn=0,first=null,last=null,timedCommits=0;
  const offsets=new Set();
  for (const commit of commits||[]) {
    const lines=nonVersionChurn(commit);
    churn+=lines;
    const minute=clockMinute(commit);
    if(minute===null)continue;
    timedCommits++;
    if(Number.isFinite(commit.offsetMinutes))offsets.add(commit.offsetMinutes);
    first=first===null?minute:Math.min(first,minute);
    last=last===null?minute:Math.max(last,minute);
    const bin=Math.floor(minute/period);
    const bucket=periods.get(bin)||{index:bin,start:bin*period,end:Math.min(1440,(bin+1)*period),commits:0,churn:0};
    bucket.commits++;bucket.churn+=lines;
    periods.set(bin,bucket);
  }
  const buckets=[...periods.values()].sort((a,b)=>a.index-b.index);
  const credits=buckets.map(bucket=>clamp01(bucket.churn/churnCap));
  const weightedPeriodUnits=credits.reduce((a,b)=>a+b,0);
  const additionalUnits=Math.max(0,weightedPeriodUnits-Math.max(0,...credits));
  const activePeriods=buckets.length;
  // One timestamped commit is unmeasurable spread, not a zero-span day.
  const mixedOffsets=offsets.size>1;
  const measurable=timedCommits>=2&&!mixedOffsets;
  const spanMinutes=measurable?last-first:null;
  const spread=measurable ? clamp01(spanMinutes/SPAN_TARGET_MINUTES)*
    clamp01((activePeriods-1)/(ACTIVE_PERIOD_TARGET-1)) : null;
  // More credit must appear in *other* periods; one large commit followed by
  // trivial changes, or two tiny changes hours apart, cannot imply continuity.
  const distribution=spread===null?null:rounded(spread*clamp01(additionalUnits/(ACTIVE_PERIOD_TARGET-1)));
  const meaningful=churn>=meaningfulLines;
  return {
    commits:(commits||[]).length,churn,meaningful,
    timedCommits,untimedCommits:(commits||[]).length-timedCommits,mixedOffsets,
    firstMinute:first,lastMinute:last,spanMinutes,activePeriods,
    substantivePeriods:buckets.filter(b=>b.churn>0).length,
    weightedPeriodUnits:rounded(weightedPeriodUnits),spread:spread===null?null:rounded(spread),
    distribution,distributed:meaningful&&distribution!==null&&distribution>=DISTRIBUTED_DAY_THRESHOLD,
    buckets,
    status:!commits?.length?'no-commits':!timedCommits?'no-time':mixedOffsets?'mixed-zones':!measurable?'single':
      timedCommits<(commits?.length||0)?'partial':'observed',
  };
}

const emptyCache=new Map();
export function emptyTemporalDay(options={}) {
  const settings=temporalOptions(options),key=JSON.stringify(settings);
  if(!emptyCache.has(key))emptyCache.set(key,temporalDay([],settings));
  return emptyCache.get(key);
}

const indexCache=new WeakMap();
/** Map contributor id -> authored date -> temporalDay. Precompute once per index/settings. */
export function temporalActivityByPerson(index,options={}) {
  if(!index||typeof index!=='object')return new Map();
  const settings=temporalOptions(options);
  const key=JSON.stringify(settings);
  let cached=indexCache.get(index);
  if(cached?.has(key))return cached.get(key);
  if(!cached){cached=new Map();indexCache.set(index,cached);}
  const commitsByPerson=new Map();
  for(const commit of index.activity||[]) {
    if(!validDate(commit.date)||commit.groupId===null||commit.groupId===undefined)continue;
    const id=String(commit.groupId);
    if(!commitsByPerson.has(id))commitsByPerson.set(id,new Map());
    const days=commitsByPerson.get(id);
    if(!days.has(commit.date))days.set(commit.date,[]);
    days.get(commit.date).push(commit);
  }
  const result=new Map();
  for(const [id,days] of commitsByPerson){
    result.set(id,new Map([...days].map(([date,commits])=>[date,temporalDay(commits,settings)])));
  }
  // UI controls only need a few combinations at once; bound the cache when
  // people experiment with window sizes and churn thresholds.
  if(cached.size>=4)cached.delete(cached.keys().next().value);
  cached.set(key,result);
  return result;
}

/** Calendar summary for the original Activity lens; percentages use covered weekdays. */
export function temporalActivitySummary(index,contributors,window,options={}) {
  const settings=temporalOptions(options),grouped=temporalActivityByPerson(index,settings);
  const start=window?.from,end=window?.to,valid=validDate(start)&&validDate(end)&&start<=end;
  const bounds=index?.bounds||{};
  const observed=validDate(bounds.min)&&validDate(bounds.max)&&Array.isArray(index?.activity);
  const rows=[],byId=new Map();
  if(valid)for(const person of contributors||[]) {
    const days=grouped.get(String(person.id))||new Map(),months=new Map();
    let coveredDays=0,meaningfulDays=0,distributedDays=0,daysWithClock=0,daysWithMeasuredSpan=0;
    let spanSum=0,activePeriodSum=0,distributionSum=0,distributionCount=0;
    for(let day=dayNumber(start),last=dayNumber(end);day<=last;day++){
      const date=dateAtDay(day);
      if(!observed||date<bounds.min||date>bounds.max||!isWorkday(date))continue;
      coveredDays++;
      const item=days.get(date)||emptyTemporalDay(settings);
      meaningfulDays+=Number(item.meaningful);
      distributedDays+=Number(item.distributed);
      daysWithClock+=Number(item.timedCommits>0);
      if(item.spanMinutes!==null){daysWithMeasuredSpan++;spanSum+=item.spanMinutes;activePeriodSum+=item.activePeriods;}
      if(item.distribution!==null){distributionSum+=item.distribution;distributionCount++;}
      const month=date.slice(0,7);
      if(!months.has(month)) months.set(month,{month,coveredDays:0,meaningfulDays:0,distributedDays:0,daysWithClock:0});
      const bucket=months.get(month);
      bucket.coveredDays++;bucket.meaningfulDays+=Number(item.meaningful);
      bucket.distributedDays+=Number(item.distributed);
      bucket.daysWithClock+=Number(item.timedCommits>0);
    }
    const row={id:String(person.id),name:person.displayName,daily:days,months,coveredDays,
      meaningfulDays,distributedDays,daysWithClock,daysWithMeasuredSpan,
      consistency:coveredDays?rounded(meaningfulDays/coveredDays):null,
      distributedConsistency:coveredDays?rounded(distributedDays/coveredDays):null,
      meanSpanMinutes:daysWithMeasuredSpan?Math.round(spanSum/daysWithMeasuredSpan):null,
      meanActivePeriods:daysWithMeasuredSpan?rounded(activePeriodSum/daysWithMeasuredSpan):null,
      meanDistribution:distributionCount?rounded(distributionSum/distributionCount):null};
    rows.push(row);byId.set(row.id,row);
  }
  return {rows,byId,...settings,from:start,to:end};
}
