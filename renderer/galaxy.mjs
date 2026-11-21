// Layout of the "branch galaxy": one repository's branches around its main branch, opened from a planet on the
// orbit map. Main is the star in the middle; every other branch orbits it. Kept free of rendering code (like
// physics.mjs) so it can be tested on its own; orbit3d.js turns the result into meshes.
//
// data (from git:branches) = { name, main, head, branches: [{ name, isMain, current, hasLocal, hasRemote,
//                              ahead, behind, sync, time, subject, hash, remote }] }
// →  { star: branch | null, bodies: [{ b, radius, angle, size, hue, tone, badge }] }
//   radius  how far the branch has drifted from main (ahead + behind, log scale): close to main = inner orbit
//   size    how much it carries that main doesn't (ahead, log scale)
//   angle   from the name, so a branch keeps its place when the data is refreshed
//   tone    'current' (checked out), 'local', or 'remote' (only on origin: drawn faint)
//   badge   '↑' commits to push, '↓' to pull, '↕' both, '' in sync or not tracked

export const INNER = 110; // the closest orbit
export const SPREAD = 70; // extra orbit radius per e-fold of divergence
export const MIN_GAP = 34; // two branches never share an orbit closer than this

export function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

const BADGE = { ahead: '↑', behind: '↓', diverged: '↕' };

export function branchLayout(data) {
  const all = (data && Array.isArray(data.branches) ? data.branches : []).filter((b) => b && typeof b.name === 'string');
  const star = all.find((b) => b.isMain) || null;
  const rest = all.filter((b) => b !== star);
  // nearest main first; ties by name, so the order (and so each orbit) is stable
  const drift = (b) => Math.max(0, b.ahead | 0) + Math.max(0, b.behind | 0);
  rest.sort((a, b) => drift(a) - drift(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const bodies = [];
  let last = -Infinity;
  for (const b of rest) {
    let radius = INNER + SPREAD * Math.log1p(drift(b));
    if (radius - last < MIN_GAP) radius = last + MIN_GAP; // keep orbits apart, still in drift order
    last = radius;
    const h = hash(b.name);
    bodies.push({
      b,
      radius,
      angle: ((h % 3600) / 3600) * Math.PI * 2,
      size: 7 + 4 * Math.log1p(Math.max(0, b.ahead | 0)),
      hue: h % 360,
      tone: b.current ? 'current' : b.hasLocal ? 'local' : 'remote',
      badge: BADGE[b.sync] || '',
    });
  }
  return { star, bodies };
}
