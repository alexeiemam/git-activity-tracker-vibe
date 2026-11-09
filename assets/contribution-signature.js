/**
 * Contribution Signature: independent Git-authorship, count-first continuity,
 * and incremental tagged-release evidence over the same selected date range.
 *
 * Authorship is dated by the commit author; delivery by the release event.
 * The two are NOT a shipped/committed conversion rate. Scores are descriptive
 * indices, not worked hours, code quality, or employment assessments.
 */
import {dayNumber,dateAtDay,validDate} from './domain.js?v=git-motion-explorer-20261108-1';
import {dailyEvidence} from './momentum.js?v=git-motion-explorer-20261108-1';
import {temporalActivityByPerson,temporalOptions,emptyTemporalDay} from './temporal-activity.js?v=git-motion-explorer-20261108-1';
import {contributionLevelUnits} from './contribution-level.js?v=git-motion-explorer-20261108-1';

export const SIGNATURE_MODES=Object.freeze(['days','signature','delivery','contribution']);
export const DEFAULT_SIGNATURE_MODE='signature';
export const DELIVERY_REFERENCE_LINES=200;
export const CONTRIBUTION_REFERENCE_INDEX=1;
const round=n=>Math.round(n*1000)/1000;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

/** Remove the shipping term, and renormalise the authored-only 80% mix. */
export function authoredOnlyUnits(day,distribution=null) {
  const result=contributionLevelUnits({commits:day?.commits??0,churn:day?.churn??0,
    releaseLines:0,distribution});
  return result===null?null:result/0.8;
}

/** Stable (cohort-independent) map axes. Plotting domains may expand to fit. */
export function quadrantPosition(x,y,{thresholdY=1,maxY=1}={}) {
  if(!finite(x)||x>1||!finite(y))return null;
  // Logarithmic Y retains magnitude without letting enormous churn flatten all
  // smaller observations. The reference threshold stays in data units.
  const top=Math.max(maxY,thresholdY,0.001);
  return {x, y:Math.log1p(y)/Math.log1p(top),
    referenceY:Math.log1p(thresholdY)/Math.log1p(top)};
}

const completeWeek=(week,from,to,bounds)=>week?.observedDays===7&&
  week.from>=from&&week.to<=to&&week.from>=bounds.min&&week.to<=bounds.max;

export function signatureMatrix(index,continuity,contributors,window,options={}) {
  const from=window?.from,to=window?.to;
  const valid=validDate(from)&&validDate(to)&&from<=to;
  const bounds=index?.bounds||{};
  const hasAuthorship=Array.isArray(index?.activity)&&validDate(bounds.min)&&validDate(bounds.max)&&bounds.min<=bounds.max;
  const temporal=temporalOptions(options.temporal);
  const daySource=hasAuthorship?dailyEvidence(index):new Map();
  const timings=hasAuthorship?temporalActivityByPerson(index,temporal):new Map();
  const releases=Array.isArray(index?.releases)&&valid?index.releases.filter(r=>
    !r.baseline&&validDate(r.date)&&r.date>=from&&r.date<=to):[];
  // Incomplete ancestry can omit a contributor entirely: never treat it as
  // a known release opportunity with zero participation.
  const completed=releases.filter(r=>r.lineageComplete!==false);
  const incomplete=releases.length-completed.length;
  const people=[],byId=new Map();
  for(const person of contributors||[]) {
    const id=String(person.id),row=continuity?.byId?.get(id);
    const evidence=daySource.get(id)||new Map(),timed=timings.get(id)||new Map();
    const weekRows=[];
    let totalUnits=0,totalCommits=0,totalChurn=0,totalExpected=0;
    let weeksMet=0,eligibleWeeks=0,coverageSum=0;
    for(const bucket of row?.weeks?.values()||[]) {
      let authoredUnits=0,authoredCommits=0,authoredChurn=0,unknown=false;
      for(let d=dayNumber(bucket.from);d<=dayNumber(bucket.to);d++) {
        const date=dateAtDay(d);
        if(!hasAuthorship||date<bounds.min||date>bounds.max){unknown=true;continue;}
        const day=evidence.get(date)||{commits:0,churn:0};
        const clock=timed.get(date)||emptyTemporalDay(temporal);
        const units=authoredOnlyUnits(day,clock.distribution);
        if(units===null){unknown=true;continue;}
        authoredUnits+=units;
        authoredCommits+=day.commits;
        authoredChurn+=day.churn;
      }
      const full=completeWeek(bucket,from,to,bounds)&&!unknown;
      const expected=bucket.expectedDays;
      const rate=!unknown&&expected>0?authoredUnits/expected:null;
      const week={...bucket,complete:full,authoredUnits:unknown?null:round(authoredUnits),
        authoredRate:rate===null?null:round(rate),authoredCommits,authoredChurn,
        // A partial week can be shown in the signature but must never be
        // silently included in the fully-observed quadrant denominators.
        partial:!full};
      weekRows.push(week);
      if(!full||expected===0)continue;
      eligibleWeeks++;
      totalExpected+=expected;
      coverageSum+=Math.min(bucket.meaningfulDays/expected,1);
      weeksMet+=Number(bucket.meaningfulDays>=expected);
      totalUnits+=authoredUnits;
      totalCommits+=authoredCommits;
      totalChurn+=authoredChurn;
    }
    const completeEligible=completed.length;
    let included=0,includedCommits=0,includedLines=0,unknownLines=false;
    for(const release of completed) {
      const member=(release.members||[]).find(m=>String(m.id)===id&&finite(m.commits)&&m.commits>0);
      if(!member)continue;
      included++;
      includedCommits+=member.commits;
      if(!finite(member.releaseLineChurn))unknownLines=true;
      else includedLines+=member.releaseLineChurn;
    }
    const result={id,name:person.displayName,expectedPerWeek:row?.expectedPerWeek??null,
      weeks:weekRows,eligibleWeeks,weeksMet,
      meanAttainment:eligibleWeeks?round(coverageSum/eligibleWeeks):null,
      weeksMetRate:eligibleWeeks?round(weeksMet/eligibleWeeks):null,
      authoredRate:totalExpected?round(totalUnits/totalExpected):null,
      authoredIndexTotal:round(totalUnits),authoredCommits:totalCommits,authoredChurn:totalChurn,
      completeExpectedDays:totalExpected,
      releaseOpportunities:completeEligible,releasePartialOpportunities:incomplete,
      releaseParticipations:included,releaseCommits:includedCommits,
      releaseLines:unknownLines?null:includedLines,
      releaseBreadth:completeEligible?round(included/completeEligible):null,
      releaseRate:completeEligible&&!unknownLines?round(includedLines/completeEligible):null,
      incompleteReleaseEvidence:unknownLines||incomplete>0,
      continuity:row};
    people.push(result);byId.set(id,result);
  }
  return {rows:people,byId,from,to,releaseOpportunities:completed.length,
    incompleteReleaseOpportunities:incomplete,hasAuthorship,
    selectedWeekCount:people[0]?.weeks.length??0};
}
