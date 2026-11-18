const test = require('node:test');
const assert = require('node:assert');
const { costOf, priceKey, prettyModel } = require('../src/pricing');

const U = (o = {}) => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...o });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test('costOf: sonnet-5-5 per million tokens', () => {
  near(costOf('claude-sonnet-5-5', U({ input: 1e6 })), 2);
  near(costOf('claude-sonnet-5-5', U({ output: 1e6 })), 10);
  near(costOf('claude-sonnet-5-5', U({ cacheRead: 1e6 })), 0.1);
  near(costOf('claude-sonnet-5-5', U({ cacheWrite5m: 1e6 })), 2.5); // 1.25 × input
  near(costOf('claude-sonnet-5-5', U({ cacheWrite1h: 1e6 })), 4); // 2 × input
});

test('costOf: cacheRead defaults to 0.1 × input when the table has null', () => {
  near(costOf('claude-opus-4-1', U({ cacheRead: 1e6 })), 1.5);
});

test('costOf: unknown family falls back to newest of that family, unknown vendor costs 0', () => {
  assert.strictEqual(priceKey('claude-haiku-9-9'), 'claude-haiku-5-5');
  assert.strictEqual(costOf('gpt-4', U({ input: 1e6 })), 0);
  assert.strictEqual(costOf(null, U({ input: 1e6 })), 0);
});

test('priceKey: longest match wins and date/bracket suffixes are accepted', () => {
  assert.strictEqual(priceKey('claude-opus-4-1-20250805'), 'claude-opus-4-1');
  assert.strictEqual(priceKey('claude-opus-4-20250514'), 'claude-opus-4');
  assert.strictEqual(priceKey('claude-sonnet-5-5[1m]'), 'claude-sonnet-5-5');
});

test('prettyModel', () => {
  assert.strictEqual(prettyModel('claude-opus-4-1'), 'Opus 4.1');
  assert.strictEqual(prettyModel('claude-3-5-haiku'), 'Haiku 3.5');
  assert.strictEqual(prettyModel('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.strictEqual(prettyModel(null), '?');
});
