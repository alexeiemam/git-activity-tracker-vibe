import test from 'node:test';
import assert from 'node:assert/strict';
import {externalIdentities,reconcileProviderGroups} from '../assets/external-identities.js';
import {moveContributorIdentities,parseGitHistory,buildAnalysis} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';
import {decodeHerokuBatch,buildDeploymentIndex} from '../assets/deployments.js';
import {routeFromState,routeUrl,readRoute,applyRoute} from '../assets/route-state.js';

const sha=n=>n.toString(16).padStart(40,'0');
const gh=[{tag:'v1.0.0',publisher:'alexei',publishedAt:Date.parse('2026-10-29T10:00:00Z'),publishedDate:'2026-10-29',draft:false},
          {tag:'v1.0.1',publisher:'robot-releaser',publishedAt:Date.parse('2026-10-30T10:00:00Z'),publishedDate:'2026-10-30',draft:false}];
const git=[{email:'123+alexei@users.noreply.github.com',name:'Alexei',hash:sha(1)},
           {email:'dev@sample.test',name:'Developer',hash:sha(2)}];
const heroku=[{actorEmail:'dev@sample.test',env:'PROD'},{actorEmail:'ops@sample.test',env:'STAG'},{actorEmail:'ops@sample.test',env:'BETA'}];

test('GitHub and Heroku actors join the same mergeable identity catalogue',()=>{
  const catalogue=externalIdentities(gh,heroku);
  assert.equal(catalogue.get('github:alexei').events,1);
  assert.equal(catalogue.get('heroku:ops@sample.test').events,2);
  const groups=reconcileProviderGroups([
    {displayName:'Alexei',emails:[git[0].email]},
    {displayName:'Developer',emails:[git[1].email]},
  ],catalogue,gh,git);
  assert.ok(groups[0].emails.includes('github:alexei'));
  assert.ok(groups[1].emails.includes('heroku:dev@sample.test'));
  assert.ok(groups.some(g=>g.emails.includes('github:robot-releaser')&&g.emails.length===1));
  assert.ok(groups.some(g=>g.emails.includes('heroku:ops@sample.test')&&g.emails.length===1));
  assert.equal(groups.filter(g=>g.emails.includes('github:alexei')).length,1);
  const moved=moveContributorIdentities(groups,1,['heroku:ops@sample.test','github:robot-releaser']);
  assert.ok(moved[1].emails.includes('heroku:ops@sample.test'));
  assert.ok(moved[1].emails.includes('github:robot-releaser'));
  assert.equal(reconcileProviderGroups(moved,catalogue,gh,git).length,moved.length);
});

test('a publisher-only identity can be addressed by native URL and restored',()=>{
  const groups=[{id:'0',emails:['github:robot-releaser'],displayName:'@robot-releaser'},
    {id:'1',emails:['heroku:ops@sample.test'],displayName:'ops@sample.test'}];
  for(const group of groups){
    const view={mode:'contributors',contributorFocus:group.id,contributorTab:'delivery'};
    const url=routeUrl('/index.html',routeFromState(view,groups));
    assert.ok(url.includes('person='));
    assert.equal(applyRoute({mode:'observatory'},readRoute(url.split('?')[1]),groups).contributorFocus,group.id);
  }
});

test('Heroku Set ... config vars is recognised, redacted, and attributed to a reconciled actor',()=>{
  const rows=[
    {version:'v2337',created_at:'2026-10-29T17:00:00Z',description:`Deploy ${sha(1).slice(0,8)}`,user:{email:'dev@sample.test'},status:'succeeded'},
    {version:'v2338',created_at:'2026-10-29T17:18:03Z',description:'Set ASK_AI_CONFIGURATION_ACTIVATIONS_ENABLED config vars',user:{email:'ops@sample.test'},status:'succeeded'},
    {version:'v2339',created_at:'2026-10-29T17:24:23Z',description:'Unset SECRET_PASSWORD config vars',user:{email:'ops@sample.test'},status:'succeeded'},
  ];
  const encoded=Buffer.from(JSON.stringify(rows)).toString('base64');
  const decoded=decodeHerokuBatch(encoded,'STAG');
  assert.equal(decoded.length,3);
  assert.deepEqual(decoded.map(r=>r.kind),['deploy','config','config']);
  assert.equal(decoded[1].description,'Set config vars');
  assert.equal(decoded[2].description,'Unset config vars');
  assert.equal(decoded[1].actorEmail,'ops@sample.test');
  assert.doesNotMatch(JSON.stringify(decoded),/ACTIVATIONS_ENABLED|SECRET_PASSWORD/);
  const raw=`COMMIT|${sha(1)}|dev@sample.test|Developer|2026-10-28T11:00:00Z|2026-10-28T11:00:00Z|feat: initial|`;
  const parsed=parseGitHistory(raw);
  const groups=[{displayName:'Developer',emails:['dev@sample.test','heroku:dev@sample.test']},
    {displayName:'Operator',emails:['heroku:ops@sample.test']}];
  const view=buildAnalysis(parsed.commits,groups,{start:'2026-10-01',end:'2026-10-31',includeMerges:false,includeReverts:true});
  const impact=impactAnalysis(view,parsed.commits,parsed.tags);
  const evidence=buildEvidenceIndex(view,impact,{min:'2026-10-01',max:'2026-10-31'});
  const model=buildDeploymentIndex(decoded,parsed.commits,evidence,{STAG:'ok'});
  assert.equal(model.events.length,3);
  assert.deepEqual(model.events.map(e=>e.type),['baseline','config','config']);
  assert.equal(model.events[1].actorGroupId,'1');
  assert.equal(model.events[1].actorName,'Operator');
  assert.equal(model.envs.STAG.configEvents,2);
  assert.equal(model.events[1].firstProdCommits,0);
});
