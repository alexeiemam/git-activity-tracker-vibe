import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  ZERO_COLOUR, MISSING_BACKGROUND, makeIntensityScale, intensityPosition,
  intensityColour, intensityTextColour, intensityStyle, intensityLegend, intensitySwatches,
} from '../assets/value-colour.js';
import {impactReleaseMatrix} from '../assets/impact-view.js';

function luminance(hex) {
  const channels=[1,3,5].map(n=>{
    const c=parseInt(hex.slice(n,n+2),16)/255;
    return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
  });
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}
function contrast(a,b) {
  const light=Math.max(luminance(a),luminance(b)),dark=Math.min(luminance(a),luminance(b));
  return (light+.05)/(dark+.05);
}

test('zero is categorically neutral and the first positive value is conspicuous',()=>{
  const scale=makeIntensityScale([0,1,10,100,1000]);
  assert.equal(intensityColour(0,scale),ZERO_COLOUR);
  assert.notEqual(intensityColour(1,scale),ZERO_COLOUR);
  assert.ok(luminance(ZERO_COLOUR)-luminance(intensityColour(1,scale))>.24);
  // With 0, 1 and 2, no-activity -> some-activity must be the stronger transition.
  const small=makeIntensityScale([0,1,2]);
  const absentToPresent=luminance(ZERO_COLOUR)-luminance(intensityColour(1,small));
  const presentToMore=luminance(intensityColour(1,small))-luminance(intensityColour(2,small));
  assert.ok(absentToPresent>presentToMore);
  assert.ok(!intensityColour(1,scale).startsWith('rgba'));
  assert.match(intensityStyle(0,scale), /background:#edf1ec/);
});

test('positive gradient spreads distinguishable bands across several orders of magnitude',()=>{
  const scale=makeIntensityScale([0,1,10,100,1000]);
  const values=[1,10,100,1000];
  const shades=values.map(n=>intensityColour(n,scale));
  assert.equal(new Set(shades).size,values.length);
  const lights=shades.map(luminance);
  for(let i=1;i<lights.length;i++) assert.ok(lights[i-1]-lights[i]>.06,`${values[i-1]} and ${values[i]} should be visually distinguishable`);
  assert.ok(Math.abs(intensityPosition(10,scale)-1/3)<1e-8);
  assert.ok(Math.abs(intensityPosition(100,scale)-2/3)<1e-8);
});

test('small fractional positives, isolated positive cells and absent observations stay distinct',()=>{
  const scale=makeIntensityScale([null,NaN,-1,0,.002,.02,2]);
  assert.equal(scale.minPositive,.002);
  assert.equal(scale.max,2);
  assert.notEqual(intensityColour(.002,scale),intensityColour(0,scale));
  assert.equal(intensityColour(null,scale),null);
  assert.equal(intensityColour(NaN,scale),null);
  assert.match(intensityStyle(null,scale), /repeating-linear-gradient/);
  assert.match(intensityStyle(undefined,scale), /repeating-linear-gradient/);
  assert.match(intensityStyle(0,scale), /background:#edf1ec/);
  assert.equal(intensityColour(3,makeIntensityScale([0,3])),intensityColour(10,makeIntensityScale([0,10])));
  assert.deepEqual(intensitySwatches(makeIntensityScale([0,0])),[0]);
  assert.deepEqual(intensitySwatches(makeIntensityScale([1])),[0,1]);
  assert.match(MISSING_BACKGROUND,/repeating-linear-gradient/);
});

test('numeric cell labels have readable foreground colours at zero and every positive intensity',()=>{
  const scale=makeIntensityScale([0,1,100000]);
  for(const v of [0,1,2,5,10,100,1000,10000,100000]) {
    const ratio=contrast(intensityColour(v,scale),intensityTextColour(v,scale));
    assert.ok(ratio>=4.5,`WCAG AA contrast for value ${v}: ${ratio.toFixed(2)}`);
  }
});

test('legends present 0, positive gradient and distinct missing state',()=>{
  const scale=makeIntensityScale([0,1,500]);
  const html=intensityLegend(scale,n=>`${Math.round(n)} commits`,{missing:true});
  assert.match(html,/0 · none/);
  assert.match(html,/500 commits · highest/);
  assert.match(html,/unavailable/);
  assert.match(html,/numeric-key-swatch is-zero/);
  assert.equal((html.match(/class="numeric-key-swatch /g)||[]).length,6);
});

test('impact contributor matrix uses the shared scale and distinguishes zero from missing',()=>{
  const model={metric:'share',referenceLabel:'repository',releases:[
    {hash:'a',tag:'v1',date:'2025-01-01',cells:[{name:'A',value:0},{name:'B',value:null}]},
    {hash:'b',tag:'v2',date:'2025-02-01',cells:[{name:'A',value:0.2},{name:'B',value:80}]},
  ]};
  const markup=impactReleaseMatrix(model,true);
  assert.match(markup,/background:#edf1ec/);
  assert.match(markup,/repeating-linear-gradient/);
  assert.match(markup,/80% · highest/);
  assert.doesNotMatch(markup,/background:rgba\(/);
});

test('every numeric heatmap is routed through the shared palette rather than opacity',async()=>{
  const app=await readFile(new URL('../assets/app.js',import.meta.url),'utf8');
  const impact=await readFile(new URL('../assets/impact-view.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const name of ['renderMonthlyPulse','renderDailyPulse','rhythmHeatmap','rhythmClock','rhythmBars','renderSeasonMonthMatrix','renderSeasonRhythmYears']) {
    assert.match(app,new RegExp(`function ${name}\\(`));
  }
  assert.ok((app.match(/intensityStyle\(/g)||[]).length>=4);
  assert.ok((impact.match(/intensityStyle\(/g)||[]).length>=2);
  assert.match(app,/intensityColour\(cell.count,scale\)/);
  assert.match(html,/id="pulse-key"/);
  assert.doesNotMatch(app,/data-level=/);
});
