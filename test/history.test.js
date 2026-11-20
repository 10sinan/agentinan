const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The collector reads CLAUDE_CONFIG_DIR once, when it is loaded: point it at a temp folder first.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-hist-'));
process.env.CLAUDE_CONFIG_DIR = home;
const { Collector, projectName } = require('../src/collector');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const reply = (id, ms, cwd, output) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(ms), cwd, message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 0, output_tokens: output }, content: [] } }) + '\n';

function write(dir, name, text) {
  const d = path.join(home, 'projects', dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), text);
}

test('history: per day and per project, a copied reply counted once, old days left out', () => {
  const now = Date.now();
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const today = noon.getTime();
  write('-work-alpha', 'a.jsonl', reply('m1', today, '/work/alpha', 1000) + reply('m2', today - DAY, '/work/alpha', 2000));
  // a resumed conversation carries m1 again: it must not be counted twice
  write('-work-alpha', 'b.jsonl', reply('m1', today, '/work/alpha', 1000) + reply('m3', today, '/work/alpha', 500));
  write('-work-beta', 'c.jsonl', reply('m4', today - 2 * DAY, '/work/beta', 4000) + reply('old', now - 60 * DAY, '/work/beta', 9999));

  const h = new Collector().history(7);
  assert.strictEqual(h.days.length, 7);
  const out = h.days.map((d) => d.output);
  assert.deepStrictEqual(out.slice(-3), [4000, 2000, 1500]);
  assert.strictEqual(h.output, 7500);
  assert.deepStrictEqual(
    h.projects.map((p) => [p.name, p.output]),
    [
      ['beta', 4000],
      ['alpha', 3500],
    ],
  );
  assert.ok(h.total > 0);
  assert.ok(h.days.at(-1).byModel['Sonnet 5.5'] > 0);
});

test('projectName: a worktree counts as its repository', () => {
  assert.strictEqual(projectName('/home/u/projects/agentinan/.claude/worktrees/feat-x'), 'agentinan');
  assert.strictEqual(projectName('/home/u/projects/agentinan/.claude/worktrees/feat-x/sub'), 'agentinan');
  assert.strictEqual(projectName('/home/u/projects/agentinan'), 'agentinan');
  assert.strictEqual(projectName(''), '(bilinmiyor)');
});
