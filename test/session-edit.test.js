const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The collector reads CLAUDE_CONFIG_DIR once, when it is loaded: point it at a temp folder first.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-edit-'));
process.env.CLAUDE_CONFIG_DIR = home;
const { Collector, Transcript } = require('../src/collector');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const SID = '11111111-2222-3333-4444-555555555555';
const cwd = '/work/demo';
const projDir = path.join(home, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
const file = path.join(projDir, SID + '.jsonl');
const prompt = JSON.stringify({ type: 'user', timestamp: '2026-01-15T12:00:00.000Z', message: { role: 'user', content: 'merhaba' } });

function fresh(content) {
  fs.rmSync(projDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(projDir, SID, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(projDir, SID, 'subagents', 'agent-a.jsonl'), '{}\n');
  fs.writeFileSync(file, content);
}

test('rename appends a custom-title record that the transcript reader picks up', () => {
  fresh(prompt + '\n');
  const c = new Collector();
  assert.strictEqual(c.rename(SID, cwd, '  yeni   ad  '), 'yeni ad');
  const t = new Transcript(file);
  t.update();
  assert.strictEqual(t.customTitle, 'yeni ad');
  c.rename(SID, cwd, 'ikinci');
  const t2 = new Transcript(file);
  t2.update();
  assert.strictEqual(t2.customTitle, 'ikinci'); // the last title wins
});

test('rename never glues the record onto an unfinished last line', () => {
  fresh(prompt); // no trailing newline
  new Collector().rename(SID, cwd, 'ad');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(JSON.parse(lines[1]).customTitle, 'ad');
});

test('rename refuses an empty name and a bad session id', () => {
  fresh(prompt + '\n');
  const c = new Collector();
  assert.throws(() => c.rename(SID, cwd, '   '), /boş/);
  assert.throws(() => c.rename('../../etc/passwd', cwd, 'x'), /Geçersiz/);
});

test('deleteSession removes the transcript and its subagent folder, and nothing else', () => {
  fresh(prompt + '\n');
  const other = path.join(projDir, 'other.jsonl');
  fs.writeFileSync(other, '{}\n');
  const c = new Collector();
  c.deleteSession(SID, cwd);
  assert.ok(!fs.existsSync(file));
  assert.ok(!fs.existsSync(path.join(projDir, SID)));
  assert.ok(fs.existsSync(other));
  assert.throws(() => c.deleteSession(SID, cwd), /bulunamadı/); // already gone
});

test('rename and deleteSession refuse a transcript that is a symlink to a file outside projects/', () => {
  fresh(prompt + '\n');
  const victim = path.join(home, 'victim.jsonl'); // outside projects/
  fs.writeFileSync(victim, 'keep\n');
  fs.rmSync(file);
  fs.symlinkSync(victim, file);
  const c = new Collector();
  assert.throws(() => c.rename(SID, cwd, 'x'), /bulunamadı/);
  assert.throws(() => c.deleteSession(SID, cwd), /bulunamadı/);
  assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'keep\n');
});

test('deleteSession only unlinks a subagent folder that is a symlink to elsewhere', () => {
  fresh(prompt + '\n');
  const other = path.join(home, 'other-dir');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'precious.txt'), 'keep');
  fs.rmSync(path.join(projDir, SID), { recursive: true });
  fs.symlinkSync(other, path.join(projDir, SID));
  new Collector().deleteSession(SID, cwd);
  assert.ok(!fs.existsSync(file));
  assert.ok(!fs.existsSync(path.join(projDir, SID)));
  assert.strictEqual(fs.readFileSync(path.join(other, 'precious.txt'), 'utf8'), 'keep');
});
