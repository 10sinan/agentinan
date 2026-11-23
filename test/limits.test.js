const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// CLAUDE_CONFIG_DIR is read when the module loads, so point it at a temp dir first: never touch the real ~/.claude.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-lim-'));
const claudeDir = path.join(root, 'claude');
process.env.CLAUDE_CONFIG_DIR = claudeDir;
fs.mkdirSync(claudeDir);
const { Limits, CLAUDE_SETTINGS } = require('../src/limits');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let n = 0;
const fresh = () => {
  const d = path.join(root, `data${n++}`);
  fs.mkdirSync(d);
  return new Limits(d);
};
const settings = () => JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));

test('enable keeps other settings, saves the old status line, disable restores it exactly', () => {
  const l = fresh();
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'echo old' } }));
  l.enable();
  assert.strictEqual(l.enabled(), true);
  assert.strictEqual(settings().theme, 'dark');
  assert.strictEqual(fs.readFileSync(l.next, 'utf8'), 'echo old');
  assert.ok(fs.existsSync(l.backup));
  l.disable();
  assert.strictEqual(l.enabled(), false);
  assert.deepStrictEqual(settings(), { theme: 'dark', statusLine: { type: 'command', command: 'echo old' } });
});

test('with no previous status line, disable removes the key', () => {
  const l = fresh();
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify({ theme: 'dark' }));
  l.enable();
  l.disable();
  assert.deepStrictEqual(settings(), { theme: 'dark' });
});

test('enable twice does not lose the user\'s original status line', () => {
  const l = fresh();
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify({ statusLine: { type: 'command', command: 'echo old' } }));
  l.enable();
  l.enable();
  l.disable();
  assert.strictEqual(settings().statusLine.command, 'echo old');
});

test('settings.json that is not valid JSON is left untouched', () => {
  const l = fresh();
  fs.writeFileSync(CLAUDE_SETTINGS, '{ broken');
  assert.throws(() => l.enable());
  assert.strictEqual(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'), '{ broken');
});

test('read: nothing yet, then parses windows and converts seconds to ms', () => {
  const l = fresh();
  fs.writeFileSync(CLAUDE_SETTINGS, '{}');
  assert.strictEqual(l.read().fiveHour, undefined);
  fs.writeFileSync(
    l.file,
    JSON.stringify({ rate_limits: { five_hour: { used_percentage: 42, resets_at: 1800000000 }, seven_day: { used_percentage: 7, resets_at: 1800000000000 } } }),
  );
  const r = l.read();
  assert.strictEqual(r.fiveHour.pct, 42);
  assert.strictEqual(r.fiveHour.resetsAt, 1800000000 * 1000);
  assert.strictEqual(r.week.resetsAt, 1800000000000);
});

test('read: corrupt limits.json does not throw', () => {
  const l = fresh();
  fs.writeFileSync(CLAUDE_SETTINGS, '{}');
  fs.writeFileSync(l.file, '{nope');
  assert.strictEqual(l.read().fiveHour, undefined);
});

test('status line script stores limit JSON and still runs the user\'s own command', () => {
  const l = fresh();
  fs.mkdirSync(l.dir, { recursive: true });
  fs.writeFileSync(l.script, l.scriptText());
  fs.writeFileSync(l.next, 'cat >/dev/null; echo MYLINE');
  const json = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 9, resets_at: 1 } } });
  const out = execFileSync('/bin/sh', [l.script], { input: json }).toString();
  assert.strictEqual(out.trim(), 'MYLINE');
  assert.strictEqual(JSON.parse(fs.readFileSync(l.file, 'utf8')).rate_limits.five_hour.used_percentage, 9);
  // JSON without rate_limits must not overwrite the stored one
  execFileSync('/bin/sh', [l.script], { input: '{"model":"x"}' });
  assert.ok(JSON.parse(fs.readFileSync(l.file, 'utf8')).rate_limits);
});

const baks = () => fs.readdirSync(claudeDir).filter((f) => f.startsWith('settings.json.bak-'));

test('every write to settings.json first leaves a timestamped backup of the previous content', () => {
  const l = fresh();
  for (const f of baks()) fs.rmSync(path.join(claudeDir, f));
  const original = JSON.stringify({ theme: 'dark' });
  fs.writeFileSync(CLAUDE_SETTINGS, original);
  l.enable();
  l.disable();
  const found = baks();
  assert.strictEqual(found.length, 2); // one per write, even within the same millisecond
  assert.ok(found.every((f) => /^settings\.json\.bak-\d{4}-\d\d-\d\dT/.test(f)));
  assert.ok(found.some((f) => fs.readFileSync(path.join(claudeDir, f), 'utf8') === original));
});

test('a failed write puts the previous settings.json back', () => {
  const l = fresh();
  const original = JSON.stringify({ theme: 'dark' });
  fs.writeFileSync(CLAUDE_SETTINGS, original);
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    // simulate a crash after the file was clobbered
    fs.writeFileSync(CLAUDE_SETTINGS, 'GARBAGE');
    throw new Error('disk full');
  };
  try {
    assert.throws(() => l.writeSettings({ theme: 'light' }), /disk full/);
  } finally {
    fs.renameSync = realRename;
  }
  assert.strictEqual(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'), original);
  assert.ok(!fs.readdirSync(claudeDir).some((f) => f.endsWith('.tmp')));
});

test('only the newest backups are kept', () => {
  const l = fresh();
  fs.writeFileSync(CLAUDE_SETTINGS, '{}');
  for (let i = 0; i < 15; i++) l.writeSettings({ i });
  assert.strictEqual(baks().length, 5);
  // the newest ones survive, not the oldest
  assert.ok(baks().sort().every((f, i, a) => !i || a[i - 1] < f));
});

test('a value that is not a JSON object is refused before anything is written', () => {
  const l = fresh();
  const original = JSON.stringify({ theme: 'dark' });
  fs.writeFileSync(CLAUDE_SETTINGS, original);
  assert.throws(() => l.writeSettings([1, 2]), /beklenen biçimde değil/);
  assert.throws(() => l.writeSettings(undefined));
  assert.strictEqual(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'), original);
});
