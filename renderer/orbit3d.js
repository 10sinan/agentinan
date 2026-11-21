// The 3D orbit map: the sun is you, every Claude Code session is a planet, active subagents are its moons.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeBody, stepBodies } from './physics.mjs';
import { branchLayout } from './galaxy.mjs';

const D = window.dash;
const host = document.getElementById('scene');
const tip = document.getElementById('tip');

// ---------- renderer, camera, controls ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05060b');
scene.fog = new THREE.FogExp2('#05060b', 0.0011);

const camera = new THREE.PerspectiveCamera(45, 1, 1, 6000);
camera.position.set(0, 470, 560);

const controls = new OrbitControls(camera, labels.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 120;
controls.maxDistance = 1600;
controls.maxPolarAngle = Math.PI * 0.86;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.25;
controls.enablePan = false;
let idleTimer = null;
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  clearTimeout(idleTimer);
});
controls.addEventListener('end', () => {
  idleTimer = setTimeout(() => (controls.autoRotate = true), 8000);
});

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera); // its scene is swapped for the branch galaxy's while that is open
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.62);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  labels.setSize(w, h);
  bloom.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

// ---------- light ----------
scene.add(new THREE.AmbientLight('#4a5680', 0.55));
const sunLight = new THREE.PointLight('#ffd08a', 3.2, 0, 0);
scene.add(sunLight);

// ---------- background: stars and a faint nebula ----------
function starField(count, rMin, rMax, size, opacity) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(rMin + Math.random() * (rMax - rMin));
    pos.set([v.x, v.y, v.z], i * 3);
    c.setHSL(0.55 + Math.random() * 0.15, 0.5, 0.75 + Math.random() * 0.25);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: size * 2.2, map: GLOW, vertexColors: true, transparent: true, opacity, sizeAttenuation: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  return new THREE.Points(g, m);
}

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)');
const stars = new THREE.Group();
stars.add(starField(2600, 1500, 3200, 1.3, 0.75), starField(500, 1500, 3200, 2.2, 0.9));
scene.add(stars);

for (let i = 0; i < 5; i++) {
  const neb = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color().setHSL(0.62 + i * 0.07, 0.7, 0.35), transparent: true, opacity: 0.09, depthWrite: false, fog: false }),
  );
  neb.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(1400));
  neb.scale.setScalar(900 + Math.random() * 700);
  scene.add(neb);
}

// ---------- sun ----------
function surfaceTexture(seed, banded, hue = null) {
  // with a hue, the grey surface is tinted by it (the project colour); without, it stays neutral
  const tone = (v, a = 1) => (hue === null ? `rgba(${v},${v},${v},${a})` : `hsla(${hue},34%,${(v / 255) * 100}%,${a})`);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  if (banded) {
    for (let y = 0; y < 128; y += 2) {
      const v = 175 + Math.sin(y * 0.11 + rnd() * 0.6) * 35 + rnd() * 30;
      g.fillStyle = tone(v);
      g.fillRect(0, y, 256, 2);
    }
  }
  for (let i = 0; i < 140; i++) {
    const v = 140 + rnd() * 115;
    g.fillStyle = tone(v, 0.25 + rnd() * 0.35);
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 128, 4 + rnd() * 26, 1 + rnd() * 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// the sun is the light source: its body, halos and corona ignore the fog so it stays bright from far away
const sunGroup = new THREE.Group();
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(30, 48, 32),
  new THREE.MeshBasicMaterial({ map: surfaceTexture(7, false), color: new THREE.Color('#ffb340').multiplyScalar(1.6), fog: false }),
);
sunGroup.add(sunMesh);
const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#ff9a2e', transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
sunHalo.scale.setScalar(190);
sunGroup.add(sunHalo);
scene.add(sunGroup);

const sunLabelEl = document.createElement('div');
sunLabelEl.className = 'sun-label';
const sunLabel = new CSS2DObject(sunLabelEl);
sunLabel.position.set(0, -44, 0);
sunGroup.add(sunLabel);

// corona: soft rays that turn slowly behind the sun
function coronaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  g.filter = 'blur(1.2px)';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 + Math.random() * 0.08;
    const len = 52 + Math.random() * 64;
    const w = 0.012 + Math.random() * 0.03;
    const grd = g.createRadialGradient(0, 0, 14, 0, 0, len);
    grd.addColorStop(0, 'rgba(255,255,255,0.28)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.07)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, len, a - w, a + w);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: coronaTexture(), color: '#ffb340', transparent: true, opacity: 0.32, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
corona.scale.setScalar(230);
sunGroup.add(corona);
const sunHalo2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#ffe2a8', transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
sunHalo2.scale.setScalar(80);
sunGroup.add(sunHalo2);

// dust disc: a faint, slowly turning haze of particles around the sun, thicker toward the middle
const DUST = 1400;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) {
  const r = 55 + Math.pow(Math.random(), 1.8) * 700;
  const a = Math.random() * Math.PI * 2;
  dustPos.set([Math.cos(a) * r, (Math.random() - 0.5) * (6 + r * 0.04), Math.sin(a) * r], i * 3);
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 2.6, map: GLOW, color: '#9fb0e8', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(dust);

// shooting stars: now and then one streaks across the far sky
const SHOOTERS = Array.from({ length: 3 }, () => {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  line.frustumCulled = false;
  scene.add(line);
  return { line, born: 0, life: 0, from: new THREE.Vector3(), vel: new THREE.Vector3() };
});
let nextShooter = 3;
function updateShooters(t, dt) {
  nextShooter -= dt;
  if (nextShooter <= 0) {
    nextShooter = 4 + Math.random() * 7;
    const sh = SHOOTERS.find((x) => t - x.born > x.life);
    if (sh) {
      sh.born = t;
      sh.life = 0.9 + Math.random() * 0.5;
      sh.from.randomDirection().multiplyScalar(1700 + Math.random() * 600);
      sh.vel.randomDirection().multiplyScalar(900 + Math.random() * 500);
    }
  }
  for (const sh of SHOOTERS) {
    const k = (t - sh.born) / sh.life;
    if (k < 0 || k > 1) {
      sh.line.material.opacity = 0;
      continue;
    }
    const head = tmp.copy(sh.from).addScaledVector(sh.vel, t - sh.born);
    const pos = sh.line.geometry.attributes.position;
    pos.setXYZ(1, head.x, head.y, head.z);
    pos.setXYZ(0, head.x - sh.vel.x * 0.14, head.y - sh.vel.y * 0.14, head.z - sh.vel.z * 0.14);
    pos.needsUpdate = true;
    sh.line.material.opacity = Math.sin(k * Math.PI) * 0.85;
  }
}

// ---------- planets ----------
const STATUS = {
  busy: new THREE.Color(D.COLORS.busy),
  waiting: new THREE.Color(D.COLORS.waiting),
  idle: new THREE.Color(D.COLORS.idle),
};
const HOT_A = new THREE.Color('#ff2a12');
const HOT_B = new THREE.Color('#ffd25a');
const HOT = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');
const ORBIT = { line: new THREE.Color('#7d8cc4'), selected: new THREE.Color('#a78bfa') };

// Theme: space colour, status colours (planets ease toward them), orbit lines.
function applyTheme(t) {
  scene.background.set(t.bg);
  scene.fog.color.set(t.bg);
  STATUS.busy.set(t.busy);
  STATUS.waiting.set(t.waiting);
  STATUS.idle.set(t.idle);
  ORBIT.line.set(t.accent).lerp(new THREE.Color('#9aa3c7'), 0.5);
  ORBIT.selected.set(t.accent2);
  for (const p of planets.values()) p.pulse.material.color.set(t.waiting);
}
window.addEventListener('dash:theme', (e) => applyTheme(e.detail));
const planets = new Map(); // session id → planet object
const dying = []; // closed sessions' planets, spiralling into the sun before they are disposed
let firstLayout = true; // the first snapshot only places planets: nothing is born or finished then
let sunFlash = 0; // 1 → 0: the sun flares when a planet is born from it or falls into it
let replay = null; // the replay of the day, while it runs (see the replay section)
const pickables = [];

function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// atmosphere: a rim glow that hugs the planet's edge (strongest where we look across the surface)
const ATMO_VS = `varying vec3 vN; varying vec3 vV;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ATMO_FS = `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
void main() { float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.6); gl_FragColor = vec4(uColor * (0.6 + f), f * uAlpha); }`;
const ATMO_GEO = new THREE.SphereGeometry(1, 40, 28);

// sessions in the same folder share a hue: a tint on the surface and a dot on the label
const projectHue = (cwd) => hash(cwd || '') % 360;

function makePlanet(s) {
  const h = hash(s.id);
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: surfaceTexture(h, true, projectHue(s.cwd)), roughness: 0.75, metalness: 0.05, emissive: new THREE.Color('#000'), emissiveIntensity: 1 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
  mesh.userData.id = s.id;
  group.add(mesh);
  pickables.push(mesh);

  const atmo = new THREE.Mesh(
    ATMO_GEO,
    new THREE.ShaderMaterial({ vertexShader: ATMO_VS, fragmentShader: ATMO_FS, uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0.9 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  group.add(atmo);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(halo);

  // a ring around some planets, for variety
  let ring = null;
  if (h % 3 === 0) {
    ring = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 2.1, 64),
      new THREE.MeshBasicMaterial({ color: '#cfd6ee', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2 - 0.45;
    group.add(ring);
  }

  // expanding pulse while waiting for you
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 64),
    new THREE.MeshBasicMaterial({ color: D.COLORS.waiting, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(pulse);

  // shockwave: a wider, faster red ring that rolls outward from an overheating planet
  const shock = new THREE.Mesh(
    new THREE.RingGeometry(0.97, 1, 64),
    new THREE.MeshBasicMaterial({ color: HOT_A, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(shock);

  // context: an arc that fills (green → yellow → red) as the conversation's context grows
  const ctx = new THREE.Mesh(
    new THREE.RingGeometry(1.3, 1.38, 64, 1, 0, 0.001),
    new THREE.MeshBasicMaterial({ color: '#5ee08a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  scene.add(ctx);

  // selection ring
  const sel = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.06, 64),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  scene.add(sel);

  // orbit path, slightly tilted so the system has depth
  const orbit = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#7d8cc4', vertexColors: true, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  scene.add(orbit);

  // comet trail while working
  const TRAIL = 60;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  const trail = new THREE.Points(
    trailGeo,
    new THREE.PointsMaterial({ size: 5, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: GLOW, sizeAttenuation: true }),
  );
  scene.add(trail);

  const moons = [];

  const el = document.createElement('div');
  el.className = 'planet-label';
  const label = new CSS2DObject(el);
  group.add(label);

  scene.add(group);
  return {
    id: s.id,
    group,
    mesh,
    atmo,
    halo,
    ring,
    pulse,
    shock,
    sel,
    ctx,
    ctxPct: -1,
    lastCtx: s.context || 0,
    orbit,
    trail,
    trailN: TRAIL,
    moons,
    phys: Object.assign(makeBody(), { anchor: new THREE.Vector3(), off: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3() }),
    label,
    el,
    angle: (h % 6283) / 1000,
    tiltX: ((h >> 8) % 100) / 100 * 0.32 - 0.16,
    tiltZ: ((h >> 16) % 100) / 100 * 0.32 - 0.16,
    spin: 0.15 + ((h >> 4) % 10) / 40,
    radius: 0,
    size: 10,
    color: STATUS.idle.clone(),
    status: s.status,
    s,
  };
}

function disposePlanet(p) {
  for (const o of [p.group, p.pulse, p.shock, p.sel, p.ctx, p.orbit, p.trail]) {
    scene.remove(o);
    o.traverse?.((x) => {
      x.geometry !== ATMO_GEO && x.geometry !== MOON_GEO && x.geometry?.dispose();
      x.material?.map && x.material.map !== GLOW && x.material.map.dispose();
      x.material?.dispose();
    });
  }
  p.group.remove(p.label);
  p.el.remove();
  const i = pickables.indexOf(p.mesh);
  if (i >= 0) pickables.splice(i, 1);
}

// A closed session's planet is not removed at once: it spirals into the sun (animate) and is disposed there.
function retire(p) {
  const i = pickables.indexOf(p.mesh);
  if (i >= 0) pickables.splice(i, 1);
  p.group.remove(p.label);
  p.el.remove();
  if (drag && drag.p === p) drag = null;
  p.diedAt = performance.now();
  p.fromPos = p.group.position.clone();
  for (const o of [p.pulse, p.shock, p.sel, p.trail]) o.visible = false;
  dying.push(p);
}

// The context arc; a big drop in context is a compaction, shown as a dust burst.
const CTX_COL = { ok: new THREE.Color('#5ee08a'), mid: new THREE.Color('#ffc94a'), full: new THREE.Color('#ff5a4a') };
function setContext(p, s) {
  if (!s.replay) {
    if (!firstLayout && p.lastCtx >= 40_000 && s.context < p.lastCtx * 0.5) compactBurst(p);
    p.lastCtx = s.context;
  }
  const pct = s.context ? Math.min(1, s.context / D.ctxLimit(s)) : 0;
  if (Math.abs(pct - p.ctxPct) < 0.01) return;
  p.ctxPct = pct;
  const th = Math.max(0.001, pct * Math.PI * 2);
  p.ctx.geometry.dispose();
  p.ctx.geometry = new THREE.RingGeometry(1.3, 1.38, 64, 1, Math.PI / 2 - th, th); // fills clockwise from the top
  p.ctx.material.color.copy(pct < 0.6 ? CTX_COL.ok : pct < 0.85 ? CTX_COL.mid : CTX_COL.full);
}

function orbitPoint(p, a, out) {
  out.set(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
  out.applyEuler(new THREE.Euler(p.tiltX, 0, p.tiltZ));
  return out;
}

function setOrbitGeometry(p) {
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= 128; i++) pts.push(orbitPoint(p, (i / 128) * Math.PI * 2, v).clone());
  p.orbit.geometry.setFromPoints(pts);
  p.orbit.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pts.length * 3).fill(1), 3));
}

// the orbit line glows brightest right behind its planet and fades along the path it has already travelled
function shadeOrbit(p) {
  const col = p.orbit.geometry.attributes.color;
  if (!col) return;
  const n = col.count - 1;
  const TAU = Math.PI * 2;
  const head = ((p.angle % TAU) + TAU) % TAU;
  for (let i = 0; i <= n; i++) {
    const behind = (((head - (i / n) * TAU) % TAU) + TAU) % TAU / TAU; // 0 at the planet, →1 all the way round
    const v = 0.3 + 0.7 * (1 - behind) ** 4;
    col.setXYZ(i, v, v, v);
  }
  col.needsUpdate = true;
}

// planet size follows how much Claude has written in the session (output tokens)
const planetSize = (s) => Math.max(13, Math.min(26, 13 + 4 * Math.log10(1 + s.tokens.output / 2e3)));

function layout(sessions) {
  const n = sessions.length;
  sessions.forEach((s, i) => {
    let p = planets.get(s.id);
    if (!p) {
      planets.set(s.id, (p = makePlanet(s)));
      if (!firstLayout) {
        p.bornAt = performance.now();
        sunFlash = 1;
      }
    }
    p.s = s;
    const r = 120 + i * Math.max(62, Math.min(95, 360 / Math.max(1, n)));
    if (Math.abs(p.radius - r) > 0.5) {
      p.radius = r;
      setOrbitGeometry(p);
    }
    p.size = planetSize(s);
    if (p.status !== s.status) {
      p.statusChangedAt = performance.now();
      if (!firstLayout && p.status === 'busy' && s.status === 'idle') celebrate(p);
    }
    p.status = s.status;
    setContext(p, s);
    const waiting = s.status === 'waiting' && s.waitingFor ? ` · ${D.esc(s.waitingFor)}` : '';
    p.el.style.setProperty('--proj', `hsl(${projectHue(s.cwd)} 70% 62%)`);
    p.el.className = `planet-label ${s.status}${s.id === D.selected() ? ' sel' : ''}`;
    p.el.innerHTML = `<b>${s.control ? '<i class="ctl">›_</i>' : ''}${D.esc(s.name)}</b><span>${D.LABELS[s.status] || D.esc(s.status)}${waiting} · ${D.fmtTok(s.context)} bağlam</span>`;
    syncMoons(p, s.subagents.filter((a) => a.active).length);
    // a process this session started is straining the PC: the planet overheats
    const hog = s.replay ? null : D.hogs().find((h) => h.sessionId === s.id);
    p.hot = !!hog;
    p.el.classList.toggle('hot', p.hot);
    if (hog) p.el.innerHTML += `<em class="heat">AŞIRI ISINMA · ${D.esc(hog.name)} %${hog.cpu}</em>`;
  });
  const live = new Set(sessions.map((s) => s.id));
  for (const [id, p] of planets) {
    if (!live.has(id)) {
      planets.delete(id);
      retire(p);
    }
  }
  const snap = D.snap();
  sunLabelEl.innerHTML = replay
    ? `<b>${sessions.length}</b> oturum · saat ${hhmm(replay.T)}`
    : `<b>${sessions.length}</b> oturum · bugün ${D.fmtCost(snap.today.cost)}`;
  document.getElementById('empty3d').hidden = sessions.length > 0 || !!replay;
  firstLayout = false;
}

const MOON_GEO = new THREE.SphereGeometry(1, 16, 12);
// A new subagent's moon shoots out of its planet; a finished one dives back in (animate removes it then).
function syncMoons(p, n) {
  const staying = p.moons.filter((m) => !m.userData.leaving);
  while (staying.length < n) {
    const m = new THREE.Mesh(MOON_GEO, new THREE.MeshStandardMaterial({ color: '#dfe5f5', roughness: 0.9, emissive: '#3a4466' }));
    m.userData.phase = Math.random() * Math.PI * 2;
    m.userData.tilt = Math.random() * 0.9 - 0.45;
    m.userData.born = firstLayout ? 0 : performance.now();
    p.group.add(m);
    p.moons.push(m);
    staying.push(m);
  }
  while (staying.length > n) staying.pop().userData.leaving = performance.now();
}

// ---------- tool sparks: the tool a session just ran drifts up from its planet ----------
const seenTools = new Set();
let firstSnap = true;
const sparks = [];

function spawnSparks(sessions) {
  const now = Date.now();
  for (const s of sessions) {
    for (const t of s.recentTools) {
      if (seenTools.has(t.id)) continue;
      seenTools.add(t.id);
      if (firstSnap || now - t.ts > 20000) continue;
      const p = planets.get(s.id);
      if (!p) continue;
      addSpark(p, t.brief ? `${t.name} · ${t.brief}` : t.name);
      if (t.git) launchComet(p, t.git);
    }
  }
  firstSnap = false;
}

function addSpark(p, text, cls = '') {
  const el = document.createElement('div');
  el.className = cls ? `spark ${cls}` : 'spark';
  el.textContent = text;
  const obj = new CSS2DObject(el);
  scene.add(obj);
  sparks.push({ obj, el, p, born: performance.now(), off: sparks.filter((x) => x.p === p).length });
}

// ---------- links between planets ----------
// project: a faint light line between sessions started in the same folder, with a spark travelling along it
// conflict: a red pulsing line (and a caption) between two sessions that both wrote the same file recently
const links = new Map(); // key → { kind, a, b, line, spark, label?, el?, file? }
const LINK_DOTS = 22;
const baseName = (f) => String(f || '').split('/').pop();

function makeLink(w) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const conflict = w.kind === 'conflict';
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: conflict ? '#ff3b3b' : '#9fb0e8', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  line.frustumCulled = false;
  scene.add(line);
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  spark.scale.setScalar(conflict ? 12 : 9);
  scene.add(spark);
  // a 1px line is easy to miss, so it also carries a row of glowing dots that drift along it
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINK_DOTS * 3), 3));
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: conflict ? 7 : 4.5, map: GLOW, color: conflict ? '#ff5a4a' : '#b8c6ff', transparent: true, opacity: conflict ? 0.95 : 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  dots.frustumCulled = false;
  scene.add(dots);
  const l = { ...w, file: null, line, spark, dots, phase: (hash(w.a + w.b) % 1000) / 1000 };
  if (conflict) {
    l.el = document.createElement('div');
    l.el.className = 'conflict-label';
    l.label = new CSS2DObject(l.el);
    scene.add(l.label);
  }
  return l;
}

function disposeLink(l) {
  for (const o of [l.line, l.spark, l.dots, l.label]) o && scene.remove(o);
  l.dots.geometry.dispose();
  l.dots.material.dispose();
  l.line.geometry.dispose();
  l.line.material.dispose();
  l.spark.material.dispose();
  l.el?.remove();
}

function setLinks(data) {
  const want = new Map();
  for (const [a, b] of (data && data.project) || []) want.set(`p:${a}:${b}`, { kind: 'project', a, b });
  for (const c of (data && data.conflicts) || []) want.set(`c:${c.a}:${c.b}`, { kind: 'conflict', a: c.a, b: c.b, file: c.file });
  for (const [k, l] of links) {
    if (!want.has(k)) {
      disposeLink(l);
      links.delete(k);
    }
  }
  for (const [k, w] of want) {
    let l = links.get(k);
    if (!l) links.set(k, (l = makeLink(w)));
    if (w.file && l.file !== w.file) {
      l.file = w.file;
      l.el.textContent = `⚠ olası çakışma · ${baseName(w.file)}`;
    }
  }
}

const linkMid = new THREE.Vector3();
const linkCol = new THREE.Color();
function updateLinks(t, low) {
  for (const l of links.values()) {
    const pa = planets.get(l.a);
    const pb = planets.get(l.b);
    const show = !!(pa && pb);
    l.line.visible = l.spark.visible = l.dots.visible = show;
    if (l.label) l.label.visible = show;
    if (!show) continue;
    const pos = l.line.geometry.attributes.position;
    pos.setXYZ(0, pa.group.position.x, pa.group.position.y, pa.group.position.z);
    pos.setXYZ(1, pb.group.position.x, pb.group.position.y, pb.group.position.z);
    pos.needsUpdate = true;
    const dp = l.dots.geometry.attributes.position;
    const drift = (t * (l.kind === 'conflict' ? 0.5 : 0.15) + l.phase) % 1;
    for (let k = 0; k < LINK_DOTS; k++) {
      const f = (k + drift) / LINK_DOTS;
      dp.setXYZ(k, pa.group.position.x + (pb.group.position.x - pa.group.position.x) * f, pa.group.position.y + (pb.group.position.y - pa.group.position.y) * f, pa.group.position.z + (pb.group.position.z - pa.group.position.z) * f);
    }
    dp.needsUpdate = true;
    if (l.kind === 'conflict') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      l.line.material.opacity = 0.35 + 0.5 * pulse;
      l.dots.material.opacity = 0.55 + 0.45 * pulse;
      l.spark.material.color.set('#ff6a5a');
      linkMid.lerpVectors(pa.group.position, pb.group.position, 0.5);
      l.label.position.copy(linkMid);
      l.spark.position.copy(linkMid);
      l.spark.scale.setScalar(10 + pulse * 10);
    } else {
      const hue = projectHue(pa.s.cwd);
      linkCol.setHSL(hue / 360, 0.75, 0.68);
      l.line.material.color.copy(linkCol);
      l.line.material.opacity = 0.3;
      l.dots.material.color.copy(linkCol);
      l.spark.visible = !low;
      l.spark.material.color.copy(linkCol);
      l.spark.position.lerpVectors(pa.group.position, pb.group.position, (t * 0.22 + l.phase) % 1);
    }
  }
}

// ---------- sun beams: energy streaming from the sun to every working planet ----------
const BEAM_N = 14;
const BEAM_MAX = 32;
const beamGeo = new THREE.BufferGeometry();
beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BEAM_MAX * BEAM_N * 3), 3));
beamGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(BEAM_MAX * BEAM_N * 3), 3));
const beams = new THREE.Points(beamGeo, new THREE.PointsMaterial({ size: 9, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
beams.frustumCulled = false;
scene.add(beams);
const beamDir = new THREE.Vector3();

function updateBeams(t, low) {
  const pos = beamGeo.attributes.position;
  const col = beamGeo.attributes.color;
  let n = 0;
  if (!low) {
    let used = 0;
    for (const p of planets.values()) {
      if (p.status !== 'busy' || used >= BEAM_MAX) continue;
      used++;
      const dist = p.group.position.length() || 1;
      beamDir.copy(p.group.position).divideScalar(dist);
      const from = 36; // just outside the sun
      const to = Math.max(from + 1, dist - p.size * 1.3);
      const speed = 0.3 + (hash(p.id) % 10) / 100;
      for (let k = 0; k < BEAM_N; k++) {
        const f = (t * speed + k / BEAM_N) % 1;
        const d = from + (to - from) * f;
        pos.setXYZ(n, beamDir.x * d, beamDir.y * d, beamDir.z * d);
        const a = Math.sin(f * Math.PI) * 1.4; // fades in near the sun and out near the planet
        col.setXYZ(n, p.color.r * a, p.color.g * a, p.color.b * a);
        n++;
      }
    }
  }
  beamGeo.setDrawRange(0, n);
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoverId = null;
let downAt = null;

function pick(e) {
  if (galaxy) return null; // the solar system's planets are not on screen then (see gPick)
  const r = labels.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  return hit ? hit.object.userData.id : null;
}

labels.domElement.addEventListener('pointermove', (e) => {
  if (drag && drag.active) return;
  if (galaxy) return void galaxyHover(e);
  hoverId = pick(e);
  labels.domElement.style.cursor = hoverId ? 'pointer' : 'grab';
  const s = hoverId && D.snap().sessions.find((v) => v.id === hoverId);
  if (!s) return void (tip.hidden = true);
  const r = (tip.offsetParent || tip.parentElement).getBoundingClientRect(); // the tooltip lives in the map view, not the full-window scene
  const lt = s.recentTools[s.recentTools.length - 1];
  tip.innerHTML =
    `<b>${D.esc(s.name)}</b><br><span class="m">${D.esc(s.cwd)}</span><br>` +
    `${D.LABELS[s.status] || D.esc(s.status)}${s.waitingFor ? ' · ' + D.esc(s.waitingFor) : ''} · ${D.ago(s.statusSince)}<br>` +
    (lt ? `<span class="m">Son araç:</span> ${D.esc(lt.name)} ${D.esc(lt.brief)}<br>` : '') +
    `<span class="m">bağlam ${D.fmtTok(s.context)} · çıkış ${D.fmtTok(s.tokens.output)} · ${D.fmtCost(s.cost)}</span>`;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 330) + 'px';
  tip.style.top = e.clientY - r.top + 14 + 'px';
});
labels.domElement.addEventListener('pointerleave', () => {
  hoverId = null;
  tip.hidden = true;
});
// Grab a planet and pull it: it follows the pointer, and springs back to its orbit (with a fling) when let go.
let drag = null; // { p, sx, sy, active }
const dragPlane = new THREE.Plane();
const UP = new THREE.Vector3(0, 1, 0);
const dragPoint = new THREE.Vector3();
labels.domElement.addEventListener(
  'pointerdown',
  (e) => {
    downAt = [e.clientX, e.clientY];
    const id = e.button === 0 ? pick(e) : null;
    const p = id && planets.get(id);
    if (p) drag = { p, sx: e.clientX, sy: e.clientY, active: false };
  },
  true, // before OrbitControls sees it, so grabbing a planet does not also rotate the camera
);
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return; // still a click
    drag.active = true;
    drag.p.phys.held = true;
    tip.hidden = true;
    labels.domElement.style.cursor = 'grabbing';
  }
  // the pointer moves the planet within the plane of the orbits (so other planets, which live there too, can react)
  const r = labels.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  dragPlane.set(UP, -drag.p.phys.anchor.y);
  if (ray.ray.intersectPlane(dragPlane, dragPoint)) {
    if (dragPoint.length() > 900) dragPoint.setLength(900); // never lose a planet off the map
    drag.p.phys.target.copy(dragPoint);
  }
  dropHover = dropTargetOf(drag.p);
});
// What a dragged planet is over: 'sun', another planet's id, or null. Dropping there asks what to do (app.js).
let dropHover = null;
// Measured on screen, where the user sees the overlap (the 3D depth of tilted orbits would mislead).
const scrA = new THREE.Vector3();
function onScreen(pos, radius) {
  const h = host.clientHeight;
  const dist = camera.position.distanceTo(pos);
  scrA.copy(pos).project(camera);
  return { x: ((scrA.x + 1) / 2) * host.clientWidth, y: ((1 - scrA.y) / 2) * h, r: (radius * h) / 2 / (Math.tan((camera.fov * Math.PI) / 360) * dist) };
}
function dropTargetOf(p) {
  const me = onScreen(p.group.position, p.size);
  const sun = onScreen(tmp.set(0, 0, 0), 30);
  if (Math.hypot(me.x - sun.x, me.y - sun.y) < sun.r * 1.5 + me.r * 0.5) return 'sun';
  let best = null;
  let bestD = Infinity;
  for (const q of planets.values()) {
    if (q === p) continue;
    const o = onScreen(q.group.position, q.size);
    const d = Math.hypot(me.x - o.x, me.y - o.y);
    if (d < (me.r + o.r) * 1.1 && d < bestD) {
      best = q.id;
      bestD = d;
    }
  }
  return best;
}
const endDrag = (e) => {
  if (!drag) return;
  const { p, active } = drag;
  p.phys.held = false;
  drag = null;
  dropHover = null;
  labels.domElement.style.cursor = 'grab';
  if (!active || e.type !== 'pointerup') return; // a cancelled drag or a lost window never acts
  const target = dropTargetOf(p);
  if (target && !replay) window.dispatchEvent(new CustomEvent('dash:drop', { detail: { id: p.id, target } }));
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
labels.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // a drag, not a click
  if (galaxy) {
    const u = gPick(e);
    if (u && u.commit) {
      window.agentinan.copy(u.commit.hash);
      return D.toast(`Commit ${u.commit.short} kopyalandı`);
    }
    const b = u && u.branch;
    return selectBranch(b && b !== galaxy.selected ? b : null);
  }
  const id = pick(e);
  D.select(id && id !== D.selected() ? id : null, true);
});

// Fly the camera's focus toward the selected planet; back to the sun when nothing is selected.
const focus = new THREE.Vector3();
window.addEventListener('dash:select', () => layout(replay ? replaySessions() : D.snap().sessions));

// ---------- double click and keyboard ----------
function openTerminal(id) {
  const s = D.snap().sessions.find((x) => x.id === id);
  if (!s) return;
  D.select(id);
  if (s.control) D.setTab('terminal');
  else D.toast('Bu oturum Agentinan dışında açıldı; terminali burada yok');
}
labels.domElement.addEventListener('dblclick', (e) => {
  const id = !replay && pick(e);
  if (id) openTerminal(id);
});
document.addEventListener('keydown', (e) => {
  if (D.tab() !== 'map' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('.modal:not([hidden])')) return;
  const sel = D.selected();
  if (galaxy) {
    // the galaxy has its own keys (Tab/Enter/Space act on planets): Esc lets go of the branch first, like on the map,
    // then goes back; G always goes back
    if (e.key === 'Escape' && galaxy.selected) {
      e.preventDefault();
      selectBranch(null);
    } else if (e.key === 'Escape' || e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      closeGalaxy();
    }
    return;
  }
  if ((e.key === 'g' || e.key === 'G') && !e.shiftKey && !replay) {
    e.preventDefault();
    openGalaxy(sel);
    return;
  }
  if (e.key === 'Tab') {
    // planets in orbit order, nearest the sun first
    const order = [...planets.values()].sort((a, b) => a.radius - b.radius).map((p) => p.id);
    if (!order.length) return;
    e.preventDefault();
    const i = order.indexOf(sel);
    const next = i < 0 ? (e.shiftKey ? order.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + order.length) % order.length;
    D.select(order[next], true);
  } else if (e.key === ' ') {
    e.preventDefault();
    if (replay) togglePlay();
    else D.select(null);
  } else if (e.key === 'Enter' && sel && !replay) {
    e.preventDefault();
    openTerminal(sel);
  } else if (e.key === 'Escape') {
    if (replay) stopReplay();
    else if (sel) D.select(null);
  }
});

// ---------- embers: sparks flying off an overheating planet ----------
const EMBERS = 180;
const emberGeo = new THREE.BufferGeometry();
emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
emberGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
const embers = new THREE.Points(
  emberGeo,
  new THREE.PointsMaterial({ size: 18, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
);
embers.frustumCulled = false;
scene.add(embers);
const emberState = Array.from({ length: EMBERS }, () => ({ p: null, life: 1, rate: 1, dir: new THREE.Vector3(), reach: 0 }));
const EMBER_HOT = new THREE.Color('#ffe08a');
const EMBER_COOL = new THREE.Color('#ff2a12');
const emberColor = new THREE.Color();

function updateEmbers(dt) {
  const hot = [...planets.values()].filter((p) => p.hot);
  const pos = emberGeo.attributes.position;
  const col = emberGeo.attributes.color;
  emberState.forEach((e, i) => {
    e.life += dt * e.rate;
    if (e.life >= 1 || !e.p || !planets.has(e.p.id) || !e.p.hot) {
      if (!hot.length) {
        col.setXYZ(i, 0, 0, 0);
        e.p = null;
        return;
      }
      e.p = hot[i % hot.length];
      e.life = Math.random() * 0.4;
      e.rate = 0.7 + Math.random() * 0.9;
      e.dir.randomDirection();
      e.dir.y = Math.abs(e.dir.y) * 1.4 + 0.2; // mostly upward, like heat
      e.dir.normalize();
      e.reach = e.p.size * (1.5 + Math.random() * 3);
    }
    const d = e.p.size * 0.9 + e.life * e.reach;
    pos.setXYZ(i, e.p.group.position.x + e.dir.x * d, e.p.group.position.y + e.dir.y * d, e.p.group.position.z + e.dir.z * d);
    emberColor.copy(EMBER_HOT).lerp(EMBER_COOL, e.life).multiplyScalar(1 - e.life * e.life);
    col.setXYZ(i, emberColor.r, emberColor.g, emberColor.b);
  });
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// ---------- one-off effects: rings, comets, dust bursts ----------
const FX_RING_GEO = new THREE.RingGeometry(0.9, 1, 64);
const GOLD = new THREE.Color('#ffd25a');
const rings = [];
function ringFx(p, color, life, from, to, opacity = 1) {
  const mesh = new THREE.Mesh(
    FX_RING_GEO,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  scene.add(mesh);
  rings.push({ mesh, p, born: performance.now(), life, from, to, opacity });
}

// a session finished its work: a golden ring rolls out and the planet flares
function celebrate(p) {
  p.doneAt = performance.now();
  ringFx(p, GOLD, 1600, 1.2, 7, 1);
  ringFx(p, '#fff4d6', 900, 1.1, 3.5, 0.8);
}

// a commit: a comet rises from the planet and fades; a push: it flies off out of the system
const COMET_N = 16;
const comets = [];
function launchComet(p, kind) {
  const push = kind === 'push';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COMET_N * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(COMET_N * 3), 3));
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: push ? 16 : 12, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  pts.frustumCulled = false;
  scene.add(pts);
  const out = new THREE.Vector3().copy(p.group.position).setY(0);
  if (out.lengthSq() < 1) out.set(1, 0, 0);
  out.normalize();
  const dir = out
    .multiplyScalar(push ? 0.9 : 0.5)
    .add(new THREE.Vector3((Math.random() - 0.5) * 0.4, push ? 0.5 : 0.9, (Math.random() - 0.5) * 0.4))
    .normalize();
  const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
  const color = push ? '#bfe0ff' : '#ffe9a8';
  comets.push({ pts, start: p.group.position.clone(), dir, side, push, born: performance.now(), life: push ? 3800 : 2600, hist: [], color: new THREE.Color(color) });
  ringFx(p, color, 700, 1.1, 2.8, 0.9);
  addSpark(p, push ? '⇡ push' : '✓ commit', 'git');
}
// commits and pushes made from the Git tab (git.js) launch from every planet working in that repository
window.addEventListener('dash:git', (e) => {
  const { root, action } = e.detail || {};
  if (!root || replay) return;
  for (const p of planets.values()) if (p.s.cwd === root || p.s.cwd.startsWith(root + '/')) launchComet(p, action);
});

// the context was compacted: the context arc scatters as dust
const bursts = [];
function compactBurst(p) {
  ringFx(p, '#cfd8ff', 1200, 1.3, 4, 0.7);
  addSpark(p, '◌ bağlam sıkıştırıldı', 'compact');
  if (D.settings().quality === 'low') return;
  const N = 120;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const colors = new Float32Array(N * 3);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const r = p.size * 1.34;
  const base = p.ctx.material.color;
  const c = new THREE.Color();
  const parts = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = new THREE.Vector3().addScaledVector(right, Math.cos(a)).addScaledVector(up, Math.sin(a));
    const v = d
      .clone()
      .multiplyScalar(30 + Math.random() * 90)
      .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30));
    parts.push({ o: d.multiplyScalar(r), v });
    c.copy(base).lerp(WHITE, Math.random() * 0.6);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 6, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  pts.frustumCulled = false;
  scene.add(pts);
  bursts.push({ pts, parts, center: p.group.position.clone(), born: performance.now(), life: 2000 });
}

function updateFx(now) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    const k = Math.max(0, (now - r.born) / r.life);
    if (k >= 1) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
      rings.splice(i, 1);
      continue;
    }
    const e = 1 - (1 - k) ** 2;
    r.mesh.position.copy(r.p.group.position);
    r.mesh.quaternion.copy(camera.quaternion);
    r.mesh.scale.setScalar(r.p.size * (r.from + (r.to - r.from) * e));
    r.mesh.material.opacity = r.opacity * (1 - k) ** 1.5;
  }
  for (let i = comets.length - 1; i >= 0; i--) {
    const c = comets[i];
    const k = Math.max(0, (now - c.born) / c.life);
    if (k >= 1) {
      scene.remove(c.pts);
      c.pts.geometry.dispose();
      c.pts.material.dispose();
      comets.splice(i, 1);
      continue;
    }
    const dist = c.push ? 20 + 1100 * k ** 1.7 : 20 + 170 * (1 - (1 - k) ** 2);
    const head = new THREE.Vector3()
      .copy(c.start)
      .addScaledVector(c.dir, dist)
      .addScaledVector(c.side, Math.sin(k * Math.PI) * (c.push ? 10 : 35));
    c.hist.unshift(head);
    if (c.hist.length > COMET_N) c.hist.length = COMET_N;
    const pos = c.pts.geometry.attributes.position;
    const col = c.pts.geometry.attributes.color;
    const fade = c.push ? Math.min(1, (1 - k) * 4) : (1 - k) ** 1.3;
    for (let j = 0; j < COMET_N; j++) {
      const h = c.hist[Math.min(j, c.hist.length - 1)];
      pos.setXYZ(j, h.x, h.y, h.z);
      const a = fade * (1 - j / COMET_N) ** 1.5;
      col.setXYZ(j, c.color.r * a, c.color.g * a, c.color.b * a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    const k = Math.max(0, (now - b.born) / b.life);
    if (k >= 1) {
      scene.remove(b.pts);
      b.pts.geometry.dispose();
      b.pts.material.dispose();
      bursts.splice(i, 1);
      continue;
    }
    const e = 1 - (1 - k) ** 2;
    const pos = b.pts.geometry.attributes.position;
    b.parts.forEach((pt, j) => pos.setXYZ(j, b.center.x + pt.o.x + pt.v.x * e, b.center.y + pt.o.y + pt.v.y * e, b.center.z + pt.o.z + pt.v.z * e));
    pos.needsUpdate = true;
    b.pts.material.opacity = (1 - k) ** 1.5;
  }
}

// ---------- replay of the day: today's sessions, minute by minute, in about 40 seconds ----------
const REPLAY_SECONDS = 40;
const rBtn = document.getElementById('replayBtn');
const rBar = document.getElementById('replayBar');
const rPlay = document.getElementById('replayPlay');
const rRange = document.getElementById('replayRange');
const rTime = document.getElementById('replayTime');
const hhmm = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
let lastLive = null; // the newest live snapshot, put back when the replay ends

// A session is on the map from its first to its last active minute (plus a little); busy in the minutes it worked.
function replaySessions() {
  const T = replay.T;
  const m = Math.floor(T / 60000);
  const live = new Map(D.snap().sessions.map((s) => [s.id, s]));
  return replay.data.sessions
    .filter((s) => s.start <= T && T <= s.end + 5 * 60000)
    .map((s) => {
      const on = replay.sets.get(s.id);
      return {
        id: s.id,
        name: s.name,
        cwd: s.cwd || '',
        status: on.has(m) || on.has(m - 1) ? 'busy' : 'idle',
        waitingFor: null,
        control: null,
        tokens: live.get(s.id)?.tokens || { output: 0 },
        context: 0,
        subagents: [],
        recentTools: [],
        replay: true,
      };
    });
}

async function startReplay() {
  let data = null;
  try {
    data = await window.agentinan.timeline();
  } catch {}
  if (!data || !data.sessions.length) return D.toast('Bugün henüz oynatılacak oturum yok');
  const from = data.sessions[0].start - 60000;
  replay = { data, from, to: Math.max(from + 60000, data.now), T: from, playing: true, min: -1, sets: new Map(data.sessions.map((s) => [s.id, new Set(s.minutes)])) };
  D.select(null);
  setLinks(null);
  rBtn.hidden = true;
  rBar.hidden = false;
  setPlaying(true);
  replayFrame(true);
}

function stopReplay() {
  if (!replay) return;
  replay = null;
  rBar.hidden = true;
  rBtn.hidden = false;
  D.select(null);
  const live = lastLive || D.snap();
  layout(live.sessions);
  setLinks(live.links);
}

function setPlaying(on) {
  replay.playing = on;
  rPlay.innerHTML = window.icon(on ? 'pause' : 'play');
  rPlay.title = on ? 'Duraklat (Boşluk)' : 'Oynat (Boşluk)';
}
function togglePlay() {
  if (!replay) return;
  if (!replay.playing && replay.T >= replay.to) replay.T = replay.from; // at the end: from the start again
  setPlaying(!replay.playing);
}

function replayFrame(force) {
  rRange.value = String(Math.round(((replay.T - replay.from) / (replay.to - replay.from)) * 1000));
  rTime.textContent = hhmm(replay.T);
  const m = Math.floor(replay.T / 60000);
  if (m === replay.min && !force) return;
  replay.min = m;
  layout(replaySessions());
}

function advanceReplay(dt) {
  replay.T += (dt * (replay.to - replay.from)) / REPLAY_SECONDS;
  if (replay.T >= replay.to) {
    replay.T = replay.to;
    setPlaying(false);
  }
  replayFrame();
}

rBtn.onclick = startReplay;
document.getElementById('replayClose').onclick = stopReplay;
rPlay.onclick = togglePlay;
rRange.addEventListener('input', () => {
  if (!replay) return;
  if (replay.playing) setPlaying(false);
  replay.T = replay.from + (Number(rRange.value) / 1000) * (replay.to - replay.from);
  replayFrame();
});

// ---------- branch galaxy: a session's repository, main in the middle and its branches around it ----------
// Opened from a selected planet (G, or the card's button). It is drawn as its own scene, so the solar system stays
// exactly as it is underneath (snapshots keep updating it) and comes back unchanged when the galaxy closes. Read only:
// local branches and origin/* as of the last fetch (git:branches), laid out by galaxy.mjs.
const gScene = new THREE.Scene();
gScene.background = scene.background; // the same Color objects, so the theme recolours both
gScene.fog = scene.fog;
gScene.add(new THREE.AmbientLight('#4a5680', 0.6));
const gLight = new THREE.PointLight('#d6e4ff', 3, 0, 0);
gScene.add(gLight);
const gStars = starField(1800, 1500, 3200, 1.4, 0.8);
gScene.add(gStars);
const gStar = new THREE.Group();
const gStarMesh = new THREE.Mesh(
  new THREE.SphereGeometry(24, 48, 32),
  new THREE.MeshBasicMaterial({ map: surfaceTexture(11, false), color: new THREE.Color('#9cc4ff').multiplyScalar(1.5), fog: false }),
);
const gStarHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#6fa8ff', transparent: true, opacity: 0.6, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
gStarHalo.scale.setScalar(170);
gStar.add(gStarMesh, gStarHalo);
const gStarEl = document.createElement('div');
gStarEl.className = 'sun-label gx-label';
const gStarLabel = new CSS2DObject(gStarEl);
gStarLabel.position.set(0, -38, 0);
gStar.add(gStarLabel);
gScene.add(gStar);
// the ring around the hovered / selected branch
const gRing = new THREE.Mesh(
  new THREE.RingGeometry(1.0, 1.06, 64),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
gScene.add(gRing);

const gxBar = document.getElementById('galaxyBar');
const gxTitle = document.getElementById('galaxyTitle');
const gxInfo = document.getElementById('galaxyInfo');
const gxFetch = document.getElementById('galaxyFetch');
const mapHint = document.querySelector('.view[data-view="map"] .hint') || document.querySelector('.hint');
const HINT_MAP = mapHint ? mapHint.textContent : '';
const HINT_GALAXY = "Tıkla: branch seç (commit'leri ay olur) · Aya tıkla: commit kimliğini kopyala · Esc: geri · G: haritaya dön";
const SYNC_TEXT = {
  same: 'origin ile aynı',
  ahead: '↑ push edilmemiş commit var',
  behind: "↓ origin'de yeni commit var",
  diverged: '↕ origin ile ayrışmış',
  'local-only': 'sadece yerelde',
  'remote-only': "sadece origin'de",
};

let galaxy = null; // { id, data, bodies: Map name → body, selected, hover, bornAt, timer, sig, stale }
let galaxyOpening = false;
const gPickables = [];

function gOrbitPoint(g, a, out) {
  out.set(Math.cos(a) * g.radius, 0, Math.sin(a) * g.radius);
  out.applyEuler(g.tilt);
  return out;
}

function makeBranchBody(L, angle) {
  const h = hash(L.b.name);
  const remote = L.tone === 'remote';
  const color = L.tone === 'current' ? ORBIT.selected.clone() : remote ? new THREE.Color('#8b93ad') : new THREE.Color().setHSL(L.hue / 360, 0.55, 0.6);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 22),
    new THREE.MeshStandardMaterial({ map: surfaceTexture(h, true, L.hue), color, emissive: color.clone().multiplyScalar(0.28), roughness: 0.8, metalness: 0.05, transparent: remote, opacity: remote ? 0.45 : 1 }),
  );
  mesh.userData.branch = L.b.name;
  group.add(mesh);
  gPickables.push(mesh);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, opacity: remote ? 0.18 : 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(halo);
  const tilt = new THREE.Euler((((h >> 8) % 100) / 100) * 0.24 - 0.12, 0, (((h >> 16) % 100) / 100) * 0.24 - 0.12);
  const g = { L, group, mesh, halo, color, tilt, radius: L.radius, angle: angle ?? L.angle, spin: 0.1 + ((h >> 4) % 10) / 50 };
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= 128; i++) pts.push(gOrbitPoint(g, (i / 128) * Math.PI * 2, v).clone());
  g.orbit = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: L.tone === 'current' ? ORBIT.selected : ORBIT.line, transparent: true, opacity: remote ? 0.1 : 0.2, depthWrite: false }),
  );
  gScene.add(g.orbit);
  // branch names and commit subjects come from the repository: escaped like everything else on the map
  g.el = document.createElement('div');
  g.el.className = `planet-label gx-label${L.tone === 'current' ? ' gx-cur' : ''}${remote ? ' gx-remote' : ''}`;
  g.el.style.setProperty('--proj', `#${color.getHexString()}`);
  const b = L.b;
  g.el.innerHTML = `<b>${D.esc(b.name)}${L.badge ? ` <i class="gx-badge">${L.badge}</i>` : ''}</b><span>+${b.ahead | 0} −${b.behind | 0}${b.current ? ' · şu an burada' : ''}</span>`;
  g.label = new CSS2DObject(g.el);
  group.add(g.label);
  gScene.add(group);
  return g;
}

function disposeBranchBody(g) {
  gScene.remove(g.group, g.orbit);
  g.group.remove(g.label);
  g.el.remove();
  for (const o of [g.mesh, g.halo, g.orbit]) {
    if (o.geometry && o.geometry !== g.halo.geometry) o.geometry.dispose();
    if (o.material.map && o.material.map !== GLOW) o.material.map.dispose();
    o.material.dispose();
  }
  const i = gPickables.indexOf(g.mesh);
  if (i >= 0) gPickables.splice(i, 1);
}

// ---- commit moons: the selected branch's commits that main lacks, the newest on the innermost moon orbit ----
const MOON_MAX = 12;
function clearMoons() {
  const m = galaxy && galaxy.moons;
  if (!m) return;
  for (const mesh of m.meshes) {
    mesh.parent?.remove(mesh);
    mesh.material.dispose(); // MOON_GEO is shared with the solar system's moons: kept
    const i = gPickables.indexOf(mesh);
    if (i >= 0) gPickables.splice(i, 1);
  }
  galaxy.moons = null;
  galaxy.hoverCommit = null;
}

async function loadMoons(name) {
  const req = ++galaxy.moonReq;
  const id = galaxy.id;
  const r = await window.agentinan.git.branchCommits(id, name).catch((e) => ({ error: String(e) }));
  if (!galaxy || galaxy.id !== id || galaxy.moonReq !== req || galaxy.selected !== name) return; // superseded
  clearMoons();
  const g = galaxy.bodies.get(name);
  if (!g) return;
  if (!r || !r.data) {
    galaxy.moons = { name, error: true, total: 0, meshes: [] };
    return renderGalaxyBar();
  }
  const meshes = r.data.commits.slice(0, MOON_MAX).map((c, k) => {
    const mesh = new THREE.Mesh(
      MOON_GEO,
      new THREE.MeshStandardMaterial({ color: g.color.clone().lerp(WHITE, 0.55), emissive: g.color.clone().multiplyScalar(0.25), roughness: 0.9 }),
    );
    mesh.userData = { commit: c, k, phase: k * 2.39996, tilt: ((hash(c.hash) % 100) / 100) * 0.8 - 0.4 }; // golden angle apart
    mesh.scale.setScalar(0.01);
    g.group.add(mesh);
    gPickables.push(mesh);
    return mesh;
  });
  galaxy.moons = { name, total: r.data.total, meshes, born: performance.now() };
  renderGalaxyBar();
}

// Selecting a branch brings out its commits as moons; selecting nothing (or another branch) takes them away.
function selectBranch(name) {
  if (!galaxy || galaxy.selected === name) return;
  galaxy.selected = name;
  galaxy.moonReq++; // a load still under way for the previous branch is dropped
  clearMoons();
  renderGalaxyBar();
  if (name) loadMoons(name);
}

// New data: rebuilt only when something changed; a branch that stays keeps its place on its orbit.
function setGalaxyData(data) {
  const sig = JSON.stringify(data);
  galaxy.stale = false;
  if (sig === galaxy.sig) return renderGalaxyBar();
  galaxy.sig = sig;
  galaxy.data = data;
  const angles = new Map([...galaxy.bodies].map(([n, g]) => [n, g.angle]));
  clearMoons();
  for (const g of galaxy.bodies.values()) disposeBranchBody(g);
  galaxy.bodies.clear();
  const { star, bodies } = branchLayout(data);
  for (const L of bodies) galaxy.bodies.set(L.b.name, makeBranchBody(L, angles.get(L.b.name)));
  if (galaxy.selected && !galaxy.bodies.has(galaxy.selected)) galaxy.selected = null;
  if (galaxy.selected) loadMoons(galaxy.selected); // the branch changed (new commits, a fetch): its moons too
  gStarEl.innerHTML = `<b>${D.esc(data.name || '')}</b> · ${star ? D.esc(star.name) : 'ana dal yok'}`;
  renderGalaxyBar();
}

function renderGalaxyBar() {
  if (!galaxy || !galaxy.data) return;
  const d = galaxy.data;
  gxTitle.innerHTML = `${window.icon('branch')}<b>${D.esc(d.name || '')}</b>`;
  const b = galaxy.selected && galaxy.bodies.get(galaxy.selected)?.L.b;
  if (b) {
    const m = galaxy.moons && galaxy.moons.name === b.name ? galaxy.moons : null;
    const moons = !m
      ? "commit'ler okunuyor…"
      : m.error
        ? "commit'ler okunamadı"
        : m.total
          ? `${m.total} commit ana dalda yok${m.total > m.meshes.length ? ` · en yeni ${m.meshes.length} tanesi ay` : ''}`
          : 'ana dalda olmayan commit yok';
    gxInfo.innerHTML = `<b>${D.esc(b.name)}</b> · +${b.ahead | 0} −${b.behind | 0} · ${D.esc(SYNC_TEXT[b.sync] || '')} · ${D.esc(moons)}`;
  } else {
    const n = d.branches.length;
    const local = d.branches.filter((x) => x.hasLocal).length;
    gxInfo.textContent = `${n} branch · ${local} yerelde · ana dal ${d.main || '—'}${galaxy.stale ? ' · oturum kapandı, son okunan hali' : ''}`;
  }
}

async function loadGalaxy() {
  if (!galaxy) return null;
  const id = galaxy.id;
  const r = await window.agentinan.git.branches(id).catch((e) => ({ error: String(e) }));
  if (!galaxy || galaxy.id !== id) return null; // closed (or another one opened) meanwhile
  if (r && r.data) setGalaxyData(r.data);
  else {
    galaxy.stale = true; // e.g. the session ended: keep showing what was read last
    renderGalaxyBar();
  }
  return r;
}

async function openGalaxy(id) {
  if (!id) return D.toast('Önce haritada bir gezegen seç');
  if (galaxyOpening) return;
  if (galaxy && galaxy.id === id) return;
  galaxyOpening = true;
  let r;
  try {
    r = await window.agentinan.git.branches(id);
  } catch (e) {
    r = { error: String(e) };
  } finally {
    galaxyOpening = false;
  }
  if (!r || r.error) return D.toast(r?.error || "Branch'ler okunamadı");
  if (replay) stopReplay();
  if (galaxy) closeGalaxy(true);
  galaxy = {
    id,
    data: null,
    bodies: new Map(),
    selected: null,
    hover: null,
    moons: null, // { name, total, meshes, born } for the selected branch
    moonReq: 0,
    hoverCommit: null,
    bornAt: performance.now(),
    sig: '',
    stale: false,
    timer: setInterval(loadGalaxy, 10_000),
  };
  setGalaxyData(r.data);
  if (drag) drag = null;
  hoverId = null;
  tip.hidden = true;
  labels.domElement.classList.add('galaxy');
  gxBar.hidden = false;
  rBtn.hidden = true;
  if (mapHint) mapHint.textContent = HINT_GALAXY;
}

function closeGalaxy(quiet) {
  if (!galaxy) return;
  clearInterval(galaxy.timer);
  clearMoons();
  for (const g of galaxy.bodies.values()) disposeBranchBody(g);
  galaxy = null;
  gRing.material.opacity = 0;
  tip.hidden = true;
  if (quiet) return;
  labels.domElement.classList.remove('galaxy');
  labels.domElement.style.cursor = 'grab';
  gxBar.hidden = true;
  rBtn.hidden = false;
  if (mapHint) mapHint.textContent = HINT_MAP;
}

function gPick(e) {
  const r = labels.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(gPickables, false)[0];
  return hit ? hit.object.userData : null; // { branch } for a branch, { commit, … } for a moon
}

function galaxyHover(e) {
  const u = gPick(e);
  galaxy.hover = (u && u.branch) || null;
  galaxy.hoverCommit = u && u.commit ? u.commit.hash : null;
  labels.domElement.style.cursor = u ? 'pointer' : 'grab';
  const r = (tip.offsetParent || tip.parentElement).getBoundingClientRect();
  const place = () => {
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 330) + 'px';
    tip.style.top = e.clientY - r.top + 14 + 'px';
  };
  if (u && u.commit) {
    const c = u.commit;
    tip.innerHTML =
      `<b>${D.esc(c.subject || '')}</b><br>` +
      `<span class="m">${D.esc(c.short || '')} · ${D.esc(c.author || '')} · ${D.esc(D.ago(c.time))} önce</span><br>` +
      `<span class="m">tıkla: commit kimliğini kopyala</span>`;
    return place();
  }
  const b = galaxy.hover && galaxy.bodies.get(galaxy.hover)?.L.b;
  if (!b) return void (tip.hidden = true);
  tip.innerHTML =
    `<b>${D.esc(b.name)}</b>${b.current ? ' · <span class="m">şu an burada</span>' : ''}<br>` +
    `<span class="m">${D.esc(b.subject || '')}</span><br>` +
    `${galaxy.data.main ? `${D.esc(galaxy.data.main)}'e göre: <b>+${b.ahead | 0}</b> önde · <b>−${b.behind | 0}</b> geride<br>` : ''}` +
    `${D.esc(SYNC_TEXT[b.sync] || '')}${b.remote ? ` <span class="m">(${D.esc(b.remote)})</span>` : ''}<br>` +
    `<span class="m">son commit ${D.esc(D.ago(b.time))} önce · ${D.esc(String(b.hash || '').slice(0, 8))}</span>`;
  place();
}

const DAY = 86_400_000;
function updateGalaxy(dt, t, now, low) {
  gStarMesh.rotation.y += dt * 0.05;
  gStarHalo.scale.setScalar(170 + Math.sin(t * 0.9) * 6);
  gStars.rotation.y += dt * 0.004;
  const e = Math.min(1, (now - galaxy.bornAt) / 1600);
  const grow = 1 - (1 - e) ** 3; // the branches spiral out of main when the galaxy opens
  const mark = galaxy.hover || galaxy.selected;
  for (const g of galaxy.bodies.values()) {
    const b = g.L.b;
    const recent = b.time && Date.now() - b.time < 2 * DAY;
    g.angle += ((recent ? 0.2 : 0.04) * dt * 140) / g.radius;
    gOrbitPoint(g, g.angle, g.group.position);
    if (grow < 1) g.group.position.multiplyScalar(grow).applyAxisAngle(UP, (1 - grow) * 2.4);
    const size = g.L.size * Math.max(0.04, grow);
    g.mesh.scale.setScalar(size);
    g.mesh.rotation.y += dt * g.spin;
    g.halo.visible = !low;
    g.halo.scale.setScalar(size * (b.current ? 4.6 + Math.sin(t * 2.4) * 0.4 : 3.2));
    if (b.current) g.mesh.material.color.copy(ORBIT.selected);
    g.orbit.material.opacity = (g.L.tone === 'remote' ? 0.1 : 0.2) + (b.name === mark ? 0.4 : 0);
  }
  const mg = mark && galaxy.bodies.get(mark);
  gRing.material.opacity += ((mg ? 0.9 : 0) - gRing.material.opacity) * Math.min(1, dt * 8);
  if (mg) {
    gRing.position.copy(mg.group.position);
    gRing.scale.setScalar(mg.L.size * 1.5);
  }
  gRing.quaternion.copy(camera.quaternion);

  // commit moons around the selected branch: they pop out one after another, the newest closest in
  const m = galaxy.moons;
  const mb = m && m.meshes.length && galaxy.bodies.get(m.name);
  if (mb) {
    const since = (now - m.born) / 700;
    for (const mesh of m.meshes) {
      const { k, phase, tilt, commit } = mesh.userData;
      const q = Math.max(0, Math.min(1, since - k * 0.08));
      const out = 1 - (1 - q) ** 3;
      const r = (mb.mesh.scale.x * 1.5 + 5 + k * 2.4) * out;
      const a = t * (0.9 - k * 0.035) + phase;
      mesh.position.set(Math.cos(a) * r, Math.sin(a) * r * tilt, Math.sin(a) * r);
      mesh.scale.setScalar((commit.hash === galaxy.hoverCommit ? 3.6 : 2.4) * Math.max(0.05, out));
    }
  }
}

// Branch labels sit under their body; one that would cover a nearer label fades (the marked one always shows).
function cullGalaxyLabels() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  placed.length = 0;
  proj.set(0, 0, 0).project(camera);
  placed.push({ x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h + 40 });
  const mark = galaxy.hover || galaxy.selected;
  const order = [...galaxy.bodies.values()]
    .map((g) => {
      proj.copy(g.group.position).project(camera);
      return { g, x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h, z: proj.z, keep: g.L.b.name === mark || g.L.b.current };
    })
    .sort((a, b) => b.keep - a.keep || a.z - b.z);
  for (const o of order) {
    const hit = placed.some((q) => Math.abs(q.x - o.x) < 140 && Math.abs(q.y - o.y) < 36);
    const dist = camera.position.distanceTo(o.g.group.position);
    const pxPerUnit = h / 2 / (Math.tan((camera.fov * Math.PI) / 360) * dist);
    o.g.el.style.marginTop = Math.round(o.g.mesh.scale.x * 1.25 * pxPerUnit + 22) + 'px';
    o.g.el.classList.toggle('faded', hit && !o.keep);
    if (!hit || o.keep) placed.push(o);
  }
}

document.getElementById('galaxyBack').onclick = () => closeGalaxy();
gxFetch.onclick = async () => {
  if (!galaxy || !galaxy.data) return;
  gxFetch.disabled = true;
  try {
    const r = await window.agentinan.git.fetch(galaxy.data.root);
    if (r && r.error) D.toast(`Fetch olmadı: ${r.error}`);
    else D.toast("origin'den getirildi");
    await loadGalaxy();
  } finally {
    gxFetch.disabled = false;
  }
};
window.addEventListener('dash:galaxy', (e) => openGalaxy(e.detail && e.detail.id));

// ---------- animation ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const camDir = new THREE.Vector3();

// Drawn only while the map tab is open (capped at 30 fps on low quality).
let lastFrame = 0;
const placed = [];
const proj = new THREE.Vector3();

function animate(now = 0) {
  requestAnimationFrame(animate);
  const onMap = D.tab() === 'map';
  const low = D.settings().quality === 'low';
  if (!onMap) return; // the map is hidden behind the other tabs: draw nothing
  // the heavy decoration is skipped on low quality
  for (const o of [dust, corona, sunHalo2, ...SHOOTERS.map((x) => x.line)]) o.visible = !low;
  const gap = low ? 1000 / 30 : 0;
  if (now - lastFrame < gap) return;
  lastFrame = now;
  controls.enabled = onMap && !drag;

  const dt = Math.min(0.1, clock.getDelta());
  const t = clock.elapsedTime;

  if (replay && replay.playing) advanceReplay(dt);

  if (galaxy) {
    // the galaxy's own scene; the solar system is left as it is and picks up again when the galaxy closes
    updateGalaxy(dt, t, now, low);
    focus.lerp(tmp.set(0, 0, 0), Math.min(1, dt * 2.5));
    camDir.subVectors(focus, controls.target);
    controls.target.add(camDir);
    camera.position.add(camDir);
    controls.update();
    renderPass.scene = gScene;
    if (low) renderer.render(gScene, camera);
    else composer.render();
    cullGalaxyLabels();
    labels.render(gScene, camera);
    return;
  }
  renderPass.scene = scene;

  sunMesh.rotation.y += dt * 0.05;
  const busy = [...planets.values()].some((p) => p.status === 'busy');
  sunFlash = Math.max(0, sunFlash - dt * 1.2);
  sunHalo.scale.setScalar((dropHover === 'sun' ? 260 : 190) + sunFlash * 140 + Math.sin(t * (busy ? 2.4 : 0.9)) * (busy ? 14 : 5));
  sunHalo.material.opacity += ((dropHover === 'sun' ? 0.95 : 0.55) + sunFlash * 0.45 - sunHalo.material.opacity) * Math.min(1, dt * 8);
  stars.rotation.y += dt * 0.004;
  corona.material.rotation += dt * 0.025;
  corona.material.opacity = (busy ? 0.42 : 0.3) + Math.sin(t * 1.3) * 0.04;
  corona.scale.setScalar(230 + Math.sin(t * (busy ? 2 : 0.8)) * 8);
  sunHalo2.scale.setScalar(80 + Math.sin(t * 1.7) * 4);
  dust.rotation.y += dt * 0.006;
  if (!low) updateShooters(t, dt);

  const selected = D.selected();

  // each planet travels its orbit (the anchor); physics adds a small springy offset on top of it
  const bodies = [];
  for (const p of planets.values()) {
    const speed = p.status === 'busy' ? 0.32 : p.status === 'waiting' ? 0 : 0.035;
    p.angle += (speed * dt * 140) / p.radius;
    orbitPoint(p, p.angle, p.phys.anchor);
    p.phys.radius = p.size;
    p.phys.pull = p.status === 'busy' ? 1 : 0;
    bodies.push(p.phys);
  }
  stepBodies(bodies, dt, !low);

  for (const p of planets.values()) {
    p.group.position.copy(p.phys.anchor).add(p.phys.off);
    // a new planet is born from the sun: it spirals out to its orbit and grows
    let grow = 1;
    if (p.bornAt) {
      const k = (now - p.bornAt) / 2500;
      if (k >= 1) p.bornAt = 0;
      else {
        const e = 1 - (1 - Math.max(0, k)) ** 3;
        p.group.position.multiplyScalar(e).applyAxisAngle(UP, (1 - e) * 2.4);
        grow = Math.max(0.04, e);
      }
    }
    if (p.hot) {
      // shake
      const k = p.size * 0.18;
      p.group.position.x += (Math.random() - 0.5) * k;
      p.group.position.y += (Math.random() - 0.5) * k;
      p.group.position.z += (Math.random() - 0.5) * k;
    }
    p.mesh.scale.setScalar(p.size * grow * (p.hot ? 1.15 + Math.sin(t * 9) * 0.06 : 1));
    p.mesh.rotation.y += dt * p.spin;
    if (p.ring) p.ring.scale.setScalar(p.size * grow);
    const boost = p.doneAt ? Math.max(0, 1 - (now - p.doneAt) / 1600) : 0; // the flare after finishing a job

    // overheating flickers between red-hot and yellow-hot; otherwise ease toward the status colour
    const target = p.hot ? HOT.copy(HOT_A).lerp(HOT_B, 0.5 + 0.5 * Math.sin(t * 13)) : STATUS[p.status] || STATUS.idle;
    p.color.lerp(target, Math.min(1, dt * (p.hot ? 12 : 4)));
    p.mesh.material.color.copy(p.color);
    p.mesh.material.emissive.copy(p.color).multiplyScalar(p.hot ? 0.95 : p.status === 'idle' ? 0.12 : 0.32);
    if (boost) p.mesh.material.emissive.lerp(GOLD, boost * 0.8);
    p.halo.material.color.copy(p.color);
    p.atmo.visible = !low;
    p.atmo.scale.setScalar(p.mesh.scale.x * 1.17);
    p.atmo.material.uniforms.uColor.value.copy(p.color).lerp(WHITE, 0.25);
    p.atmo.material.uniforms.uAlpha.value = p.hot ? 1.4 : p.status === 'idle' ? 0.55 : 1;
    p.halo.scale.setScalar(p.size * grow * (1 + boost * 0.9) * (p.hot ? 8 + Math.sin(t * 7) * 1.4 : p.status === 'idle' ? 3.2 : 4.4 + Math.sin(t * 3) * 0.3));
    p.halo.material.opacity = Math.min(1, (p.hot ? 0.9 : p.status === 'idle' ? 0.35 : 0.6) + boost * 0.4);

    p.label.position.set(0, 0, 0);

    // waiting pulse: a ring facing the camera that grows and fades
    if (p.status === 'waiting' || p.hot) {
      const ph = (t * (p.hot ? 1.8 : 0.85)) % 1;
      p.pulse.position.copy(p.group.position);
      p.pulse.quaternion.copy(camera.quaternion);
      p.pulse.scale.setScalar(p.size * (1.3 + ph * (p.hot ? 4 : 2.4)));
      p.pulse.material.color.copy(p.hot ? HOT_A : STATUS.waiting);
      p.pulse.material.opacity = 0.9 * (1 - ph);
    } else p.pulse.material.opacity = 0;

    if (p.hot) {
      const sh = (t * 0.9 + (hash(p.id) % 100) / 100) % 1;
      p.shock.position.copy(p.group.position);
      p.shock.quaternion.copy(camera.quaternion);
      p.shock.scale.setScalar(p.size * (1.5 + sh * 7));
      p.shock.material.opacity = 0.7 * (1 - sh) ** 2;
    } else p.shock.material.opacity = 0;

    // selection / hover ring
    const on = p.id === selected || p.id === hoverId || p.id === dropHover;
    p.sel.material.opacity += ((on ? 0.9 : 0) - p.sel.material.opacity) * Math.min(1, dt * 8);
    p.sel.position.copy(p.group.position);
    p.sel.quaternion.copy(camera.quaternion);
    p.sel.scale.setScalar(p.size * grow * 1.45);
    // context arc: clear on the selected / hovered planet, faint on the others
    p.ctx.visible = p.ctxPct > 0;
    p.ctx.position.copy(p.group.position);
    p.ctx.quaternion.copy(camera.quaternion);
    p.ctx.scale.setScalar(p.size * grow);
    p.ctx.material.opacity += ((on ? 0.95 : 0.4) - p.ctx.material.opacity) * Math.min(1, dt * 6);
    shadeOrbit(p);
    p.orbit.material.opacity = p.id === selected ? 0.6 : 0.2;
    p.orbit.material.color.copy(p.id === selected ? ORBIT.selected : ORBIT.line);

    // comet trail
    const pos = p.trail.geometry.attributes.position;
    const col = p.trail.geometry.attributes.color;
    const fade = p.status === 'busy' && !p.bornAt ? 1 : 0;
    for (let k = 0; k < p.trailN; k++) {
      orbitPoint(p, p.angle - (k + 1) * 0.012, tmp);
      pos.setXYZ(k, tmp.x, tmp.y, tmp.z);
      const a = fade * (1 - k / p.trailN) ** 1.6;
      col.setXYZ(k, p.color.r * a, p.color.g * a, p.color.b * a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    p.trail.material.size = p.size * 0.9;

    // moons: a new one shoots out to its orbit with a pop; a leaving one dives back into the planet
    for (let k = p.moons.length - 1; k >= 0; k--) {
      const m = p.moons[k];
      let r = 1;
      let sc = 0.22;
      if (m.userData.leaving) {
        const q = (now - m.userData.leaving) / 600;
        if (q >= 1) {
          p.group.remove(m);
          m.material.dispose();
          p.moons.splice(k, 1);
          continue;
        }
        r = 1 - q * q;
        sc = 0.22 * (1 - q);
      } else if (m.userData.born) {
        const q = Math.max(0, (now - m.userData.born) / 800);
        if (q >= 1) m.userData.born = 0;
        r = 1 - (1 - Math.min(1, q)) ** 3;
        sc = 0.22 * (1 + Math.sin(Math.min(1, q) * Math.PI) * 0.8);
      }
      const mr = (1.9 + k * 0.45) * r;
      const a = t * (1.6 - k * 0.15) + m.userData.phase;
      m.position.set(Math.cos(a) * mr, Math.sin(a) * mr * m.userData.tilt, Math.sin(a) * mr);
      m.scale.setScalar(sc);
    }
  }

  // closed sessions fall into the sun, shrinking; the sun flares as each one arrives
  for (let i = dying.length - 1; i >= 0; i--) {
    const p = dying[i];
    const k = (now - p.diedAt) / 1800;
    if (k >= 1) {
      disposePlanet(p);
      dying.splice(i, 1);
      sunFlash = 1;
      continue;
    }
    const e = Math.max(0, k) ** 2;
    p.group.position.copy(p.fromPos).multiplyScalar(1 - e).applyAxisAngle(UP, e * 2.6);
    const sc = p.size * (1 - e * 0.92);
    p.mesh.scale.setScalar(sc);
    p.mesh.rotation.y += dt * p.spin * 4;
    p.atmo.scale.setScalar(sc * 1.17);
    p.halo.scale.setScalar(sc * 3.2);
    if (p.ring) p.ring.scale.setScalar(sc);
    p.orbit.material.opacity = 0.2 * (1 - k);
    p.ctx.material.opacity *= 0.9;
  }
  updateFx(now);

  updateEmbers(dt);
  updateLinks(t, low);
  updateBeams(t, low);

  // sparks
  for (let i = sparks.length - 1; i >= 0; i--) {
    const sp = sparks[i];
    const age = (performance.now() - sp.born) / 1000;
    if (age > 3.4 || !planets.has(sp.p.id)) {
      scene.remove(sp.obj);
      sp.el.remove();
      sparks.splice(i, 1);
      continue;
    }
    sp.obj.position.copy(sp.p.group.position);
    sp.obj.position.y += sp.p.size + 12 + age * 16 + sp.off * 9;
    sp.el.style.opacity = String(Math.max(0, 1 - age / 3.4));
  }

  // camera focus eases toward the selected planet
  const sp = selected && planets.get(selected);
  if (sp) focus.lerp(sp.group.position, Math.min(1, dt * 2.5));
  else focus.lerp(tmp.set(0, 0, 0), Math.min(1, dt * 2.5));
  camDir.subVectors(focus, controls.target);
  controls.target.add(camDir);
  camera.position.add(camDir);
  sunLight.position.set(0, 0, 0);

  controls.update();
  if (low) renderer.render(scene, camera);
  else composer.render();
  if (onMap) {
    cullLabels(selected);
    labels.render(scene, camera);
  }
}

// Hides a planet's label when it would cover a nearer one (the selected and hovered planets always keep theirs).
function cullLabels(selected) {
  const w = host.clientWidth;
  const h = host.clientHeight;
  placed.length = 0;
  proj.set(0, 0, 0).project(camera);
  placed.push({ x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h + 40 }); // the sun's caption
  const order = [...planets.values()]
    .map((p) => {
      proj.copy(p.group.position).project(camera);
      return { p, x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h, z: proj.z };
    })
    .sort((a, b) => {
      const pa = a.p.id === selected || a.p.id === hoverId;
      const pb = b.p.id === selected || b.p.id === hoverId;
      return pb - pa || a.z - b.z;
    });
  for (const o of order) {
    const keep = o.p.id === selected || o.p.id === hoverId;
    const hit = placed.some((q) => Math.abs(q.x - o.x) < 150 && Math.abs(q.y - o.y) < 40);
    const dist = camera.position.distanceTo(o.p.group.position);
    const pxPerUnit = h / 2 / (Math.tan((camera.fov * Math.PI) / 360) * dist);
    o.p.el.style.marginTop = Math.round(o.p.size * 1.25 * pxPerUnit + 24) + 'px';
    o.p.el.classList.toggle('faded', hit && !keep);
    if (!hit || keep) placed.push(o);
  }
}

window.addEventListener('dash:settings', () => {
  const low = D.settings().quality === 'low';
  renderer.setPixelRatio(low ? 1 : Math.min(2, window.devicePixelRatio || 1));
  resize();
});

window.addEventListener('dash:snapshot', (e) => {
  lastLive = e.detail;
  if (replay) return; // the replay owns the map until it is closed
  layout(e.detail.sessions);
  setLinks(e.detail.links);
  spawnSparks(e.detail.sessions);
});
layout(D.snap().sessions);
applyTheme(window.themes.current());
resize();
requestAnimationFrame(animate);
