const test = require('node:test');
const assert = require('node:assert');
const { ownSessionList } = require('../src/ownsessions');

test('uses the id from the snapshot when Claude Code registered the session', () => {
  const list = ownSessionList([{ pid: 10, cwd: '/a' }], [{ pid: 10, id: 'abc', cwd: '/a' }]);
  assert.deepStrictEqual(list, [{ id: 'abc', cwd: '/a' }]);
});

test('a resumed session is remembered before it shows up in a snapshot', () => {
  const list = ownSessionList([{ pid: 11, resumeId: 'old', cwd: '/b' }], []);
  assert.deepStrictEqual(list, [{ id: 'old', cwd: '/b' }]);
  assert.deepStrictEqual(ownSessionList([{ pid: 11, resumeId: 'old', cwd: '/b' }], null), [{ id: 'old', cwd: '/b' }]);
});

test('snapshot id wins over the old id (resume may fork a new session)', () => {
  const list = ownSessionList([{ pid: 12, resumeId: 'old', cwd: '/c' }], [{ pid: 12, id: 'new', cwd: '/c' }]);
  assert.deepStrictEqual(list, [{ id: 'new', cwd: '/c' }]);
});

test('a brand-new session without an id yet is skipped; duplicates and background sessions are not listed', () => {
  assert.deepStrictEqual(ownSessionList([{ pid: 13, cwd: '/d' }], []), []);
  const dup = ownSessionList([{ pid: 1, resumeId: 'x', cwd: '/e' }, { pid: 2, resumeId: 'x', cwd: '/e' }], []);
  assert.strictEqual(dup.length, 1);
  assert.deepStrictEqual(ownSessionList([], [{ pid: 99, id: 'bg', cwd: '/f' }]), []);
});
