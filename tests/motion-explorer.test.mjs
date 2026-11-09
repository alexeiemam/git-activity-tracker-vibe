import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayNumber,dateAtDay} from '../assets/domain.js';
import {
  motionWindows,buildMotionScenes,motionRegion,motionDomain,motionPlotPosition,
  MOTION_WINDOWS,MOTION_STEPS,MOTION_MODES,DEFAULT_MOTION_VIEWS
} from '../assets/motion-explorer.js';
import {renderMotionExplorer,renderMotionPlot,renderMotionInspector,motionMovement,bindMotionExplorer} from '../assets/motion-view.js';

const start='2026-03-02'; // Monday
const end=dateAtDay(dayNumber(start)+7*22-1); // Sunday
const dates=Array.from({length:22},(_,w)=>Array.from({length:7},(_,d)=>dateAtDay(dayNumber(start)+w*7+d)));
const people=[
  {id:'0',displayName:'Aster',workingDays:[1,2,3,4]},
  {id:'1',displayName:'Birch',workingDays:[1,2,3,4,5]},
  {id:'2',displayName:'Cedar',workingDays:[]}
];
const commit=(date,id,lines)=>({date,groupId:id,files:[{path:'app/service.rb',added:lines,deleted:0}]});
function source() {
  const activity=[],releases=[];
  for(let w=0;w<22;w++){
    // Aster: sustained meaningful authorship; Birch: one light day per week.
    for(const day of [0,1,2,3])activity.push(commit(dates[w][day],'0',80+w*2));
    activity.push(commit(dates[w][0],'1',w%2===0?30:3));
    if(w%3===1) releases.push({tag:`v${w}`,date:dates[w][6],lineageComplete:true,
      members:[{id:'0',commits:3,releaseLineChurn:450+w*10}]});
    if(w%5===2)releases.push({tag:`x${w}`,date:dates[w][5],lineageComplete:true,
      members:[{id:'1',commits:1,releaseLineChurn:12}]});
  }
  return {bounds:{min:start,max:end},activity,releases};
}
const opts={weeks:8,step:1,temporal:{period:90,churnCap:50,meaningfulLines:20},meaningfulLines:20,
  workingDaysById:{'0':[1,2,3,4],'1':[1,2,3,4,5],'2':[]},continuityWeeks:20,
  gapHorizon:60,busyDay:4,releaseLines:200,dailyChurn:200,momentumWorkdays:10,levelWorkdays:10};

function scenes(mode,alter={}) {return buildMotionScenes(source(),people,{from:start,to:end},mode,{...opts,...alter});}

test('playback uses only complete calendar weeks, honors step, and includes last complete window',()=>{
  const windows=motionWindows({from:start,to:end},{weeks:8,step:4});
  assert.equal(windows[0].from,start);
  assert.equal(windows[0].to,dates[7][6]);
  assert.equal(windows.at(-1).to,end,'latest complete week is not silently skipped by step');
  assert.equal(dayNumber(windows.at(-1).to)-dayNumber(windows.at(-1).from)+1,56);
  const partial=motionWindows({from:dates[0][2],to:dates[8][2]},{weeks:8,step:1});
  assert.deepEqual(partial,[], 'partial edge weeks cannot masquerade as eight complete weeks');
  assert.deepEqual(motionWindows({from:start,to:end},{weeks:9,step:1}),[]);
  const insufficient=buildMotionScenes(source(),people,{from:start,to:dates[3][6]},'contribution',opts);
  assert.equal(insufficient.frames.length,0);
  assert.match(renderMotionExplorer(insufficient),/data-motion-empty-window/);
  assert.deepEqual([...MOTION_WINDOWS],[4,8,12,20]);
  assert.deepEqual([...MOTION_STEPS],[1,2,4]);
});

test('six spatial lenses plus velocity strip have grounded data, fixed plot domains and independent metrics',()=>{
  const index=source(),range={from:start,to:end};
  for(const mode of MOTION_MODES){
    const item=buildMotionScenes(index,people,range,mode,opts);
    assert.equal(item.frames.length,15,`${mode} frame count`);
    assert.equal(item.frames.at(-1).to,end);
    assert.equal(item.frames[0].from,start);
    assert.ok(item.frames[0].people.some(p=>p.x!==null&&p.y!==null),`${mode} should have plotted evidence`);
    assert.ok(item.frames.every(f=>f.people.length===3));
    assert.deepEqual(motionDomain(item.frames,item.mode),item.domain);
    for(const frame of item.frames)for(const p of frame.people){
      const pos=motionPlotPosition(p,item.mode,item.domain);
      if(p.x===null)assert.equal(pos,null);
      else assert.ok(pos.x>=0&&pos.x<=1&&pos.y>=0&&pos.y<=1,`${mode} ${p.name}`);
    }
    assert.strictEqual(buildMotionScenes(index,people,range,mode,opts),item,'same data and settings reuse the cached scene');
  }
  const strip=buildMotionScenes(index,people,range,'level',{...opts,levelDisplay:'strip'});
  assert.equal(strip.mode,'level-strip');
  assert.ok(strip.frames.at(-1).people[0].x>strip.frames.at(-1).people[1].x);
  assert.equal(strip.frames[0].people[0].lane,0);
});

test('contribution and authored maps show sustained activity apart from sparse authored changes',()=>{
  const contribution=scenes('contribution');
  const final=contribution.frames.at(-1).people;
  assert.ok(final[0].x>final[1].x);
  assert.ok(final[0].y>final[1].y);
  assert.equal(final[2].x,null,'zero-day reference must not invent schedule-attainment coordinates');
  const activity=scenes('activity').frames.at(-1).people;
  assert.ok(activity[0].x>activity[1].x);
  assert.ok(activity[0].y>activity[1].y);
  assert.equal(activity[2].y,0,'covered quiet dates are known zero in the unscheduled authored-only map');
});

test('delivery uses release-event opportunities, not authored date or release publisher credit',()=>{
  const model=scenes('delivery');
  const first=model.frames[0],last=model.frames.at(-1);
  assert.ok(first.people[0].x>0);
  assert.ok(last.people[0].y>last.people[1].y);
  assert.equal(last.people[2].x,0,'no release inclusion is an observed zero when eligible tags exist');
  const noTag={...source(),releases:[]};
  const missing=buildMotionScenes(noTag,people,{from:start,to:end},'delivery',opts);
  assert.equal(missing.frames[0].people[0].x,null,'no release opportunities must not be reported as zero participation');
  const partial={...source(),releases:[{tag:'unverified',date:dates[4][6],lineageComplete:false,members:[{id:'0',commits:2,releaseLineChurn:5000}]}]};
  const unavailable=buildMotionScenes(partial,people,{from:start,to:end},'delivery',opts);
  assert.equal(unavailable.frames[0].people[0].x,null,'incomplete ancestry is excluded from denominator');
});

test('release-gap motion preserves uncredited unknowns and differentiates activity support',()=>{
  const frame=scenes('release-gap').frames.at(-1);
  const a=frame.people[0],b=frame.people[1];
  assert.ok(a.y>b.y,'sustained authorship supplies more average support');
  assert.equal(frame.people[2].x,null,'no authored release involvement means unknown gap, not maximum');
  assert.ok(b.x>=0&&b.x<=1,'a tiny, nonzero release contribution earns partial credit');
  assert.ok(a.x>=0&&a.x<=1);
});

test('momentum can be flat at a consistently high absolute level, without merging the axes',()=>{
  const frame=scenes('momentum').frames.at(-1);
  assert.ok(frame.people[0].x>frame.people[1].x);
  assert.ok(Number.isFinite(frame.people[0].y));
  assert.ok(Number.isFinite(frame.people[1].y));
  assert.equal(motionRegion('momentum',1.3,-20),'Higher level / cooling');
  assert.equal(motionRegion('momentum',1.3,20),'Higher level / building');
});

test('timeline movement exposes net change and variation without comparing against peers',()=>{
  const model=scenes('delivery');
  const info=motionMovement(model,'0',model.frames.length-1);
  assert.ok(info.comparablePoints>=2);
  assert.ok(Number.isFinite(info.variation));
  assert.ok(info.label.includes('Eligible releases'));
  assert.equal(motionMovement(model,'99',0).comparablePoints,undefined);
});

test('rendering escapes identities, exposes scrubber, legend, evidence and no misleading winners',()=>{
  const model=scenes('delivery');
  model.frames.forEach(f=>{f.people[0].name='Aster <script>alert(1)</script>';});
  const html=renderMotionExplorer(model,{trail:'short',labels:'hover'});
  assert.match(html,/data-motion-explorer/);
  assert.match(html,/data-motion-scrub/);
  assert.match(html,/data-motion-command="play"/);
  assert.match(html,/data-motion-setting="weeks"/);
  assert.match(html,/data-motion-person="0"/);
  assert.match(html,/Aster &lt;script&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html,/gold star|winner badge/i);
  assert.match(renderMotionInspector(model,model.frames.length-1,'0'),/Movement since first comparable window/);
  assert.match(renderMotionPlot(model,model.frames.length-1,{trail:'full',labels:'all'}),/polyline/);
  assert.equal(typeof bindMotionExplorer,'function');
});

test('UI includes shared motion controls in all six modes, with session migration and playback cleanup',()=>{
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.deepEqual({...DEFAULT_MOTION_VIEWS},{delivery:'motion',contribution:'motion',activity:'cells','release-gap':'cells',momentum:'cells',level:'cells'});
  assert.match(app,/buildMotionScenes\(perspectiveIndex/);
  assert.match(app,/bindMotionExplorer\(container/);
  assert.match(app,/if\(stopMotionExplorer\)\{stopMotionExplorer\(\);stopMotionExplorer=null;\}/);
  assert.match(app,/motionViews:state\.motionViews/);
  assert.match(app,/state\.motionViews\[lens\]=s\.motionViews\[lens\]/);
  assert.match(html,/id="pulse-motion-selector"/);
  assert.match(html,/data-motion-view="motion"/);
});
