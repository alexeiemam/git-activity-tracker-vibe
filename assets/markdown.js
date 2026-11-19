/**
 * Published release notes as GitHub-flavoured Markdown, rendered by the
 * vendored `marked` library and shown inside a sandboxed frame whose own
 * styles and Content-Security-Policy contain it. Raw HTML in notes is shown
 * as text, only http(s) and mailto links are kept, and images become links,
 * so nothing is fetched from the notes.
 */
import { Marked } from './vendor/marked.esm.js?v=codebase-20261119-2';

const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

const notes = new Marked({
  gfm: true,
  async: false,
  renderer: {
    // Notes sit under the frame's own title, so their top level is a second-level heading.
    heading: (text, level) => `<h${Math.min(6, level + 1)}>${text}</h${Math.min(6, level + 1)}>\n`,
    link: (href, title, text) => SAFE_URL.test(href || '')
      ? `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`
      : text,
    image: (href, title, text) => SAFE_URL.test(href || '')
      ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">Image${text ? `: ${text}` : ''}</a>`
      : escape(text || ''),
    html: html => escape(html),
  },
});

/** Release notes Markdown as HTML, with raw HTML, unsafe links and images neutralised. */
export function renderMarkdown(source) {
  return notes.parse(String(source ?? ''));
}

const FRAME_STYLE = `
  :root{color-scheme:light}
  html,body{margin:0}
  body{padding:16px 18px;font:13px/1.65 'DM Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#202924;background:#fffefa;overflow-wrap:anywhere}
  body>:first-child{margin-top:0}
  h2,h3,h4,h5,h6{margin:1.1em 0 .4em;line-height:1.3;letter-spacing:-.01em;color:#1d3b2e}
  h2{font-size:17px}h3{font-size:15px}h4,h5,h6{font-size:13px}
  p{margin:.5em 0}
  ul,ol{margin:.4em 0;padding-left:1.4em}
  li{margin:.15em 0}
  li>input[type=checkbox]{margin:0 .4em 0 0;vertical-align:-1px}
  a{color:#1b704f}
  code{font:12px 'IBM Plex Mono',ui-monospace,SFMono-Regular,monospace;background:#eef3ec;border-radius:4px;padding:.1em .35em}
  pre{background:#f3f6f1;border:1px solid #e0e8df;border-radius:7px;padding:10px 12px;overflow:auto}
  pre code{background:none;padding:0}
  blockquote{margin:.6em 0;padding:.1em 0 .1em 12px;border-left:3px solid #c9dccd;color:#4d6457}
  hr{border:0;border-top:1px solid #e0e8df;margin:1em 0}
  table{border-collapse:collapse;margin:.6em 0;font-size:12px}
  th,td{border:1px solid #e0e8df;padding:4px 8px;text-align:left}
  th{background:#f3f6f1}
  del{color:#7a867d}
`;

/**
 * A sandboxed frame showing rendered Markdown. No scripts run and nothing is
 * loaded (its CSP allows only its own inline styles); links open in a new tab.
 * `allow-same-origin` lets the page measure the frame to fit its height.
 */
export function markdownFrame(source, {title = 'Rendered Markdown'} = {}) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><base target="_blank"><style>${FRAME_STYLE}</style></head><body>${renderMarkdown(source)}</body></html>`;
  return `<iframe class="markdown-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="${escape(title)}" srcdoc="${escape(doc)}"></iframe>`;
}
