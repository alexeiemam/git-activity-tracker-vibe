/** CPU-heavy Git parsing and evidence aggregation stays off the UI thread. */
import { parseGitHistory, buildAnalysis } from './domain.js?v=matrix-history-20261101-1';
import { impactAnalysis } from './impact.js?v=matrix-history-20261101-1';

let history = null;
const progress = (id, phase, value, message) =>
  self.postMessage({id, type:'progress', phase, value, message});

self.onmessage = ({data}) => {
  const {id, type} = data;
  try {
    if (type === 'parse') {
      progress(id,'Reading history',5,'Parsing commit records, Git tags and GitHub Releases');
      history = parseGitHistory(data.raw);
      progress(id,'Reading history',95,`${history.commits.length.toLocaleString()} commits parsed`);
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
      progress(id,'Preparing visualisations',96,'Transferring computed evidence to the dashboard');
      // Functions cannot cross worker boundaries. The main thread restores the
      // deterministic week helper after receiving the structured data.
      const {sumsByWeek, ...serializableView}=view;
      self.postMessage({id,type:'result',result:{view:serializableView,impact}});
    } else throw new Error('Unknown processing request.');
  } catch (error) {
    self.postMessage({id,type:'error',message:error?.message||'Unknown analysis error'});
  }
};
