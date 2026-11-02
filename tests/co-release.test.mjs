import test from 'node:test';
import assert from 'node:assert/strict';
import {coReleasePatterns, coReleaseEvidence} from '../assets/co-release.js';

const member=(id,commits=1,drove=false)=>({id,commits,drove});
const makeRelease=(tag,date,members,{baseline=false,lineageComplete=true,driver=null}={})=>({
  tag,hash:tag,date,members,baseline,lineageComplete,driver:{groupId:driver}
});
const index={groups:[{id:'a',displayName:'Ada'},{id:'b',displayName:'Ben'},
  {id:'c',displayName:'Chris'},{id:'d',displayName:'Dana'}],releases:[
  makeRelease('base','2024-11-01',[member('a'),member('b')],{baseline:true}),
  makeRelease('r1','2025-01-02',[member('a'),member('b')],{driver:'b'}),
  makeRelease('r2','2025-02-03',[member('a'),member('b'),member('c')],{driver:'d'}),
  makeRelease('r3','2025-03-04',[member('a'),member('c')]),
  makeRelease('r4','2025-04-05',[member('b'),member('c')]),
  makeRelease('r5','2025-05-06',[member('a'),member('b')],{lineageComplete:false}),
  makeRelease('r6','2025-06-07',[member('a'),member('d',0)],{driver:'d'}),
]};
const window={from:'2025-01-01',to:'2025-12-31'};

test('shared release counts and asymmetric conditional overlaps use complete incremental releases',()=>{
  const model=coReleasePatterns(index,'a',window);
  assert.equal(model.eligible,5);
  assert.equal(model.omitted,1);
  assert.equal(model.mine,4);
  const ben=model.partners.find(p=>p.id==='b');
  assert.equal(ben.shared,2);
  assert.equal(ben.theirs,3);
  assert.equal(ben.ofMine,0.5);
  assert.equal(ben.ofTheirs,2/3);
  assert.equal(ben.overlap,2/5);
  assert.equal(model.partners.find(p=>p.id==='d').shared,0,'driver-only does not count as authored participation');
  assert.deepEqual(coReleaseEvidence(index,'a','b',window).map(r=>r.tag),['r2','r1']);
  assert.equal(coReleaseEvidence(index,'a','b',window)[1].driverId,'b');
});

test('pair overlap is symmetric while conditional overlap follows the selected contributor',()=>{
  const a=coReleasePatterns(index,'a',window).partners.find(p=>p.id==='b');
  const b=coReleasePatterns(index,'b',window).partners.find(p=>p.id==='a');
  assert.equal(a.overlap,b.overlap);
  assert.equal(a.ofMine,b.ofTheirs);
  assert.equal(a.ofTheirs,b.ofMine);
  assert.equal(a.shared,b.shared);
});

test('an empty or baseline-only scope has undefined ratios, not artificial zeros',()=>{
  const zero=coReleasePatterns(index,'a',{from:'2024-10-01',to:'2024-12-31'});
  assert.equal(zero.eligible,0);
  assert.equal(zero.omitted,1);
  assert.equal(zero.mine,0);
  assert.equal(zero.partners.find(p=>p.id==='b').overlap,null);
  const isolated=coReleasePatterns(index,'d',window);
  assert.equal(isolated.mine,0);
  assert.equal(isolated.partners.find(p=>p.id==='a').ofMine,null);
  assert.deepEqual(coReleaseEvidence(index,'a','a',window),[]);
});

test('release-event date window is independent of when included commits were authored',()=>{
  const feb=coReleasePatterns(index,'a',{from:'2025-02-01',to:'2025-02-28'});
  assert.equal(feb.eligible,1);
  assert.equal(feb.partners.find(p=>p.id==='b').shared,1);
  assert.deepEqual(coReleaseEvidence(index,'a','b',{from:'2025-02-01',to:'2025-02-28'}).map(x=>x.tag),['r2']);
});


test('hundreds of release tags keep pair counts complete and the displayed evidence bounded',()=>{
  const releases=Array.from({length:428},(_,i)=>makeRelease(`v2.0.${i}`,
    new Date(Date.UTC(2025,0,1)+i*86400000).toISOString().slice(0,10),
    [member('a'),...(i%3===0?[member('b')]:[]),...(i%5===0?[member('c')]:[])]));
  const history={...index,releases};
  const through={from:'2025-01-01',to:'2027-01-01'};
  const model=coReleasePatterns(history,'a',through);
  assert.equal(model.mine,428);
  assert.equal(model.eligible,428);
  assert.equal(model.partners.find(x=>x.id==='b').shared,143);
  assert.equal(coReleaseEvidence(history,'a','b',through).length,143);
});
