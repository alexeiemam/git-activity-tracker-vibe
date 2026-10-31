import test from 'node:test';
import assert from 'node:assert/strict';
import { impactTimelineExtent,impactTimelineWindow,impactTimelineZoom,impactTimelineReveal,impactTimelineCustomRange,impactTimelinePan,impactTimelineDates } from '../assets/impact-window.js';
import { impactTimeline } from '../assets/impact-view.js';

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
  assert.match(noTags,/impact-timeline-pan/);
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
