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

test('snapshot ignores session files with a bad pid or id and cleans status and job id', () => {
  const dir = path.join(home, 'sessions');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const base = { sessionId: SID, cwd, startedAt: 1 };
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ ...base, pid: process.pid, status: '"><img src=x onerror=alert(1)>', jobId: '../../x' }));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ ...base, pid: '../../etc/passwd' })); // not a number
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ ...base, pid: process.pid, sessionId: '../../evil' })); // not an id
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify({ ...base, pid: -5 }));
  const snap = new Collector().snapshot();
  assert.strictEqual(snap.sessions.length, 1);
  assert.strictEqual(snap.sessions[0].status, 'idle');
  assert.strictEqual(snap.sessions[0].jobId, null);
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ ...base, pid: process.pid, status: 'waiting', jobId: 'job_1-a' }));
  const ok = new Collector().snapshot().sessions[0];
  assert.strictEqual(ok.status, 'waiting');
  assert.strictEqual(ok.jobId, 'job_1-a');
});

test('deletePlan names the file and counts subagent transcripts without touching anything', () => {
  fresh(prompt + "\n");
  const plan = new Collector().deletePlan(SID, cwd);
  assert.strictEqual(plan.name, SID + ".jsonl");
  assert.strictEqual(plan.subagents, 1);
  assert.ok(fs.existsSync(file));
  assert.throws(() => new Collector().deletePlan("../x", cwd), /Geçersiz/);
});

test('trashSession hands the transcript and its folder to the trash function instead of deleting them', async () => {
  fresh(prompt + "\n");
  const moved = [];
  await new Collector().trashSession(SID, cwd, async (p) => moved.push(p));
  assert.deepStrictEqual(moved.map((p) => path.basename(p)), [SID + ".jsonl", SID]);
  assert.ok(fs.existsSync(file)); // the fake trash left them: we never rm anything ourselves
});

test('trashSession deletes nothing when the trash refuses', async () => {
  fresh(prompt + "\n");
  await assert.rejects(new Collector().trashSession(SID, cwd, async () => { throw new Error("no trash"); }), /no trash/);
  assert.ok(fs.existsSync(file));
});
