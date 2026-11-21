// A repository's own config must not make Agentinan run programs: core.fsmonitor (git status), diff.external and
// textconv drivers (git diff / git show). Each points at a script that would leave a marker file if it ran.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Git } = require('../src/git');

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-gitsafe-')));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const sh = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, env }).toString();

const repo = path.join(base, 'evil');
const marker = path.join(base, 'ran');
const script = path.join(base, 'evil.sh');
fs.writeFileSync(script, `#!/bin/sh\necho "$0 $*" >> '${marker}'\ncat "$1" 2>/dev/null\nexit 0\n`, { mode: 0o755 });

fs.mkdirSync(repo);
sh(repo, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
sh(repo, 'add', '-A');
sh(repo, 'commit', '-q', '-m', 'first');
// set after the commit, so only Agentinan's git calls can trigger them
sh(repo, 'config', 'core.fsmonitor', script);
sh(repo, 'config', 'diff.external', script);
sh(repo, 'config', 'diff.evil.textconv', script);
fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt diff=evil\n');
fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');

const ran = () => fs.existsSync(marker);

test('the setup really is dangerous: plain git runs the repository fsmonitor', () => {
  fs.rmSync(marker, { force: true });
  execFileSync('git', ['status', '--porcelain'], { cwd: repo, env });
  assert.ok(ran(), 'plain git status should have run core.fsmonitor, otherwise this test proves nothing');
  fs.rmSync(marker, { force: true });
});

test('repos, status, diff and show never run a program from the repository config', async () => {
  fs.rmSync(marker, { force: true });
  const g = new Git();
  const [r] = await g.repos([repo], true);
  assert.strictEqual(r.root, repo);
  const st = await g.status(repo);
  assert.ok(st.unstaged.some((f) => f.path === 'a.txt'));

  const d = await g.diff(repo, 'a.txt', 'unstaged');
  assert.match(d, /-one\n\+two/); // a normal diff, not the driver's output
  await g.diff(repo, 'a.txt', 'head');
  await g.diff(repo, 'b.txt', 'untracked');
  const [c] = (await g.log(repo)).filter((x) => x.hash);
  await g.show(repo, c.hash);

  assert.ok(!ran(), `a repository-configured program ran: ${ran() ? fs.readFileSync(marker, 'utf8') : ''}`);
});
