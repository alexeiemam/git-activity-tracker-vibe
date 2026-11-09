/**
 * Time Explorer: evidence-driven, fixed-domain spatial views.
 * Each frame is a fully observed Monday-Sunday window contained in the user's
 * date selection. Author activity is dated by authorship; releases by tag date.
 * These coordinates describe recorded Git evidence, never attendance or quality.
 */
import {dayNumber,dateAtDay,validDate} from './domain.js?v=git-motion-explorer-20261108-1';
import {mondayOfDate,continuityMatrix} from './continuity.js?v=git-motion-explorer-20261108-1';
import {signatureMatrix,DELIVERY_REFERENCE_LINES,CONTRIBUTION_REFERENCE_INDEX} from './contribution-signature.js?v=git-motion-explorer-20261108-1';
import {dailyEvidence} from './momentum.js?v=git-motion-explorer-20261108-1';
import {momentumMatrix} from './momentum.js?v=git-motion-explorer-20261108-1';
import {contributionLevelMatrix} from './contribution-level.js?v=git-motion-explorer-20261108-1';
import {releaseGapMatrix} from './release-gap.js?v=git-motion-explorer-20261108-1';

export const MOTION_WINDOWS=Object.freeze([4,8,12,20]);
export const MOTION_STEPS=Object.freeze([1,2,4]);
export const MOTION_TRAILS=Object.freeze(['off','short','full']);
export const MOTION_LABELS=Object.freeze(['hover','all','none']);
export const MOTION_MODES=Object.freeze(['delivery','contribution','activity','release-gap','momentum','level']);
export const DEFAULT_MOTION_VIEWS=Object.freeze({delivery:'motion',contribution:'motion',activity:'cells','release-gap':'cells',momentum:'cells',level:'cells'});
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const round=n=>Math.round(n*1000)/1000;

/** Only full calendar weeks in the selected window. Always include the latest complete week. */
export function motionWindows(range,{weeks=8,step=1}={}) {
  if(!MOTION_WINDOWS.includes(weeks)||!MOTION_STEPS.includes(step)||
    !validDate(range?.from)||!validDate(range?.to)||range.from>range.to)return [];
  const selectedFirst=dayNumber(range.from),selectedLast=dayNumber(range.to);
  const firstMonday=dayNumber(mondayOfDate(range.from));
  const start=firstMonday<selectedFirst?firstMonday+7:firstMonday;
  const lastSunday=dayNumber(mondayOfDate(range.to))+6<=selectedLast?
    dayNumber(mondayOfDate(range.to))+6:dayNumber(mondayOfDate(range.to))-1;
  const firstEnd=start+weeks*7-1;
  if(firstEnd>lastSunday)return [];
  const ends=[];
  for(let d=firstEnd;d<=lastSunday;d+=step*7)ends.push(d);
  if(ends.at(-1)!==lastSunday)ends.push(lastSunday);
  return ends.map((end,i)=>({index:i,from:dateAtDay(end-weeks*7+1),to:dateAtDay(end)}));
}

export const MOTION_DESCRIPTORS=Object.freeze({
  delivery:{title:'Delivery trajectory',x:'Eligible releases with authored changes',y:'Released changed lines per eligible release',xReference:.5,yReference:DELIVERY_REFERENCE_LINES,xScale:'linear',yScale:'log',
    regions:['Selective participation / smaller changes','Broad participation / smaller changes','Selective participation / larger changes','Broad participation / larger changes'],caution:'Release dates are tag events; the underlying commits may have been authored earlier. Incomplete ancestry is excluded.'},
  contribution:{title:'Contribution trajectory',x:'Expected-day attainment',y:'Authored-only index per expected day',xReference:.75,yReference:CONTRIBUTION_REFERENCE_INDEX,xScale:'linear',yScale:'log',
    regions:['Episodic / lighter output','Regular / lighter output','Episodic / substantial output','Regular / substantial output'],caution:'Only complete observed weeks with a positive scheduled-day count are scored. Released changes are not counted again.'},
  activity:{title:'Authored activity map',x:'Meaningful authored dates / observed dates',y:'Non-VERSION changed lines per observed day',xReference:.35,yReference:50,xScale:'linear',yScale:'log',
    regions:['Infrequent / lighter changes','Frequent / lighter changes','Infrequent / substantial changes','Frequent / substantial changes'],caution:'Meaningful days use the selected churn threshold. Weekends are included; this is not a scheduled-day or worked-hours measure.'},
  'release-gap':{title:'Release gap x activity map',x:'Weighted release gap / configured horizon',y:'Mean daily authored activity support',xReference:.5,yReference:.5,xScale:'linear',yScale:'linear',
    regions:['Recent release / quieter activity','Older release / quieter activity','Recent release / active','Older release / active'],caution:'High authored activity can accompany a long release gap. No credited release means gap is unknown, not maximum concern.'},
  momentum:{title:'Momentum phase-space',x:'Absolute contribution level / observed day',y:'Directional momentum',xReference:1,yReference:0,xScale:'log',yScale:'signed',
    regions:['Lower level / cooling','Higher level / cooling','Lower level / building','Higher level / building'],caution:'Momentum is relative to the same contributor\'s prior working days. A high absolute level can legitimately have zero momentum.'},
  level:{title:'Absolute velocity landscape',x:'Expected-day attainment',y:'Absolute level per expected day',xReference:.75,yReference:1,xScale:'linear',yScale:'log',
    regions:['Irregular / lower level','Regular / lower level','Irregular / higher level','Regular / higher level'],caution:'Includes absolute authored and release-linked Git signals. The output index is a fixed scale; the display domain stays stable during playback.'},
  'level-strip':{title:'Absolute velocity distance strip',x:'Absolute level / observed calendar day',y:'Contributor lane (not a ranking)',xReference:1,yReference:null,xScale:'log',yScale:'lanes',regions:[],caution:'Each identity keeps a fixed lane while its contribution-level dot moves along the shared absolute scale. Dot positions are not peer rankings.'}
});

export function motionRegion(mode,x,y) {
  const desc=MOTION_DESCRIPTORS[mode];
  if(!desc||desc.yScale==='lanes'||!finite(x)||!Number.isFinite(y)||x<0||x>(desc.xScale==='linear'?1:Infinity))return null;
  const right=x>=desc.xReference,top=y>=desc.yReference;
  return desc.regions[(top?2:0)+(right?1:0)];
}

/** Fixed across the animation: maxima are calculated over ALL frames. */
export function motionDomain(frames,mode) {
  const desc=MOTION_DESCRIPTORS[mode];
  const all=frames.flatMap(f=>f.people.filter(p=>p.x!==null&&p.y!==null));
  const xMax=desc.xScale==='linear'?1:Math.max(desc.xReference*2,0.001,...all.map(p=>p.x*1.08));
  const yMax=desc.yScale==='signed'?100:desc.yScale==='lanes'?1:
    desc.yScale==='linear'?1:Math.max(desc.yReference*2,0.001,...all.map(p=>p.y*1.12));
  return {xMax,yMax};
}

function validPoint(x,y,mode) {
  const descriptor=MOTION_DESCRIPTORS[mode];
  return finite(x)&&Number.isFinite(y)&& (descriptor.yScale==='signed'||y>=0)&&
    (descriptor.xScale==='linear'?x<=1:true);
}

export function motionPlotPosition(p,mode,domain) {
  if(!p||!validPoint(p.x,p.y,mode))return null;
  const d=MOTION_DESCRIPTORS[mode];
  const x=d.xScale==='log'?Math.log1p(p.x)/Math.log1p(domain.xMax):p.x;
  const y=d.yScale==='signed'?(p.y+100)/200:d.yScale==='linear'?p.y:
    d.yScale==='lanes'?p.y:Math.log1p(p.y)/Math.log1p(domain.yMax);
  return {x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
}

function collectWeeks(row,from,to) {
  return (row?.weeks||[]).filter(w=>w.complete&&w.from>=from&&w.to<=to&&w.expectedDays>=0);
}
function weekEvidence(weeks) {
  const included=weeks.filter(w=>w.expectedDays>0);
  const expected=included.reduce((sum,w)=>sum+w.expectedDays,0);
  return {eligible:included.length,expected,met:included.filter(w=>w.meaningfulDays>=w.expectedDays).length,
    attainment:included.length?included.reduce((sum,w)=>sum+Math.min(w.meaningfulDays/w.expectedDays,1),0)/included.length:null,
    output:expected?included.reduce((sum,w)=>sum+w.authoredUnits,0)/expected:null,
    commits:weeks.reduce((sum,w)=>sum+w.authoredCommits,0),
    churn:weeks.reduce((sum,w)=>sum+w.authoredChurn,0),
    meaningful:weeks.reduce((sum,w)=>sum+w.meaningfulDays,0),
    observed:weeks.reduce((sum,w)=>sum+w.observedDays,0)};
}

function releaseEvidence(releases,personId,from,to) {
  let opportunities=0,partial=0,inclusions=0,lines=0,commits=0,known=true;
  for(const release of releases) {
    if(release.baseline||!validDate(release.date)||release.date<from||release.date>to)continue;
    if(release.lineageComplete===false){partial++;continue;}
    opportunities++;
    const m=(release.members||[]).find(member=>String(member.id)===personId&&finite(member.commits)&&member.commits>0);
    if(!m)continue;
    inclusions++;commits+=m.commits;
    if(!finite(m.releaseLineChurn))known=false;
    else lines+=m.releaseLineChurn;
  }
  return {opportunities,partial,inclusions,lines:known?lines:null,commits,
    breadth:opportunities?inclusions/opportunities:null,
    rate:opportunities&&known?lines/opportunities:null};
}
function selectDays(daily,from,to,weekdayOnly=false) {
  const out=[];
  if(!daily)return out;
  for(let d=dayNumber(from),end=dayNumber(to);d<=end;d++){
    const date=dateAtDay(d),weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
    if(weekdayOnly&&(weekday===0||weekday===6))continue;
    const item=daily.get(date);
    if(item)out.push(item);
  }
  return out;
}
const average=(values)=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;

/**
 * Build just the requested map using existing evidence models. Cached per index
 * and configuration so scrubbing never reruns release ancestry or day scans.
 */
const sceneCache=new WeakMap();
export function buildMotionScenes(index,contributors,range,mode,options={}) {
  if(!index||!MOTION_MODES.includes(mode))return {frames:[],mode,domain:{xMax:1,yMax:1}};
  const weeks=MOTION_WINDOWS.includes(Number(options.weeks))?Number(options.weeks):8;
  const step=MOTION_STEPS.includes(Number(options.step))?Number(options.step):1;
  const plotMode=mode==='level'&&options.levelDisplay==='strip'?'level-strip':mode;
  const people=contributors||[];
  const patterns=options.workingDaysById||{};
  const key=JSON.stringify([range?.from,range?.to,mode,plotMode,weeks,step,people.map(p=>[String(p.id),p.displayName,patterns[String(p.id)]||p.workingDays]),options.meaningfulLines,options.temporal,
    options.gapHorizon,options.busyDay,options.releaseLines,options.dailyChurn,options.momentumWorkdays,options.levelWorkdays,options.continuityWeeks]);
  let cache=sceneCache.get(index);
  if(!cache){cache=new Map();sceneCache.set(index,cache);}
  if(cache.has(key))return cache.get(key);
  // Bounded caches: a single import may be inspected under several settings.
  if(cache.size>12)cache.clear();
  const frames=motionWindows(range,{weeks,step});
  if(!frames.length){const empty={frames:[],mode:plotMode,domain:{xMax:1,yMax:1},weeks,step};cache.set(key,empty);return empty;}
  const signatureNeeded=['activity','contribution','level'].includes(mode);
  const continuity=signatureNeeded?continuityMatrix(index,people,range,{meaningfulLines:options.meaningfulLines,
    workingDaysById:patterns,weeks:options.continuityWeeks}):null;
  const signature=signatureNeeded?signatureMatrix(index,continuity,people,range,{temporal:options.temporal}):null;
  const gap=mode==='release-gap'?releaseGapMatrix(index,people,range,{horizon:options.gapHorizon,busyDay:options.busyDay,fullCreditLines:options.releaseLines,busyChurn:options.dailyChurn,temporal:options.temporal}):null;
  const momentum=mode==='momentum'?momentumMatrix(index,people,range,{workdays:options.momentumWorkdays,temporal:options.temporal}):null;
  const level=['momentum','level'].includes(mode)?contributionLevelMatrix(index,people,range,{workdays:options.levelWorkdays,temporal:options.temporal}):null;
  const source=mode==='activity'?dailyEvidence(index):null;
  const releases=mode==='delivery'?index?.releases||[]:[];
  const bounds=index?.bounds||{};
  const resultFrames=frames.map(f=>{
    const out=people.map((person,lane)=>{
      const id=String(person.id),name=person.displayName;
      let x=null,y=null,weight=0,evidence={};
      const fullyObserved=validDate(bounds.min)&&validDate(bounds.max)&&f.from>=bounds.min&&f.to<=bounds.max&&Array.isArray(index.activity);
      if(mode==='delivery'){
        const r=releaseEvidence(releases,id,f.from,f.to);
        x=r.breadth;y=r.rate;weight=r.commits;evidence={...r};
      }else if(!fullyObserved){
        evidence={reason:'Window extends beyond imported authorship history'};
      }else if(mode==='activity'||mode==='contribution'||mode==='level'){
        const w=weekEvidence(collectWeeks(signature?.byId.get(id),f.from,f.to));
        weight=w.commits;
        if(mode==='activity'){
          x=w.observed?w.meaningful/w.observed:null;
          y=w.observed?w.churn/w.observed:null;
          evidence={meaningfulDays:w.meaningful,observedDays:w.observed,commits:w.commits,churn:w.churn};
        }else if(mode==='contribution'){
          x=w.attainment;y=w.output;
          evidence={weeksMet:w.met,eligibleWeeks:w.eligible,expectedDays:w.expected,commits:w.commits,churn:w.churn};
        }else{
          const days=selectDays(level?.byId.get(id)?.daily,f.from,f.to);
          const scored=days.filter(d=>finite(d.level));
          const total=scored.reduce((sum,d)=>sum+d.level,0);
          x=plotMode==='level-strip'?(scored.length?total/scored.length:null):w.attainment;
          y=plotMode==='level-strip'?(people.length>1?1-lane/(people.length-1):.5):w.expected?total/w.expected:null;
          weight=w.commits;evidence={weeksMet:w.met,eligibleWeeks:w.eligible,expectedDays:w.expected,
            meanLevel:scored.length?total/scored.length:null,outputPerExpectedDay:w.expected?total/w.expected:null,commits:w.commits,churn:w.churn};
        }
      }else if(mode==='release-gap'){
        const days=selectDays(gap?.byId.get(id)?.daily,f.from,f.to,true);
        const known=days.filter(d=>d.reason==='scored');
        const endItem=gap?.byId.get(id)?.daily.get(f.to);
        x=finite(endItem?.effectiveGapDays)?Math.min(1,endItem.effectiveGapDays/options.gapHorizon):null;
        const support=days.filter(d=>d.reason!=='outside-history').map(d=>{
          const qCommit=Math.max(0,1-d.commits/options.busyDay);
          const qChurn=Math.max(0,1-d.churn/options.dailyChurn);
          return 1-qCommit*qChurn*(1-.15*(d.temporal?.distribution||0));
        });
        y=average(support);
        weight=known.length;evidence={scoredDays:known.length,activityDays:support.length,latestEffectiveGap:endItem?.effectiveGapDays??null,
          lastRelease:endItem?.lastRelease?.tag||null,meanSignal:average(known.map(d=>d.score))};
      }else if(mode==='momentum'){
        const days=selectDays(level?.byId.get(id)?.daily,f.from,f.to);
        const scored=days.filter(d=>finite(d.level));
        x=average(scored.map(d=>d.level));
        const direction=selectDays(momentum?.byId.get(id)?.daily,f.from,f.to,true).filter(d=>d.score!==null);
        y=direction.at(-1)?.score??null;
        weight=scored.length;evidence={observedDays:scored.length,momentumScoredDays:direction.length,
          meanLevel:x,latestMomentum:y};
      }
      if(!validPoint(x,y,plotMode))return {id,name,x:null,y:null,weight,evidence,lane,reason:evidence.reason||'Insufficient complete evidence for an axis'};
      return {id,name,x:round(x),y:round(y),weight,evidence,lane,region:motionRegion(plotMode,x,y)};
    });
    return {...f,people:out};
  });
  const result={frames:resultFrames,mode:plotMode,weeks,step,domain:motionDomain(resultFrames,plotMode),
    selectedRange:range};
  cache.set(key,result);
  return result;
}
