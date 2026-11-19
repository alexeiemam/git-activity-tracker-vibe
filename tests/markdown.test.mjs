import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown,markdownFrame} from '../assets/markdown.js';

const compact=html=>html.replace(/>\s+</g,'><').trim();

test('release notes render GitHub-flavoured headings, lists, tasks, tables, code, quotes and links',()=>{
  const html=compact(renderMarkdown([
    "## What's changed",
    '- **Faster** imports by @ada in #12',
    '- Fix `parse()` edge case',
    '  - nested detail',
    '- [x] Done item',
    '',
    '| Area | Change |',
    '| --- | --- |',
    '| app/ | ~~old~~ new |',
    '',
    '> Quoted *note*',
    '',
    '```js',
    'const a = 1 < 2;',
    '```',
    '',
    'Full changelog: https://github.com/o/r/compare/v1...v2 and [docs](https://example.com/a_b_c).',
  ].join('\n')));
  assert.match(html,/<h3>What(&#39;|')s changed<\/h3>/,'a level-2 heading sits below the frame title');
  assert.match(html,/<li><strong>Faster<\/strong> imports by @ada in #12<\/li>/);
  assert.match(html,/<code>parse\(\)<\/code>/);
  assert.match(html,/<ul><li>nested detail<\/li><\/ul>/,'nested lists');
  assert.match(html,/<input checked="" disabled="" type="checkbox"> ?Done item/,'task lists');
  assert.match(html,/<table><thead><tr><th>Area<\/th><th>Change<\/th><\/tr><\/thead><tbody><tr><td>app\/<\/td><td><del>old<\/del> new<\/td><\/tr><\/tbody><\/table>/,'tables');
  assert.match(html,/<blockquote><p>Quoted <em>note<\/em><\/p><\/blockquote>/);
  assert.match(html,/<pre><code class="language-js">const a = 1 &lt; 2;\n?<\/code><\/pre>/);
  assert.match(html,/<a href="https:\/\/github.com\/o\/r\/compare\/v1...v2" target="_blank" rel="noopener noreferrer">/,'bare URLs link');
  assert.match(html,/<a href="https:\/\/example.com\/a_b_c" target="_blank" rel="noopener noreferrer">docs<\/a>/);
});

test('notes cannot inject markup or scripts, link to unsafe schemes, or load images',()=>{
  const html=renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> [click](javascript:alert(1)) ![shot](https://example.com/s.png)');
  assert.doesNotMatch(html,/<script|<img|href="javascript/i,'no live markup, scripts or unsafe links');
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/,'raw HTML is shown as text');
  assert.match(html,/click/,'an unsafe link keeps its text');
  assert.match(html,/<a href="https:\/\/example.com\/s.png" target="_blank" rel="noopener noreferrer">Image: shot<\/a>/,'images become links; nothing is fetched');
});

test('the frame is sandboxed with a policy that blocks scripts and every load',()=>{
  const frame=markdownFrame('# Hi',{title:'Release notes for v1'});
  assert.match(frame,/<iframe class="markdown-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(frame,/allow-scripts/);
  assert.match(frame,/default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;/);
  assert.match(frame,/title="Release notes for v1"/);
  assert.match(frame,/srcdoc="[^"]*&lt;h2&gt;Hi&lt;\/h2&gt;/,'the document is escaped into srcdoc');
});
