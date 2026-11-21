const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../renderer/galaxy.mjs');
const br = (name, o = {}) => ({ name, isMain: false, current: false, hasLocal: true, hasRemote: true, ahead: 0, behind: 0, sync: 'same', ...o });

test('main is the star; the others orbit it, nearer the less they drifted', async () => {
  const { branchLayout } = await load();
  const { star, bodies } = branchLayout({
    branches: [br('far', { ahead: 30, behind: 40 }), br('main', { isMain: true }), br('near', { ahead: 1 }), br('mid', { behind: 6 })],
  });
  assert.strictEqual(star.name, 'main');
  assert.deepStrictEqual(
    bodies.map((x) => x.b.name),
    ['near', 'mid', 'far'],
  );
  assert.ok(bodies[0].radius < bodies[1].radius && bodies[1].radius < bodies[2].radius);
});

test('orbits keep a minimum gap, even for branches that drifted the same', async () => {
  const { branchLayout, MIN_GAP } = await load();
  const { bodies } = branchLayout({ branches: [br('a'), br('b'), br('c')] });
  for (let i = 1; i < bodies.length; i++) assert.ok(bodies[i].radius - bodies[i - 1].radius >= MIN_GAP - 1e-9);
});

test('more commits ahead of main makes a bigger body; angles are stable across refreshes', async () => {
  const { branchLayout } = await load();
  const data = { branches: [br('main', { isMain: true }), br('small', { ahead: 1 }), br('big', { ahead: 50 })] };
  const one = branchLayout(data);
  const two = branchLayout(JSON.parse(JSON.stringify(data)));
  const size = (l, n) => l.bodies.find((x) => x.b.name === n).size;
  assert.ok(size(one, 'big') > size(one, 'small'));
  assert.deepStrictEqual(
    one.bodies.map((x) => x.angle),
    two.bodies.map((x) => x.angle),
  );
});

test('tone and badge follow checkout and sync state', async () => {
  const { branchLayout } = await load();
  const { bodies } = branchLayout({
    branches: [
      br('cur', { current: true, sync: 'ahead' }),
      br('loc', { hasRemote: false, sync: 'local-only' }),
      br('rem', { hasLocal: false, sync: 'remote-only' }),
      br('pull', { sync: 'behind' }),
      br('both', { sync: 'diverged' }),
    ],
  });
  const by = Object.fromEntries(bodies.map((x) => [x.b.name, x]));
  assert.deepStrictEqual(
    ['cur', 'loc', 'rem', 'pull', 'both'].map((n) => [by[n].tone, by[n].badge]),
    [
      ['current', '↑'],
      ['local', ''],
      ['remote', ''],
      ['local', '↓'],
      ['local', '↕'],
    ],
  );
});

test('empty, missing or junk data gives an empty galaxy', async () => {
  const { branchLayout } = await load();
  for (const d of [null, undefined, {}, { branches: null }, { branches: [null, 3, { name: 5 }] }]) {
    assert.deepStrictEqual(branchLayout(d), { star: null, bodies: [] });
  }
});

test('neighbouring orbits start at least MIN_ANGLE apart, even when the names hash to nearby angles', async () => {
  const { branchLayout, MIN_ANGLE } = await load();
  // the two branches that overlapped on screen, plus enough others for some angles to collide
  const names = ['branch-galaxy', 'security-audit', ...Array.from({ length: 30 }, (_, i) => `feature-${i}`)];
  const data = { branches: [br('main', { isMain: true }), ...names.map((n, i) => br(n, { ahead: i }))] };
  const { bodies } = branchLayout(data);
  const gap = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return Math.min(d, Math.PI * 2 - d);
  };
  for (let i = 1; i < bodies.length; i++) {
    assert.ok(gap(bodies[i].angle, bodies[i - 1].angle) >= MIN_ANGLE - 1e-9, `${bodies[i - 1].b.name} / ${bodies[i].b.name}`);
  }
  for (const x of bodies) assert.ok(x.angle >= 0 && x.angle < Math.PI * 2);
  // still stable: the same data gives the same angles
  assert.deepStrictEqual(
    branchLayout(data).bodies.map((x) => x.angle),
    bodies.map((x) => x.angle),
  );
});
