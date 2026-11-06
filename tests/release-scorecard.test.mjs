import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGitHistory,buildAnalysis} from '../assets/domain.js';
import {impactAnalysis} from '../assets/impact.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';
import {releaseScorecard} from '../assets/release-scorecard.js';

const persons=[{id:'0',displayName:'Ada'},{id:'1',displayName:'Ben'},{id:'2',displayName:'Chris'}];
const range={from:'2026-02-01',to:'2026-02-28'};
const index={releases:[
  {hash:'base',tag:'v1',date:'2026-01-05',baseline:true,members:[{id:'0',commits:1,releaseLineChurn:1000}]},
  {hash:'r1',tag:'v2',aliases:['v2','release-v2'],date:'2026-02-02',baseline:false,lineageComplete:true,members:[
    {id:'0',commits:2,releaseLineChurn:100,drove:false},
    {id:'1',commits:0,releaseLineChurn:0,drove:true},
  ]},
  {hash:'r2',tag:'v3',date:'2026-02-20',baseline:false,lineageComplete:false,members:[
    {id:'0',commits:1,releaseLineChurn:20,drove:true},
    {id:'2',commits:1,releaseLineChurn:0,drove:false},
  ]},
  {hash:'r3',tag:'v4',date:'2026-03-03',baseline:false,members:[{id:'1',commits:8,releaseLineChurn:600}]},
]};

test('incremental canonical release events count authored participation, lines and actor roles separately',()=>{
  const model=releaseScorecard(index,range,persons);
  assert.equal(model.available,true);
  assert.equal(model.inRange,2);
  assert.equal(model.partialReleases,1);
  assert.deepEqual(model.byId.get('0'),{releases:2,commits:3,lines:120,actorEvents:1,partial:1});
  assert.deepEqual(model.byId.get('1'),{releases:0,commits:0,lines:0,actorEvents:1,partial:0});
  assert.deepEqual(model.byId.get('2'),{releases:1,commits:1,lines:0,actorEvents:0,partial:1});
  // Contributor selection affects the columns, not release reconstruction.
  assert.equal(releaseScorecard(index,range,[persons[1]]).byId.size,1);
  assert.equal(releaseScorecard(index,{from:'2026-03-01',to:'2026-03-10'},persons).byId.get('1').commits,8);
});

test('missing tag evidence is unavailable; no tags in a covered period is a legitimate zero',()=>{
  assert.equal(releaseScorecard({releases:[]},range,persons).available,false);
  assert.equal(releaseScorecard(null,range,persons).available,false);
  assert.equal(releaseScorecard(index,{from:'2026-04-01',to:'2026-04-30'},persons).byId.get('0').releases,0);
  assert.equal(releaseScorecard(index,{from:'2026-05-30',to:'2026-05-01'},persons).available,false);
  const partial=releaseScorecard({releases:[{date:'2026-02-05',baseline:false,members:[{id:'0',commits:1}]}]},range,persons);
  assert.equal(partial.byId.get('0').lines,null,'do not fabricate a zero from missing numstat values');
  assert.equal(partial.byId.get('0').commits,1);
});

test('actual Git ancestry and reconciled author identity determine released changes across different clocks',()=>{
  const h=c=>c.repeat(40);
  const raw=[
    `TAG|v1||${h('a')}|commit|2026-01-05T12:00:00Z`,
    `TAG|v2||${h('c')}|commit|2026-02-12T12:00:00Z`,
    `TAG|alias-v2||${h('c')}|commit|2026-02-12T12:00:00Z`,
    `COMMIT|${h('c')}|ada@new|Ada|2026-01-22T13:00:00Z|2026-01-22T13:00:00Z|feat: product|${h('b')}`,
    '8\t2\tapp/main.rb',
    `COMMIT|${h('b')}|ben@work|Ben|2026-01-15T12:00:00Z|2026-01-15T12:00:00Z|fix: build|${h('a')}`,
    '2\t1\tapp/build.rb',
    `COMMIT|${h('a')}|ada@old|Ada|2026-01-03T12:00:00Z|2026-01-03T12:00:00Z|chore: version|`,
    '999\t999\tVERSION',
  ].join('\n');
  const data=parseGitHistory(raw);
  const groups=[{displayName:'Ada',emails:['ada@old','ada@new']},{displayName:'Ben',emails:['ben@work']}];
  const full=buildAnalysis(data.commits,groups,{
    start:'2026-01-01',end:'2026-02-28',selectedIds:new Set(['0','1']),
    includeMerges:false,includeReverts:true,
  });
  const rawImpact=impactAnalysis(full,data.commits,data.tags,{skipFollowup:true});
  const evidence=buildEvidenceIndex(full,rawImpact,{min:'2026-01-01',max:'2026-02-28'});
  const model=releaseScorecard(evidence,range,persons);
  assert.equal(model.inRange,1,'alias tags are one release event');
  assert.deepEqual(model.byId.get('0'),{releases:1,commits:1,lines:10,actorEvents:0,partial:0});
  assert.deepEqual(model.byId.get('1'),{releases:1,commits:1,lines:3,actorEvents:0,partial:0});
  assert.equal(releaseScorecard(evidence,{from:'2026-01-15',to:'2026-01-31'},persons).byId.get('0').releases,0,
    'author-date range does not redefine the tag-event clock');
});

test('the contributor table exports sortable real release metrics while retaining VERSION touches as a proxy',()=>{
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const label of ['Tagged releases','Commits in releases','Released changed lines','Tag/publish actor events','VERSION touches · proxy']){
    assert.ok(app.includes(label));
  }
  for(const name of ['releases','released_commits','released_lines','actor_events','version']){
    assert.match(app,new RegExp(`key:'${name}'`));
  }
  assert.match(app,/releaseScorecard\(perspectiveIndex,\{from:view\.start,to:view\.end\},view\.contributors\)/);
  assert.match(app,/const data=makeTableData\(analysis\)/);
  assert.match(html,/tagged-release metrics use release-event dates/);
});
