import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {continuityMatrix} from '../assets/continuity.js';
import {signatureMatrix} from '../assets/contribution-signature.js';
import {renderSignatureQuadrant,signatureQuadrantRegion,bindSignatureQuadrant} from '../assets/contribution-signature-view.js';

const makeModel=()=>{
  const from='2026-04-06',to='2026-04-19';
  const contributors=[{id:'0',displayName:'Ada & Ben <Team>',workingDays:[1,2,3,4]},
    {id:'1',displayName:'Brynn',workingDays:[1,2,3,4]}];
  const index={bounds:{min:from,max:to},activity:[
    ...['2026-04-06','2026-04-07','2026-04-08','2026-04-09'].map(date=>({date,groupId:'0',files:[{path:'app.rb',added:200,deleted:0}]})),
    {date:'2026-04-14',groupId:'1',files:[{path:'app.rb',added:12,deleted:0}]}
  ],releases:[
    {tag:'v2',date:'2026-04-09',lineageComplete:true,members:[{id:'0',commits:2,releaseLineChurn:500}]},
    {tag:'v3',date:'2026-04-16',lineageComplete:true,members:[{id:'1',commits:1,releaseLineChurn:7}]}
  ]};
  const continuity=continuityMatrix(index,contributors,{from,to},{meaningfulLines:20});
  return signatureMatrix(index,continuity,contributors,{from,to});
};

test('regions are classified against the same fixed X/Y lines as the plotted quadrant',()=>{
  assert.equal(signatureQuadrantRegion('delivery',.49,199).label,'Selective participation · smaller changes');
  assert.equal(signatureQuadrantRegion('delivery',.5,199).label,'Broad participation · smaller changes');
  assert.equal(signatureQuadrantRegion('delivery',.49,200).label,'Selective participation · larger changes');
  assert.equal(signatureQuadrantRegion('delivery',.5,200).label,'Broad participation · larger changes');
  assert.equal(signatureQuadrantRegion('contribution',.749,.999).label,'Episodic · lighter recorded output');
  assert.equal(signatureQuadrantRegion('contribution',.75,1).label,'Regular · substantial recorded output');
  assert.equal(signatureQuadrantRegion('delivery',null,0),null);
  assert.equal(signatureQuadrantRegion('delivery',1.1,100),null);
  assert.equal(signatureQuadrantRegion('other',.5,200),null);
});

test('both quadrants directly identify points and explain their regions with exact evidence',()=>{
  const model=makeModel();
  for(const mode of ['delivery','contribution']){
    const html=renderSignatureQuadrant(model,mode);
    assert.match(html,/data-quadrant-inspection/);
    assert.match(html,/data-quadrant-point="0" data-quadrant-region="/);
    assert.match(html,/data-quadrant-point="1" data-quadrant-region="/);
    assert.match(html,/data-quadrant-detail="0"/);
    assert.match(html,/data-quadrant-detail="1"/);
    assert.match(html,/aria-pressed="false"/);
    assert.match(html,/POINT 1/);
    assert.match(html,/Why this region/);
    assert.match(html,/is (?:at or above|below) the/);
    assert.match(html,/data-quadrant-inspector aria-live="polite"/);
    assert.match(html,/data-quadrant-tag hidden/);
    assert.match(html,/Quadrant region/);
    assert.match(html,/data-quadrant-person="1"/);
    assert.match(html,/Ada &amp; Ben &lt;Team&gt;/);
    assert.doesNotMatch(html,/Ada & Ben <Team>/);
    assert.doesNotMatch(html,/gold star|winner badge/i);
  }
});

test('release inspector explains actual participation and magnitude without author-date conflation',()=>{
  const html=renderSignatureQuadrant(makeModel(),'delivery');
  assert.match(html,/1 of 2 eligible tagged releases included authored changes/);
  assert.match(html,/500 released non-VERSION lines across 2 included commits/);
  assert.match(html,/50% is at or above the 50% participation reference/);
  assert.match(html,/250\.0 is at or above the 200 lines-per-release reference/);
  assert.match(html,/Releases use tag dates, which may follow authored dates/);
});

test('contribution inspector explains count-first history and excludes release bonus',()=>{
  const html=renderSignatureQuadrant(makeModel(),'contribution');
  assert.match(html,/Mean across 2 complete weeks/);
  assert.match(html,/Quiet expected dates are included/);
  assert.match(html,/releases are excluded from this authored-only axis/);
  assert.match(html,/not performance targets/i);
});

test('missing points remain in evidence table but cannot receive a fabricated classification',()=>{
  const model=makeModel();
  model.rows[1].releaseRate=null;
  const html=renderSignatureQuadrant(model,'delivery');
  assert.match(html,/Not plotted/);
  assert.match(html,/Brynn/);
  assert.doesNotMatch(html,/data-quadrant-person="1"/);
});

test('app binds the inspector after quadrant render and offers keyboard and pointer selection',()=>{
  assert.equal(typeof bindSignatureQuadrant,'function');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const source=readFileSync(new URL('../assets/contribution-signature-view.js',import.meta.url),'utf8');
  assert.match(app,/if\(state\.continuityView!=='signature'\)bindSignatureQuadrant\(container\)/);
  for(const event of ['pointerover','pointerout','focusin','focusout','click','keydown','scroll']){
    assert.match(source,new RegExp(`addEventListener\\('${event}'`));
  }
  assert.match(source,/event\.key==='Enter'\|\|event\.key===' '/);
  assert.match(source,/event\.key==='Escape'/);
  assert.match(source,/selected=selected===key\?null:key/);
});
