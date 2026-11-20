const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transcript, Collector } = require('../src/collector');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentinan-tr-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const newFile = () => path.join(dir, `t${n++}.jsonl`);
const L = (o) => JSON.stringify(o) + '\n';
const TS = '2026-01-15T12:00:00.000Z';

const asst = (id, usage, content = [{ type: 'text', text: 'hi' }], extra = {}) =>
  L({ type: 'assistant', timestamp: TS, message: { id, model: 'claude-sonnet-5-5', usage, content }, ...extra });

test('a reply written as several records is counted once (last record wins)', () => {
  const f = newFile();
  fs.writeFileSync(f, asst('m1', { input_tokens: 10, output_tokens: 1 }) + asst('m1', { input_tokens: 10, output_tokens: 50 }));
  const t = new Transcript(f);
  t.update();
  const { usage, cost } = t.totals();
  assert.strictEqual(usage.input, 10);
  assert.strictEqual(usage.output, 50);
  assert.ok(cost > 0);
});

test('cache_creation breakdown is used when present, otherwise the flat field counts as 5m', () => {
  const f = newFile();
  fs.writeFileSync(
    f,
    asst('a', { cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 7 } }) +
      asst('b', { cache_creation_input_tokens: 3 }),
  );
  const t = new Transcript(f);
  t.update();
  const { usage } = t.totals();
  assert.strictEqual(usage.cacheWrite5m, 8);
  assert.strictEqual(usage.cacheWrite1h, 7);
});

test('tool_use stays pending until its tool_result arrives', () => {
  const f = newFile();
  fs.writeFileSync(f, asst('a', {}, [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/x/y/foo.js' } }]));
  const t = new Transcript(f);
  t.update();
  assert.strictEqual(t.pending.size, 1);
  assert.strictEqual(t.recentTools[0].brief, 'foo.js');
  fs.appendFileSync(f, L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] } }));
  t.update();
  assert.strictEqual(t.pending.size, 0);
  assert.strictEqual(t.toolCount, 1);
});

test('injected harness text is not taken as the last prompt; real prompt is', () => {
  const f = newFile();
  fs.writeFileSync(
    f,
    L({ type: 'user', message: { content: 'merhaba' } }) +
      L({ type: 'user', message: { content: '<system-reminder>x</system-reminder>' } }) +
      L({ type: 'user', isMeta: true, message: { content: 'meta' } }),
  );
  const t = new Transcript(f);
  t.update();
  assert.strictEqual(t.lastPrompt, 'merhaba');
});

test('a half-written last line is kept and completed on the next update', () => {
  const f = newFile();
  const line = asst('m', { input_tokens: 4 });
  fs.writeFileSync(f, line.slice(0, 40));
  const t = new Transcript(f);
  t.update();
  assert.strictEqual(t.msgs.size, 0);
  fs.appendFileSync(f, line.slice(40));
  t.update();
  assert.strictEqual(t.totals().usage.input, 4);
});

test('garbage lines and synthetic messages are ignored', () => {
  const f = newFile();
  fs.writeFileSync(f, 'not json\n' + L({ type: 'assistant', message: { id: 's', model: '<synthetic>', usage: { input_tokens: 99 } } }));
  const t = new Transcript(f);
  t.update();
  assert.strictEqual(t.msgs.size, 0);
});

test('a truncated/replaced file is re-read from scratch', () => {
  const f = newFile();
  fs.writeFileSync(f, asst('a', { input_tokens: 100 }) + asst('b', { input_tokens: 100 }));
  const t = new Transcript(f);
  t.update();
  fs.writeFileSync(f, asst('c', { input_tokens: 1 }));
  t.update();
  assert.strictEqual(t.totals().usage.input, 1);
});

test('missing file does not throw', () => {
  assert.strictEqual(new Transcript(path.join(dir, 'nope.jsonl')).update(), false);
});

test('a Bash git commit / push is flagged on the tool for the map', () => {
  const f = newFile();
  const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command, description: 'x' } });
  fs.writeFileSync(
    f,
    asst('g', { output_tokens: 1 }, [
      bash('b1', 'git add -A && git commit -m "push the button"'),
      bash('b2', 'cd repo && git -C . push origin main'),
      bash('b3', 'git status'),
      bash('b4', 'echo git commit'),
    ]),
  );
  const t = new Transcript(f);
  t.update();
  assert.deepStrictEqual(t.recentTools.map((x) => x.git || null), ['commit', 'push', null, null]);
});

test('timeline: active minutes of today, closed sessions too, subagents left out', () => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const userAt = (ms, extra = {}) => L({ type: 'user', timestamp: iso(ms), cwd: '/work/proj', message: { role: 'user', content: 'do it' }, ...extra });
  const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const f = path.join(dir, sid + '.jsonl');
  const old = now - 3 * 86400000; // an earlier day: not part of today
  fs.writeFileSync(f, userAt(old) + userAt(now - 120000) + userAt(now - 60000) + userAt(now - 30000, { isMeta: true }) + L({ type: 'ai-title', aiTitle: 'Başlık' }));
  const subDir = path.join(dir, sid, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const sub = path.join(subDir, 'agent-x.jsonl');
  fs.writeFileSync(sub, userAt(now - 60000));
  const c = new Collector();
  c.transcript(f);
  c.transcript(sub);
  const tl = c.timeline();
  assert.strictEqual(tl.sessions.length, 1);
  const s = tl.sessions[0];
  assert.strictEqual(s.id, sid);
  assert.strictEqual(s.name, 'Başlık');
  assert.strictEqual(s.cwd, '/work/proj');
  const m = (ms) => Math.floor(ms / 60000);
  const expect = [...new Set([now - 120000, now - 60000].filter((x) => x >= tl.from).map(m))];
  assert.deepStrictEqual(s.minutes, expect);
  assert.ok(s.start <= now - 60000 && s.end >= now - 60000);
});
