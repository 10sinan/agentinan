// Soft "gravity" between the planets of the orbit map. Purely visual: every planet still travels its own orbit
// (its anchor); physics only adds a small offset on top, which springs back to zero. Kept free of any
// rendering code so it can be tested on its own.
//
// body = {
//   anchor: {x,y,z}   where its orbit says it is
//   off, vel: {x,y,z} the offset from the anchor and its speed (owned by this module)
//   radius            visual radius, sets the personal space around it
//   pull              0..1 how strongly the sun draws it in (working planets lean toward the sun)
//   held              true while the user drags it; `target` is then where the pointer wants it
//   target: {x,y,z}
// }

export const makeBody = () => ({
  anchor: { x: 0, y: 0, z: 0 },
  off: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  radius: 10,
  pull: 0,
  held: false,
  target: { x: 0, y: 0, z: 0 },
});

export const DEFAULTS = {
  spring: 7, // how hard the offset is pulled back to rest
  damping: 3.2, // friction; spring 7 / damping 3.2 gives a couple of soft wobbles
  space: 4.2, // personal space, in planet radii: closer than this the planets push apart
  reach: 9, // beyond personal space up to this many radii they attract a little
  push: 420, // strength of the push
  attract: 26, // strength of the pull
  sunRange: 95, // planets this close to the sun feel its wind
  sunWind: 120,
  lean: 14, // how far a "pull" planet leans toward the sun
  maxOffset: 46, // the offset never grows past this (unless held), so orbits stay readable
  maxSpeed: 420,
};

const len = (v) => Math.hypot(v.x, v.y, v.z);

function clampVec(v, max) {
  const l = len(v);
  if (l > max) {
    const k = max / l;
    v.x *= k;
    v.y *= k;
    v.z *= k;
  }
}

// Advances all bodies by dt seconds. `interact` = false turns off the planet-to-planet and sun forces
// (low quality), leaving only the spring and dragging.
export function stepBodies(bodies, dt, interact = true, opt = DEFAULTS) {
  dt = Math.min(dt, 0.05); // a long frame must not blow the simulation up
  const acc = bodies.map(() => ({ x: 0, y: 0, z: 0 }));

  if (interact) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const ap = { x: a.anchor.x + a.off.x, y: a.anchor.y + a.off.y, z: a.anchor.z + a.off.z };

      // sun: wind pushes planets that get too close, "pull" leans working planets toward it
      const dSun = len(ap) || 1;
      if (dSun < opt.sunRange) {
        const f = (1 - dSun / opt.sunRange) ** 2 * opt.sunWind;
        acc[i].x += (ap.x / dSun) * f;
        acc[i].y += (ap.y / dSun) * f;
        acc[i].z += (ap.z / dSun) * f;
      }

      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const dx = ap.x - (b.anchor.x + b.off.x);
        const dy = ap.y - (b.anchor.y + b.off.y);
        const dz = ap.z - (b.anchor.z + b.off.z);
        const d = Math.hypot(dx, dy, dz) || 0.001;
        const unit = (a.radius + b.radius) / 2;
        const near = opt.space * unit;
        const far = opt.reach * unit;
        let f = 0; // + pushes apart, - pulls together
        if (d < near) f = (1 - d / near) ** 2 * opt.push;
        else if (d < far) f = -Math.sin(((d - near) / (far - near)) * Math.PI) * opt.attract;
        if (!f) continue;
        const k = f / d;
        acc[i].x += dx * k;
        acc[i].y += dy * k;
        acc[i].z += dz * k;
        acc[j].x -= dx * k;
        acc[j].y -= dy * k;
        acc[j].z -= dz * k;
      }
    }
  }

  bodies.forEach((b, i) => {
    if (b.held) {
      // follows the pointer; the speed is measured so letting go flings it
      const nx = b.target.x - b.anchor.x;
      const ny = b.target.y - b.anchor.y;
      const nz = b.target.z - b.anchor.z;
      const ease = Math.min(1, dt * 22);
      const ox = b.off.x;
      const oy = b.off.y;
      const oz = b.off.z;
      b.off.x += (nx - b.off.x) * ease;
      b.off.y += (ny - b.off.y) * ease;
      b.off.z += (nz - b.off.z) * ease;
      const inv = dt > 0 ? 1 / dt : 0;
      b.vel.x = b.vel.x * 0.6 + ((b.off.x - ox) * inv) * 0.4;
      b.vel.y = b.vel.y * 0.6 + ((b.off.y - oy) * inv) * 0.4;
      b.vel.z = b.vel.z * 0.6 + ((b.off.z - oz) * inv) * 0.4;
      return;
    }
    // rest position of the offset: leaning toward the sun a little when "pull" is set
    const dSun = len(b.anchor) || 1;
    const rest = { x: (-b.anchor.x / dSun) * opt.lean * b.pull, y: (-b.anchor.y / dSun) * opt.lean * b.pull, z: (-b.anchor.z / dSun) * opt.lean * b.pull };
    for (const c of ['x', 'y', 'z']) {
      const a = acc[i][c] - opt.spring * (b.off[c] - rest[c]) - opt.damping * b.vel[c];
      b.vel[c] += a * dt;
    }
    clampVec(b.vel, opt.maxSpeed);
    for (const c of ['x', 'y', 'z']) b.off[c] += b.vel[c] * dt;
    clampVec(b.off, opt.maxOffset);
  });
}

// True when the body has come to rest (used to skip work).
export const atRest = (b) => !b.held && len(b.off) < 0.02 && len(b.vel) < 0.02;
