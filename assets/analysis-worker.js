/** CPU-heavy Git parsing and evidence aggregation stays off the UI thread. */
import { parseGitHistory, buildAnalysis, getHistoryDateBounds } from './domain.js?v=git-quadrant-inspection-20261108-1';
import { impactAnalysis } from './impact.js?v=git-quadrant-inspection-20261108-1';
import { buildStoryAnalysis } from './stories.js?v=git-quadrant-inspection-20261108-1';
import { buildEvidenceIndex } from './perspectives.js?v=git-quadrant-inspection-20261108-1';
import { buildDeploymentIndex } from './deployments.js?v=git-quadrant-inspection-20261108-1';
import { encodeSessionArchive, decodeSessionArchive } from './session-archive.js?v=git-quadrant-inspection-20261108-1';

let history = null;
let cachedPrimary = null, cachedPrimaryKey = null;
const progress = (id, phase, value, message) =>
  self.postMessage({id, type:'progress', phase, value, message});

self.onmessage = async ({data}) => {
  const {id, type} = data;
  try {
    if (type === 'session-export') {
      const archive = await encodeSessionArchive(data.payload, {onProgress: p => progress(id, p.phase, p.value, p.message)});
      self.postMessage({id, type:'result', result:archive});
    } else if (type === 'session-import') {
      const payload = await decodeSessionArchive(data.file, {onProgress: p => progress(id, p.phase, p.value, p.message)});
      self.postMessage({id, type:'result', result:payload});
    } else if (type === 'parse') {
      progress(id,'Reading history',5,'Parsing commit records, Git tags and GitHub Releases');
      history = parseGitHistory(data.raw);
      cachedPrimary=null;cachedPrimaryKey=null;
      progress(id,'Reading history',95,`${history.commits.length.toLocaleString()} commits · ${history.herokuReleases.length.toLocaleString()} Heroku events parsed`);
      self.postMessage({id,type:'result',result:history});
    } else if (type === 'build') {
      if (!history) throw new Error('Import history before building the dashboard.');
      progress(id,'Building comparisons',10,'Applying author-date scope and contributor identities');
      const view = buildAnalysis(history.commits,data.groups,data.scope);
      progress(id,'Reconstructing releases',25,`${history.tags.length.toLocaleString()} Git tags · calculating release ancestry`);
      const impact = impactAnalysis(view,history.commits,history.tags,{
        ...data.impactOptions,
        githubReleases:history.githubReleases,
        progress: ({current,total}) => progress(id,'Reconstructing releases',25+Math.round(68*current/Math.max(1,total)),
          `${current.toLocaleString()} / ${total.toLocaleString()} scoped release snapshots analysed`),
      });
      progress(id,'Finding stories',95,'Detecting noteworthy changes with evidence thresholds');
      const stories = buildStoryAnalysis(view,impact);
      // Independently reconstruct the complete tag-defined release ledger.
      // The classic evidence workbench can filter authored dates, but never
      // let that filter silently redefine the contents of a tagged release.
      const key=JSON.stringify([data.groups,data.scope.includeMerges,data.scope.includeReverts,data.impactOptions.actorMap]);
      if(key!==cachedPrimaryKey||!cachedPrimary){
        progress(id,'Building the release observatory',96,'Preserving complete tag-defined release contents');
        const bounds=getHistoryDateBounds(history.commits,history.tags,history.githubReleases,history.herokuReleases);
        const fullView=buildAnalysis(history.commits,data.groups,{
          start:bounds.min,end:bounds.max,
          selectedIds:new Set(data.groups.map((_,i)=>String(i))),
          includeMerges:data.scope.includeMerges,includeReverts:data.scope.includeReverts,
          metric:'commits',denominator:'repository',
        });
        const fullImpact=impactAnalysis(fullView,history.commits,history.tags,{
          ...data.impactOptions,metric:'commits',skipFollowup:true,
          githubReleases:history.githubReleases,
        });
        cachedPrimary=buildEvidenceIndex(fullView,fullImpact,bounds);
        progress(id,'Connecting deployments',97,'Matching independent STAG/BETA histories and production revisions');
        cachedPrimary.deployments=buildDeploymentIndex(history.herokuReleases,history.commits,cachedPrimary,history.herokuStatus);
        cachedPrimary.historyEnrichment=history.historyEnrichment||[];
        cachedPrimaryKey=key;
      }
      progress(id,'Preparing visualisations',98,'Transferring releases, people and period evidence to the dashboard');
      // Functions cannot cross worker boundaries. The main thread restores the
      // deterministic week helper after receiving the structured data.
      const {sumsByWeek, ...serializableView}=view;
      self.postMessage({id,type:'result',result:{view:serializableView,impact,stories,primaryIndex:cachedPrimary}});
    } else throw new Error('Unknown processing request.');
  } catch (error) {
    self.postMessage({id,type:'error',message:error?.message||'Unknown analysis error'});
  }
};
