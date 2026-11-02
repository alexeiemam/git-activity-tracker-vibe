import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deploymentOverviewPanel,deploymentStatusGuide,deploymentExplorer} from '../assets/deployment-view.js';
const css=readFileSync(new URL('../assets/app.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');

test('active vs inactive primary navigation has deliberate contrasting text colours',()=>{
  assert.match(css,/\.experience-switch a\.experience-choice\.is-current,[\s\S]*?color:#fff/);
  assert.match(css,/\.experience-switch a\.experience-choice:not\(\.is-current\)\{color:#486150/);
  assert.match(css,/\.primary-tabs button\.active,[\s\S]*?color:#fff/);
  assert.match(css,/\.primary-preset\.active,[\s\S]*?color:#fff/);
  assert.match(css,/@media\(forced-colors:active\)/);
  assert.match(html,/aria-current="page"/);
});

test('all deployment statuses, clocks, and navigation are explained inline',()=>{
  assert.match(deploymentStatusGuide(),/First observed snapshot/);
  assert.match(deploymentStatusGuide(),/does not prove a bad deployment/);
  assert.match(deploymentStatusGuide(),/Config change/);
  const index={groups:[{id:'0',displayName:'Developer',emails:['dev@sample.test']}],releases:[{
    tag:'v1.0.0',hash:'a'.repeat(40),date:'2026-10-29',driver:{name:'dev'}
  }],bounds:{min:'2026-10-28',max:'2026-10-30'},
  deployments:{available:true,events:[{id:'PROD-2338-0',env:'PROD',version:2338,at:Date.parse('2026-10-30T20:53:50Z'),date:'2026-10-30',type:'config',description:'Set config vars',actorEmail:'dev@sample.test',actorGroupId:'0',actorName:'Developer',releaseTags:['v1.0.0'],introducedReleaseTags:[],people:[],areas:[],outcome:'succeeded'}],
    envs:{STAG:{count:0,codeEvents:0,configEvents:0},BETA:{count:0,codeEvents:0,configEvents:0},PROD:{count:1,codeEvents:0,configEvents:1}},
    releaseLinks:[{tag:'v1.0.0',releaseHash:'a'.repeat(40),byEnv:{PROD:{at:Date.parse('2026-10-30T20:53:50Z'),certainty:'observed-by',eventId:'PROD-2338-0'}}}],
    people:[],qaComparison:{}}};
  const page=deploymentOverviewPanel(index);
  assert.match(page,/GitHub release is not necessarily a production deployment/);
  assert.match(page,/Heroku v2338/);
  assert.match(page,/view=observatory/);
  assert.match(page,/view=contributors/);
  assert.match(page,/view=deployments/);
  assert.match(page,/Recent configuration events/);
  assert.match(page,/Present by/);
  assert.match(page,/Set config vars/);
  const browser=deploymentExplorer(index,{deploymentEnv:'all',deploymentYear:'all',deploymentPage:0});
  assert.match(browser,/actor: /i);
  assert.match(browser,/What do these statuses mean/);
});

test('3,000-record capture is visibly bounded and incomplete coverage can be reported',()=>{
  assert.match(html,/two pages use the authenticated API|Range":f"version /);
  assert.match(html,/rows\[:3000\]/);
  assert.match(html,/HEROKUSTATUS\|%s\|partial/);
  assert.match(js,/reconcileProviderGroups/);
  assert.match(html,/Review identities/);
  assert.doesNotMatch(html,/--num 3000 -r/);
});
