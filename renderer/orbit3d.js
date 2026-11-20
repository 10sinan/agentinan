// The 3D orbit map: the sun is you, every Claude Code session is a planet, active subagents are its moons.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
composer.addPass(new RenderPass(scene, camera));
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
function surfaceTexture(seed, banded) {
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
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, 256, 2);
    }
  }
  for (let i = 0; i < 140; i++) {
    const v = 140 + rnd() * 115;
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.35})`;
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 128, 4 + rnd() * 26, 1 + rnd() * 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const sunGroup = new THREE.Group();
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(30, 48, 32),
  new THREE.MeshBasicMaterial({ map: surfaceTexture(7, false), color: new THREE.Color('#ffb340').multiplyScalar(1.6) }),
);
sunGroup.add(sunMesh);
const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#ff9a2e', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
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
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + Math.random() * 0.1;
    const len = 70 + Math.random() * 58;
    const w = 0.035 + Math.random() * 0.05;
    const grd = g.createRadialGradient(0, 0, 18, 0, 0, len);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
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
const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: coronaTexture(), color: '#ffb340', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
corona.scale.setScalar(250);
sunGroup.add(corona);
const sunHalo2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#ffe2a8', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
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

function makePlanet(s) {
  const h = hash(s.id);
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: surfaceTexture(h, true), roughness: 0.75, metalness: 0.05, emissive: new THREE.Color('#000'), emissiveIntensity: 1 });
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
    sel,
    orbit,
    trail,
    trailN: TRAIL,
    moons,
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
  for (const o of [p.group, p.pulse, p.sel, p.orbit, p.trail]) {
    scene.remove(o);
    o.traverse?.((x) => {
      x.geometry !== ATMO_GEO && x.geometry !== MOON_GEO && x.geometry?.dispose();
      x.material?.map && x.material.map !== GLOW && x.material.map.dispose();
      x.material?.dispose();
    });
  }
  p.group.remove(p.label);
  p.el.remove();
  pickables.splice(pickables.indexOf(p.mesh), 1);
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
const planetSize = (s) => Math.max(9, Math.min(22, 9 + 4 * Math.log10(1 + s.tokens.output / 2e3)));

function layout(sessions) {
  const n = sessions.length;
  sessions.forEach((s, i) => {
    let p = planets.get(s.id);
    if (!p) planets.set(s.id, (p = makePlanet(s)));
    p.s = s;
    const r = 120 + i * Math.max(62, Math.min(95, 360 / Math.max(1, n)));
    if (Math.abs(p.radius - r) > 0.5) {
      p.radius = r;
      setOrbitGeometry(p);
    }
    p.size = planetSize(s);
    if (p.status !== s.status) p.statusChangedAt = performance.now();
    p.status = s.status;
    const waiting = s.status === 'waiting' && s.waitingFor ? ` · ${D.esc(s.waitingFor)}` : '';
    p.el.className = `planet-label ${s.status}${s.id === D.selected() ? ' sel' : ''}`;
    p.el.innerHTML = `<b>${s.control ? '<i class="ctl">›_</i>' : ''}${D.esc(s.name)}</b><span>${D.LABELS[s.status] || D.esc(s.status)}${waiting} · ${D.fmtTok(s.context)} bağlam</span>`;
    syncMoons(p, s.subagents.filter((a) => a.active).length);
    // a process this session started is straining the PC: the planet overheats
    const hog = D.hogs().find((h) => h.sessionId === s.id);
    p.hot = !!hog;
    p.el.classList.toggle('hot', p.hot);
    if (hog) p.el.innerHTML += `<em class="heat">AŞIRI ISINMA · ${D.esc(hog.name)} %${hog.cpu}</em>`;
  });
  const live = new Set(sessions.map((s) => s.id));
  for (const [id, p] of planets) {
    if (!live.has(id)) {
      disposePlanet(p);
      planets.delete(id);
    }
  }
  const snap = D.snap();
  sunLabelEl.innerHTML = `<b>${sessions.length}</b> oturum · bugün ${D.fmtCost(snap.today.cost)}`;
  document.getElementById('empty3d').hidden = sessions.length > 0;
}

const MOON_GEO = new THREE.SphereGeometry(1, 16, 12);
function syncMoons(p, n) {
  while (p.moons.length < n) {
    const m = new THREE.Mesh(MOON_GEO, new THREE.MeshStandardMaterial({ color: '#dfe5f5', roughness: 0.9, emissive: '#3a4466' }));
    m.userData.phase = Math.random() * Math.PI * 2;
    m.userData.tilt = Math.random() * 0.9 - 0.45;
    p.group.add(m);
    p.moons.push(m);
  }
  while (p.moons.length > n) {
    const m = p.moons.pop();
    p.group.remove(m);
    m.material.dispose();
  }
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
      const el = document.createElement('div');
      el.className = 'spark';
      el.textContent = t.brief ? `${t.name} · ${t.brief}` : t.name;
      const obj = new CSS2DObject(el);
      scene.add(obj);
      sparks.push({ obj, el, p, born: performance.now(), off: sparks.filter((x) => x.p === p).length });
    }
  }
  firstSnap = false;
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoverId = null;
let downAt = null;

function pick(e) {
  const r = labels.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  return hit ? hit.object.userData.id : null;
}

labels.domElement.addEventListener('pointermove', (e) => {
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
labels.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
labels.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // a drag, not a click
  const id = pick(e);
  D.select(id && id !== D.selected() ? id : null, true);
});

// Fly the camera's focus toward the selected planet; back to the sun when nothing is selected.
const focus = new THREE.Vector3();
window.addEventListener('dash:select', () => layout(D.snap().sessions));

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
  const gap = low ? 1000 / 30 : 0;
  if (now - lastFrame < gap) return;
  lastFrame = now;
  controls.enabled = onMap;

  const dt = Math.min(0.1, clock.getDelta());
  const t = clock.elapsedTime;

  sunMesh.rotation.y += dt * 0.05;
  const busy = [...planets.values()].some((p) => p.status === 'busy');
  sunHalo.scale.setScalar(190 + Math.sin(t * (busy ? 2.4 : 0.9)) * (busy ? 14 : 5));
  stars.rotation.y += dt * 0.004;
  corona.material.rotation += dt * 0.025;
  corona.material.opacity = (busy ? 0.62 : 0.45) + Math.sin(t * 1.3) * 0.05;
  corona.scale.setScalar(250 + Math.sin(t * (busy ? 2 : 0.8)) * 10);
  sunHalo2.scale.setScalar(80 + Math.sin(t * 1.7) * 4);
  dust.rotation.y += dt * 0.006;
  updateShooters(t, dt);

  const selected = D.selected();
  for (const p of planets.values()) {
    const speed = p.status === 'busy' ? 0.32 : p.status === 'waiting' ? 0 : 0.035;
    p.angle += (speed * dt * 140) / p.radius;
    orbitPoint(p, p.angle, p.group.position);
    if (p.hot) {
      // shake
      const k = p.size * 0.18;
      p.group.position.x += (Math.random() - 0.5) * k;
      p.group.position.y += (Math.random() - 0.5) * k;
      p.group.position.z += (Math.random() - 0.5) * k;
    }
    p.mesh.scale.setScalar(p.size * (p.hot ? 1.15 + Math.sin(t * 9) * 0.06 : 1));
    p.mesh.rotation.y += dt * p.spin;
    if (p.ring) p.ring.scale.setScalar(p.size);

    // overheating flickers between red-hot and yellow-hot; otherwise ease toward the status colour
    const target = p.hot ? HOT.copy(HOT_A).lerp(HOT_B, 0.5 + 0.5 * Math.sin(t * 13)) : STATUS[p.status] || STATUS.idle;
    p.color.lerp(target, Math.min(1, dt * (p.hot ? 12 : 4)));
    p.mesh.material.color.copy(p.color);
    p.mesh.material.emissive.copy(p.color).multiplyScalar(p.hot ? 0.95 : p.status === 'idle' ? 0.12 : 0.32);
    p.halo.material.color.copy(p.color);
    p.atmo.scale.setScalar(p.mesh.scale.x * 1.17);
    p.atmo.material.uniforms.uColor.value.copy(p.color).lerp(WHITE, 0.25);
    p.atmo.material.uniforms.uAlpha.value = p.hot ? 1.4 : p.status === 'idle' ? 0.55 : 1;
    p.halo.scale.setScalar(p.size * (p.hot ? 8 + Math.sin(t * 7) * 1.4 : p.status === 'idle' ? 3.2 : 4.4 + Math.sin(t * 3) * 0.3));
    p.halo.material.opacity = p.hot ? 0.9 : p.status === 'idle' ? 0.35 : 0.6;

    p.label.position.set(0, -p.size - 6, 0);

    // waiting pulse: a ring facing the camera that grows and fades
    if (p.status === 'waiting' || p.hot) {
      const ph = (t * (p.hot ? 1.8 : 0.85)) % 1;
      p.pulse.position.copy(p.group.position);
      p.pulse.quaternion.copy(camera.quaternion);
      p.pulse.scale.setScalar(p.size * (1.3 + ph * (p.hot ? 4 : 2.4)));
      p.pulse.material.color.copy(p.hot ? HOT_A : STATUS.waiting);
      p.pulse.material.opacity = 0.9 * (1 - ph);
    } else p.pulse.material.opacity = 0;

    // selection / hover ring
    const on = p.id === selected || p.id === hoverId;
    p.sel.material.opacity += ((on ? 0.9 : 0) - p.sel.material.opacity) * Math.min(1, dt * 8);
    p.sel.position.copy(p.group.position);
    p.sel.quaternion.copy(camera.quaternion);
    p.sel.scale.setScalar(p.size * 1.45);
    shadeOrbit(p);
    p.orbit.material.opacity = p.id === selected ? 0.7 : 0.3;
    p.orbit.material.color.copy(p.id === selected ? ORBIT.selected : ORBIT.line);

    // comet trail
    const pos = p.trail.geometry.attributes.position;
    const col = p.trail.geometry.attributes.color;
    const fade = p.status === 'busy' ? 1 : 0;
    for (let k = 0; k < p.trailN; k++) {
      orbitPoint(p, p.angle - (k + 1) * 0.012, tmp);
      pos.setXYZ(k, tmp.x, tmp.y, tmp.z);
      const a = fade * (1 - k / p.trailN) ** 1.6;
      col.setXYZ(k, p.color.r * a, p.color.g * a, p.color.b * a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    p.trail.material.size = p.size * 0.9;

    // moons
    p.moons.forEach((m, k) => {
      const mr = 1.9 + k * 0.45;
      const a = t * (1.6 - k * 0.15) + m.userData.phase;
      m.position.set(Math.cos(a) * mr, Math.sin(a) * mr * m.userData.tilt, Math.sin(a) * mr);
      m.scale.setScalar(0.22);
    });
  }

  updateEmbers(dt);

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
  layout(e.detail.sessions);
  spawnSparks(e.detail.sessions);
});
layout(D.snap().sessions);
applyTheme(window.themes.current());
resize();
requestAnimationFrame(animate);
