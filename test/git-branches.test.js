const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Git, parseRefs } = require('../src/git');

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-gitb-')));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, env }).toString();
let n = 0;
const commit = (cwd, msg) => {
  fs.writeFileSync(path.join(cwd, `f${n++}.txt`), msg);
  sh(cwd, 'add', '-A');
  sh(cwd, 'commit', '-q', '-m', msg);
};

// origin (bare) ← other (pushes a branch we only see as origin/remote-only) and work (our clone)
const origin = path.join(base, 'origin.git');
const seed = path.join(base, 'seed');
const work = path.join(base, 'work');
fs.mkdirSync(origin);
sh(origin, 'init', '-q', '--bare', '-b', 'main');
fs.mkdirSync(seed);
sh(seed, 'init', '-q', '-b', 'main');
sh(seed, 'remote', 'add', 'origin', origin);
commit(seed, 'first');
sh(seed, 'push', '-q', 'origin', 'main');
sh(seed, 'checkout', '-q', '-b', 'remote-only');
commit(seed, 'only on the server');
sh(seed, 'push', '-q', 'origin', 'remote-only');
sh(seed, 'checkout', '-q', 'main');

sh(base, 'clone', '-q', origin, work);
// feature: 2 commits ahead of main, pushed, then 1 more local commit (ahead of its origin twin)
sh(work, 'checkout', '-q', '-b', 'feature');
commit(work, 'feat 1');
commit(work, 'feat 2');
sh(work, 'push', '-q', '-u', 'origin', 'feature');
commit(work, 'feat 3 unpushed');
// old: branched off main, then main moved on (behind 1, ahead 0)
sh(work, 'checkout', '-q', 'main');
sh(work, 'branch', 'old');
commit(work, 'main moves');
// a branch whose name looks like an option: `git branch` refuses it, but the ref can still exist (update-ref, a
// hostile clone), so it must not turn into an option on our command lines
sh(work, 'update-ref', 'refs/heads/-dash', 'old');
sh(work, 'checkout', '-q', 'feature');
// meanwhile on GitHub: "merged" is pushed and merged into main. work fetches but never pulls its main, so its local
// main is stale: measured against that, "merged" would look 1 ahead although it is in main already
sh(seed, 'checkout', '-q', '-b', 'merged');
commit(seed, 'merged on the server');
sh(seed, 'push', '-q', 'origin', 'merged');
sh(seed, 'checkout', '-q', 'main');
sh(seed, 'merge', '-q', '--ff-only', 'merged');
sh(seed, 'push', '-q', 'origin', 'main');
sh(work, 'fetch', '-q', 'origin');

async function load() {
  const g = new Git();
  await g.repos([work], true);
  return g.branches(work);
}

// Everything is measured against origin/main (as of the last fetch): first + "merged on the server".
test('branches: main, ahead/behind against it, local/remote pairs and their sync', async () => {
  const d = await load();
  assert.strictEqual(d.root, work);
  assert.strictEqual(d.main, 'main');
  assert.strictEqual(d.head, 'feature');
  const by = Object.fromEntries(d.branches.map((b) => [b.name, b]));

  assert.ok(by.main.isMain);
  assert.strictEqual(by.main.sync, 'diverged'); // "main moves" not pushed, the merge not pulled
  assert.deepStrictEqual([by.main.ahead, by.main.behind], [1, 1]);

  assert.ok(by.feature.current && by.feature.hasLocal && by.feature.hasRemote);
  assert.strictEqual(by.feature.sync, 'ahead');
  assert.deepStrictEqual([by.feature.ahead, by.feature.behind], [3, 1]);
  assert.strictEqual(by.feature.subject, 'feat 3 unpushed');

  assert.strictEqual(by.old.sync, 'local-only');
  assert.deepStrictEqual([by.old.ahead, by.old.behind], [0, 1]);

  assert.strictEqual(by['remote-only'].sync, 'remote-only');
  assert.ok(!by['remote-only'].hasLocal);
  assert.strictEqual(by['remote-only'].remote, 'origin/remote-only');
  assert.deepStrictEqual([by['remote-only'].ahead, by['remote-only'].behind], [1, 1]);

  assert.ok(by['-dash'], 'a branch named like an option is listed');
  assert.deepStrictEqual([by['-dash'].ahead, by['-dash'].behind], [0, 1]);

  assert.ok(!d.branches.some((b) => b.name === 'HEAD' || b.name.endsWith('/HEAD')));
  assert.strictEqual(d.branches.filter((b) => b.isMain).length, 1);
});

test('a branch already merged on origin is not ahead, even while the local main is not pulled', async () => {
  const by = Object.fromEntries((await load()).branches.map((b) => [b.name, b]));
  assert.deepStrictEqual([by.merged.ahead, by.merged.behind], [0, 0]);
});

test('branches: only a known repository, and the count is capped (newest kept)', async () => {
  const g = new Git();
  await assert.rejects(() => g.branches(work), /Bilinmeyen depo/);
  await g.repos([work], true);
  const d = await g.branches(work, 2);
  assert.strictEqual(d.branches.length, 2);
});

test('parseRefs skips junk, HEAD pointers and refs outside heads/remotes', () => {
  const S = '\x1f';
  const out = [
    ['refs/heads/main', 'main', 'a'.repeat(40), '1700000000', '*', 'subject with \x1f inside'].join(S),
    ['refs/remotes/origin/HEAD', 'origin', 'b'.repeat(40), '1700000000', ' ', 'x'].join(S),
    ['refs/remotes/origin/main', 'origin/main', 'c'.repeat(40), '1700000000', ' ', 'x'].join(S),
    ['refs/tags/v1', 'v1', 'd'.repeat(40), '1', ' ', 'x'].join(S),
    ['refs/heads/bad', 'bad', 'not-a-hash', '1', ' ', 'x'].join(S),
    'garbage',
    '',
  ].join('\n');
  const r = parseRefs(out);
  assert.deepStrictEqual(
    r.map((x) => [x.name, x.remote, x.current]),
    [
      ['main', null, true],
      ['origin/main', 'origin', false],
    ],
  );
  assert.strictEqual(r[0].subject, 'subject with \x1f inside');
  assert.strictEqual(r[0].time, 1700000000000);
  assert.deepStrictEqual(parseRefs(''), []);
  assert.deepStrictEqual(parseRefs(null), []);
});
