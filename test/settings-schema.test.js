const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize } = require('../src/settings-schema');

test('valid values pass through unchanged', () => {
  const p = {
    notifyWaiting: false,
    quality: 'low',
    theme: 'tokyo-night',
    hogCpu: 180,
    hogSecs: 8,
    hogMem: 20,
    hogIgnore: ['node', 'chrome'],
    keys: { dock: 'Ctrl+`', newSession: 'Ctrl+Shift+N' },
  };
  assert.deepEqual(sanitize(p), p);
});

test('unknown keys are dropped, including prototype tricks', () => {
  const out = sanitize(JSON.parse('{"evil":1,"__proto__":{"x":1},"constructor":{"y":1},"trayKeep":true}'));
  assert.deepEqual(out, { trayKeep: true });
  assert.equal({}.x, undefined);
});

test('wrong types and out-of-range values are dropped', () => {
  assert.deepEqual(sanitize({ trayKeep: 'yes', notifyDone: 1, quality: 'ultra', theme: '../x', hogCpu: -5, hogSecs: NaN, hogMem: 500 }), {});
  assert.deepEqual(sanitize({ hogCpu: Infinity, hogIgnore: 'node', hogMem: '30' }), {});
  assert.deepEqual(sanitize({ hogIgnore: ['ok', 5] }), {});
  assert.deepEqual(sanitize({ hogIgnore: new Array(201).fill('a') }), {});
});

test('keys: only dock and newSession, shaped like a shortcut', () => {
  assert.deepEqual(sanitize({ keys: { dock: 'F5' } }), { keys: { dock: 'F5' } });
  assert.deepEqual(sanitize({ keys: { dock: 'Ctrl+`', other: 'Ctrl+X' } }), {});
  assert.deepEqual(sanitize({ keys: { dock: 'rm -rf /' } }), {});
  assert.deepEqual(sanitize({ keys: { dock: 5 } }), {});
  assert.deepEqual(sanitize({ keys: ['Ctrl+A'] }), {});
});

test('gitRepos is main-only: refused from the page, accepted when main reads its own file', () => {
  const p = { gitRepos: ['/home/u/repo'] };
  assert.deepEqual(sanitize(p), {});
  assert.deepEqual(sanitize(p, { internal: true }), p);
  assert.deepEqual(sanitize({ gitRepos: ['relative'] }, { internal: true }), {});
});

test('non-objects give an empty patch', () => {
  for (const v of [null, undefined, 'str', 5, [1, 2]]) assert.deepEqual(sanitize(v), {});
});
