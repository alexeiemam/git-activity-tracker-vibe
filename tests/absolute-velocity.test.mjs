import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {velocityColour,velocityStyle,velocityPosition,velocityCellText,velocityLegend,VELOCITY_MARKS} from '../assets/absolute-velocity.js';
import {contributionLevelUnits} from '../assets/contribution-level.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('velocity uses fixed numeric references, regardless of cohort or selected period',()=>{
  assert.ok(Math.abs(contributionLevelUnits({commits:4,churn:200,releaseLines:200,distribution:1})-1)<1e-10);
  assert.equal(VELOCITY_MARKS.at(-1),3);
  assert.equal(velocityPosition(0),null);
  assert.ok(velocityPosition(.5)<velocityPosition(1));
  assert.ok(velocityPosition(1)<velocityPosition(2));
  assert.equal(velocityColour(3),velocityColour(300),'colour caps, observable index does not');
  assert.notEqual(velocityColour(.5),velocityColour(1));
  assert.notEqual(velocityColour(1),velocityColour(2));
  assert.notEqual(velocityColour(0),velocityColour(null));
  for(const bad of [null,undefined,NaN,Infinity,-1]){
    assert.equal(velocityColour(bad),null);
    assert.equal(velocityCellText(bad),'—');
    assert.match(velocityStyle(bad),/repeating-linear-gradient/);
  }
  assert.equal(velocityCellText(0),'0');
  assert.equal(velocityCellText(.05),'<.1');
  assert.equal(velocityCellText(1.26),'1.3');
  assert.equal(velocityCellText(3.85),'3.9');
  assert.equal(velocityCellText(11.4),'11');
  assert.match(velocityLegend(),/FIXED INDEX/);
});

test('absolute velocity cells show real values without peer bars, honours original session lens identifier',()=>{
  const app=read('../assets/app.js'),html=read('../index.html'),css=read('../assets/app.css');
  assert.match(html,/data-pulse-lens="level"[^>]*>Absolute velocity/);
  assert.match(app,/levelMode\?velocityStyle:null/); // module import / usage for fixed lens
  assert.match(app,/pulse-velocity-cell pulse-velocity-month/);
  assert.match(app,/pulse-velocity-cell pulse-velocity-day/);
  assert.match(app,/velocityCellText\(value\)/);
  assert.match(app,/velocityCellText\(v\)/);
  assert.match(app,/velocityLegend\(\)/);
  assert.match(app,/pulseLevelWorkdays:state\.pulseLevelWorkdays/);
  assert.doesNotMatch(html,/id="pulse-comparison"/);
  assert.doesNotMatch(css,/\.pulse-peer-bar/);
  assert.doesNotMatch(app,/pulseLevelDistribution/);
  assert.match(css,/\.pulse-velocity-cell/);
});
