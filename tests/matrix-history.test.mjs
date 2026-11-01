import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {impactMatrixWindow, impactMatrixPageForRelease, impactReleaseMatrix, impactReleaseMatrixCsv} from '../assets/impact-view.js';
import {intensityStyle,makeIntensityScale} from '../assets/value-colour.js';

const releases=Array.from({length:428},(_,i)=>{
  const year=2020+Math.floor(i/72);
  const month=String(1+Math.floor((i%72)/6)).padStart(2,'0');
  const day=String(1+i%6).padStart(2,'0');
  return {hash:`id-${i}`,tag:`v${year}.${i}`,date:`${year}-${month}-${day}`,transition:'patch',
    driver:{login:i===427?'@publisher':''},cells:['Ada','Ben','Cleo'].map((name,j)=>({name,id:`${j}`,value:i===427&&j===2?10000:j===0?2:(i%11),share:i%20,
    drove:i===427 && j===0,footprint:{commits:i%17,pathsCount:5,areasCount:2,churn:i*2}}))};
});
const model={metric:'commits',referenceLabel:'all imported contributors',releases};

test('428 releases are all reachable by bounded chronological pages, no duplicates or omissions',()=>{
  const first=impactMatrixWindow(releases);
  assert.equal(first.mode,'all');
  assert.equal(first.total,428);
  assert.equal(first.pages,24);
  assert.deepEqual(first.releases.map(r=>r.hash),releases.slice(-18).map(r=>r.hash));
  const seen=[];
  for(let page=0;page<first.pages;page++) {
    const window=impactMatrixWindow(releases,{page});
    assert.ok(window.releases.length<=18);
    seen.push(...window.releases.map(r=>r.hash));
  }
  assert.equal(seen.length,428);
  assert.equal(new Set(seen).size,428);
  assert.deepEqual(new Set(seen),new Set(releases.map(r=>r.hash)));
  assert.equal(impactMatrixWindow(releases,{page:999}).page,23);
  assert.equal(impactMatrixWindow(releases,{page:-1}).page,0);
  assert.deepEqual(impactMatrixWindow(releases,{mode:'latest'}).releases.map(r=>r.hash),first.releases.map(r=>r.hash));
});

test('direct jump finds even the earliest tag in a 428-release history',()=>{
  for(const index of [0,1,17,18,36,223,410,427]) {
    const page=impactMatrixPageForRelease(releases,`id-${index}`);
    const window=impactMatrixWindow(releases,{page});
    assert.ok(window.releases.some(r=>r.hash===`id-${index}`),`tag ${index} appears in page ${page}`);
  }
  assert.equal(impactMatrixPageForRelease(releases,'unreachable'),null);
});

test('year and page-size choices are display-only and never remove underlying release evidence',()=>{
  const filtered=impactMatrixWindow(releases,{mode:'all',year:'2024',size:36,page:1});
  assert.equal(filtered.total,72);
  assert.equal(filtered.pages,2);
  assert.equal(filtered.releases.length,36);
  assert.ok(filtered.releases.every(r=>r.date.startsWith('2024-')));
  assert.equal(impactMatrixWindow(releases,{mode:'all',year:'1990'}).total,428,'stale year filter does not silently blank the matrix');
  assert.equal(impactMatrixWindow(releases,{mode:'latest',year:'2024'}).total,18,'latest mode uses the complete scoped history');
});

test('release matrix exposes full-history navigation without mounting all columns',()=>{
  const markup=impactReleaseMatrix(model,{mode:'all',selectedHash:'id-427'});
  assert.match(markup,/Browse all 428/);
  assert.match(markup,/Latest 18/);
  assert.match(markup,/411–428 of 428/);
  assert.match(markup,/page 24 of 24/);
  assert.match(markup,/Jump to a tagged release/);
  assert.match(markup,/Export all 428/);
  assert.match(markup,/data-matrix-release="id-427" class="is-selected"/);
  assert.equal((markup.match(/data-matrix-release="/g)||[]).length,18);
  assert.match(markup,/v2025.427/);
  assert.doesNotMatch(markup,/<th data-matrix-release="id-15"/);
  const oldest=impactReleaseMatrix(model,{mode:'all',page:23});
  assert.match(oldest,/1–14 of 428/);
  assert.equal((oldest.match(/data-matrix-release="/g)||[]).length,14);
  assert.match(oldest,/v2020.0/);
});

test('the exact same numerical value keeps its colour across distant matrix pages',()=>{
  const older=impactReleaseMatrix(model,{mode:'all',page:23});
  const recent=impactReleaseMatrix(model,{mode:'latest'});
  const scale=makeIntensityScale(releases.flatMap(r=>r.cells.map(c=>c.value)));
  const sameColour=intensityStyle(2,scale);
  assert.ok(older.includes(`style="${sameColour}"`));
  assert.ok(recent.includes(`style="${sameColour}"`));
  assert.match(recent,/one scale for the entire scoped release history/);
});

test('CSV contains all release-contributor pairs even when browsing a limited page',()=>{
  const csv=impactReleaseMatrixCsv(model);
  assert.equal(csv.trimEnd().split('\r\n').length,1+428*3);
  assert.match(csv,/"v2020\.0"/);
  assert.match(csv,/"v2025\.427"/);
  assert.match(csv,/"Yes"/);
  const malicious={...model,releases:[{...releases[0],tag:'=BAD()',["cells"]:[{...releases[0].cells[0],name:'@evil()'}]}]};
  const safe=impactReleaseMatrixCsv(malicious);
  assert.match(safe,/"'=BAD\(\)"/);
  assert.match(safe,/"'@evil\(\)"/);
  const undefinedShare=impactReleaseMatrixCsv({...model,releases:[{...releases[0],cells:[{...releases[0].cells[0],share:null,value:null}]}]});
  assert.match(undefinedShare,/"","0","","5"/);
});

test('full-history controls only rerender the matrix and persist through exported sessions',async()=>{
  const app=await readFile(new URL('../assets/app.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(app,/function refreshImpactMatrix/);
  assert.match(app,/region\.innerHTML=impactReleaseMatrix/);
  assert.match(app,/'impact-matrix-page':/);
  assert.match(app,/case 'impact-matrix-release-select':if\(t\.value\)matrixJump/);
  assert.match(app,/impactMatrixMode:state\.impactMatrixMode/);
  assert.match(app,/state\.impactMatrixMode=s\.impactMatrixMode/);
  const version=html.match(/assets\/app\.js\?v=([^"\s]+)/)?.[1];
  assert.equal(version,'matrix-history-20261101-1');
});
