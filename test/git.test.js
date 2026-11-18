const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseStatus } = require('../src/git');

const z = (...a) => a.join('\0') + '\0';

test('parseStatus: branch headers, staged/unstaged/untracked, rename, conflict', () => {
  const out = z(
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a b src/a.js',
    '1 .M N... 100644 100644 100644 a b src/b file.js',
    '1 MM N... 100644 100644 100644 a b both.js',
    '2 R. N... 100644 100644 100644 a b R100 new.js', 'old.js',
    'u UU N... 100644 100644 100644 100644 a b c conflict.js',
    '? untracked.txt',
  );
  const s = parseStatus(out);
  assert.strictEqual(s.branch, 'main');
  assert.strictEqual(s.upstream, 'origin/main');
  assert.strictEqual(s.ahead, 2);
  assert.strictEqual(s.behind, 1);
  assert.deepStrictEqual(s.staged.map((x) => x.path), ['src/a.js', 'both.js', 'new.js']);
  assert.deepStrictEqual(s.unstaged.map((x) => x.path), ['src/b file.js', 'both.js']);
  assert.strictEqual(s.staged[2].from, 'old.js');
  assert.deepStrictEqual(s.conflicts.map((x) => x.path), ['conflict.js']);
  assert.deepStrictEqual(s.untracked.map((x) => x.path), ['untracked.txt']);
});

test('parseStatus matches what real git prints', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-git-'));
  try {
    const g = (...a) => execFileSync('git', a, { cwd: d, env: { ...process.env, LC_ALL: 'C' } }).toString();
    g('init', '-q', '-b', 'main');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    fs.writeFileSync(path.join(d, 'a.txt'), 'x');
    fs.writeFileSync(path.join(d, 'sp ace.txt'), 'y');
    g('add', 'a.txt');
    const s = parseStatus(g('status', '--porcelain=v2', '--branch', '-z'));
    assert.strictEqual(s.branch, 'main');
    assert.deepStrictEqual(s.staged.map((x) => x.path), ['a.txt']);
    assert.deepStrictEqual(s.untracked.map((x) => x.path), ['sp ace.txt']);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
