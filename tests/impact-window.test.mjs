import test from 'node:test';
import assert from 'node:assert/strict';
import { impactTimelineZoomWindow,impactTimelineShiftWindow,impactTimelineCentreWindow,impactTimelinePreferenceFor,impactTimelineExtent,impactTimelineWindow,impactTimelineZoom,impactTimelineReveal,impactTimelineCustomRange,impactTimelinePan,impactTimelineDates } from '../assets/impact-window.js';
import { impactTimeline, dodgeReleases } from '../assets/impact-view.js';
import { impactReleasePosition } from '../assets/impact-window.js';
import { parseGitHistory } from '../assets/domain.js';

const DAY=86400000;
const at=date=>Date.parse(`${date}T12:00:00Z`);
const model=(count=30)=>{
  const releases=Array.from({length:count},(_,i)=>{
    const date=`${2022+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}-10`;
    return {hash:`release-${i}`,tag:`v2.${i}.0`,date,timestamp:at(date),transition:'minor',metricValue:i+1,selectedFootprint:{pathsCount:1}};
  });
  return {metric:'commits',releases,activityMonths:[{month:'2021-03',count:1},{month:'2025-07',count:1}],
    activityDays:[{date:'2021-03-01',count:1,version:0},{date:'2025-07-15',count:1,version:0}],versionEvents:[]};
};

test('all-release default fits the full time domain, whereas latest 18 genuinely focuses on last 18 tag dates',()=>{
  const m=model();
  const all=impactTimelineWindow(m),latest=impactTimelineWindow(m,{mode:'latest'});
  assert.equal(all.mode,'all');
  assert.ok(all.start<at('2021-03-01'));
  assert.ok(all.end>at('2025-07-15'),'all includes authored evidence after the last tag');
  assert.ok(latest.start>at('2022-11-01'),'latest excludes years of earlier authored activity');
  assert.ok(latest.start<m.releases[12].timestamp && latest.end>m.releases.at(-1).timestamp);
  assert.ok(latest.end-latest.start<all.end-all.start);
  const allMarkup=impactTimeline(m,m.releases[22].hash);
  const latestMarkup=impactTimeline(m,m.releases[22].hash,{mode:'latest'});
  assert.equal((allMarkup.match(/data-impact-hash=/g)||[]).length,30);
  assert.equal((latestMarkup.match(/data-impact-hash=/g)||[]).length,18);
  assert.match(allMarkup,/All releases<\/button>/);
  assert.match(latestMarkup,/18 of 30 releases/);
  assert.match(allMarkup,/width="100%"/,'all releases fit the available chart width');
});

test('timeline zoom and pan preserve a date window independently of global evidence',()=>{
  const m=model();
  const original=impactTimelineWindow(m),zoom=impactTimelineZoom(m,{mode:'all'},0.5,m.releases[20].timestamp);
  const zoomed=impactTimelineWindow(m,zoom);
  assert.equal(zoom.mode,'custom');
  assert.ok(zoomed.end-zoomed.start < original.end-original.start);
  assert.ok(m.releases[20].timestamp>=zoomed.start && m.releases[20].timestamp<=zoomed.end);
  const panned=impactTimelinePan(m,zoom,1000),pannedWindow=impactTimelineWindow(m,panned);
  assert.ok(pannedWindow.start>zoomed.start);
  assert.ok(pannedWindow.end<=impactTimelineExtent(m).end);
  const out=impactTimelineZoom(m,zoom,10);
  assert.equal(out.mode,'all','zooming fully out resets rather than inventing a wider domain');
});

test('choosing an older release automatically pans to it while preserving the prior zoom scale',()=>{
  const m=model();
  const recent={mode:'latest'};
  const older=m.releases[1];
  const revealed=impactTimelineReveal(m,recent,older.hash);
  assert.equal(revealed.mode,'custom');
  const viewport=impactTimelineWindow(m,revealed);
  assert.ok(viewport.start<=older.timestamp&&viewport.end>=older.timestamp);
  const latest=impactTimelineWindow(m,recent);
  assert.ok(Math.abs((viewport.end-viewport.start)-(latest.end-latest.start))<2*DAY);
  const markup=impactTimeline(m,older.hash,revealed);
  assert.match(markup,new RegExp(`data-impact-hash="${older.hash}"`));
  assert.match(markup,/Selected · v2.1.0/);
  assert.match(markup,/aria-current="true"/);
  assert.deepEqual(impactTimelineReveal(m,revealed,older.hash),revealed);
});

test('custom dates validate, expose no fake zeros, and honour exact authored-day buckets',()=>{
  const m=model();
  m.activityDays.push({date:'2023-03-04',count:4,version:1},{date:'2023-03-29',count:99,version:0});
  const options=impactTimelineCustomRange(m,'2023-03-01','2023-03-08');
  assert.deepEqual(options,{mode:'custom',from:'2023-03-01',to:'2023-03-08'});
  const output=impactTimeline(m,m.releases[20].hash,options);
  assert.match(output,/4 authored commits/);
  assert.doesNotMatch(output,/99 authored commits/,'partial-month zoom must not include outside activity');
  assert.equal(impactTimelineCustomRange(m,'2023-03-09','2023-03-04'),null);
  assert.equal(impactTimelineCustomRange(m,'2023-02-29','2023-03-04'),null);
  assert.ok(impactTimelineDates(impactTimelineWindow(m,options)).to==='2023-03-08');
  const noTags=impactTimeline(m,m.releases[20].hash,{mode:'custom',from:'2023-03-04',to:'2023-03-06'});
  assert.match(noTags,/No release tags fall within this timeline range/);
  assert.match(noTags,/data-timeline-brush/,'the history brush still lets you pan to tags');
});

test('viewport works for a single tagged release and truncated history',()=>{
  const m=model(1);
  const all=impactTimelineWindow(m);
  const latest=impactTimelineWindow(m,{mode:'latest'});
  assert.ok(all.end>all.start && latest.end>latest.start);
  assert.match(impactTimeline(m,m.releases[0].hash),/Selected/);
  assert.equal(impactTimelineWindow({releases:[],activityMonths:[]}),null);
});

test('tag date selection uses the recorded tag local date, even when its UTC instant is a different day',()=>{
  const m=model(1);
  m.releases[0].date='2026-01-01';
  m.releases[0].timestamp=Date.parse('2025-12-31T23:30:00Z');
  const range=impactTimelineCustomRange(m,'2026-01-01','2026-01-01');
  assert.ok(range);
  const visible=impactTimeline(m,m.releases[0].hash,range);
  assert.match(visible,/data-impact-hash="release-0"/);
  assert.match(visible,/aria-current="true"/);
});

test('exact windows zoom around a pointer, shift, centre and save as dates, always inside history',()=>{
  const m=model(),extent=impactTimelineExtent(m),all=impactTimelineWindow(m);
  const anchor=m.releases[10].timestamp;
  const zoomed=impactTimelineZoomWindow(m,all,.5,anchor);
  assert.ok(Math.abs((zoomed.end-zoomed.start)-(all.end-all.start)/2)<1,'half the span');
  const before=(anchor-all.start)/(all.end-all.start),after=(anchor-zoomed.start)/(zoomed.end-zoomed.start);
  assert.ok(Math.abs(before-after)<1e-9,'the time under the pointer stays under the pointer');
  const day=impactTimelineZoomWindow(m,zoomed,1e-9,anchor);
  assert.equal(day.end-day.start,86400000,'zoom stops at one day');
  const shifted=impactTimelineShiftWindow(m,zoomed,-1e13);
  assert.equal(shifted.start,extent.start,'panning stops at the start of history');
  assert.equal(shifted.end-shifted.start,zoomed.end-zoomed.start,'and keeps the zoom');
  const centred=impactTimelineCentreWindow(m,zoomed,anchor);
  assert.ok(Math.abs((centred.start+centred.end)/2-anchor)<1||centred.start===extent.start||centred.end===extent.end);
  assert.deepEqual(impactTimelinePreferenceFor(m,all),{mode:'all'});
  const saved=impactTimelinePreferenceFor(m,zoomed);
  assert.equal(saved.mode,'custom');
  assert.match(saved.from,/^\d{4}-\d{2}-\d{2}$/);
  const exact=impactTimelineWindow(m,{mode:'custom',start:zoomed.start,end:zoomed.end});
  assert.deepEqual([exact.start,exact.end],[zoomed.start,zoomed.end],'an exact window is shown as given');
});

test('releases sit at their time of day, so same-day releases spread out in order',()=>{
  const midnight=Date.parse('2026-03-12T00:00:00Z');
  const morning=impactReleasePosition({date:'2026-03-12',clock:9*3600000});
  const evening=impactReleasePosition({date:'2026-03-12',clock:17.5*3600000});
  assert.equal(morning,midnight+9*3600000);
  assert.ok(evening-morning===8.5*3600000,'eight and a half hours apart, not stacked');
  assert.equal(impactReleasePosition({date:'2026-03-12'}),midnight+DAY/2,'no known time: midday');
  assert.equal(impactReleasePosition({date:'2026-03-12',clock:DAY}),midnight+DAY/2,'an impossible time is ignored');
  const {tags}=parseGitHistory(`TAG|v2||${'c'.repeat(40)}|commit|2026-03-12T23:40:05+01:00\nCOMMIT|${'c'.repeat(40)}|a@x|A|2026-03-12T10:00:00Z|2026-03-12T10:00:00Z|feat: x|`);
  assert.equal(tags[0].taggedDate,'2026-03-12','the tagger\'s own date');
  assert.equal(tags[0].taggedClock,(23*3600+40*60+5)*1000,'and their own clock, not UTC');
});

test('overlapping release dots move right just enough, keep their height, and only when zoomed in',()=>{
  const rows=[{hash:'a',x:100,y:50},{hash:'b',x:103,y:50},{hash:'c',x:104,y:90},{hash:'d',x:300,y:50}];
  const layout=dodgeReleases(rows,r=>r.x,r=>r.y,1000);
  assert.deepEqual(layout.get('a'),{at:100,cx:100,cy:50});
  assert.equal(layout.get('b').cx,113,'cleared by one dot width');
  assert.equal(layout.get('b').at,103,'its stem still starts at its true time');
  assert.equal(layout.get('b').cy,50,'height is the measure and never moves');
  assert.equal(layout.get('c').cx,104,'a dot well above needs no move');
  assert.equal(layout.get('d').cx,300);
  const crowd=Array.from({length:8},(_,i)=>({hash:String(i),x:100,y:50}));
  assert.ok(dodgeReleases(crowd,r=>r.x,r=>r.y,1000).get('7').cx<=100+39,'never more than three dot widths');
  assert.equal(dodgeReleases(rows,r=>r.x,r=>r.y,1000,false).get('b').cx,103,'zoomed out: true time only');
});
