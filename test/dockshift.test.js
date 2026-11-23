const test = require('node:test');
const assert = require('node:assert');
const { dockShift } = require('../renderer/dockshift.js');

test('closed drawer: no shift, whatever the geometry', () => {
  assert.strictEqual(dockShift(800, 500, false), 0);
});

test('open drawer moves the terminal up by exactly what it covers', () => {
  assert.strictEqual(dockShift(800, 520, true), 280);
  assert.strictEqual(dockShift(800.4, 520, true), 280); // whole pixels
});

test('a drawer that does not reach the terminal moves nothing', () => {
  assert.strictEqual(dockShift(400, 520, true), 0);
  assert.strictEqual(dockShift(520, 520, true), 0);
});

test('bad numbers (a hidden drawer measures 0, NaN) never produce a shift', () => {
  assert.strictEqual(dockShift(NaN, 500, true), 0);
  assert.strictEqual(dockShift(800, NaN, true), 0);
  assert.strictEqual(dockShift(undefined, undefined, true), 0);
});
