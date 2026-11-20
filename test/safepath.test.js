const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isDirectory, realInside } = require('../src/safepath');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-safe-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const root = path.join(tmp, 'root');
const outside = path.join(tmp, 'outside');
fs.mkdirSync(root);
fs.mkdirSync(outside);
fs.writeFileSync(path.join(root, 'a.jsonl'), '');
fs.writeFileSync(path.join(root, 'a.txt'), '');
fs.writeFileSync(path.join(outside, 'secret.jsonl'), '');
fs.symlinkSync(path.join(outside, 'secret.jsonl'), path.join(root, 'link.jsonl'));
fs.symlinkSync(outside, path.join(root, 'dirlink'));

test('isDirectory: only absolute paths of existing directories', () => {
  assert.equal(isDirectory(root), true);
  assert.equal(isDirectory(path.join(root, 'a.txt')), false); // a file
  assert.equal(isDirectory(path.join(root, 'nope')), false);
  assert.equal(isDirectory('relative/dir'), false);
  assert.equal(isDirectory(undefined), false);
  assert.equal(isDirectory(42), false);
});

test('realInside: accepts files under the root with the right extension', () => {
  assert.equal(realInside(root, path.join(root, 'a.jsonl'), '.jsonl'), fs.realpathSync(path.join(root, 'a.jsonl')));
  assert.equal(realInside(root, path.join(root, 'a.txt'), '.jsonl'), null); // wrong extension
  assert.equal(realInside(root, path.join(root, 'a.txt')), fs.realpathSync(path.join(root, 'a.txt')));
});

test('realInside: refuses paths that escape the root', () => {
  assert.equal(realInside(root, path.join(outside, 'secret.jsonl'), '.jsonl'), null);
  assert.equal(realInside(root, path.join(root, '..', 'outside', 'secret.jsonl'), '.jsonl'), null);
  assert.equal(realInside(root, path.join(root, 'link.jsonl'), '.jsonl'), null); // symlink to outside
  assert.equal(realInside(root, path.join(root, 'dirlink', 'secret.jsonl'), '.jsonl'), null);
  assert.equal(realInside(root, path.join(root, 'missing.jsonl'), '.jsonl'), null);
  assert.equal(realInside(root, root), null); // the root itself is not inside it
  assert.equal(realInside(root + '-sibling', path.join(root, 'a.jsonl')), null);
});
