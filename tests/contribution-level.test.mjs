import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {dayNumber,dateAtDay,buildAnalysis,parseGitHistory} from '../assets/domain.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';
import {impactAnalysis} from '../assets/impact.js';
import {momentumMatrix} from '../assets/momentum.js';
import {contributionLevelUnits,contributionLevelMatrix,relativeLevel,median,DEFAULT_LEVEL_WINDOW} from '../assets/contribution-level.js';
import {intensityStyle,makeIntensityScale} from '../assets/value-colour.js';

const weekdays=(date,count)=>{
  const out=[];
  for(let d=dayNumber(date);out.length<count;d++){
    const day=dateAtDay(d),dow=new Date(`${day}T12:00:00Z`).getUTCDay();
    if(dow!==0&&dow!==6)out.push(day);
  }
  return out;
};
const commit=(id,date,lines=50,hour=null,path='src/app.rb')=>({groupId:id,date,hour,minute:hour===null?null:20,
  files:[{path,added:lines,deleted:0}]});
const contributor=id=>({id:String(id),displayName:id==='0'?'Aster':'Birch',daily:{commits:{},churn:{}}});
const history=(activity,dates,releases=[])=>({activity,releases,bounds:{min:dates[0],max:dates.at(-1)}});
const matrix=(index,dates,contributors=['0','1'],options={})=>contributionLevelMatrix(index,contributors.map(contributor),
  {from:dates[0],to:dates.at(-1)},options);

test('uncapped log-scaled level distinguishes genuinely larger recorded contributions beyond Momentum caps',()=>{
  const moderate=contributionLevelUnits({commits:4,churn:200,releaseLines:200,distribution:1});
  const high=contributionLevelUnits({commits:40,churn:2000,releaseLines:2000,distribution:1});
  assert.ok(Math.abs(moderate-1)<1e-10);
  assert.ok(high>moderate+0.4);
  assert.ok(contributionLevelUnits({commits:4,churn:200})<moderate);
  assert.ok(contributionLevelUnits({commits:1,churn:4000})>contributionLevelUnits({commits:4,churn:30}),
    'one large commit keeps its substantive raw change credit');
  assert.equal(contributionLevelUnits({commits:0,churn:0,releaseLines:0}),0);
  for(const value of [-1,Infinity,NaN]) {
    assert.equal(contributionLevelUnits({commits:value}),null);
    assert.equal(contributionLevelUnits({churn:value}),null);
    assert.equal(contributionLevelUnits({distribution:value}),null);
  }
  assert.equal(contributionLevelUnits({distribution:1.1}),null);
  assert.equal(contributionLevelUnits({commits:1,churn:1e100})>0,true);
});

test('sustained high contributors stand out despite identical flat self-relative momentum',()=>{
  const dates=weekdays('2026-01-05',28);
  const activity=dates.flatMap(d=>[
    commit('0',d,250,9),commit('0',d,250,11),commit('0',d,250,14),commit('0',d,250,17),
    commit('1',d,8,10),
  ]);
  const data=history(activity,dates);
  const m=momentumMatrix(data,['0','1'].map(contributor),{from:dates[19],to:dates[19]});
  assert.equal(m.byId.get('0').latest.score,0);
  assert.equal(m.byId.get('1').latest.score,0);
  const level=matrix(data,dates);
  const high=level.byId.get('0'),low=level.byId.get('1');
  assert.ok(high.recentLevel>low.recentLevel*3,'real scale survives the hard caps of directional Momentum');
  assert.ok(high.averageLevel>low.averageLevel*3);
  assert.ok(high.consistency>low.consistency);
  assert.ok(high.distributedConsistency>low.distributedConsistency);
  assert.ok(high.peer.ratio>3);
  assert.equal(low.peer.ratio<1,true);
  assert.equal(high.rank,1);
  assert.equal(high.uniqueLeader,true);
  assert.equal(high.broadLead,true);
  assert.ok(high.leadingSignals.includes('Authored commits'));
  assert.ok(high.leadingSignals.includes('Distributed-day consistency'));
  assert.equal(level.leader,high);
  assert.ok(level.byId.get('0').daily.get(dates[20]).leader);
  assert.ok(level.byId.get('0').months.get('2026-02').leader);
  assert.ok(!level.byId.get('1').daily.get(dates[20]).leader);
  assert.equal(level.workdays,DEFAULT_LEVEL_WINDOW);
});

test('monthly cells use shared daily-index averages and preserve partial-date coverage',()=>{
  const dates=weekdays('2026-01-05',21);
  const data=history([commit('0',dates[7],100),commit('0',dates[10],200),commit('1',dates[10],10)],dates);
  const full=matrix(data,dates);
  const selected=contributionLevelMatrix(data,['0','1'].map(contributor),{from:dates[10],to:dates[15]});
  const item=selected.byId.get('0').daily.get(dates[10]);
  assert.equal(item.level,full.byId.get('0').daily.get(dates[10]).level);
  const month=selected.byId.get('0').months.get(dates[10].slice(0,7));
  const covered=[...selected.byId.get('0').daily.values()].filter(v=>v.date.startsWith(month.month)&&v.reason==='scored');
  assert.equal(month.days,covered.length);
  assert.ok(Math.abs(month.score-covered.reduce((v,d)=>v+d.level,0)/covered.length)<1e-10);
  assert.equal(month.commits,1);
  const sameEnd=contributionLevelMatrix(data,['0','1'].map(contributor),{from:dates[0],to:dates[15]});
  assert.equal(selected.byId.get('0').recentLevel,sameEnd.byId.get('0').recentLevel,
    'recent pace is based on full history through the selected end, independent of display start');
});

test('VERSION-only churn cannot inflate level, while authored commits still count',()=>{
  const dates=weekdays('2026-01-05',15);
  const data=history([commit('0',dates[8],50000,9,'VERSION'),commit('1',dates[8],50,9)],dates);
  const model=matrix(data,dates);
  const version=model.byId.get('0').daily.get(dates[8]);
  const substantive=model.byId.get('1').daily.get(dates[8]);
  assert.equal(version.commits,1);
  assert.equal(version.churn,0);
  assert.ok(substantive.level>version.level);
  assert.equal(version.temporal.meaningful,false);
});

test('release contributions preserve incremental author credit, not baseline or driver-only attribution; weekend tags go to Monday',()=>{
  const dates=weekdays('2026-01-05',27);
  const releases=[
    {date:dates[0],tag:'v0',baseline:true,members:[{id:'0',commits:1,releaseLineChurn:10000}]},
    {date:dates[20],tag:'driver',baseline:false,members:[{id:'1',commits:0,releaseLineChurn:1000}]},
    {date:'2026-01-31',tag:'v1',baseline:false,members:[{id:'0',commits:1,releaseLineChurn:3000}]},
    {date:dates[20],tag:'version',baseline:false,members:[{id:'1',commits:1,releaseLineChurn:0}]},
  ];
  const index=history([commit('0',dates[1],20)],dates,releases);
  const model=matrix(index,dates);
  assert.equal(model.byId.get('0').daily.get(dates[0]).releaseLines,0);
  assert.equal(model.byId.get('1').daily.get(dates[20]).releaseLines,0);
  assert.equal(model.byId.get('0').daily.get('2026-01-31').releaseLines,0);
  const monday=model.byId.get('0').daily.get('2026-02-02');
  assert.equal(monday.releaseLines,3000);
  assert.equal(monday.releases[0].tag,'v1');
  assert.ok(monday.level>model.byId.get('0').daily.get('2026-02-03').level);
});

test('peer comparisons exclude the subject and are safe for ties, quiet peers and single-contributor selection',()=>{
  assert.equal(median([2,1,6,5]),3.5);
  assert.equal(median([2,1,6]),2);
  assert.equal(median([]),null);
  assert.deepEqual(relativeLevel(9,[3,0]),{reference:1.5,ratio:6,peers:2});
  assert.deepEqual(relativeLevel(9,[0,0]),{reference:0,ratio:null,peers:2});
  assert.deepEqual(relativeLevel(9,[]),{reference:null,ratio:null,peers:0});
  const dates=weekdays('2026-01-05',15),index=history([commit('0',dates[5],300)],dates);
  const solo=matrix(index,dates,['0']);
  assert.equal(solo.comparable,false);
  assert.equal(solo.byId.get('0').rank,1);
  assert.equal(solo.byId.get('0').uniqueLeader,false);
  assert.equal(solo.byId.get('0').leadingSignals.length,0);
  const pair=matrix(index,dates);
  assert.equal(pair.byId.get('0').peer.ratio,null);
  assert.equal(pair.byId.get('0').peer.reference,0);
  assert.equal(pair.byId.get('0').uniqueLeader,true);
  const ties=matrix(history([commit('0',dates[5],300),commit('1',dates[5],300)],dates),dates);
  assert.equal(ties.byId.get('0').uniqueLeader,false);
  assert.equal(ties.byId.get('1').rank,1);
});

test('out-of-history dates remain unknown and workday warmup does not manufacture a recent pace',()=>{
  const dates=weekdays('2026-01-05',5);
  const model=contributionLevelMatrix(history([],dates),[contributor('0')],{from:'2026-01-01',to:'2026-01-10'});
  const row=model.byId.get('0');
  assert.equal(row.daily.get('2026-01-01').level,null);
  assert.equal(row.daily.get('2026-01-01').reason,'outside-history');
  assert.equal(row.daily.get('2026-01-06').level,0);
  assert.equal(row.recentLevel,null);
  assert.equal(row.averageLevel,0);
  assert.equal(row.rank,null);
  assert.equal(model.available,true);
  assert.equal(contributionLevelMatrix(null,[contributor('0')],{from:dates[0],to:dates[3]}).available,false);
  assert.equal(contributionLevelMatrix(history([],dates),[contributor('0')],{from:dates[2],to:dates[0]}).available,false);
});

test('same cell colours are shared across people; no separate per-person normalisation erases differences',()=>{
  const scale=makeIntensityScale([0,0.1,0.2,0.9,2.5]);
  assert.notEqual(intensityStyle(.1,scale),intensityStyle(2.5,scale));
  assert.notEqual(intensityStyle(null,scale),intensityStyle(0,scale));
  assert.ok(scale.max>scale.minPositive);
});

test('UI wiring keeps four distinct lenses, evidence, cache-busted module contracts and backwards-compatible settings',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../assets/app.css',import.meta.url),'utf8');
  for(const id of ['pulse-level-settings','pulse-level-workdays','pulse-level-summary'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/data-pulse-lens="level"/);
  assert.match(app,/pulseLevel=momentumMode\|\|levelMode\?contributionLevelMatrix/);
  assert.match(app,/const value=signalMode\?\(levelMode\?\(cell\?\.level/);
  assert.match(app,/pulseLevelSummary\(pulseLevel\)/);
  assert.match(app,/pulseMomentumSummary\(pulseMomentum,pulseLevel\)/);
  assert.match(app,/LEVEL_WINDOWS\.includes\(s\.pulseLevelWorkdays\)/);
  assert.match(app,/pulseLevelWorkdays:state\.pulseLevelWorkdays/);
  assert.match(app,/pulseLevelDayDetails\(levelItem\)/);
  assert.match(css,/\.pulse-level-leading/);
});
