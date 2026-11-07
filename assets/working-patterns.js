/**
 * Reconciled contributors have an explicit weekly observation reference, not
 * an inferred employment contract. JS weekday numbers: Sunday=0, Monday=1.
 * An empty array is intentional: there are no expected dates, but qualifying
 * recorded activity on any date remains visible as an extra day.
 */
export const DEFAULT_WORKING_DAYS=Object.freeze([1,2,3,4,5]);
export const WEEKDAY_LABELS=Object.freeze(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);

export function normalizeWorkingDays(days) {
  if(!Array.isArray(days))return [...DEFAULT_WORKING_DAYS];
  if(days.length>7 || days.some(day=>!Number.isInteger(day)||day<0||day>6))
    return [...DEFAULT_WORKING_DAYS];
  return [...new Set(days)].sort((a,b)=>a-b);
}
export function isScheduledDay(date,days) {
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
  return normalizeWorkingDays(days).includes(weekday);
}
export function workingPatternLabel(days) {
  const normalized=normalizeWorkingDays(days);
  return normalized.length?`${normalized.length}-day reference · ${normalized.map(day=>WEEKDAY_LABELS[day]).join(', ')}`:'0-day reference · no scheduled dates';
}
/** Evaluate missing expected dates *independently* of extra recorded days. */
export function continuityScheduleStatus({expectedDays=0,missedDays=0,extraDays=0,observedDays=0}={}) {
  if(!observedDays)return 'unknown';
  if(!expectedDays)return extraDays?'extra-only':'no-schedule';
  if(missedDays===0)return extraDays?'above':'met';
  return missedDays/expectedDays <= 1/3+1e-10?'slightly-under':'under';
}
/** A fixed, cohort-independent colour scale for *missing scheduled dates*. */
export function missingDayColour(missed,expected,observed=true) {
  if(!observed)return null;
  if(expected===0)return '#e8eeea';
  if(missed===0)return '#d1e7da';
  const proportion=missed/expected;
  if(proportion<=1/3+1e-10)return '#f5dfb9';
  if(proportion<=2/3+1e-10)return '#dd978a';
  return '#ac554e';
}
/** Separate blue scale for qualifying contributions on unscheduled days. */
export function extraDayColour(extra) {
  if(!extra)return '#edf1f3';
  if(extra===1)return '#b9dced';
  if(extra===2)return '#7fbad9';
  return '#397eaa';
}
