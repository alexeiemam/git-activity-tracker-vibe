import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {continuityMatrix} from '../assets/continuity.js';
import {signatureMatrix,authoredOnlyUnits,quadrantPosition,SIGNATURE_MODES,DEFAULT_SIGNATURE_MODE} from '../assets/contribution-signature.js';
import {renderContributionSignature,renderSignatureQuadrant,renderSignatureSummary} from '../assets/contribution-signature-view.js';

const contributors=[{id:'0',displayName:'Aster',workingDays:[1,2,3,4]},{id:'1',displayName:'Birch',workingDays:[1,2,3,4,5]}];
const window={from:'2026-04-06',to:'2026-04-19'};
const commit=(date,lines,id='0')=>({date,groupId:id,files:[{path:'app/service.rb',added:lines,deleted:0}]});
const source=()=>({bounds:{min:'2026-04-06',max:'2026-04-19'},activity:[
  // Five qualifying days in the first 4-day reference week, two in the second.
  ...['2026-04-06','2026-04-07','2026-04-08','2026-04-09','2026-04-10'].map(d=>commit(d,70)),
  ...['2026-04-13','2026-04-14'].map(d=>commit(d,50)),
  commit('2026-04-06',15,'1'),commit('2026-04-14',15,'1'),
],releases:[
  {tag:'v1',baseline:true,date:'2026-04-05',members:[{id:'0',commits:40,releaseLineChurn:8000}]},
  {tag:'v2',date:'2026-04-09',lineageComplete:true,members:[{id:'0',commits:2,releaseLineChurn:400}]},
  {tag:'v3',date:'2026-04-12',lineageComplete:true,members:[{id:'1',commits:3,releaseLineChurn:35}]},
  {tag:'v4',date:'2026-04-18',lineageComplete:false,members:[{id:'0',commits:4,releaseLineChurn:600}]},
]});
const build=(index=source(),people=contributors,dates=window)=>{
  const continuity=continuityMatrix(index,people,dates,{meaningfulLines:20});
  return signatureMatrix(index,continuity,people,dates);
};

test('the three complementary views are explicitly selected, with legacy day counts retained',()=>{
  assert.deepEqual([...SIGNATURE_MODES],['days','signature','delivery','contribution']);
  assert.equal(DEFAULT_SIGNATURE_MODE,'signature');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const name of SIGNATURE_MODES)assert.match(html,new RegExp(`data-continuity-view="${name}"`));
  assert.match(app,/if \(SIGNATURE_MODES\.includes\(s\.continuityView\)\) state\.continuityView=s\.continuityView/);
  assert.match(app,/continuityView:state\.continuityView/);
  assert.match(app,/renderContributionSignature\(signature/);
  assert.match(app,/renderSignatureQuadrant\(signature/);
  assert.match(app,/showPulsePeriodPopover/);
});

test('authored-only output excludes release bonuses and keeps magnitude above the reference level',()=>{
  const regular=authoredOnlyUnits({commits:3,churn:200,releaseLines:0});
  assert.equal(regular,authoredOnlyUnits({commits:3,churn:200,releaseLines:20000}));
  assert.ok(authoredOnlyUnits({commits:7,churn:2000})>regular);
  assert.equal(authoredOnlyUnits({commits:0,churn:0}),0);
  assert.equal(authoredOnlyUnits({commits:-1,churn:1}),null);
});

test('weeks are count-first and extra days in one week do not erase deficits in another',()=>{
  const model=build(),a=model.byId.get('0');
  assert.equal(a.eligibleWeeks,2);
  assert.equal(a.weeksMet,1);
  assert.equal(a.weeksMetRate,0.5);
  assert.equal(a.meanAttainment,0.75,'(4/4 + 2/4) / 2: 5/4 cannot compensate for 2/4');
  assert.equal(a.completeExpectedDays,8);
  assert.ok(a.authoredRate>0);
  assert.ok(a.authoredChurn>0);
  assert.equal(a.weeks[0].overageDays,1);
  assert.equal(a.weeks[1].shortfallDays,2);
  assert.equal(a.weeks[0].complete,true);
});

test('delivery quadrant uses complete eligible releases, distinct participation and released magnitude',()=>{
  const model=build();
  const a=model.byId.get('0'),b=model.byId.get('1');
  assert.equal(model.releaseOpportunities,2);
  assert.equal(model.incompleteReleaseOpportunities,1);
  assert.equal(a.releaseParticipations,1);
  assert.equal(a.releaseBreadth,0.5);
  assert.equal(a.releaseRate,200,'400 released lines spread over two eligible release events');
  assert.equal(a.releaseLines,400);
  assert.equal(a.releaseCommits,2);
  assert.equal(b.releaseBreadth,0.5);
  assert.equal(b.releaseRate,17.5);
  assert.equal(a.releaseLines>10*b.releaseLines,true);
  assert.equal(a.authoredChurn,450,'release metrics cannot be added into authored-date churn');
});

test('release inclusions count on tag dates even when their authored commits precede selection',()=>{
  const index=source();index.activity=[];
  const model=build(index);
  const a=model.byId.get('0');
  assert.equal(a.authoredRate,0,'no authored commits in the selected dates');
  assert.equal(a.releaseRate,200,'tag-event inclusion still counts on its later release date');
});

test('zero-day reference preserves authored evidence without an invented weekly rate or quadrant point',()=>{
  const model=build(source(),[{...contributors[0],workingDays:[]}]);
  const a=model.rows[0];
  assert.equal(a.expectedPerWeek,0);
  assert.equal(a.eligibleWeeks,0);
  assert.equal(a.meanAttainment,null);
  assert.equal(a.authoredRate,null);
  assert.ok(a.weeks[0].authoredUnits>0);
  assert.match(renderContributionSignature(model),/∑/);
  assert.match(renderSignatureQuadrant(model,'contribution'),/Not plotted/);
  assert.equal(a.releaseBreadth,0.5,'delivery is independent of expected weekdays');
});

test('partial calendar weeks and incomplete import bounds are shown but not treated as complete',()=>{
  const dates={from:'2026-04-08',to:'2026-04-16'};
  const model=build(source(),contributors,dates);
  assert.equal(model.byId.get('0').eligibleWeeks,0);
  assert.equal(model.byId.get('0').authoredRate,null);
  assert.ok(model.byId.get('0').weeks.every(w=>w.partial));
  const html=renderContributionSignature(model);
  assert.match(html,/is-partial/);
  assert.match(html,/partial week/);
});

test('unknown released lines suppress the delivered-magnitude coordinate rather than silently becoming zero',()=>{
  const index=source();index.releases[1].members[0].releaseLineChurn=null;
  const model=build(index);const a=model.byId.get('0');
  assert.equal(a.releaseParticipations,1);
  assert.equal(a.releaseBreadth,.5);
  assert.equal(a.releaseLines,null);
  assert.equal(a.releaseRate,null);
  assert.match(renderSignatureQuadrant(model,'delivery'),/Not plotted/);
});

test('missing tagged-release opportunities produce an unknown delivery coordinate, not 0% participation',()=>{
  const index=source();index.releases=[];
  const model=build(index);
  assert.equal(model.byId.get('0').releaseBreadth,null);
  assert.equal(model.byId.get('0').releaseRate,null);
  assert.match(renderSignatureQuadrant(model,'delivery'),/No complete incremental tagged-release opportunities/);
  assert.ok(model.byId.get('0').authoredRate>0,'contribution chart remains available without releases');
});

test('quadrant axes retain absolute calibration independent of which contributors are selected',()=>{
  assert.equal(quadrantPosition(.5,200,{thresholdY:200,maxY:800}).x,.5);
  assert.ok(quadrantPosition(.5,400,{thresholdY:200,maxY:800}).y>quadrantPosition(.5,200,{thresholdY:200,maxY:800}).y);
  assert.equal(quadrantPosition(null,100),null);
  assert.equal(quadrantPosition(1.1,0),null);
  const model=build();
  const delivery=renderSignatureQuadrant(model,'delivery');
  assert.match(delivery,/Delivery-focused quadrant/);
  assert.match(delivery,/larger changes/);
  assert.match(delivery,/Release breadth/);
  assert.match(delivery,/index \/ expected day|Released lines \/ opportunity/);
  assert.doesNotMatch(delivery,/gold star|winner|leader badge/i);
  const contribution=renderSignatureQuadrant(model,'contribution');
  assert.match(contribution,/Contribution-focused quadrant/);
  assert.match(contribution,/Target-day attainment/);
  assert.match(contribution,/Authored index \/ expected day/);
  assert.match(renderSignatureSummary(model),/Evidence behind the signature/);
});

test('real imported Git ancestry reconciles author aliases and deduplicates release tag aliases',async()=>{
  const {parseGitHistory,buildAnalysis}=await import('../assets/domain.js');
  const {impactAnalysis}=await import('../assets/impact.js');
  const {buildEvidenceIndex}=await import('../assets/perspectives.js');
  const h=c=>c.repeat(40);
  const raw=[
    `TAG|v1||${h('a')}|commit|2026-01-05T12:00:00Z`,
    `TAG|v2||${h('c')}|commit|2026-03-12T12:00:00Z`,
    `TAG|alias-v2||${h('c')}|commit|2026-03-12T12:00:00Z`,
    `COMMIT|${h('c')}|ada@new|Ada|2026-02-22T13:00:00Z|2026-02-22T13:00:00Z|feat: product|${h('b')}`,
    '8\t2\tapp/main.rb',
    `COMMIT|${h('b')}|ben@work|Ben|2026-02-10T12:00:00Z|2026-02-10T12:00:00Z|fix: build|${h('a')}`,
    '2\t1\tapp/build.rb',
    `COMMIT|${h('a')}|ada@old|Ada|2026-01-03T12:00:00Z|2026-01-03T12:00:00Z|chore: version|`,
    '999\t999\tVERSION',
  ].join('\n');
  const parsed=parseGitHistory(raw);
  const full=buildAnalysis(parsed.commits,[
    {displayName:'Ada',emails:['ada@old','ada@new']},{displayName:'Ben',emails:['ben@work']},
  ],{start:'2026-01-01',end:'2026-03-31',selectedIds:new Set(['0','1']),includeMerges:false,includeReverts:true});
  const impact=impactAnalysis(full,parsed.commits,parsed.tags,{skipFollowup:true});
  const index=buildEvidenceIndex(full,impact,{min:'2026-01-01',max:'2026-03-31'});
  const chosen={from:'2026-03-01',to:'2026-03-31'};
  const people=[{id:'0',displayName:'Ada',workingDays:[1,2,3,4,5]},
    {id:'1',displayName:'Ben',workingDays:[1,2,3,4,5]}];
  const continuity=continuityMatrix(index,people,chosen);
  const model=signatureMatrix(index,continuity,people,chosen);
  assert.equal(model.releaseOpportunities,1,'alias-v2 cannot create another opportunity');
  assert.equal(model.byId.get('0').releaseParticipations,1);
  assert.equal(model.byId.get('0').releaseLines,10);
  assert.equal(model.byId.get('1').releaseLines,3);
  assert.equal(model.byId.get('0').authoredChurn,0,'March release must not move February commits into March authored output');
});
