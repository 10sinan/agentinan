const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../src/atomic');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-atomic-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const leftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

test('writes the text and leaves no temp file', () => {
  const f = path.join(dir, 'a.json');
  writeFileAtomic(f, '{"a":1}', { json: true });
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"a":1}');
  assert.deepStrictEqual(leftovers(), []);
});

test('invalid JSON is refused and the old file stays', () => {
  const f = path.join(dir, 'b.json');
  fs.writeFileSync(f, '{"ok":true}');
  assert.throws(() => writeFileAtomic(f, '{broken', { json: true }));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"ok":true}');
  assert.deepStrictEqual(leftovers(), []);
});

test('a failing rename keeps the old content and removes the temp file', () => {
  const f = path.join(dir, 'c.json');
  fs.writeFileSync(f, 'old');
  const real = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('boom');
  };
  try {
    assert.throws(() => writeFileAtomic(f, 'new'), /boom/);
  } finally {
    fs.renameSync = real;
  }
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'old');
  assert.deepStrictEqual(leftovers(), []);
});

test('keeps the mode of an existing file; a new file is private', () => {
  const f = path.join(dir, 'd.json');
  fs.writeFileSync(f, 'x', { mode: 0o640 });
  fs.chmodSync(f, 0o640);
  writeFileAtomic(f, 'y');
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o640);
  const g = path.join(dir, 'e.json');
  writeFileAtomic(g, 'z');
  assert.strictEqual(fs.statSync(g).mode & 0o077, 0);
});
