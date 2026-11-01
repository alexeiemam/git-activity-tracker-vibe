/** Pure, date-based viewport rules for the Impact timeline. Never changes Git evidence. */
const DAY = 86400000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = date => {
  if (typeof date !== 'string' || !ISO_DATE.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0,10) === date ? value : null;
};
// Release positions use their recorded event calendar date (GitHub publication
// when present, otherwise the tag/date fallback), not an inferred UTC day.
export const impactReleasePosition = release => {
  const localDay = dayStart(release.date);
  return localDay===null ? (Number.isFinite(release.timestamp)?release.timestamp:null) : localDay + DAY/2;
};
const dateOf = time => new Date(time).toISOString().slice(0,10);
const clamp = (value, min, max) => Math.min(Math.max(value,min),max);

export function impactTimelineExtent(model) {
  const releaseDates = model.releases.map(impactReleasePosition).filter(t=>t!==null);
  const months = (model.activityMonths || []).flatMap(m=>{
    const start = dayStart(`${m.month}-01`);
    return start===null?[]:[start,Date.UTC(Number(m.month.slice(0,4)),Number(m.month.slice(5,7)),1)];
  });
  const times = [...releaseDates,...months];
  if (!times.length) return null;
  const start = Math.min(...times);
  const end = Math.max(...times);
  // A one-tag import still needs a usable, zoomable time axis.
  return {start: start - 2*DAY, end: Math.max(end+2*DAY,start+2*DAY)};
}

function keepWithin(extent, start, end) {
  const span = Math.max(DAY,end-start);
  const total = extent.end-extent.start;
  if (span>=total) return {start:extent.start,end:extent.end};
  const first = clamp(start,extent.start,extent.end-span);
  return {start:first,end:first+span};
}

export function impactTimelineWindow(model, options={}) {
  const extent=impactTimelineExtent(model);
  if(!extent) return null;
  const mode=options.mode || 'all';
  if(mode==='latest') {
    const recent=model.releases.slice(-18);
    if(!recent.length) return {...extent,mode:'all'};
    const first=impactReleasePosition(recent[0]),last=impactReleasePosition(recent.at(-1));
    const pad=Math.max(7*DAY,(last-first)*.035);
    const bounds=keepWithin(extent,first-pad,last+pad);
    return {...bounds,mode:'latest'};
  }
  if(mode==='custom') {
    const from=dayStart(options.from),to=dayStart(options.to);
    if(from!==null&&to!==null&&from<=to) {
      const bounds=keepWithin(extent,from,to+DAY);
      return {...bounds,mode:'custom'};
    }
  }
  return {...extent,mode:'all'};
}

export function impactTimelineZoom(model, options={}, factor=1, anchor=null) {
  const current=impactTimelineWindow(model,options),extent=impactTimelineExtent(model);
  if(!current||!extent) return {mode:'all'};
  const total=extent.end-extent.start;
  const span=clamp(Math.round((current.end-current.start)*factor),DAY,total);
  if(span>=total) return {mode:'all'};
  const midpoint=(current.start+current.end)/2;
  const pivot=Number.isFinite(anchor) && anchor>=current.start && anchor<=current.end ? anchor : midpoint;
  const proportion=(pivot-current.start)/(current.end-current.start);
  const bounds=keepWithin(extent,pivot-span*proportion,pivot+span*(1-proportion));
  return {mode:'custom',from:dateOf(bounds.start),to:dateOf(bounds.end-1)};
}

export function impactTimelineReveal(model, options, hash) {
  const selected=model.releases.find(r=>r.hash===hash);
  const current=impactTimelineWindow(model,options),extent=impactTimelineExtent(model);
  if(!selected||!current||!extent) return options;
  const event=impactReleasePosition(selected);
  if(event>=current.start && event<=current.end) return options;
  const span=current.end-current.start;
  const bounds=keepWithin(extent,event-span/2,event+span/2);
  return {mode:'custom',from:dateOf(bounds.start),to:dateOf(bounds.end-1)};
}

export function impactTimelineCustomRange(model, from, to) {
  const extent=impactTimelineExtent(model);
  const start=dayStart(from),end=dayStart(to);
  if(!extent||start===null||end===null||start>end) return null;
  if(end+DAY<extent.start||start>extent.end) return null;
  const bounds=keepWithin(extent,start,end+DAY);
  return {mode:'custom',from:dateOf(bounds.start),to:dateOf(bounds.end-1)};
}

export function impactTimelineDates(window) {
  return window?{from:dateOf(window.start),to:dateOf(window.end-1)}:null;
}

export function impactTimelinePan(model, options, progress) {
  const window=impactTimelineWindow(model,options),extent=impactTimelineExtent(model);
  if(!window||!extent) return {mode:'all'};
  const span=window.end-window.start,available=extent.end-extent.start-span;
  if(available<=0) return {mode:'all'};
  const start=extent.start+available*clamp(Number(progress)/1000||0,0,1);
  return {mode:'custom',from:dateOf(start),to:dateOf(start+span-1)};
}
