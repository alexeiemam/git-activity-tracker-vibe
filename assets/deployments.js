/**
 * Heroku release history: recorded environment events, not a presumed
 * STAG -> BETA -> PROD promotion pipeline. No Heroku config values are read.
 * The only positive code link is an unambiguous Git SHA and its ancestry.
 */
export const DEPLOYMENT_ENVS=Object.freeze(['STAG','BETA','PROD']);
const SHA_RE=/^[a-f\d]{7,64}$/i;
const MAX_BATCH=16_000_000;
export const HEROKU_CAPTURE_LIMIT=3000;
const iso=value=>{
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?ms:null;
};
const day=ms=>ms==null?null:new Date(ms).toISOString().slice(0,10);
const clean=(value,max=140)=>String(value??'').trim().slice(0,max);
const releaseNumber=v=>{
  const match=String(v??'').match(/^v?(\d+)$/i);
  return match?Number(match[1]):null;
};
const releaseActor=item=>{
  const value=typeof item.user==='string'?item.user:item.user?.email??item.actor?.email??item.user_email;
  const email=String(value||'').trim().toLowerCase();
  return /^[^\s@<>]{1,100}@[^\s@<>]{1,120}$/.test(email)?email.slice(0,220):null;
};
const isConfigDescription=value=>
  /^\s*(?:Config\b|(?:Set|Unset|Remove|Update|Changed?|Add|Delete)\b.*\bconfig\s+vars?\b|(?:Set|Unset|Update)\s+config\b)/i.test(value);
const configLabel=value=>{
  // Retain the action, never config keys, values or arbitrary descriptions.
  const verb=String(value).trim().match(/^(Set|Unset|Remove|Update|Changed?|Add|Delete)\b/i)?.[1]?.toLowerCase();
  return verb==='set'||verb==='add'?'Set config vars':
    verb==='unset'||verb==='remove'||verb==='delete'?'Unset config vars':
    verb==='update'||verb==='change'||verb==='changed'?'Update config vars':'Configuration change';
};
const shaFromDescription=description=>{
  // Do not treat an arbitrary SHA mentioned in a note as a deployment.
  const hit=String(description||'').match(/^\s*(?:Deploy(?:ed)?|Build)\s+([a-f\d]{7,64})(?=\b|\s|$)/i);
  return hit?hit[1].toLowerCase():null;
};

/** A single base64-encoded CLI JSON ARRAY per environment; no jq needed. */
export function decodeHerokuBatch(encoded,env) {
  if(!DEPLOYMENT_ENVS.includes(env)||typeof encoded!=='string'||encoded.length>MAX_BATCH ||
      !/^[A-Za-z\d+/]+={0,2}$/.test(encoded))return null;
  try {
    const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const entries=Array.isArray(parsed)?parsed:Array.isArray(parsed?.releases)?parsed.releases:null;
    if(!entries||entries.length>20_000)return null;
    const seen=new Set(),result=[];
    for(const item of entries){
      if(!item||typeof item!=='object'||Array.isArray(item))continue;
      const at=iso(item.created_at??item.createdAt);
      if(at===null)continue;
      const version=releaseNumber(item.version??item.release);
      const description=clean(item.description??item.change,500);
      const rawSha=[item.commit,item.git_sha,item.sha,item.source_blob?.version,shaFromDescription(description)]
        .find(v=>typeof v==='string'&&SHA_RE.test(v.trim()))?.trim().toLowerCase()||null;
      const kind=isConfigDescription(description)?'config':
        /\brollback\b/i.test(description)?'rollback':
        /^\s*(?:Deploy|Build)\b/i.test(description)?'deploy':'other';
      const targetVersion=description.match(/\brollback\s+to\s+v?(\d+)\b/i)?.[1];
      // Config keys may be sensitive; do not retain config descriptions or
      // unknown JSON fields in the analysed model. Raw clipboard import is user-owned.
      const label=kind==='config'?configLabel(description):clean(description,160);
      const outcome=clean(item.status,30).toLowerCase()||'unreported';
      const unique=`${env}|${version??'?'}|${at}|${rawSha||''}|${label}`;
      if(seen.has(unique))continue;
      seen.add(unique);
      result.push({env,version,at,date:day(at),description:label,kind,rawSha,outcome,actorEmail:releaseActor(item),
        targetVersion:targetVersion?Number(targetVersion):null});
    }
    return result.sort((a,b)=>a.at-b.at||(a.version??0)-(b.version??0));
  }catch{return null;}
}

/** Build one compact, transferable deployment index in the analysis worker. */
export function buildDeploymentIndex(records=[],commits=[],index=null,status={}) {
  const input=records.filter(r=>r&&DEPLOYMENT_ENVS.includes(r.env)&&Number.isFinite(r.at));
  const hashes=commits.filter(c=>SHA_RE.test(c.hash||'')).map(c=>c.hash.toLowerCase());
  const byHash=new Map(commits.filter(c=>SHA_RE.test(c.hash||'')).map(c=>[c.hash.toLowerCase(),c]));
  const position=new Map(hashes.map((h,i)=>[h,i]));
  const bytes=Math.ceil(hashes.length/8);
  const prefix7=new Map();
  for(const hash of hashes){const p=hash.slice(0,7);if(!prefix7.has(p))prefix7.set(p,[]);prefix7.get(p).push(hash);}
  const resolve=short=>{
    if(!short||!SHA_RE.test(short))return {hash:null,reason:'missing'};
    const prefix=short.toLowerCase();
    if(byHash.has(prefix))return {hash:prefix,reason:'exact'};
    const possible=(prefix7.get(prefix.slice(0,7))||[]).filter(h=>h.startsWith(prefix));
    return possible.length===1?{hash:possible[0],reason:'abbreviated'}:
      {hash:null,reason:possible.length?'ambiguous':'not-imported'};
  };
  const cache=new Map();
  const ancestry=hash=>{
    if(cache.has(hash))return cache.get(hash);
    const bits=new Uint8Array(bytes),stack=[hash];let complete=true;
    while(stack.length){
      const next=stack.pop(),i=position.get(next);
      if(i===undefined){complete=false;continue;}
      const slot=i>>3,bit=1<<(i&7);
      if(bits[slot]&bit)continue;
      bits[slot]|=bit;
      const commit=byHash.get(next);
      if(!commit?.parentsKnown){complete=false;continue;}
      for(const parent of commit.parents||[])stack.push(parent.toLowerCase());
    }
    const out={bits,complete};cache.set(hash,out);return out;
  };
  const has=(graph,hash)=>{
    const i=position.get(hash);
    return graph&&i!==undefined&&!!(graph.bits[i>>3]&(1<<(i&7)));
  };
  const changes=(current,previous)=>{
    const out=[];
    for(let i=0;i<hashes.length;i++)if((current.bits[i>>3]&(1<<(i&7)))&&!(previous.bits[i>>3]&(1<<(i&7))))out.push(hashes[i]);
    return out;
  };
  const authoredByHash=new Map((index?.activity||[]).map(c=>[c.hash.toLowerCase(),c]));
  const names=new Map((index?.groups||[]).map(g=>[g.id,g.displayName]));
  const identityGroup=new Map((index?.groups||[]).flatMap(g=>g.emails.map(email=>[email.toLowerCase(),g])));
  const entries=[],state={},groups={};
  const firstProduction=new Map();
  const seenProduction=new Set();
  const releaseObservations=new Map((index?.releases||[]).map(r=>[r.hash,{releaseHash:r.hash,tag:r.tag,byEnv:{}}]));
  const releases=index?.releases||[];
  for(const env of DEPLOYMENT_ENVS){
    const history=input.filter(r=>r.env===env).sort((a,b)=>a.at-b.at||(a.version??0)-(b.version??0));
    let prior=null;
    const versions=new Map(), events=[];
    const earliest=history[0]?.at??null,latest=history.at(-1)?.at??null;
    for(let i=0;i<history.length;i++){
      const record=history[i],matched=resolve(record.rawSha);
      const succeeded=!['failed','pending','queued','error'].includes(record.outcome);
      let codeSha=succeeded?matched.hash:null, shaSource=matched.hash?matched.reason:'unknown';
      if(succeeded&&record.kind==='rollback'&&!codeSha){
        const target=versions.get(record.targetVersion);
        if(target?.codeSha){codeSha=target.codeSha;shaSource='rollback-version';}
      }
      if(succeeded&&record.kind==='config'&&!codeSha&&prior?.codeSha){
        codeSha=prior.codeSha;shaSource='config-inferred';
      }
      const graph=codeSha?ancestry(codeSha):null;
      // Unknown code state interrupts the interval: never bridge over an
      // unresolvable rollback/slug event and call the resulting diff exact.
      const before=prior?.codeSha&&prior.codeSha!==codeSha?ancestry(prior.codeSha):null;
      const changed=!!codeSha&&!!before&&codeSha!==prior.codeSha;
      const reliableDiff=changed&&graph?.complete&&before?.complete;
      const diff=reliableDiff?changes(graph,before):[];
      let type=!succeeded?'unsuccessful':record.kind==='config'?'config':record.kind==='rollback'?'rollback':
        !codeSha?'unknown':!prior?.codeSha?'baseline':codeSha===prior.codeSha?'same-revision':'code';
      if(succeeded&&record.kind==='deploy'&&codeSha&&prior?.codeSha===codeSha)type='redeploy';
      if(succeeded&&record.kind==='config'&&changed)type='config-and-code';
      // A Git SHA can move to an ancestor without an explicit Heroku
      // 'Rollback to vN' description, e.g. deployment of an older slug.
      if(succeeded&&record.kind==='deploy'&&changed&&graph?.complete&&before?.complete){
        if(has(before,codeSha))type='revision-rollback';
        else if(!has(graph,prior.codeSha))type='divergent-revision';
      }
      const people=new Map(),areas=new Map(), introduced=[];
      for(const hash of diff){
        const commit=authoredByHash.get(hash);
        if(!commit)continue;
        introduced.push(hash);
        const member=people.get(commit.groupId)||{id:commit.groupId,name:names.get(commit.groupId)||'Unknown',commits:0,paths:new Set()};
        member.commits++;for(const file of commit.files){member.paths.add(file.area);areas.set(file.area,(areas.get(file.area)||0)+1);}people.set(commit.groupId,member);
      }
      const actor=record.actorEmail?identityGroup.get(`heroku:${record.actorEmail}`)||identityGroup.get(record.actorEmail):null;
      const event={id:`${env}-${record.version??i}-${i}`,env,version:record.version,at:record.at,date:record.date,
        actorEmail:record.actorEmail||null,actorGroupId:actor?.id??null,actorName:actor?.displayName||null,
        type,description:record.description,outcome:record.outcome,codeSha,rawSha:record.rawSha,
        shaSource,hashStatus:record.rawSha&&!matched.hash?matched.reason:null,
        deltaReliable:!!reliableDiff,allNewCommits:reliableDiff?diff.length:null,
        eligibleNewCommits:reliableDiff?introduced.length:null,
        people:[...people.values()].sort((a,b)=>b.commits-a.commits).map(p=>({id:p.id,name:p.name,commits:p.commits,areas:p.paths.size})),
        areas:[...areas].sort((a,b)=>b[1]-a[1]).slice(0,12),
        sample:introduced.slice(-15),
        firstProdCommits:0,initialObservation:!prior?.codeSha,
        releaseTags:[],introducedReleaseTags:[]};
      if(env==='PROD'&&succeeded&&codeSha&&graph?.complete){
        // Seed the earliest known production snapshot without crediting its
        // historical commits as freshly deployed. A later rollback or
        // redeployment cannot turn those already-present commits into a
        // fabricated first production introduction.
        if(!reliableDiff){
          if(!prior?.codeSha||prior.codeSha!==codeSha)
            for(const hash of hashes)if(has(graph,hash))seenProduction.add(hash);
        }else{
          const eligible=new Set(introduced);
          for(const hash of diff){
            if(!seenProduction.has(hash)&&eligible.has(hash)&&['code','config-and-code','divergent-revision'].includes(type)){
              firstProduction.set(hash,{at:event.at,eventId:event.id,date:event.date});
              event.firstProdCommits++;
            }
            seenProduction.add(hash);
          }
        }
      }
      if(codeSha&&graph){
        // Only positive graph membership is asserted. A missing tag in an
        // incomplete ancestry is not proof of an exclusion.
        for(const release of releases){
          const tagHash=release.hash.toLowerCase();
          if(!has(graph,tagHash))continue;
          event.releaseTags.push(release.tag);
          if(reliableDiff&&!has(before,tagHash))event.introducedReleaseTags.push(release.tag);
          const observation=releaseObservations.get(release.hash);
          if(!observation.byEnv[env]){
            const certainty=before?.complete&&!has(before,tagHash)&&changed?'introduced': 'observed-by';
            observation.byEnv[env]={eventId:event.id,date:event.date,at:event.at,certainty,
              hoursSincePublication:!release.published||release.timestamp==null?null:Math.round((event.at-release.timestamp)/3600000*10)/10};
          }
        }
      }
      events.push(event);entries.push(event);
      if(succeeded){if(record.version!=null)versions.set(record.version,event);prior=event;}
    }
    groups[env]={status:status[env]||'not-captured',count:events.length,
      firstDate:day(earliest),lastDate:day(latest),latestKnownSha:prior?.codeSha||null,latestKnownDate:prior?.codeSha?prior.date:null,
      // A release list is a historical sample, never a live environment check.
      latestEventId:events.at(-1)?.id||null,
      codeEvents:events.filter(e=>['code','config-and-code','divergent-revision','revision-rollback'].includes(e.type)).length,
      configEvents:events.filter(e=>['config','config-and-code'].includes(e.type)).length,
      unknownEvents:events.filter(e=>['unknown','unsuccessful'].includes(e.type)).length,
      possibleTruncation:events.length>=HEROKU_CAPTURE_LIMIT||status[env]==='partial'};
  }
  entries.sort((a,b)=>a.at-b.at||DEPLOYMENT_ENVS.indexOf(a.env)-DEPLOYMENT_ENVS.indexOf(b.env));
  const qaComparison=Object.fromEntries(['STAG','BETA'].map(env=>{
    const qa=groups[env]?.latestKnownSha,prod=groups.PROD?.latestKnownSha;
    let relation='unavailable';
    if(qa&&prod){
      if(qa===prod)relation='same';
      else {
        const qaGraph=ancestry(qa),prodGraph=ancestry(prod);
        if(has(qaGraph,prod))relation='ahead-of-prod';
        else if(has(prodGraph,qa))relation='behind-prod';
        else if(qaGraph.complete&&prodGraph.complete)relation='diverged';
        else relation='unknown-ancestry';
      }
    }
    return [env,{relation,qaSha:qa||null,prodSha:prod||null,
      qaDate:groups[env]?.latestKnownDate||null,prodDate:groups.PROD?.latestKnownDate||null}];
  }));
  for(const release of releaseObservations.values()){
    const qa=DEPLOYMENT_ENVS.slice(0,2).flatMap(env=>release.byEnv[env]?[{env,...release.byEnv[env]}]:[])
      .sort((a,b)=>a.at-b.at);
    release.firstQa=qa[0]||null;
  }
  const productionByPerson=new Map();
  for(const [hash,record] of firstProduction){
    const commit=authoredByHash.get(hash);
    if(!commit)continue;
    const key=commit.groupId;
    if(!productionByPerson.has(key))productionByPerson.set(key,{id:key,name:names.get(key)||'Unknown contributor',commits:0,entries:new Map(),areas:new Map()});
    const person=productionByPerson.get(key);person.commits++;
    person.entries.set(record.eventId,(person.entries.get(record.eventId)||0)+1);
    for(const file of commit.files)person.areas.set(file.area,(person.areas.get(file.area)||0)+1);
  }
  return {available:entries.length>0,status:{...status},envs:groups,qaComparison,events:entries,
    releaseLinks:[...releaseObservations.values()],
    people:[...productionByPerson.values()].map(p=>({id:p.id,name:p.name,commits:p.commits,
      events:[...p.entries],areas:[...p.areas]})),
    note:'Only imported Heroku release history is observable. First snapshots and incomplete Git histories do not establish an exact first production date.',
  };
}
