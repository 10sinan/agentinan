const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transcript } = require('../src/collector');

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
