import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const app = await readFile(new URL('assets/app.js', root), 'utf8');

test('HTML has no inline event handlers or inline style/script blocks', () => {
  assert.doesNotMatch(html, /\son(?:click|change|input|mouseenter|mouseleave|keydown|keyup)\s*=/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('HTML loads external CSS and module JavaScript', () => {
  assert.match(html, /href="\.\/assets\/app\.css"/);
  assert.match(html, /type="module" src="\.\/assets\/app\.js"/);
});

test('UI actions are dispatched centrally rather than through global functions', () => {
  assert.match(app, /const ACTIONS = \{/);
  assert.match(app, /document\.addEventListener\('click', handleDocumentClick\)/);
  assert.doesNotMatch(app, /window\.[A-Za-z_$][\w$]*\s*=/);
});
