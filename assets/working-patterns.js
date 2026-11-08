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
/**
 * Primary weekly assessment uses the number of qualifying *distinct dates*,
 * not which weekday each date falls on. An off-pattern date can therefore
 * replace a missed scheduled date. It only counts as overage once the entire
 * expected number of dates has been met.
 *
 * Keep exact-pattern adherence (scheduled hits, missed scheduled dates, and
 * off-pattern dates) as explanatory evidence, not as the primary result.
 */
export function continuityCountBalance({expectedDays=0,meaningfulDays=0,observedDays=0}={}) {
  const expected=Math.max(0,Number(expectedDays)||0);
  const actual=Math.max(0,Number(meaningfulDays)||0);
  if(!observedDays)return {shortfallDays:0,overageDays:0,status:'unknown'};
  if(expected===0)return {shortfallDays:0,overageDays:0,
    status:actual>0?'extra-only':'no-schedule'};
  const shortfallDays=Math.max(0,expected-actual);
  const overageDays=Math.max(0,actual-expected);
  const status=shortfallDays?(shortfallDays/expected<=1/3+1e-10?'slightly-under':'under'):
    overageDays?'above':'met';
  return {shortfallDays,overageDays,status};
}
/** For aggregated weekly balances, keep both unders and overs visible. */
export function continuityScheduleStatus({expectedDays=0,meaningfulDays=0,observedDays=0,
  shortfallDays,overageDays}={}) {
  const base=continuityCountBalance({expectedDays,meaningfulDays,observedDays});
  if(base.status==='unknown'||expectedDays===0)return base.status;
  const deficit=shortfallDays??base.shortfallDays;
  const surplus=overageDays??base.overageDays;
  if(deficit>0&&surplus>0)return 'mixed';
  if(deficit>0)return deficit/expectedDays<=1/3+1e-10?'slightly-under':'under';
  return surplus>0?'above':'met';
}
/** A fixed, cohort-independent colour scale for *weekly count shortfall*. */
export function missingDayColour(missed,expected,observed=true) {
  if(!observed)return null;
  if(expected===0)return '#e8eeea';
  if(missed===0)return '#d1e7da';
  const proportion=missed/expected;
  if(proportion<=1/3+1e-10)return '#f5dfb9';
  if(proportion<=2/3+1e-10)return '#dd978a';
  return '#ac554e';
}
/** Separate blue scale for count overage beyond expected dates. */
export function extraDayColour(extra) {
  if(!extra)return '#edf1f3';
  if(extra===1)return '#b9dced';
  if(extra===2)return '#7fbad9';
  return '#397eaa';
}
