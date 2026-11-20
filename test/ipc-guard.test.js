const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { isTrustedUrl, isTrustedFrame, guardIpc } = require('../src/ipc-guard');

const page = path.join('/opt/app', 'renderer', 'index.html');
const good = pathToFileURL(page).href;

test('only the local index.html is trusted', () => {
  assert.equal(isTrustedUrl(good, page), true);
  assert.equal(isTrustedUrl(good + '#x', page), true);
  assert.equal(isTrustedUrl('file:///opt/app/renderer/other.html', page), false);
  assert.equal(isTrustedUrl('file:///tmp/evil/renderer/index.html', page), false);
  assert.equal(isTrustedUrl('https://example.com/renderer/index.html', page), false);
  assert.equal(isTrustedUrl('file:///opt/app/renderer/../renderer/index.html', page), true); // normalised by URL
  assert.equal(isTrustedUrl('file:///opt/app/renderer/index.html/../x.html', page), false);
  assert.equal(isTrustedUrl('', page), false);
  assert.equal(isTrustedUrl(undefined, page), false);
});

test('a frame must be top-level too', () => {
  assert.equal(isTrustedFrame({ url: good, parent: null }, page), true);
  assert.equal(isTrustedFrame({ url: good, parent: {} }, page), false);
  assert.equal(isTrustedFrame(null, page), false);
});

test('guardIpc blocks handle and on from other frames and lets the page through', async () => {
  const handlers = {};
  const fake = { handle: (c, f) => (handlers['h:' + c] = f), on: (c, f) => (handlers['o:' + c] = f) };
  const denied = [];
  guardIpc(fake, page, (c, u) => denied.push([c, u]));
  let ran = 0;
  fake.handle('a', () => ++ran);
  fake.on('b', () => ++ran);
  const ok = { senderFrame: { url: good, parent: null } };
  const bad = { senderFrame: { url: 'https://evil.example/', parent: null } };
  assert.equal(await handlers['h:a'](ok), 1);
  handlers['o:b'](ok);
  assert.equal(ran, 2);
  assert.throws(() => handlers['h:a'](bad), /Yetkisiz/);
  handlers['o:b'](bad);
  assert.throws(() => handlers['h:a']({ senderFrame: null }), /Yetkisiz/);
  assert.equal(ran, 2);
  assert.equal(denied.length, 3);
});
