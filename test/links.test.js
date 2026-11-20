const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findLinks, CONFLICT_WINDOW_MS } = require('../src/links');

const NOW = 1_700_000_000_000;
const s = (id, cwd, edits = []) => ({ id, cwd, edits });

test('sessions in the same folder are linked as one project', () => {
  const l = findLinks([s('a', '/p/x'), s('b', '/p/x'), s('c', '/p/y')], NOW);
  assert.deepStrictEqual(l.project, [['a', 'b']]);
  assert.deepStrictEqual(l.conflicts, []);
});

test('an empty folder never links sessions', () => {
  assert.deepStrictEqual(findLinks([s('a', ''), s('b', '')], NOW).project, []);
});

test('two sessions that wrote the same file recently are a conflict, naming the file', () => {
  const l = findLinks([s('a', '/p/x', [{ file: '/p/x/app.js', ts: NOW - 60_000 }]), s('b', '/p/y', [{ file: '/p/x/app.js', ts: NOW - 5_000 }])], NOW);
  assert.strictEqual(l.conflicts.length, 1);
  assert.deepStrictEqual([l.conflicts[0].a, l.conflicts[0].b, l.conflicts[0].file, l.conflicts[0].ts], ['a', 'b', '/p/x/app.js', NOW - 5_000]);
});

test('different files, or old edits, are not conflicts', () => {
  const old = NOW - CONFLICT_WINDOW_MS - 1;
  assert.strictEqual(findLinks([s('a', '/p', [{ file: '/p/1.js', ts: NOW }]), s('b', '/p', [{ file: '/p/2.js', ts: NOW }])], NOW).conflicts.length, 0);
  assert.strictEqual(findLinks([s('a', '/p', [{ file: '/p/1.js', ts: old }]), s('b', '/p', [{ file: '/p/1.js', ts: NOW }])], NOW).conflicts.length, 0);
});

test('worktrees of one repository do not clash: their files have different paths', () => {
  const l = findLinks([s('a', '/r', [{ file: '/r/app.js', ts: NOW }]), s('b', '/r/.claude/worktrees/w', [{ file: '/r/.claude/worktrees/w/app.js', ts: NOW }])], NOW);
  assert.strictEqual(l.conflicts.length, 0);
});

test('the transcript records writes (not reads) with the time of the last one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-links-'));
  try {
    const { Transcript } = require('../src/collector');
    const f = path.join(dir, 't.jsonl');
    const use = (id, name, file, ts) =>
      JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), message: { id: 'm' + id, content: [{ type: 'tool_use', id, name, input: { file_path: file } }] } }) + '\n';
    fs.writeFileSync(f, use('1', 'Read', '/p/read.js', NOW) + use('2', 'Edit', '/p/a.js', NOW) + use('3', 'Write', '/p/a.js', NOW + 5000) + use('4', 'Write', '/p/b.js', NOW + 1000));
    const t = new Transcript(f);
    t.update();
    const e = Object.fromEntries(t.recentEdits().map((x) => [x.file, x.ts]));
    assert.deepStrictEqual(Object.keys(e).sort(), ['/p/a.js', '/p/b.js']);
    assert.strictEqual(e['/p/a.js'], NOW + 5000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
