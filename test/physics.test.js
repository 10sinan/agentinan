const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../renderer/physics.mjs');
const body = (m, x, y = 0, z = 0, radius = 10) => {
  const b = m.makeBody();
  b.anchor = { x, y, z };
  b.radius = radius;
  return b;
};
const run = (m, bodies, seconds, interact = true) => {
  for (let t = 0; t < seconds; t += 1 / 60) m.stepBodies(bodies, 1 / 60, interact);
};
const dist = (a, b) =>
  Math.hypot(a.anchor.x + a.off.x - b.anchor.x - b.off.x, a.anchor.y + a.off.y - b.anchor.y - b.off.y, a.anchor.z + a.off.z - b.anchor.z - b.off.z);

test('a lone planet far from everything stays on its orbit', async () => {
  const m = await load();
  const a = body(m, 300);
  run(m, [a], 2);
  assert.ok(Math.hypot(a.off.x, a.off.y, a.off.z) < 1e-6);
});

test('two planets passing close push each other apart', async () => {
  const m = await load();
  const a = body(m, 300, 0, 0);
  const b = body(m, 300, 0, 18); // 18 apart, well inside personal space
  run(m, [a, b], 0.3);
  assert.ok(dist(a, b) > 18);
});

test('the push is bounded: offsets never exceed maxOffset', async () => {
  const m = await load();
  const a = body(m, 300, 0, 0);
  const b = body(m, 300, 0, 1);
  run(m, [a, b], 3);
  for (const p of [a, b]) assert.ok(Math.hypot(p.off.x, p.off.y, p.off.z) <= m.DEFAULTS.maxOffset + 1e-6);
});

test('after they drift apart the offsets spring back to rest', async () => {
  const m = await load();
  const a = body(m, 300, 0, 0);
  const b = body(m, 300, 0, 18);
  run(m, [a, b], 0.3);
  b.anchor.z = 900; // the orbits carried them away from each other
  run(m, [a, b], 6);
  assert.ok(m.atRest(a) && m.atRest(b));
});

test('a working planet (pull) leans toward the sun, an idle one does not', async () => {
  const m = await load();
  const working = body(m, 300);
  working.pull = 1;
  const idle = body(m, 0, 0, 300);
  run(m, [working, idle], 3);
  assert.ok(working.off.x < -5, 'leans inward');
  assert.ok(Math.abs(idle.off.x) < 1e-6 && Math.abs(idle.off.z) < 1e-6);
});

test('a planet too close to the sun is blown outward', async () => {
  const m = await load();
  const a = body(m, 50);
  run(m, [a], 1);
  assert.ok(a.off.x > 0);
});

test('a held planet follows its target and flings on release, then returns', async () => {
  const m = await load();
  const a = body(m, 300);
  a.held = true;
  for (let i = 0; i < 40; i++) {
    a.target = { x: 300 + i * 3, y: 0, z: 0 }; // dragged outward
    m.stepBodies([a], 1 / 60);
  }
  assert.ok(a.off.x > 60, 'followed past maxOffset while held');
  assert.ok(a.vel.x > 20, 'has speed from the drag');
  a.held = false;
  run(m, [a], 8);
  assert.ok(m.atRest(a), 'springs home');
});

test('interact = false: no planet-to-planet forces, spring and drag still work', async () => {
  const m = await load();
  const a = body(m, 300, 0, 0);
  const b = body(m, 300, 0, 18);
  run(m, [a, b], 1, false);
  assert.ok(Math.abs(dist(a, b) - 18) < 1e-6);
});

test('a very long frame does not blow the simulation up', async () => {
  const m = await load();
  const a = body(m, 300, 0, 0);
  const b = body(m, 300, 0, 5);
  m.stepBodies([a, b], 5);
  assert.ok(Number.isFinite(a.off.x) && Math.hypot(a.off.x, a.off.y, a.off.z) <= m.DEFAULTS.maxOffset + 1e-6);
});
