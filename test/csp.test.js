const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';

test('the page has a CSP that blocks plugins, base rewrites, form posts and remote scripts', () => {
  assert.ok(csp, 'CSP meta tag missing');
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  const script = csp.split(';').find((x) => x.trim().startsWith('script-src')) || '';
  assert.ok(!/unsafe-inline|unsafe-eval|https?:|\*/.test(script), script);
});

test('the window is sandboxed, isolated and refuses navigation, new windows and webviews', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  for (const s of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'will-navigate', 'will-redirect', "action: 'deny'", 'will-attach-webview', 'setPermissionRequestHandler']) {
    assert.ok(main.includes(s), s);
  }
});
