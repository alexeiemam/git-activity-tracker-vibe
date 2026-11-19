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
/** Every day of the week: what rates use when an identity has no working days set. */
export const EVERY_DAY=Object.freeze([0,1,2,3,4,5,6]);

/**
 * How an identity's days are measured: their working days, or every day when
 * none are set (so their work is still measured, never left out). `noneSet`
 * lets summaries say so plainly.
 */
export function scheduleFor(days) {
  const pattern=normalizeWorkingDays(days),measured=pattern.length?pattern:[...EVERY_DAY];
  return {pattern,measured,noneSet:!pattern.length,
    isWorkingDay:date=>measured.includes(new Date(`${date}T12:00:00Z`).getUTCDay())};
}
/** Each identity's schedule from a `{id: workingDays}` map, falling back to their own pattern. */
export function scheduleById(workingDaysById={},id,fallback) {
  return scheduleFor(Object.hasOwn(workingDaysById||{},String(id))?workingDaysById[String(id)]:fallback);
}

/**
 * Count the days that meet some test (`hit`) against a schedule, week by week
 * (Monday–Sunday). A hit on a non-working day fills a missed working day in
 * the same week; any further hits are `extra`. Nothing is dropped:
 * `met + extra` is every hit.
 */
export function countAgainstSchedule(entries,isWorkingDay) {
  const weeks=new Map();
  for(const {date,hit} of entries){
    const at=Date.parse(`${date}T00:00:00Z`),monday=new Date(at-((new Date(at).getUTCDay()+6)%7)*86400000).toISOString().slice(0,10);
    const week=weeks.get(monday)||{expected:0,onSchedule:0,offSchedule:0};
    if(isWorkingDay(date)){week.expected++;week.onSchedule+=Number(!!hit);}
    else week.offSchedule+=Number(!!hit);
    weeks.set(monday,week);
  }
  const total={expected:0,onSchedule:0,substituted:0,extra:0};
  for(const week of weeks.values()){
    const substituted=Math.min(week.expected-week.onSchedule,week.offSchedule);
    total.expected+=week.expected;total.onSchedule+=week.onSchedule;
    total.substituted+=substituted;total.extra+=week.offSchedule-substituted;
  }
  total.met=total.onSchedule+total.substituted;
  return total;
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

/**
 * Bank holidays by name, resolved to real dates each year. Fixed dates that
 * fall on a weekend move to the next free weekday, as UK substitute days do.
 * The defaults are the eight in the standard contract.
 */
export const BANK_HOLIDAYS=Object.freeze([
  {id:'new-year',name:'New Year\'s Day',fixed:'01-01'},
  {id:'second-january',name:'2 January',fixed:'01-02'},
  {id:'st-patrick',name:'St Patrick\'s Day',fixed:'03-17'},
  {id:'good-friday',name:'Good Friday',easter:-2},
  {id:'easter-monday',name:'Easter Monday',easter:1},
  {id:'may-day',name:'May Day',monday:[5,1]},
  {id:'spring',name:'Spring Bank Holiday',monday:[5,-1]},
  {id:'boyne',name:'Battle of the Boyne',fixed:'07-12'},
  {id:'august-first',name:'Summer Bank Holiday (first Monday of August)',monday:[8,1]},
  {id:'august',name:'August Bank Holiday',monday:[8,-1]},
  {id:'st-andrew',name:'St Andrew\'s Day',fixed:'11-30'},
  {id:'christmas',name:'Christmas Day',fixed:'12-25'},
  {id:'boxing',name:'Boxing Day',fixed:'12-26'},
].map(Object.freeze));
const BANK_IDS=new Set(BANK_HOLIDAYS.map(h=>h.id));
/** Days off: holiday entitlement (2 a month, taken whenever) on top of named bank holidays and any one-off days. */
export const DEFAULT_LEAVE=Object.freeze({holidays:24,bankHolidays:Object.freeze(['new-year','st-patrick','easter-monday','may-day','spring','august','christmas','boxing']),extraDays:Object.freeze([])});
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const realDate=value=>ISO_DATE.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
/**
 * Holidays are whole or half days from 0 to 366; bank holidays are names from
 * the list above (an older plain count falls back to the defaults); one-off
 * days are real dates, given as a list or as text.
 */
export function normalizeLeave(leave) {
  const n=Number(leave?.holidays);
  const holidays=leave?.holidays!==null&&leave?.holidays!==''&&Number.isFinite(n)&&n>=0&&n<=366?Math.round(n*2)/2:DEFAULT_LEAVE.holidays;
  const bankHolidays=Array.isArray(leave?.bankHolidays)?BANK_HOLIDAYS.map(h=>h.id).filter(id=>leave.bankHolidays.includes(id)):[...DEFAULT_LEAVE.bankHolidays];
  const raw=typeof leave?.extraDays==='string'?leave.extraDays.split(/[\s,;]+/):Array.isArray(leave?.extraDays)?leave.extraDays:[];
  const extraDays=[...new Set(raw.map(String).map(d=>d.trim()).filter(realDate))].sort().slice(0,500);
  return {holidays,bankHolidays:bankHolidays.filter(id=>BANK_IDS.has(id)),extraDays};
}
/** "7 bank holidays + 1 other day off" */
export function daysOffText(leave) {
  const {bankHolidays,extraDays}=normalizeLeave(leave),n=bankHolidays.length,m=extraDays.length;
  return `${n} bank holiday${n===1?'':'s'}${m?` + ${m} other day${m===1?'':'s'} off`:''}`;
}
const easterSunday=year=>{
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return Date.UTC(year,month-1,day)/86400000;
};
const nthMonday=(year,month,nth)=>{
  if(nth>0){const first=Date.UTC(year,month-1,1)/86400000,dow=new Date(first*86400000).getUTCDay();return first+((8-dow)%7)+7*(nth-1);}
  const last=Date.UTC(year,month,0)/86400000,dow=new Date(last*86400000).getUTCDay();return last-((dow+6)%7);
};
const bankDateCache=new Map();
/** The dates a set of named bank holidays falls on in one year, with weekend substitutes. */
export function bankHolidayDates(year,ids=DEFAULT_LEAVE.bankHolidays) {
  const key=`${year}:${ids.join(',')}`;
  if(bankDateCache.has(key))return bankDateCache.get(key);
  const chosen=BANK_HOLIDAYS.filter(h=>ids.includes(h.id));
  const day=h=>h.easter?easterSunday(year)+h.easter:h.monday?nthMonday(year,...h.monday):Date.parse(`${year}-${h.fixed}T00:00:00Z`)/86400000;
  const weekend=d=>[0,6].includes(new Date(d*86400000).getUTCDay());
  const taken=new Set(chosen.map(day).filter(d=>!weekend(d)));
  for(const d of chosen.map(day).filter(weekend).sort((a,b)=>a-b)){let s=d+1;while(weekend(s)||taken.has(s))s++;taken.add(s);}
  const dates=new Set([...taken].map(d=>new Date(d*86400000).toISOString().slice(0,10)));
  bankDateCache.set(key,dates);
  return dates;
}

const dayMs=86400000;
const dayOf=date=>Date.parse(`${date}T00:00:00Z`)/dayMs;
const dateOf=day=>new Date(day*dayMs).toISOString().slice(0,10);
const round1=value=>Math.round(value*10)/10;

/**
 * Worked days against what each identity's schedule and leave lead you to
 * expect, per calendar year and across the whole period. Each person is
 * measured only between their first and last authored commit in the imported
 * history, so years before they joined or after they left are not shortfalls.
 * A year's expected days are its working days inside that span and the
 * period, less the bank holidays and one-off days that land on those working
 * days, less the holiday entitlement scaled to the share of the year covered
 * (holiday can be taken whenever, so no dates are assumed). Worked days are
 * every date with an authored commit, on a working day or not, so no work is
 * dropped. Git records changes, not attendance: a day of reviews, meetings or
 * unpushed work looks the same as a day off.
 */
export function workedDaysBalance(index,contributors,window,{workingDaysById={},leaveById={}}={}) {
  const bounds=index?.bounds||{};
  const from=[window?.from,bounds.min].filter(Boolean).sort().pop(),to=[window?.to,bounds.max].filter(Boolean).sort()[0];
  const active=new Map();
  for(const c of index?.activity||[]){
    if(c.groupId==null||!c.date)continue;
    const id=String(c.groupId);if(!active.has(id))active.set(id,new Set());
    active.get(id).add(c.date);
  }
  const years=[];
  if(from&&to&&from<=to)for(let y=Number(from.slice(0,4));y<=Number(to.slice(0,4));y++){
    const start=[from,`${y}-01-01`].sort().pop(),end=[to,`${y}-12-31`].sort()[0];
    years.push({year:y,from:start,to:end});
  }
  const rows=(contributors||[]).map(person=>{
    const id=String(person.id),schedule=scheduleById(workingDaysById,id,person.workingDays);
    const leave=normalizeLeave(Object.hasOwn(leaveById,id)?leaveById[id]:person.leave);
    const dates=active.get(id)||new Set(),sorted=[...dates].sort();
    const first=sorted[0]||null,last=sorted[sorted.length-1]||null;
    const perYear=years.map(y=>{
      const start=[y.from,first].filter(Boolean).sort().pop(),end=[y.to,last].filter(Boolean).sort()[0];
      if(!first||start>end)return {year:y.year,from:null,to:null,measured:false,share:0,scheduled:0,bankHolidays:0,holidays:0,allowance:0,expected:0,worked:0,onSchedule:0,offSchedule:0,balance:0};
      const closed=new Set([...bankHolidayDates(y.year,leave.bankHolidays),...leave.extraDays]);
      let scheduled=0,bankHolidays=0,onSchedule=0,offSchedule=0;
      for(let d=dayOf(start),stop=dayOf(end);d<=stop;d++){
        const date=dateOf(d),scheduledDay=schedule.isWorkingDay(date),closedDay=scheduledDay&&closed.has(date),working=scheduledDay&&!closedDay,worked=dates.has(date);
        scheduled+=Number(scheduledDay);bankHolidays+=Number(closedDay);onSchedule+=Number(working&&worked);offSchedule+=Number(!working&&worked);
      }
      const share=(dayOf(end)-dayOf(start)+1)/(dayOf(`${y.year}-12-31`)-dayOf(`${y.year}-01-01`)+1);
      const holidays=leave.holidays*share,allowance=bankHolidays+holidays;
      const expected=Math.max(0,scheduled-allowance),worked=onSchedule+offSchedule;
      return {year:y.year,from:start,to:end,measured:true,share,scheduled,bankHolidays,holidays:round1(holidays),allowance:round1(allowance),expected:round1(expected),worked,onSchedule,offSchedule,balance:round1(worked-expected)};
    });
    const measured=perYear.filter(y=>y.measured);
    const total=key=>measured.reduce((n,y)=>n+y[key],0);
    return {id,name:person.displayName,schedule,leave,first,last,years:perYear,
      total:{measured:measured.length>0,from:measured[0]?.from||null,to:measured[measured.length-1]?.to||null,
        scheduled:total('scheduled'),bankHolidays:total('bankHolidays'),holidays:round1(total('holidays')),allowance:round1(total('allowance')),expected:round1(total('expected')),worked:total('worked'),
        onSchedule:total('onSchedule'),offSchedule:total('offSchedule'),balance:round1(total('worked')-total('expected'))}};
  });
  return {from,to,years,rows};
}
