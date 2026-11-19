import test from 'node:test';
import assert from 'node:assert/strict';
import {codebaseSignals} from '../assets/perspectives.js';

let serial=0;
const commit=(groupId,date,...paths)=>({hash:`c${serial++}`,groupId,date,files:paths.map(path=>({path,added:1,deleted:0}))});
const many=(n,make)=>Array.from({length:n},(_,i)=>make(i));
const window={from:'2026-01-01',to:'2026-04-30'};

test('knowledge concentration flags areas where one person made most changes, with enough changes to mean it',()=>{
  const commits=[
    ...many(18,i=>commit('ada',`2026-01-${String(1+i).padStart(2,'0')}`,'app/billing/a.rb')),
    ...many(2,i=>commit('ben',`2026-02-0${1+i}`,'app/billing/b.rb')),
    ...many(10,i=>commit('ada','2026-03-01','lib/tools/x.rb')),
    ...many(12,i=>commit(i%2?'ada':'ben','2026-03-02','app/models/m.rb')),
  ];
  const s=codebaseSignals(commits,window);
  assert.deepEqual(s.concentrated.map(r=>r.area),['app/billing/'],'90% by one person over 20 changes');
  const billing=s.areas.find(r=>r.area==='app/billing/');
  assert.equal(billing.top,'ada');
  assert.equal(billing.topShare,.9);
  assert.equal(billing.half,1,'one person covers half the changes');
  assert.equal(s.areas.find(r=>r.area==='app/models/').half,1);
  assert.ok(!s.concentrated.some(r=>r.area==='lib/tools/'),'10 changes are too few to call it concentrated');
  assert.equal(s.substantial,1,'only app/billing/ has the 20 changes needed to be judged');
});

test('churn compares the first and second half of the dates, ignoring small numbers',()=>{
  const commits=[
    ...many(4,i=>commit('ada','2026-01-10','app/old/a.rb')),...many(16,i=>commit('ada','2026-04-10','app/old/a.rb')),
    ...many(14,i=>commit('ada','2026-01-12','app/legacy/a.rb')),...many(2,i=>commit('ada','2026-04-12','app/legacy/a.rb')),
    ...many(3,i=>commit('ada','2026-04-12','app/tiny/a.rb')),
  ];
  const s=codebaseSignals(commits,window);
  assert.deepEqual(s.rising.map(r=>r.area),['app/old/']);
  assert.deepEqual(s.fading.map(r=>r.area),['app/legacy/']);
  assert.equal(s.granularity,'week','a four-month span is shown weekly');
  const old=s.areas.find(r=>r.area==='app/old/');
  assert.equal(old.series.reduce((a,b)=>a+b,0),20,'the sparkline holds every change');
});

test('changed together scores pairs by overlap and ignores sweeping commits',()=>{
  const commits=[
    ...many(6,()=>commit('ada','2026-02-01','app/models/a.rb','spec/models/a_spec.rb')),
    ...many(4,()=>commit('ada','2026-02-02','app/models/b.rb')),
    ...many(2,()=>commit('ada','2026-02-03','app/views/v.erb','spec/models/b_spec.rb')),
    commit('ada','2026-02-04',...many(13,i=>`area${i}/x/y.rb`)),
  ];
  const s=codebaseSignals(commits,window);
  assert.equal(s.coupled.length,1,'pairs need three shared commits; the 13-area sweep is ignored');
  const [pair]=s.coupled;
  assert.deepEqual([pair.a,pair.b,pair.shared],['app/models/','spec/models/',6]);
  assert.equal(pair.ofA,.6,'6 of app/models/\'s 10 commits');
  assert.equal(pair.ofB,.75,'6 of spec/models/\'s 8 commits');
  assert.equal(pair.overlap,.5,'6 shared of 12 commits touching either');
});

test('coupled pairs rank by overlap weighted by how often they change together',()=>{
  const commits=[
    ...many(40,()=>commit('ada','2026-02-01','app/core/a.rb','spec/core/a_spec.rb')),
    ...many(40,()=>commit('ada','2026-02-01','app/core/b.rb')),
    ...many(3,()=>commit('ada','2026-02-02','docs/x/a.md','docs/y/b.md')),
  ];
  const [first,second]=codebaseSignals(commits,window).coupled;
  assert.deepEqual([first.a,second.a],['app/core/','docs/x/'],'50% of 80 commits outranks 100% of 3');
  assert.equal(second.overlap,1);
});
