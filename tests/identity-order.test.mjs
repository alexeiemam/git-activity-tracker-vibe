import test from 'node:test';
import assert from 'node:assert/strict';
import {reorderContributors,reorderLinkedIdentity,rebaseContributorId,contributorColourIndex,contributorKey} from '../assets/identity-order.js';
import {buildAnalysis} from '../assets/domain.js';
import {primaryStateForExport,restorePrimaryState} from '../assets/perspective-state.js';

const groups = [
  {displayName:'A',emails:['a@example.test','a2@example.test']},
  {displayName:'B',emails:['github:b','heroku:b@example.test']},
  {displayName:'C',emails:['c@example.test']},
];
const commit = (hash,email,date) => ({hash,email,date,name:email,files:[],isMerge:false,isRevert:false});

test('moving contributor cards preserves each reconciled identity and changes only display order',()=>{
  const next=reorderContributors(groups,0,2);
  assert.deepEqual(next.map(g=>g.displayName),['B','C','A']);
  assert.deepEqual(next[2].emails,groups[0].emails);
  assert.deepEqual(groups.map(g=>g.displayName),['A','B','C']);
  assert.equal(reorderContributors(groups,0,0),groups);
  assert.equal(reorderContributors(groups,-1,2),groups);
  assert.equal(reorderContributors(groups,1,30),groups);
  const original=buildAnalysis([commit('a','a@example.test','2026-10-01'),commit('b','c@example.test','2026-10-02')],groups);
  const moved=buildAnalysis([commit('a','a@example.test','2026-10-01'),commit('b','c@example.test','2026-10-02')],next);
  assert.deepEqual(Object.fromEntries(original.allContributors.map(g=>[g.displayName,g.totals.commits])),
    Object.fromEntries(moved.allContributors.map(g=>[g.displayName,g.totals.commits])));
  assert.equal(rebaseContributorId('0',groups,next),'2');
  assert.equal(rebaseContributorId('2',groups,next),'1');
  assert.equal(rebaseContributorId('selection',groups,next),'selection');
  assert.equal(rebaseContributorId(null,groups,next),null);
});

test('linked-identity order is adjustable without changing membership, analytics or colour',()=>{
  const next=reorderLinkedIdentity(groups,1,1,0);
  assert.deepEqual(next[1].emails,['heroku:b@example.test','github:b']);
  assert.deepEqual(groups[1].emails,['github:b','heroku:b@example.test']);
  assert.equal(contributorKey(next[1]),contributorKey(groups[1]));
  assert.equal(contributorColourIndex(next[1],12),contributorColourIndex(groups[1],12));
  assert.equal(reorderLinkedIdentity(groups,1,0,0),groups);
  assert.equal(reorderLinkedIdentity(groups,1,-1,0),groups);
  assert.equal(reorderLinkedIdentity(groups,42,0,1),groups);
});

test('manual order survives exported session groups and contributor focus resolves by email',()=>{
  const reordered=reorderContributors(groups,0,2);
  const ui={mode:'contributors',contributorFocus:'2',compareB:'0',compareC:'1',coReleasePartner:'0',trail:[]};
  const scope={primary:primaryStateForExport(ui,reordered)};
  const roundTrip=JSON.parse(JSON.stringify({mergeGroups:reordered,scope}));
  assert.deepEqual(roundTrip.mergeGroups.map(g=>g.displayName),['B','C','A']);
  const restored=restorePrimaryState(roundTrip.scope,roundTrip.mergeGroups);
  assert.equal(restored.contributorFocus,'2');
  assert.equal(restored.compareB,'0');
  assert.equal(restored.compareC,'1');
  assert.equal(contributorColourIndex(reordered[2],12),contributorColourIndex(groups[0],12));
});

test('provider reconciliation and session restoration preserve a manually arranged contributor list',async()=>{
  const {reconcileProviderGroups,externalIdentities}=await import('../assets/external-identities.js');
  const order=reorderContributors(groups,0,2);
  const restored=reconcileProviderGroups(order,externalIdentities([],[]),[],[]);
  assert.deepEqual(restored,order);
  assert.deepEqual(restored.map(g=>g.displayName),['B','C','A']);
  const withoutLinks=reorderLinkedIdentity(restored,0,1,0);
  assert.deepEqual(withoutLinks[0].emails,['heroku:b@example.test','github:b']);
  assert.deepEqual(new Set(withoutLinks.flatMap(g=>g.emails)),new Set(groups.flatMap(g=>g.emails)));
});

test('Review identities offers keyboard-accessible reorder controls at both levels',async()=>{
  const {readFile}=await import('node:fs/promises');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../assets/app.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../assets/app.css',import.meta.url),'utf8');
  assert.match(html,/Reorder contributor cards and linked identities/);
  assert.match(app,/data-action="move-contributor"/);
  assert.match(app,/data-action="move-linked-identity"/);
  assert.match(app,/data-action="toggle-linked-order"/);
  assert.match(app,/rebaseContributorViews\(before, after\)/);
  assert.match(app,/requireResolvedIdentitySelection\(\)/);
  assert.match(css,/\.linked-order-panel/);
  assert.match(css,/\.order-button:focus-visible/);
});
