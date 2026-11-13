/**
 * Incremental repository evidence is a UNION, never a replacement of author
 * mappings or a second count of an overlapping capture. This module is shared
 * by the parser, the analysis worker and the compatibility path.
 */
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const lower = value => String(value || '').toLowerCase();
const keyCommit = commit => lower(commit.hash);
const keyTag = tag => String(tag.name || '');
const keyRelease = release => String(release.tag || '');
const keyHeroku = event => event.version != null
  ? `${event.env}|version:${event.version}`
  : `${event.env}|${event.at}|${event.kind}|${event.rawSha || ''}|${event.description || ''}`;
const keyEnrichment = record => lower(record.sha);

export const statusRank = (status, provider='github') => {
  const ranks = provider === 'heroku'
    ? {'not-captured':0,'missing-remote':1,'missing-cli':1,unavailable:1,partial:2,ok:3}
    : {'not-captured':0,'missing-cli':1,'unsupported-origin':1,unavailable:1,ok:2};
  return ranks[status] ?? 0;
};
export function bestCaptureStatus(previous, incoming, provider='github') {
  return statusRank(incoming,provider) > statusRank(previous,provider) ? incoming : previous || 'not-captured';
}

/** An ignored/invalid paste must not be mistaken for a successful no-op import.
 * Metadata-only updates (including status and ancestry records) are valid. */
export function hasImportableEvidence(history) {
  return ['commits','tags','githubReleases','herokuReleases','historyEnrichment','shallowBoundaries']
    .some(key=>history?.[key]?.length>0) ||
    (history?.githubStatus && history.githubStatus!=='not-captured') ||
    Object.values(history?.herokuStatus||{}).some(status=>status!=='not-captured');
}

function preferredCommit(before, after) {
  // The SHA is authoritative. Never silently reassign an existing SHA to a
  // different author/date, even if a later paste is malformed.
  if (before.email !== after.email || before.date !== after.date) return before;
  const oldFiles=before.files?.length || 0, newFiles=after.files?.length || 0;
  const oldParents=before.parentsKnown ? 1 : 0, newParents=after.parentsKnown ? 1 : 0;
  if (newParents > oldParents || (newParents === oldParents && newFiles > oldFiles)) {
    return {...before, ...after, files:newFiles >= oldFiles ? after.files : before.files,
      touchesVersion: newFiles >= oldFiles ? after.touchesVersion : before.touchesVersion,
      parents: newParents >= oldParents ? after.parents : before.parents,
      parentsKnown: !!(newParents || oldParents)};
  }
  // Enrich missing numstat even if the old capture had better ancestry.
  if (newFiles > oldFiles) return {...before,files:after.files,touchesVersion:after.touchesVersion};
  return before;
}
function preferredTag(before, after) {
  if (lower(before.hash) !== lower(after.hash)) return after; // a tag was moved
  const completeness = tag => Number(!!tag.taggedAt) + Number(!!tag.taggerEmail) + Number(!!tag.annotated);
  return completeness(after) > completeness(before) ? after : before;
}
function preferredHeroku(before,after) {
  const completeness = event => Number(!!event.actorEmail)+Number(!!event.rawSha)+Number(!!event.outcome && event.outcome !== 'unreported');
  return completeness(after) >= completeness(before) ? after : before;
}
function preferredEnrichment(before,after) {
  const ranks={unavailable:0,bounded:1,complete:2};
  const first=ranks[before.status]??0, second=ranks[after.status]??0;
  return second > first || (second === first && after.limitCount > before.limitCount) ? after : before;
}
function unionRecords(previous=[],incoming=[],keyOf,choose=(_before,after)=>after) {
  const map=new Map(),counts={added:0,updated:0};
  for(const record of previous || []){
    const key=keyOf(record);
    if (!key) continue;
    map.set(key,map.has(key)?choose(map.get(key),record):record);
  }
  for(const record of incoming || []){
    const key=keyOf(record);
    if (!key) continue;
    if (!map.has(key)) {map.set(key,record);counts.added++;continue;}
    const before=map.get(key),after=choose(before,record);
    if(!same(before,after)){map.set(key,after);counts.updated++;}
  }
  return {values:[...map.values()],...counts};
}

export function mergeGitHistories(previous={},incoming={}) {
  const sources={
    commits:unionRecords(previous.commits,incoming.commits,keyCommit,preferredCommit),
    tags:unionRecords(previous.tags,incoming.tags,keyTag,preferredTag),
    githubReleases:unionRecords(previous.githubReleases,incoming.githubReleases,keyRelease),
    herokuReleases:unionRecords(previous.herokuReleases,incoming.herokuReleases,keyHeroku,preferredHeroku),
    historyEnrichment:unionRecords(previous.historyEnrichment,incoming.historyEnrichment,keyEnrichment,preferredEnrichment),
  };
  // Older fixtures can lack a usable commit SHA. Preserve them once, rather
  // than losing evidence or deduplicating unrelated records under ''.
  const noHash=[...(previous.commits||[]),...(incoming.commits||[])].filter(c=>!keyCommit(c));
  sources.commits.values.push(...noHash);
  sources.commits.added+=(incoming.commits||[]).filter(c=>!keyCommit(c)).length;
  const shallowBoundaries=[...new Set([...(previous.shallowBoundaries||[]),...(incoming.shallowBoundaries||[])].map(lower))];
  const shallowHashes=new Set(shallowBoundaries);
  let shallowUpdates=0;
  sources.commits.values=sources.commits.values.map(commit=>{
    if(!shallowHashes.has(lower(commit.hash))||!commit.parentsKnown)return commit;
    shallowUpdates++;
    return {...commit,parentsKnown:false};
  });
  const githubStatus=bestCaptureStatus(previous.githubStatus,incoming.githubStatus);
  const herokuStatus={};
  for(const env of ['STAG','BETA','PROD'])
    herokuStatus[env]=bestCaptureStatus(previous.herokuStatus?.[env],incoming.herokuStatus?.[env],'heroku');
  const captureWarnings=[...new Set([...(previous.captureWarnings||[]),...(incoming.captureWarnings||[])])];
  const changes=Object.fromEntries(Object.entries(sources).map(([key,value])=>[key,{added:value.added,updated:value.updated}]));
  changes.commits.updated+=shallowUpdates;
  changes.shallowBoundariesAdded=shallowBoundaries.length-(previous.shallowBoundaries||[]).length;
  changes.statusChanged=githubStatus !== (previous.githubStatus||'not-captured') ||
    Object.keys(herokuStatus).some(env=>herokuStatus[env] !== (previous.herokuStatus?.[env]||'not-captured'));
  changes.warningsAdded=captureWarnings.length-(previous.captureWarnings||[]).length;
  const changed=Object.values(sources).some(value=>value.added||value.updated) ||
    shallowUpdates>0 || changes.shallowBoundariesAdded>0 || changes.statusChanged || changes.warningsAdded>0;
  return {
    history:{commits:sources.commits.values,tags:sources.tags.values,githubReleases:sources.githubReleases.values,
      herokuReleases:sources.herokuReleases.values,historyEnrichment:sources.historyEnrichment.values,
      shallowBoundaries,githubStatus,herokuStatus,captureWarnings},
    changes,changed,
  };
}

/** A truly full re-capture can replace the old raw text rather than growing
 * the session every time. Partial updates must be appended so no old evidence
 * is silently discarded. */
export function isCompleteRecapture(previous, incoming, combined) {
  const keys={commits:keyCommit,tags:keyTag,githubReleases:keyRelease,
    herokuReleases:keyHeroku,historyEnrichment:keyEnrichment};
  for(const [name,keyOf] of Object.entries(keys)) {
    const latest=incoming[name]||[],all=combined[name]||[];
    if(latest.length!==all.length)return false;
    const recaptured=new Map(latest.map(row=>[keyOf(row),row]));
    if(all.some(row=>!recaptured.has(keyOf(row))||!same(row,recaptured.get(keyOf(row)))))return false;
  }
  if((combined.shallowBoundaries||[]).some(hash=>!(incoming.shallowBoundaries||[]).includes(hash)))return false;
  return combined.githubStatus === incoming.githubStatus &&
    ['STAG','BETA','PROD'].every(env=>combined.herokuStatus?.[env]===incoming.herokuStatus?.[env]) &&
    combined.captureWarnings.every(warning=>incoming.captureWarnings?.includes(warning));
}

/** Remove unchanged commit blocks from a partial overlapping capture before
 * storing its raw text in a portable session. Full re-captures are stored as-is.
 * Keep changed metadata and upgraded commit records so reparsing is lossless. */
export function compactAdditionalCapture(previousRaw, incomingRaw, previous, combined) {
  const before=new Map((previous.commits||[]).filter(c=>keyCommit(c)).map(c=>[keyCommit(c),c]));
  const changed=new Set((combined.commits||[]).filter(c=>{
    const old=before.get(keyCommit(c));
    return !old||!same(old,c);
  }).map(keyCommit));
  const knownMetadata=new Set(String(previousRaw||'').split(/\r?\n/).map(row=>row.trim())
    .filter(row=>/^(?:TAG|GHRELEASE|GHSTATUS|HEROKU|HEROKUSTATUS|HISTORYENRICH|HISTORYSHALLOW)\|/.test(row)));
  const result=[];
  let commitBlock=null,keep=false;
  const flush=()=>{if(keep&&commitBlock)result.push(...commitBlock);commitBlock=null;keep=false;};
  for(const row of String(incomingRaw||'').split(/\r?\n/)) {
    const line=row.trim();
    if(/^COMMIT\|/.test(line)){
      flush();
      const sha=lower(line.split('|',3)[1]);
      keep=!before.has(sha)||changed.has(sha);
      commitBlock=[row];
    }else if(/^(?:TAG|GHRELEASE|GHSTATUS|HEROKU|HEROKUSTATUS|HISTORYENRICH|HISTORYSHALLOW)\|/.test(line)){
      flush();
      if(!knownMetadata.has(line)){result.push(row);knownMetadata.add(line);}
    }else if(commitBlock){
      commitBlock.push(row);
    }
  }
  flush();
  return result.join('\n').trim();
}
