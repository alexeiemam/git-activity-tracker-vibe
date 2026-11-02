import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {parseGitHistory} from '../assets/domain.js';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const command=html.match(/<code id="git-cmd">([^<]+)<\/code>/)?.[1]?.replaceAll('&gt;','>').replaceAll('&amp;','&').replace(/\s*\| pbcopy\s*$/,'');
const row=v=>({version:v,created_at:`2026-10-29T17:${String(v%60).padStart(2,'0')}:03Z`,description:v===2238?'Set VERY_SECRET_CONFIG_KEY config vars':`Deploy ${'a'.repeat(40)}`,status:'succeeded',user:{email:v===2238?'ops@work.test':'developer@work.test'}});

test('the standard shell command paginates two older Heroku API pages and redacts config keys',()=>{
  assert.ok(command);
  const dir=mkdtempSync(join(tmpdir(),'signals-heroku-pages-'));
  try{
    execFileSync('git',['init','-q'],{cwd:dir});
    execFileSync('git',['config','user.name','Tester'],{cwd:dir});
    execFileSync('git',['config','user.email','tester@work.test'],{cwd:dir});
    writeFileSync(join(dir,'README.md'),'sample');
    execFileSync('git',['add','README.md'],{cwd:dir});
    execFileSync('git',['commit','-q','-m','test: source'],{cwd:dir});
    writeFileSync(join(dir,'first.json'),JSON.stringify(Array.from({length:1000},(_,i)=>row(2300-i))));
    const cli=join(dir,'heroku');
    writeFileSync(cli,`#!/bin/sh\nif [ "$1" = "auth:token" ]; then printf 'fake-token\\n'; else cat "$GIT_SIGNALS_HEROKU_FIRST"; fi\n`);
    chmodSync(cli,0o755);
    // Prevent network access: simulate exactly the two older Platform API pages.
    writeFileSync(join(dir,'sitecustomize.py'),`import io, json, os, re, urllib.request\nif os.getenv('GIT_SIGNALS_FAKE_API')=='1':\n def fake(request,timeout=None):\n  raw=request.get_header('Range')\n  cap=int(re.search(r'version \\.\\.(\\d+)',raw).group(1))\n  start=min(1000,cap)\n  if cap==1300: start=1300\n  rows=[{'version':v,'created_at':'2026-10-29T12:00:00Z','description':'Deploy aaaaaaa','status':'succeeded','user':{'email':'developer@work.test'}} for v in range(start,max(0,start-1000),-1)]\n  return io.BytesIO(json.dumps(rows).encode())\n urllib.request.urlopen=fake\n`);
    const python=join(dir,'python3');
    const realPython=execFileSync('which',['python3'],{encoding:'utf8'}).trim();
    writeFileSync(python,`#!/bin/sh\nif [ "$1" = "-c" ]; then shift; exec "${realPython}" -c 'import runpy,sys;runpy.run_path(sys.argv[1]);exec(sys.argv[2])' "$GIT_SIGNALS_TEST_SITE" "$1"; else exec "${realPython}" "$@"; fi\n`);
    chmodSync(python,0o755);
    const script=`git() { if [ "$1" = fetch ]; then return 0; fi; if [ "$1" = remote ] && [ "$2" = get-url ]; then printf 'https://git.heroku.com/fake-app.git\\n'; return 0; fi; command git "$@"; }\ngh(){ return 1; }\n${command}`;
    const output=execFileSync('bash',['-c',script],{
      cwd:dir,encoding:'utf8',maxBuffer:15*1024*1024,timeout:35000,
      env:{...process.env,PATH:`${dir}:${process.env.PATH}`,PYTHONPATH:dir,GIT_SIGNALS_FAKE_API:'1',GIT_SIGNALS_TEST_SITE:join(dir,'sitecustomize.py'),GIT_SIGNALS_HEROKU_FIRST:join(dir,'first.json')},
    });
    const parsed=parseGitHistory(output);
    for(const env of ['STAG','BETA','PROD']){
      assert.equal(parsed.herokuReleases.filter(e=>e.env===env).length,2300,env);
      assert.equal(parsed.herokuStatus[env],'ok',env);
      assert.equal(parsed.herokuReleases.find(e=>e.env===env&&e.version===2238)?.kind,'config');
    }
    assert.equal(parsed.commits.length,1);
    assert.doesNotMatch(output,/VERY_SECRET_CONFIG_KEY/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
