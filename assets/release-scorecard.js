/**
 * Verified tag-ancestry participation for the contributor comparison table.
 *
 * The selected period filters RELEASE EVENTS (GitHub published date when
 * available, else tag/commit date), not commit author dates. Release contents
 * retain their full reconstructed ancestry and the global merge/revert policy.
 * Baseline snapshots never count as incremental releases. A publisher/tagger
 * alone is not credited with authored release involvement or deployed work.
 */
import {validDate} from './domain.js?v=git-absolute-velocity-20261106-1';

const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

export function releaseScorecard(index,{from,to},contributors) {
  const byId=new Map((contributors||[]).map(c=>[String(c.id),{
    releases:0,commits:0,lines:0,actorEvents:0,partial:0,linesKnown:true,
  }]));
  const observed=Array.isArray(index?.releases)&&index.releases.length>0;
  const valid=validDate(from)&&validDate(to)&&from<=to;
  if(!observed||!valid)return {byId,available:false,inRange:0,partialReleases:0};
  let inRange=0,partialReleases=0;
  for(const release of index.releases) {
    if(release.baseline||!validDate(release.date)||release.date<from||release.date>to)continue;
    inRange++;
    if(release.lineageComplete===false)partialReleases++;
    // One release is one canonical tagged snapshot; aliases don't multiply it.
    for(const member of release.members||[]) {
      const row=byId.get(String(member.id));
      if(!row)continue;
      if(member.drove)row.actorEvents++;
      if(!(number(member.commits)>0))continue;
      row.releases++;
      row.commits+=member.commits;
      const lines=number(member.releaseLineChurn);
      if(lines===null)row.linesKnown=false;
      else row.lines+=lines;
      if(release.lineageComplete===false)row.partial++;
    }
  }
  for(const row of byId.values()) {
    if(!row.linesKnown)row.lines=null;
    delete row.linesKnown;
  }
  return {byId,available:true,inRange,partialReleases};
}
