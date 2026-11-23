const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// CLAUDE_CONFIG_DIR is read when the collector loads: point it at a temp folder, never at the real ~/.claude.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-snap-'));
process.env.CLAUDE_CONFIG_DIR = home;
const { Collector } = require('../src/collector');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const cwd = '/work/snap';
const sessDir = path.join(home, 'sessions');
const projDir = path.join(home, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
fs.mkdirSync(sessDir, { recursive: true });
fs.mkdirSync(projDir, { recursive: true });

const sessionFile = (pid, extra = {}) =>
  fs.writeFileSync(
    path.join(sessDir, `${pid}.json`),
    JSON.stringify({ pid, sessionId: SID, cwd, startedAt: Date.now(), status: 'busy', kind: 'interactive', ...extra }),
  );
const reply = JSON.stringify({
  type: 'assistant',
  timestamp: new Date().toISOString(),
  message: { id: 'm1', model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text: 'tamam' }], usage: { input_tokens: 100, output_tokens: 50 } },
});
fs.writeFileSync(path.join(projDir, SID + '.jsonl'), reply + '\n');

test('snapshot lists a live session with its tokens, cost and status', () => {
  sessionFile(process.pid); // this very process is guaranteed to be alive
  const snap = new Collector().snapshot();
  assert.strictEqual(snap.sessions.length, 1);
  const s = snap.sessions[0];
  assert.strictEqual(s.id, SID);
  assert.strictEqual(s.status, 'busy');
  assert.strictEqual(s.tokens.output, 50);
  assert.ok(s.cost > 0);
});

test('snapshot skips a session whose process is gone, and a session file with a bad id or pid', () => {
  fs.rmSync(path.join(sessDir, `${process.pid}.json`));
  sessionFile(2 ** 22 + 12345); // a pid no process has
  sessionFile(process.pid, { sessionId: '../../etc/passwd' });
  fs.writeFileSync(path.join(sessDir, 'junk.json'), '{ not json');
  assert.strictEqual(new Collector().snapshot().sessions.length, 0);
});

test('a second snapshot reuses what the first read: the transcript is not parsed again', () => {
  fs.rmSync(sessDir, { recursive: true, force: true });
  fs.mkdirSync(sessDir);
  sessionFile(process.pid);
  const c = new Collector();
  c.snapshot();
  const t = [...c.transcripts.values()][0];
  const before = t.msgs.size;
  c.snapshot();
  assert.strictEqual([...c.transcripts.values()][0], t); // same object, not rebuilt
  assert.strictEqual(t.msgs.size, before);
});

test('an unknown status in a session file falls back to idle', () => {
  fs.rmSync(sessDir, { recursive: true, force: true });
  fs.mkdirSync(sessDir);
  sessionFile(process.pid, { status: 'rm -rf /' });
  assert.strictEqual(new Collector().snapshot().sessions[0].status, 'idle');
});
