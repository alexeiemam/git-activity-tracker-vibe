import test from 'node:test';
import assert from 'node:assert/strict';
import {primaryDefaults,restorePrimaryState,primaryStateForExport} from '../assets/perspective-state.js';

const groups=[{displayName:'Lin',emails:['lin@example.test','lin@personal.test']},
  {displayName:'Ada',emails:['ada@example.test']},
  {displayName:'Ben',emails:['ben@example.test']}];

test('restored navigation retains non-null dates, release, contributor and comparison',()=>{
  const saved={...primaryDefaults(),mode:'contributors',releaseHash:'f'.repeat(40),releasePage:12,
    periodFrom:'2025-01-01',periodTo:'2025-04-30',periodComparison:'year',periodPreset:'custom',
    contributorFocus:'1',compareB:'0',compareC:'2',periodSelectedId:'1',codeArea:'app/',
    contributorTab:'compare',contributorRange:'period',trail:[{mode:'periods',periodFrom:'2025-01-01',periodTo:'2025-01-14'}]};
  const exported=primaryStateForExport(saved,groups);
  const reloaded=restorePrimaryState({primary:exported},groups);
  for(const key of ['mode','releaseHash','releasePage','periodFrom','periodTo','periodComparison','periodPreset','contributorFocus',
    'compareB','compareC','periodSelectedId','codeArea','contributorTab','contributorRange'])assert.equal(reloaded[key],saved[key],key);
  assert.equal(reloaded.trail[0].periodFrom,'2025-01-01');
});

test('saved identity handles survive reordered merged contributor groups',()=>{
  const saved=primaryStateForExport({...primaryDefaults(),contributorFocus:'0',compareB:'1',periodSelectedId:'0'},groups);
  const newOrder=[groups[1],groups[2],groups[0]];
  const restored=restorePrimaryState({primary:saved},newOrder);
  assert.equal(restored.contributorFocus,'2');
  assert.equal(restored.compareB,'0');
  assert.equal(restored.periodSelectedId,'2');
});

test('malformed session controls cannot inject state, damage navigation or request runaway pages',()=>{
  const restored=restorePrimaryState({primary:{mode:'evil',releasePage:Infinity,releaseType:'other',periodComparison:'broken',
    periodFrom:'2020-08-99<script>',periodTo:'2090-01-01',contributorTab:'other',trail:[{mode:'evil'},{mode:'periods',periodFrom:'2025-01-01'}]}},groups);
  assert.equal(restored.mode,'observatory');
  assert.equal(restored.releasePage,0);
  assert.equal(restored.releaseType,'all');
  assert.equal(restored.periodComparison,'previous');
  assert.equal(restored.periodFrom,null);
  assert.equal(restored.contributorTab,'delivery');
  assert.equal(restored.trail.length,1);
  assert.equal(restorePrimaryState({},groups).mode,'observatory');
});

test('cohort selection and investigation trail survive session restoration',()=>{
 const p={...primaryDefaults(),cohortBy:'driver',releaseHash:'abcdef',releasePage:5,
   trail:[{...primaryDefaults(),mode:'periods',periodFrom:'2025-02-01',periodTo:'2025-02-14'}]};
 const loaded=restorePrimaryState({primary:primaryStateForExport(p,groups)},groups);
 assert.equal(loaded.cohortBy,'driver');
 assert.equal(loaded.releaseHash,'abcdef');
 assert.equal(loaded.trail[0].periodTo,'2025-02-14');
});


test('co-release sorting, selected partner, and reconciled identity survive session restore',()=>{
  const source={...primaryDefaults(),contributorFocus:'0',coReleasePartner:'1',contributorTab:'together',coReleaseSort:'overlap'};
  const exported=primaryStateForExport(source,groups);
  const restored=restorePrimaryState({primary:exported},[groups[1],groups[2],groups[0]]);
  assert.equal(restored.contributorFocus,'2');
  assert.equal(restored.coReleasePartner,'0');
  assert.equal(restored.contributorTab,'together');
  assert.equal(restored.coReleaseSort,'overlap');
  assert.equal(restorePrimaryState({primary:{coReleaseSort:'random',contributorTab:'evil'}},groups).coReleaseSort,'shared');
});
