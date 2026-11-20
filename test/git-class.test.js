const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Git } = require('../src/git');

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-gitc-')));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, env }).toString();

// bare "origin" + a working clone with one commit pushed
const origin = path.join(base, 'origin.git');
const work = path.join(base, 'work');
fs.mkdirSync(origin);
sh(origin, 'init', '-q', '--bare', '-b', 'main');
fs.mkdirSync(work);
sh(work, 'init', '-q', '-b', 'main');
sh(work, 'remote', 'add', 'origin', origin);
fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
sh(work, 'add', '-A');
sh(work, 'commit', '-q', '-m', 'first');
sh(work, 'push', '-q', '-u', 'origin', 'main');

async function open() {
  const g = new Git();
  const repos = await g.repos([work]);
  return { g, repos };
}

test('repos finds the repository root from a subfolder and counts changes', async () => {
  fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(work, 'new.txt'), 'n');
  const g = new Git();
  const repos = await g.repos([path.join(work, 'sub'), work, '/nonexistent', 'relative/path']);
  assert.strictEqual(repos.length, 1);
  assert.strictEqual(repos[0].root, work);
  assert.strictEqual(repos[0].branch, 'main');
  assert.strictEqual(repos[0].changes, 1);
  fs.rmSync(path.join(work, 'new.txt'));
});

test('a repository that was never listed is refused', async () => {
  const g = new Git();
  await assert.rejects(g.status(work), /Bilinmeyen/);
  await assert.rejects(g.commit(work, 'x'), /Bilinmeyen/);
  await assert.rejects(g.push(work), /Bilinmeyen/);
});

test('unsafe paths and hashes are rejected before git runs', async () => {
  const { g } = await open();
  await assert.rejects(g.stage(work, ['../evil']), /bad path/);
  await assert.rejects(g.stage(work, ['/etc/passwd']), /bad path/);
  await assert.rejects(g.diff(work, '../x', 'unstaged'), /bad path/);
  await assert.rejects(g.show(work, '--output=/tmp/x'), /bad hash/);
});

test('stage → status → commit → log, and an empty message is refused', async () => {
  const { g } = await open();
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\ntwo\n');
  let s = await g.status(work);
  assert.deepStrictEqual(s.unstaged.map((x) => x.path), ['a.txt']);
  assert.match(await g.diff(work, 'a.txt', 'unstaged'), /\+two/);
  await g.stage(work, ['a.txt']);
  s = await g.status(work);
  assert.deepStrictEqual(s.staged.map((x) => x.path), ['a.txt']);
  assert.match(await g.diff(work, 'a.txt', 'staged'), /\+two/);
  await g.unstage(work, 'all');
  assert.strictEqual((await g.status(work)).staged.length, 0);
  await g.stage(work, 'all');
  await assert.rejects(g.commit(work, '   '), /boş/);
  await sh(work, 'config', 'user.name', 't');
  await sh(work, 'config', 'user.email', 't@t');
  await g.commit(work, 'second');
  const log = (await g.log(work)).filter((l) => l.hash);
  assert.strictEqual(log[0].subject, 'second');
  assert.strictEqual(log.length, 2);
  assert.match(await g.show(work, log[0].hash), /second/);
  assert.strictEqual((await g.status(work)).ahead, 1);
});

test('push sends the commit to origin; pull fast-forwards from another clone', async () => {
  const { g } = await open();
  await g.push(work);
  assert.strictEqual((await g.status(work)).ahead, 0);
  assert.match(sh(origin, 'log', '--format=%s', '-1', 'main'), /second/);

  const other = path.join(base, 'other');
  sh(base, 'clone', '-q', origin, other);
  fs.writeFileSync(path.join(other, 'b.txt'), 'b');
  sh(other, 'add', '-A');
  sh(other, 'commit', '-q', '-m', 'from other');
  sh(other, 'push', '-q');

  await g.fetch(work);
  assert.strictEqual((await g.status(work)).behind, 1);
  await g.pull(work);
  assert.strictEqual((await g.status(work)).behind, 0);
  assert.ok(fs.existsSync(path.join(work, 'b.txt')));
});

test('pull refuses to merge when histories diverged (ff-only)', async () => {
  const { g } = await open();
  fs.writeFileSync(path.join(work, 'local.txt'), 'l');
  sh(work, 'add', '-A');
  sh(work, 'commit', '-q', '-m', 'local only');
  const other = path.join(base, 'other');
  fs.writeFileSync(path.join(other, 'c.txt'), 'c');
  sh(other, 'add', '-A');
  sh(other, 'commit', '-q', '-m', 'remote only');
  sh(other, 'push', '-q');
  await g.fetch(work);
  await assert.rejects(g.pull(work));
  assert.ok(!fs.existsSync(path.join(work, 'c.txt')));
});

test('untracked file diff works', async () => {
  const { g } = await open();
  fs.writeFileSync(path.join(work, 'u.txt'), 'untracked!\n');
  assert.match(await g.diff(work, 'u.txt', 'untracked'), /\+untracked!/);
});

test('head diff shows staged and unstaged changes together, and works before the first commit', async () => {
  const { g } = await open();
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\nstaged line\n');
  sh(work, 'add', 'a.txt');
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\nstaged line\nunstaged line\n');
  const d = await g.diff(work, 'a.txt', 'head');
  assert.match(d, /\+staged line/);
  assert.match(d, /\+unstaged line/);
  sh(work, 'checkout', '-q', 'HEAD', '--', 'a.txt');

  const fresh = path.join(base, 'fresh');
  fs.mkdirSync(fresh);
  sh(fresh, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(fresh, 'f.txt'), 'first file\n');
  sh(fresh, 'add', 'f.txt');
  const g2 = new Git();
  await g2.repos([fresh]);
  assert.match(await g2.diff(fresh, 'f.txt', 'head'), /\+first file/);
});
