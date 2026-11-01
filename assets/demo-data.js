/**
 * Deterministic synthetic git-log data used by the "Load demo data" action.
 * Keeping generation separate makes the application renderer agnostic to demos.
 */

const CONTRIBUTORS = [
  { name: 'Casey Moran', email: 'casey@example.test', weight: 5 },
  { name: 'Casey Moran', email: 'c.moran@example.test', weight: 2 },
  { name: 'Priya Shah', email: 'priya@example.test', weight: 4 },
  { name: 'Hugo Martin', email: 'hugo@example.test', weight: 3 },
  { name: 'Lin Chen', email: 'lin@example.test', weight: 3 },
  { name: "Sam O'Neil", email: 'sam@example.test', weight: 2 },
];

const VERBS = ['add', 'fix', 'refactor', 'improve', 'update', 'extract', 'simplify', 'optimise'];
const NOUNS = [
  'dashboard filters', 'API client', 'cache layer', 'auth flow', 'error handling',
  'test coverage', 'data pipeline', 'session handling', 'search endpoint', 'release tooling',
];
const PATHS = [
  'app/controllers/dashboard_controller.rb',
  'app/services/activity_report.rb',
  'app/javascript/controllers/filter_controller.js',
  'app/views/dashboard/index.html.erb',
  'app/assets/stylesheets/application.css',
  'spec/services/activity_report_spec.rb',
  'config/routes.rb',
  'README.md',
];

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function weightedContributor(random) {
  const total = CONTRIBUTORS.reduce((sum, contributor) => sum + contributor.weight, 0);
  let cursor = random() * total;
  for (const contributor of CONTRIBUTORS) {
    cursor -= contributor.weight;
    if (cursor <= 0) return contributor;
  }
  return CONTRIBUTORS.at(-1);
}

function fakeHash(index) {
  return index.toString(16).padStart(40, '0').slice(-40);
}

function isoAt(date, hour, minute) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mi = String(minute).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+00:00`;
}

/** Demo history includes full ancestry and tags so impact views work offline. */
export function generateDemoLog({ years = 3, commits = 520 } = {}) {
  const random = mulberry32(0xC0FFEE);
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const spanDays = Math.max(1, Math.round(years * 365.25));
  const rows = [];
  for (let index = 0; index < commits; index += 1) {
    const daysAgo = Math.floor(random() * spanDays);
    const date = new Date(end);
    date.setDate(date.getDate() - daysAgo);
    const contributor = weightedContributor(random);
    const hour = 7 + Math.floor(random() * 13);
    const minute = Math.floor(random() * 60);
    let subject = `${pick(random, VERBS)} ${pick(random, NOUNS)}`;
    if (index % 47 === 0) subject = 'chore: update release candidate VERSION';
    else if (index % 41 === 0) subject = `Merge pull request #${100 + index} from demo/feature-${index}`;
    else if (index % 53 === 0) subject = `Revert "${pick(random, VERBS)} ${pick(random, NOUNS)}"`;
    const files = [];
    const fileCount = 1 + Math.floor(random() * 4);
    for (let i=0;i<fileCount;i++) files.push({
      added:1+Math.floor(random()*180),deleted:Math.floor(random()*90),path:pick(random,PATHS),
    });
    if (index % 47 === 0) files.push({added:1,deleted:1,path:'VERSION'});
    rows.push({date,contributor,hour,minute,subject,files,index});
  }
  rows.sort((a,b)=>a.date-b.date || a.index-b.index);
  const tags=[], github=[];
  const publishers=['casey-demo','priya-demo','lin-demo','hugo-demo'];
  const releaseVersion=index=>{
    if(index>=9) return `v9.${Math.floor((index-9)/3)}.${(index-9)%3}`;
    return `v8.${7+Math.floor(index/3)}.${index%3}`;
  };
  for(let index=0;index<rows.length;index++){
    const entry=rows[index];
    const parents=index===0?'':index>4 && index%41===0
      ? `${fakeHash(index)} ${fakeHash(index-2)}` : fakeHash(index);
    const author=isoAt(entry.date,entry.hour,entry.minute);
    entry.text=[
      `COMMIT|${fakeHash(index+1)}|${entry.contributor.email}|${entry.contributor.name}|${author}|${author}|${entry.subject}|${parents}`,
      ...entry.files.map(f=>`${f.added}\t${f.deleted}\t${f.path}`),
    ].join('\n');
    if((index+1)%60===0 || index===rows.length-1) {
      const releaseNumber=tags.length;
      const version=releaseVersion(releaseNumber);
      const annotated=releaseNumber%3===0;
      const hash=fakeHash(index+1);
      tags.push(`TAG|${version}|${annotated?hash:''}|${hash}|${annotated?'tag':'commit'}|${author}|${annotated?entry.contributor.name:''}|${annotated?`<${entry.contributor.email}>`:''}`);
      // Synthetic published GitHub Releases: exercise publisher attribution and
      // multiline notes without making external requests in demo mode.
      const publisher=publishers[releaseNumber%publishers.length];
      const event={tag_name:version,name:`Release ${version}`,author:{login:publisher,type:'User'},
        published_at:author,prerelease:false,draft:false,
        body:`Demo release ${version}:\n- Improvements to dashboard and API workflows\n- Tests and maintenance follow-ups`,
        html_url:`https://github.com/example/demo/releases/tag/${version}`};
      github.push(`GHRELEASE|${btoa(JSON.stringify(event))}`);
    }
  }
  // The tag inventory is emitted before the commit stream, just like the
  // generated capture command; their timestamps can differ from authored dates.
  return [...tags,...github,'GHSTATUS|ok',...rows.reverse().map(r=>r.text)].join('\n');
}
