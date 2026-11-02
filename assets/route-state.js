/** Small, stable, non-sensitive navigation URLs. Never encode imported evidence. */
const MODES=new Set(['observatory','periods','contributors','codebase','deployments','evidence']);
const TABS=new Set(['delivery','together','focus','behaviour','evolution','compare']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const dateOk=value=>{if(!DATE.test(String(value)))return false;const ms=Date.parse(`${value}T00:00:00Z`);return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;};
const SHA=/^[a-f0-9]{7,64}$/i;
const EMAIL=/^[^\s@]{1,160}@[^\s@]{1,160}$/;
const DATA=/^[a-zA-Z0-9_-]{8,100}$/;
const keys=['view','release','person','tab','partner','personB','personC','from','to','area','environment','event','dataset'];
const emailFor=(id,groups)=>groups?.find(g=>String(g.id)===String(id))?.emails?.[0]||null;
const idFor=(email,groups)=>groups?.find(g=>g.emails?.some(e=>e.toLowerCase()===email.toLowerCase()))?.id??null;
const add=(q,name,value,valid=()=>true)=>{if(value!=null&&value!==''&&valid(String(value)))q.set(name,String(value));};
export function routeFromState(ui,groups=[],datasetId=null){
  const mode=ui?.mode||'observatory',r={view:MODES.has(mode)?mode:'observatory'};
  if(mode==='observatory')r.release=ui.releaseHash;
  if(mode==='periods')r.person=emailFor(ui.periodSelectedId,groups);
  if(mode==='contributors'){
    r.person=emailFor(ui.contributorFocus,groups);
    r.tab=ui.contributorTab;
    r.partner=emailFor(ui.coReleasePartner,groups);
    r.personB=emailFor(ui.compareB,groups);
    r.personC=emailFor(ui.compareC,groups);
  }
  if(mode==='periods'||mode==='contributors'&&ui.contributorRange==='period'){
    r.from=ui.periodFrom;r.to=ui.periodTo;
  }
  if(mode==='codebase'){r.area=ui.codeArea;if(ui.codebaseRange==='period'){r.from=ui.periodFrom;r.to=ui.periodTo;}}
  if(mode==='deployments'){
    r.environment=ui.deploymentEnv;r.event=ui.deploymentFocus;
  }
  if(datasetId)r.dataset=datasetId;
  return r;
}
export function readRoute(source){
  const query=source instanceof URL?source.searchParams:new URLSearchParams(String(source).replace(/^\?/,''));
  const value=key=>query.get(key);
  const r={view:MODES.has(value('view'))?value('view'):'observatory'};
  if(SHA.test(value('release')||''))r.release=value('release').toLowerCase();
  for(const key of ['person','partner','personB','personC'])if(EMAIL.test(value(key)||''))r[key]=value(key).toLowerCase();
  if(TABS.has(value('tab')))r.tab=value('tab');
  if(dateOk(value('from')||'')&&dateOk(value('to')||'')&&value('from')<=value('to')){
    r.from=value('from');r.to=value('to');
  }
  if(value('area')?.length<=140&&value('area'))r.area=value('area');
  if(['all','STAG','BETA','PROD'].includes(value('environment')))r.environment=value('environment');
  if(value('event')?.length<=120&&/^[\w-]+$/.test(value('event')))r.event=value('event');
  if(DATA.test(value('dataset')||''))r.dataset=value('dataset');
  return r;
}
export function applyRoute(ui,route,groups=[]){
  const next={...ui,mode:route.view||'observatory',trail:[]};
  if(route.release)next.releaseHash=route.release;
  if(route.person){const id=idFor(route.person,groups);if(id!=null){
    if(next.mode==='periods')next.periodSelectedId=String(id);
    else next.contributorFocus=String(id);
  }}
  if(route.partner){const id=idFor(route.partner,groups);if(id!=null)next.coReleasePartner=String(id);}
  if(route.personB){const id=idFor(route.personB,groups);if(id!=null)next.compareB=String(id);}
  if(route.personC){const id=idFor(route.personC,groups);if(id!=null)next.compareC=String(id);}
  if(route.tab)next.contributorTab=route.tab;
  if(route.from&&route.to){next.periodFrom=route.from;next.periodTo=route.to;next.periodPreset='custom';
    if(next.mode==='contributors')next.contributorRange='period';
    if(next.mode==='codebase')next.codebaseRange='period';
  }
  if(route.area){next.codeArea=route.area;}
  if(route.environment)next.deploymentEnv=route.environment;
  if(route.event){next.deploymentFocus=route.event;next.deploymentYear='all';next.deploymentEnv='all';}
  return next;
}
export function routeUrl(path,route){
  const params=new URLSearchParams();
  add(params,'view',route.view, v=>MODES.has(v));
  add(params,'release',route.release,v=>SHA.test(v));
  for(const k of ['person','partner','personB','personC'])add(params,k,route[k],v=>EMAIL.test(v));
  add(params,'tab',route.tab,v=>TABS.has(v));
  if(route.from&&route.to&&dateOk(route.from)&&dateOk(route.to)&&route.from<=route.to){params.set('from',route.from);params.set('to',route.to);}
  add(params,'area',route.area,v=>v.length<=140);
  add(params,'environment',route.environment,v=>['all','STAG','BETA','PROD'].includes(v));
  add(params,'event',route.event,v=>v.length<=120&&/^[\w-]+$/.test(v));
  add(params,'dataset',route.dataset,v=>DATA.test(v));
  return `${path||'./'}?${params.toString()}`;
}
export function targetUrl(path,ui,groups,datasetId,changes){
  const base=routeFromState(ui,groups,datasetId);
  const view=changes.view||base.view;
  // Avoid stale detail query parameters when navigating to another kind of object.
  const next={dataset:base.dataset,view};
  if(view==='periods'){next.from=base.from;next.to=base.to;}
  if((view==='contributors'||view==='codebase')&&(ui?.mode==='periods'||(view==='contributors'&&ui?.mode==='contributors'&&ui?.contributorRange==='period')||(view==='codebase'&&ui?.mode==='codebase'&&ui?.codebaseRange==='period'))){next.from=ui?.periodFrom;next.to=ui?.periodTo;}
  return routeUrl(path,{...next,...changes});
}
export const routeKeys=keys;
