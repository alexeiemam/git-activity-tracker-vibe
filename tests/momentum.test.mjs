import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {dayNumber,dateAtDay,buildAnalysis,parseGitHistory} from '../assets/domain.js';
import {buildEvidenceIndex} from '../assets/perspectives.js';
import {impactAnalysis} from '../assets/impact.js';
import {contributionUnits,momentumScore,momentumDirection,momentumMatrix,
  DEFAULT_MOMENTUM_WINDOW,MOMENTUM_DIRECTION_THRESHOLD} from '../assets/momentum.js';

const isWeekday=d=>!([0,6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()));
const workdays=(start,count)=>{
  const dates=[];
  for(let d=dayNumber(start);dates.length<count;d++) {
    const date=dateAtDay(d);
    if(isWeekday(date))dates.push(date);
  }
  return dates;
};
const change=(id,date,added=0,deleted=0,path='src/app.rb')=>({groupId:id,date,files:[{path,added,deleted}]});
const release=(date,tag,id,lines,extra={})=>({date,tag,baseline:false,
  members:[{id,commits:1,releaseLineChurn:lines}],...extra});
const contributor=(id='0')=>({id,displayName:id==='0'?'Ada':'Ben',daily:{commits:{},churn:{}}});
const withHistory=(activity, releases=[],bounds={min:'2026-01-05',max:'2026-03-31'})=>({activity,releases,bounds});
const get=(matrix,date,id='0')=>matrix.byId.get(id).daily.get(date);

test('normalised day units are bounded; signed change has a quiet-period stabiliser',()=>{
  assert.equal(contributionUnits({commits:4,churn:200,releaseLines:200}),1);
  assert.equal(contributionUnits({commits:40,churn:10000,releaseLines:50000}),1);
  assert.equal(contributionUnits({commits:0,churn:0,releaseLines:0}),0);
  assert.ok(Math.abs(contributionUnits({commits:1,churn:50,releaseLines:20}) - (0.45/4+0.35/4+0.20/10))<1e-10);
  assert.equal(contributionUnits({commits:-1}),null);
  assert.equal(momentumScore(0,0),0);
  assert.equal(momentumScore(0.5,0.5),0);
  assert.equal(momentumScore(0.5,0),83.3);
  assert.equal(momentumScore(0,0.5),-83.3);
  assert.equal(momentumScore(null,0),null);
  assert.equal(momentumDirection(17),'building');
  assert.equal(momentumDirection(-17),'cooling');
  assert.equal(momentumDirection(0),'steady');
  assert.equal(momentumDirection(0,false),'no-observed-activity');
});

test('momentum compares complete adjacent weekday windows, remains neutral if both are equal, and survives narrowing the selected date range',()=>{
  const days=workdays('2026-01-05',24);
  const activity=days.slice(0,20).map(d=>change('0',d,50,0));
  const history=withHistory(activity,[],{min:days[0],max:days.at(-1)});
  const full=momentumMatrix(history,[contributor()],{from:days[0],to:days.at(-1)});
  assert.equal(get(full,days[18]).reason,'insufficient-history');
  assert.equal(get(full,days[19]).reason,'scored');
  assert.equal(get(full,days[19]).score,0);
  assert.equal(get(full,days[19]).direction,'steady');
  assert.equal(get(full,days[19]).recent.commits,10);
  assert.equal(get(full,days[19]).previous.commits,10);
  assert.ok(get(full,days[22]).score<0,'a quieting period produces negative momentum');
  assert.equal(get(full,days[22]).direction,'steady','small shifts near zero should not become categorical judgements');
  const narrow=momentumMatrix(history,[contributor()],{from:days[22],to:days.at(-1)});
  assert.equal(get(narrow,days[22]).score,get(full,days[22]).score);
  assert.equal(narrow.byId.get('0').scoredDays,2);
  assert.equal(full.workdays,DEFAULT_MOMENTUM_WINDOW);
});

test('build-up, decline, stability and no activity are different, without requiring release tags',()=>{
  const days=workdays('2026-01-05',30);
  const build=withHistory(days.slice(10,20).map(d=>change('0',d,200)),[],{min:days[0],max:days.at(-1)});
  const up=momentumMatrix(build,[contributor()],{from:days[19],to:days[19]});
  assert.equal(get(up,days[19]).score,82.2,'maximum activity against silence is bounded by smoothing');
  assert.equal(get(up,days[19]).direction,'building');
  const cooling=withHistory(days.slice(0,10).map(d=>change('0',d,200)),[],{min:days[0],max:days.at(-1)});
  const down=momentumMatrix(cooling,[contributor()],{from:days[19],to:days[19]});
  assert.equal(get(down,days[19]).score,-82.2);
  assert.equal(get(down,days[19]).direction,'cooling');
  const none=momentumMatrix(withHistory([],[],{min:days[0],max:days.at(-1)}),[contributor()],{from:days[19],to:days[19]});
  assert.equal(get(none,days[19]).score,0);
  assert.equal(get(none,days[19]).direction,'no-observed-activity');
  assert.equal(none.byId.get('0').scoredDays,1);
});

test('release shipping boosts trend, baseline/driver/VERSION-only do not, weekend tags are credited on Monday',()=>{
  const days=workdays('2026-01-05',24);
  const baseline={date:days[0],tag:'v0',baseline:true,members:[{id:'0',commits:1,releaseLineChurn:9999}]};
  const weekend=release('2026-01-31','v1','0',200); // Saturday
  const version=release(days[18],'version','0',0);
  const driven={date:days[17],tag:'drive',baseline:false,members:[{id:'0',commits:0,releaseLineChurn:200,drove:true}]};
  const releases=[baseline,version,driven,weekend];
  const activity=days.slice(0,20).map(d=>change('0',d,0,200,'VERSION'));
  const history=withHistory(activity,releases,{min:days[0],max:days.at(-1)});
  const model=momentumMatrix(history,[contributor()],{from:days[19],to:days.at(-1)});
  assert.equal(get(model,days[19]).recent.churn,0,'VERSION-only changes must not earn substantive churn');
  assert.equal(get(model,days[19]).previous.churn,0);
  assert.equal(get(model,days[19]).recent.releaseLines,0);
  assert.equal(get(model,'2026-01-31').reason,'weekend');
  assert.equal(get(model,'2026-02-02').releaseLines,200);
  assert.equal(get(model,'2026-02-02').releases[0].tag,'v1');
  assert.ok(get(model,'2026-02-02').score>get(model,days[19]).score);
});

test('monthly cells average signed weekday results, excluding weekends, out-of-coverage and warm-up',()=>{
  const days=workdays('2026-01-05',30);
  const activity=days.slice(12,24).map(d=>change('0',d,100));
  const history=withHistory(activity,[],{min:days[0],max:days[26]});
  const model=momentumMatrix(history,[contributor()],{from:'2026-01-01',to:days[29]},{workdays:5});
  const row=model.byId.get('0');
  assert.equal(get(model,'2026-01-01').score,null);
  assert.equal(get(model,days[8]).reason,'insufficient-history');
  assert.equal(get(model,days[9]).reason,'scored');
  assert.equal(get(model,days[27]).reason,'outside-history');
  assert.equal(get(model,'2026-01-24').reason,'weekend');
  for (const bucket of row.months.values()) {
    const eligible=[...row.daily.values()].filter(d=>d.reason==='scored'&&d.date.startsWith(bucket.month));
    assert.equal(bucket.days,eligible.length);
    assert.equal(bucket.score,Math.round(eligible.reduce((n,d)=>n+d.score,0)/eligible.length*10)/10);
    assert.equal(bucket.buildingDays,eligible.filter(d=>d.direction==='building').length);
    assert.equal(bucket.coolingDays,eligible.filter(d=>d.direction==='cooling').length);
  }
  assert.equal(model.workdays,5);
  assert.equal(momentumMatrix(history,[contributor()],{from:days[19],to:days[19]},{workdays:123}).workdays,10);
});

test('tagged release ancestry and reconciled authored identities are honoured by momentum',()=>{
  const h=c=>c.repeat(40);
  const log=[
    `TAG|v1.0||${h('a')}|commit|2026-01-05T12:00:00Z`,
    `TAG|v1.1||${h('d')}|commit|2026-02-03T12:00:00Z`,
    `COMMIT|${h('d')}|ada@home|Ada|2026-02-02T12:00:00Z|2026-02-02T12:00:00Z|feat|${h('c')}`,
    '50\t20\tapp/foo.rb',
    `COMMIT|${h('c')}|ben@work|Ben|2026-01-22T12:00:00Z|2026-01-22T12:00:00Z|release version|${h('b')}`,
    '999\t0\tVERSION',
    `COMMIT|${h('b')}|ada@work|Ada|2026-01-10T12:00:00Z|2026-01-10T12:00:00Z|docs|${h('a')}`,
    '10\t0\tdocs/readme.md',
    `COMMIT|${h('a')}|ada@work|Ada|2026-01-04T12:00:00Z|2026-01-04T12:00:00Z|initial|`,
    '1\t0\tapp/initial.rb',
  ].join('\n');
  const git=parseGitHistory(log);
  const groups=[{displayName:'Ada',emails:['ada@work','ada@home']},{displayName:'Ben',emails:['ben@work']}];
  const full=buildAnalysis(git.commits,groups,{start:'2026-01-04',end:'2026-02-05',includeReverts:true,includeMerges:false});
  const impact=impactAnalysis(full,git.commits,git.tags,{skipFollowup:true});
  const index=buildEvidenceIndex(full,impact,{min:'2026-01-04',max:'2026-02-05'});
  assert.equal(index.releases[1].members.find(m=>m.id==='0').releaseLineChurn,80);
  const selected=buildAnalysis(git.commits,groups,{start:'2026-02-03',end:'2026-02-05',selectedIds:new Set(['0'])});
  const model=momentumMatrix(index,selected.contributors,{from:'2026-02-03',to:'2026-02-05'});
  assert.equal(get(model,'2026-02-03').releaseLines,80);
  assert.equal(get(model,'2026-02-03').recent.churn,70,'full history includes the renamed email');
  assert.equal(model.rows.length,1);
  assert.equal(get(model,'2026-02-03').direction,'building');
  assert.ok(get(model,'2026-02-03').score>0);
});

test('legacy or partial evidence cannot manufacture comparable pre-window history',()=>{
  const days=workdays('2026-01-05',22);
  const history=withHistory([],[],{min:days[0],max:days.at(-1)});
  delete history.activity;
  const result=momentumMatrix(history,[contributor()],{from:days[19],to:days.at(-1)});
  assert.equal(get(result,days[19]).score,null);
  assert.equal(get(result,days[19]).reason,'outside-history');
  assert.equal(result.available,false);
});

test('three Pulse lenses, settings, explanatory notes and export roundtrip are wired',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
  for(const lens of ['activity','release-gap','momentum'])assert.match(html,new RegExp(`data-pulse-lens="${lens}"`));
  for(const id of ['pulse-momentum-settings','pulse-momentum-workdays','pulse-momentum-summary','pulse-daily-churn'])
    assert.ok(html.includes(`id="${id}"`));
  assert.match(app,/pulseMomentum=momentumMode\?momentumMatrix\(perspectiveIndex,view\.contributors/);
  assert.match(app,/pulseDailyChurn:state\.pulseDailyChurn,pulseMomentumWorkdays:state\.pulseMomentumWorkdays/);
  assert.match(app,/MOMENTUM_WINDOWS\.includes\(s\.pulseMomentumWorkdays\)/);
  assert.match(app,/DAILY_CHURN_THRESHOLDS\.includes\(s\.pulseDailyChurn\)/);
  assert.match(app,/\['activity','release-gap','momentum'\]\.includes\(s\.pulseLens\)/);
  assert.match(app,/pulseDayMarkup\(details,gapItem,momentumItem\)/);
  assert.ok(MOMENTUM_DIRECTION_THRESHOLD>0);
});
