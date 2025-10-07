/*
scripts.js
Immersive Solar System Simulation (Canvas)

* Visual-first N-body-ish simulation: Newtonian gravity influences orbits,
  but planets are artistically scaled and placed for visual beauty.
* Features: textured planets, atmosphere glow, soft lighting, rings, starfield,
  trails, camera controls (pan/zoom), focus, presets, info overlays.
* Notes: distances and sizes are *not* to scale; they are adjusted for long-term engagement.
  */

/* ================================
Initialization & Global Config
================================ */

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: true });

// Resize canvas to device pixel ratio and viewport
function resizeCanvas() {
const rect = canvas.getBoundingClientRect();
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = Math.max(800, Math.floor(rect.width * dpr));
canvas.height = Math.max(600, Math.floor(rect.height * dpr));
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function fitCanvasFull() {
canvas.style.width = '100%';
canvas.style.height = '100%';
resizeCanvas();
}

// run initial sizing
fitCanvasFull();
// handle window resize
window.addEventListener('resize', () => {
fitCanvasFull();
// regenerate starfield for new size if needed
starfield.generate();
});

// Configuration: tweak these to change the look/feel
const CONFIG = {
timeStepPerFrameDefault: 0.65,     // simulation days per animation frame (artistic)
pixelsPerAUDefault: 160,           // visual scale (px per AU)
trailLengthDefault: 1600,          // how many points to keep for trails
G: 4 * Math.PI * Math.PI / (365.25 * 365.25), // physically consistent G (AU^3 / (Msun * day^2))
artisticGravityScale: 1.0,         // multiplier to adjust gravitational influence for visuals
maxSubSteps: 6,                    // limit per-frame sub-steps for integrator stability
starLayers: 3,                     // number of starfield layers for parallax
fpsMeter: false                    // enable a simple fps readout for debug
};

// Simulation state
let sim = {
bodies: [],      // array of Body objects (Sun + planets)
trails: [],      // same length array of arrays of {x,y}
timeDays: 0,
running: true,
dt: CONFIG.timeStepPerFrameDefault,
pixelsPerAU: CONFIG.pixelsPerAUDefault,
trailLength: CONFIG.trailLengthDefault,
pan: { x: 0, y: 0 },    // screen-space pan in pixels
centerOnSun: true,
focusedIndex: 0,
warmupDone: false
};

/* ================================
Utility Helpers
================================ */

// clamp
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// deep copy small helper (used rarely)
function copy(obj) { return JSON.parse(JSON.stringify(obj)); }

// hex to rgba helper
function hexToRgba(hex, a = 1.0) {
const h = hex.replace('#', '');
const bigint = parseInt(h, 16);
const r = (bigint >> 16) & 255;
const g = (bigint >> 8) & 255;
const b = bigint & 255;
return `rgba(${r},${g},${b},${a})`;
}

/* ================================
Starfield (multi-layer) - aesthetic
================================ */

const starfield = {
layers: [],
generate() {
this.layers = [];
const w = canvas.clientWidth, h = canvas.clientHeight;
for (let layer = 0; layer < CONFIG.starLayers; layer++) {
const count = (layer + 1) * 120; // more distant layers have fewer stars, nearer layers more
const stars = [];
for (let i = 0; i < count; i++) {
stars.push({
x: Math.random() * w,
y: Math.random() * h,
r: Math.random() * (0.9 + layer * 0.6) + 0.2,
a: 0.3 + Math.random() * 0.9,
twinkle: Math.random() * 0.02 + 0.01
});
}
this.layers.push({ stars, parallax: 0.15 * layer, alpha: 0.25 + 0.35 * (1 - layer / CONFIG.starLayers) });
}
},
draw() {
const w = canvas.clientWidth, h = canvas.clientHeight;

// background nebula subtle gradient painted directly on canvas
const g = ctx.createLinearGradient(0, 0, 0, h);
g.addColorStop(0, '#020318');
g.addColorStop(1, '#000007');
ctx.fillStyle = g;
ctx.fillRect(0, 0, w, h);

// draw each layer with parallax offset according to pan
for (let L = 0; L < this.layers.length; L++) {
  const layer = this.layers[L];
  ctx.globalAlpha = layer.alpha;
  for (const s of layer.stars) {
    const sx = s.x + sim.pan.x * layer.parallax;
    const sy = s.y + sim.pan.y * layer.parallax;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${s.a * (0.7 + Math.sin(perf * s.twinkle) * 0.15)})`;
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
ctx.globalAlpha = 1;

}
};

// initial generate
let perf = 0;
starfield.generate();

/* ================================
Body class (planet / sun) & dataset
================================ */

class Body {
constructor(opts) {
this.name = opts.name;
this.mass = opts.mass; // in solar masses (for physics)
this.r = { x: opts.x || 0, y: opts.y || 0 }; // position in AU for physics engine
this.v = { x: opts.vx || 0, y: opts.vy || 0 }; // velocity AU/day
this.color = opts.color || '#ffffff';
this.radiusKm = opts.radiusKm || 1000;
this.sideSize = opts.sideSize || 1;
this.renderRadius = opts.renderRadius || Math.max(3, Math.log10(this.radiusKm || 1000) * 2.0);
this.hasRings = opts.rings || false;
this.textureSeed = Math.random(); // for procedural surface texture
this.info = opts.info || '';
}

// screen coordinate from world coordinate (AU -> px) with pan and centering controls
screenPos() {
const cx = canvas.clientWidth / 2;
const cy = canvas.clientHeight / 2;
if (sim.centerOnSun) {
// attempt to keep Sun at center with pan offset applied
const sun = sim.bodies[0];
const originX = cx + sim.pan.x - sun.r.x * sim.pixelsPerAU;
const originY = cy + sim.pan.y - sun.r.y * sim.pixelsPerAU;
return { x: originX + this.r.x * sim.pixelsPerAU, y: originY + this.r.y * sim.pixelsPerAU };
} else {
return { x: cx + sim.pan.x + this.r.x * sim.pixelsPerAU, y: cy + sim.pan.y + this.r.y * sim.pixelsPerAU };
}
}

// visual radius (artistically scaled)
getVisualRadius() {
// base visible size from km -> visual size tuned against pixelsPerAU
const base = Math.max(2.4, Math.log10(this.radiusKm + 1) * 2.2);
// exaggerate for visibility and long-term viewing, scale with pixelsPerAU for outer planets
const scaleFactor = Math.max(1, sim.pixelsPerAU / 140);
const sunBoost = this.name === 'Sun' ? 1.8 : 1.0;
return base * Math.max(1.0, scaleFactor) * sunBoost * this.renderRadius;
}
}

/* ================================
Dataset: Sun + Planets (artistically tuned)
================================ */

/*
Notes:

* Distances are represented in AU internally (for physics consistency),
  but we use artistically scaled render radii so viewers can enjoy long sessions.
* Masses roughly follow actual solar masses to give physically plausible gravity,
  though we may tweak the gravitational multiplier for visual stability.
  */

function setupDefaultBodies() {
sim.bodies = [];
sim.trails = [];

// Sun (index 0)
const sun = new Body({
name: 'Sun',
mass: 1.0,
x: 0, y: 0, vx: 0, vy: 0,
color: '#ffd86b',
radiusKm: 695700,
renderRadius: 3.5,
info: 'The star at the center of the solar system'
});
sim.bodies.push(sun);

// Planet presets: name, semi-major axis (AU), mass (solar masses), visual color, radiusKm, optional rings.
const presets = [
{ name: 'Mercury', a: 0.387, mass: 1.6601e-7, color: '#bdbdbd', radiusKm: 2439.7, rFactor: 0.9 },
{ name: 'Venus',   a: 0.723, mass: 2.447e-6, color: '#e4cdb2', radiusKm: 6051.8, rFactor: 1.0 },
{ name: 'Earth',   a: 1.000, mass: 3.003e-6, color: '#5da8ff', radiusKm: 6371.0, rFactor: 1.0 },
{ name: 'Mars',    a: 1.524, mass: 3.213e-7, color: '#ff9a6b', radiusKm: 3389.5, rFactor: 0.95 },
{ name: 'AsteroidBelt', a: 2.8, mass: 3e-9, color: '#9a9a9a', radiusKm: 600, rFactor: 0.5, synthetic: true },
{ name: 'Jupiter', a: 5.203, mass: 0.0009543, color: '#d9b48f', radiusKm: 69911, rFactor: 1.6 },
{ name: 'Saturn',  a: 9.537, mass: 0.0002857, color: '#f7e6bf', radiusKm: 58232, rFactor: 1.4, rings: true },
{ name: 'Uranus',  a: 19.191, mass: 4.366e-5, color: '#d1f4ff', radiusKm: 25362, rFactor: 1.1 },
{ name: 'Neptune', a: 30.07, mass: 5.151e-5, color: '#6f9fff', radiusKm: 24622, rFactor: 1.1 }
];

// Initialize planets in approx circular orbit initial velocities
for (let i = 0; i < presets.length; i++) {
const p = presets[i];
// create many small asteroids for the 'AsteroidBelt' synthetic visual ring
if (p.synthetic) {
// create a sparse ring of small bodies that are purely visual (low mass)
for (let k = 0; k < 120; k++) {
const angle = Math.random() * Math.PI * 2;
const radiusVariation = (Math.random() - 0.5) * 0.25;
const a = p.a + radiusVariation;
const x = Math.cos(angle) * a;
const y = Math.sin(angle) * a;
const body = new Body({
name: 'Asteroid-' + k,
mass: 3e-12,
x, y,
color: '#9c9c9c',
radiusKm: 80 + Math.random() * 120,
renderRadius: p.rFactor * 0.45
});
// initial tangential velocity for circular-ish path
const vYear = 2 * Math.PI / Math.sqrt(a);
body.v.x = -Math.sin(angle) * vYear / 365.25;
body.v.y = Math.cos(angle) * vYear / 365.25;
sim.bodies.push(body);
}
continue;
}

const angle0 = Math.random() * Math.PI * 2;
const x0 = Math.cos(angle0) * p.a;
const y0 = Math.sin(angle0) * p.a;
const vYear = 2 * Math.PI / Math.sqrt(p.a); // AU/year
const vx0 = -Math.sin(angle0) * vYear / 365.25;
const vy0 = Math.cos(angle0) * vYear / 365.25;

const body = new Body({
  name: p.name,
  mass: p.mass,
  x: x0, y: y0,
  vx: vx0, vy: vy0,
  color: p.color,
  radiusKm: p.radiusKm,
  renderRadius: p.rFactor,
  rings: p.rings || false,
  info: `${p.name} — beautiful planet`
});
sim.bodies.push(body);

}

// zero total momentum by nudging Sun's velocity
let px = 0, py = 0;
for (let b of sim.bodies) {
px += b.mass * b.v.x;
py += b.mass * b.v.y;
}
sim.bodies[0].v.x = -px / sim.bodies[0].mass;
sim.bodies[0].v.y = -py / sim.bodies[0].mass;

// prepare trails
sim.trails = sim.bodies.map(() => []);
}
setupDefaultBodies();

/* ================================
Physics: compute accelerations and integrate
================================ */

// compute accelerations for all bodies (vector of {x,y}) — pairwise O(N^2)
function computeAccelerations(bodies) {
const n = bodies.length;
const acc = new Array(n);
for (let i = 0; i < n; i++) acc[i] = { x: 0, y: 0 };

for (let i = 0; i < n; i++) {
for (let j = i + 1; j < n; j++) {
const bi = bodies[i], bj = bodies[j];
const dx = bj.r.x - bi.r.x;
const dy = bj.r.y - bi.r.y;
const dist2 = dx * dx + dy * dy + 1e-12;
const dist = Math.sqrt(dist2);
// force magnitude per unit mass = G * mOther / r^2
const aOnI = (CONFIG.G * bj.mass * CONFIG.artisticGravityScale) / dist2;
const ax = aOnI * (dx / dist);
const ay = aOnI * (dy / dist);
acc[i].x += ax;
acc[i].y += ay;
// Newton's third law: acceleration on j:
const aOnJ = (CONFIG.G * bi.mass * CONFIG.artisticGravityScale) / dist2;
acc[j].x -= aOnJ * (dx / dist);
acc[j].y -= aOnJ * (dy / dist);
}
}
return acc;
}

// velocity Verlet integrator for stability and energy-like conservation
function velocityVerletStep(dt) {
const n = sim.bodies.length;
const a0 = computeAccelerations(sim.bodies);

for (let i = 0; i < n; i++) {
const b = sim.bodies[i];
b.r.x += b.v.x * dt + 0.5 * a0[i].x * dt * dt;
b.r.y += b.v.y * dt + 0.5 * a0[i].y * dt * dt;
}

const a1 = computeAccelerations(sim.bodies);
for (let i = 0; i < n; i++) {
const b = sim.bodies[i];
b.v.x += 0.5 * (a0[i].x + a1[i].x) * dt;
b.v.y += 0.5 * (a0[i].y + a1[i].y) * dt;
}

// update trails
for (let i = 0; i < n; i++) {
sim.trails[i].push({ x: sim.bodies[i].r.x, y: sim.bodies[i].r.y });
if (sim.trails[i].length > sim.trailLength) sim.trails[i].shift();
}

sim.timeDays += dt;
}

// compute simple energy diagnostic (kinetic + potential)
function computeEnergy() {
let K = 0, U = 0;
for (let i = 0; i < sim.bodies.length; i++) {
const bi = sim.bodies[i];
const v2 = bi.v.x * bi.v.x + bi.v.y * bi.v.y;
K += 0.5 * bi.mass * v2;
for (let j = i + 1; j < sim.bodies.length; j++) {
const bj = sim.bodies[j];
const dx = bi.r.x - bj.r.x;
const dy = bi.r.y - bj.r.y;
const d = Math.sqrt(dx * dx + dy * dy) + 1e-12;
U -= CONFIG.G * bi.mass * bj.mass / d;
}
}
return { K, U, total: K + U };
}

/* ================================
Rendering: draw everything beautifully
================================ */

// helper: convert world (AU) to screen px
function worldToScreen(x, y) {
const cw = canvas.clientWidth, ch = canvas.clientHeight;
const cx = cw / 2;
const cy = ch / 2;
if (sim.centerOnSun) {
const sun = sim.bodies[0];
const originX = cx + sim.pan.x - sun.r.x * sim.pixelsPerAU;
const originY = cy + sim.pan.y - sun.r.y * sim.pixelsPerAU;
return { x: originX + x * sim.pixelsPerAU, y: originY + y * sim.pixelsPerAU };
} else {
return { x: cx + sim.pan.x + x * sim.pixelsPerAU, y: cy + sim.pan.y + y * sim.pixelsPerAU };
}
}

// draw a textured planet using layered radial gradients + procedural surface highlights
function drawPlanetSurface(screenX, screenY, visR, body, rotationAngle = 0) {
// base radial gradient for body
const g = ctx.createRadialGradient(screenX - visR * 0.25, screenY - visR * 0.25, visR * 0.05, screenX, screenY, visR);
g.addColorStop(0, hexToRgba(body.color, 1.0));
g.addColorStop(0.55, hexToRgba(body.color, 0.9));
g.addColorStop(1, 'rgba(0,0,0,0.05)');

// glow
ctx.save();
ctx.globalCompositeOperation = 'lighter';
ctx.fillStyle = g;
ctx.beginPath();
ctx.arc(screenX, screenY, visR * 1.2, 0, Math.PI * 2);
ctx.fill();
ctx.restore();

// actual sphere
ctx.beginPath();
ctx.fillStyle = body.color;
ctx.arc(screenX, screenY, visR, 0, Math.PI * 2);
ctx.fill();

// faux surface texture: layered noise-like ellipses (cheap procedural)
const layers = 6;
for (let i = 0; i < layers; i++) {
const alpha = 0.02 + i * 0.025;
ctx.beginPath();
const ox = Math.cos(body.textureSeed * 10 + perf * 0.0002 * (i + 1)) * (visR * 0.3) * (i / layers);
const oy = Math.sin(body.textureSeed * 7 + perf * 0.00014 * (i + 1)) * (visR * 0.18) * (i / layers);
ctx.fillStyle = hexToRgba('#000000', alpha);
ctx.ellipse(screenX + ox, screenY + oy, visR * (0.8 - i * 0.08), visR * (0.5 - i * 0.06), rotationAngle + i * 0.15, 0, Math.PI * 2);
ctx.fill();
}

// specular highlight (light source approximated at top-left)
const lx = screenX - visR * 0.6;
const ly = screenY - visR * 0.6;
const spec = ctx.createRadialGradient(lx, ly, 0, screenX, screenY, visR * 1.2);
spec.addColorStop(0, 'rgba(255,255,255,0.45)');
spec.addColorStop(0.12, 'rgba(255,255,255,0.18)');
spec.addColorStop(0.4, 'rgba(255,255,255,0.03)');
spec.addColorStop(1, 'rgba(0,0,0,0)');
ctx.globalCompositeOperation = 'lighter';
ctx.fillStyle = spec;
ctx.beginPath();
ctx.arc(screenX, screenY, visR, 0, Math.PI * 2);
ctx.fill();
ctx.globalCompositeOperation = 'source-over';
}

// draw ring with soft translucent bands
function drawRings(screenX, screenY, innerR, outerR, bodyColor) {
ctx.save();
ctx.translate(screenX, screenY);
const tilt = -0.45 + Math.sin(perf * 0.0001) * 0.06;
ctx.rotate(tilt);
ctx.scale(1, 0.45);
const bands = 8;
for (let i = 0; i < bands; i++) {
const t = i / (bands - 1);
ctx.beginPath();
const r = innerR + (outerR - innerR) * t;
ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2);
ctx.strokeStyle = `rgba(220,200,160,${0.18 * (1 - t)})`;
ctx.lineWidth = Math.max(1, (outerR - innerR) / 25);
ctx.stroke();
}
ctx.restore();
}

// draw a soft trail from sim.trails array for an index
function drawTrail(index, color) {
const t = sim.trails[index];
if (!t || t.length < 2) return;
ctx.beginPath();
for (let i = 0; i < t.length; i++) {
const p = worldToScreen(t[i].x, t[i].y);
if (i === 0) ctx.moveTo(p.x, p.y);
else ctx.lineTo(p.x, p.y);
}
ctx.strokeStyle = hexToRgba(color, 0.38);
ctx.lineWidth = 1.2;
ctx.stroke();
}

/* ================================
Camera / Interaction: pan / zoom / focus
================================ */

let pointerDown = false;
let lastPointer = null;

// pointer events for pan
canvas.addEventListener('pointerdown', (e) => {
pointerDown = true;
lastPointer = { x: e.clientX, y: e.clientY };
canvas.setPointerCapture(e.pointerId);
canvas.style.cursor = 'grabbing';
});
window.addEventListener('pointerup', (e) => {
pointerDown = false;
lastPointer = null;
canvas.style.cursor = 'grab';
});
window.addEventListener('pointermove', (e) => {
if (!pointerDown || !lastPointer) return;
const dx = e.clientX - lastPointer.x;
const dy = e.clientY - lastPointer.y;
sim.pan.x += dx;
sim.pan.y += dy;
sim.centerOnSun = false;
lastPointer = { x: e.clientX, y: e.clientY };
});

// wheel to zoom
canvas.addEventListener('wheel', (e) => {
e.preventDefault();
const delta = e.deltaY > 0 ? 0.96 : 1.04;
const old = sim.pixelsPerAU;
sim.pixelsPerAU = clamp(sim.pixelsPerAU * delta, 20, 4000);
// adjust pan to zoom towards pointer
const rect = canvas.getBoundingClientRect();
const px = e.clientX - rect.left;
const py = e.clientY - rect.top;
const zoomScale = sim.pixelsPerAU / old;
sim.pan.x = (sim.pan.x - px) * zoomScale + px;
sim.pan.y = (sim.pan.y - py) * zoomScale + py;
// update UI range if present
const scaleRange = document.getElementById('scaleRange');
if (scaleRange) scaleRange.value = Math.round(sim.pixelsPerAU);
}, { passive: false });

// click to focus body
canvas.addEventListener('click', (e) => {
const rect = canvas.getBoundingClientRect();
const cx = e.clientX - rect.left;
const cy = e.clientY - rect.top;
let best = -1, bestDist = 1e9;
for (let i = 0; i < sim.bodies.length; i++) {
const b = sim.bodies[i];
const sp = worldToScreen(b.r.x, b.r.y);
const d = Math.hypot(sp.x - cx, sp.y - cy);
if (d < Math.max(18, b.getVisualRadius() * 1.5) && d < bestDist) {
best = i; bestDist = d;
}
}
if (best >= 0) {
// focus on clicked object
focusOnIndex(best);
}
});

// keyboard interactions: arrow keys to pan, +/- to zoom, space to pause
window.addEventListener('keydown', (e) => {
switch (e.key) {
case ' ': // toggle play/pause
toggleRunning();
e.preventDefault();
break;
case '+':
case '=':
sim.pixelsPerAU = clamp(sim.pixelsPerAU * 1.07, 20, 4000);
break;
case '-':
case '_':
sim.pixelsPerAU = clamp(sim.pixelsPerAU / 1.07, 20, 4000);
break;
case 'ArrowLeft':
sim.pan.x += 40; sim.centerOnSun = false; break;
case 'ArrowRight':
sim.pan.x -= 40; sim.centerOnSun = false; break;
case 'ArrowUp':
sim.pan.y += 40; sim.centerOnSun = false; break;
case 'ArrowDown':
sim.pan.y -= 40; sim.centerOnSun = false; break;
}
});

/* ================================
Focus helpers & UI binding
================================ */

function focusOnIndex(i) {
if (i < 0 || i >= sim.bodies.length) return;
sim.focusedIndex = i;
sim.centerOnSun = false;
// compute screen pos of body and adjust pan to center it
const sp = worldToScreen(sim.bodies[i].r.x, sim.bodies[i].r.y);
sim.pan.x += canvas.clientWidth / 2 - sp.x;
sim.pan.y += canvas.clientHeight / 2 - sp.y;
// visually emphasize focused body by slightly increasing its glow on next frames
}

// build focus list in HUD
function populateFocusList() {
const container = document.getElementById('focusList');
if (!container) return;
container.innerHTML = '';
for (let i = 0; i < sim.bodies.length; i++) {
const b = sim.bodies[i];
const btn = document.createElement('button');
btn.textContent = b.name;
btn.onclick = () => focusOnIndex(i);
container.appendChild(btn);
}
}
populateFocusList();

/* ================================
UI Bindings (DOM controls)
================================ */

const speedRange = document.getElementById('speedRange');
const speedValue = document.getElementById('speedValue');
const scaleRange = document.getElementById('scaleRange');
const scaleValue = document.getElementById('scaleValue');
const playPauseBtn = document.getElementById('playPause');
const resetBtn = document.getElementById('resetBtn');
const timeDisplay = document.getElementById('timeDisplay');
const energyDisplay = document.getElementById('energyDisplay');

// initial UI values
if (speedRange) { speedRange.value = sim.dt; if (speedValue) speedValue.value = sim.dt; }
if (scaleRange) { scaleRange.value = sim.pixelsPerAU; if (scaleValue) scaleValue.value = sim.pixelsPerAU; }

// attach UI events
if (speedRange) {
speedRange.addEventListener('input', (e) => {
sim.dt = parseFloat(e.target.value);
if (speedValue) speedValue.value = sim.dt;
});
}
if (scaleRange) {
scaleRange.addEventListener('input', (e) => {
sim.pixelsPerAU = parseFloat(e.target.value);
if (scaleValue) scaleValue.value = sim.pixelsPerAU;
});
}
if (playPauseBtn) {
playPauseBtn.addEventListener('click', () => toggleRunning());
}
if (resetBtn) {
resetBtn.addEventListener('click', () => {
resetSimulation();
// subtle inventory refresh
populateFocusList();
});
}

function toggleRunning() {
sim.running = !sim.running;
if (playPauseBtn) {
playPauseBtn.textContent = sim.running ? 'Pause' : 'Play';
playPauseBtn.setAttribute('aria-pressed', sim.running ? 'true' : 'false');
}
}

/* ================================
Drawing loop & orchestration
================================ */

let lastTime = performance.now();
let fpsCount = 0, fpsLast = performance.now();

function renderFrame(now) {
const delta = (now - lastTime) / 1000;
lastTime = now;
perf += delta * 1000; // simple perf counter used by some procedural elements

// physics update: if running, do a number of substeps based on sim.dt for integrator stability
if (sim.running) {
const targetDt = sim.dt;
const sub = Math.max(1, Math.min(CONFIG.maxSubSteps, Math.ceil(targetDt / 0.9)));
const subDt = targetDt / sub;
for (let s = 0; s < sub; s++) {
velocityVerletStep(subDt);
}
}

// clear canvas and draw background
ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
starfield.draw();

// draw soft sun glow behind everything via DOM element (already present) and canvas bloom ring
drawSunBloom();

// draw trails for major planets (draw lightweight trails first)
for (let i = 0; i < sim.bodies.length; i++) {
// skip asteroids except faint trails for a few largest
if (sim.bodies[i].name.startsWith('Asteroid-')) {
// optional small alpha trails for asteroids might be expensive - skip
continue;
}
drawTrail(i, sim.bodies[i].color);
}

// draw bodies (ordered by distance to create depth)
const order = sim.bodies.map((b, idx) => ({ idx, d: Math.hypot(b.r.x, b.r.y) })).sort((a, b) => b.d - a.d);
for (const o of order) {
const b = sim.bodies[o.idx];
const sp = worldToScreen(b.r.x, b.r.y);
const visR = b.getVisualRadius();
// subtle orbital ring for each major object
if (!b.name.startsWith('Asteroid-')) drawOrbitRing(b);
drawPlanetSurface(sp.x, sp.y, visR, b, (perf * 0.0004) + (o.idx * 0.1));
if (b.hasRings) {
drawRings(sp.x, sp.y, visR * 1.6, visR * 3.4, b.color);
}
// label
drawLabel(sp.x, sp.y, visR, b);
}

// draw small UI overlays (time, energy)
if (timeDisplay) timeDisplay.textContent = `Day ${sim.timeDays.toFixed(2)} (≈ ${(sim.timeDays/365.25).toFixed(3)} yr)`;
if (energyDisplay) {
const E = computeEnergy();
energyDisplay.textContent = `${E.total.toExponential(4)}`;
}

// request next frame
requestAnimationFrame(renderFrame);
}

// orbit ring painter for major bodies
function drawOrbitRing(b) {
if (b.name.startsWith('Asteroid-')) return;
const sun = sim.bodies[0];
const sp = worldToScreen(sun.r.x, sun.r.y);
const centerX = sp.x;
const centerY = sp.y;
// radius in pixels based on distance from sun
const r = Math.hypot(b.r.x - sun.r.x, b.r.y - sun.r.y) * sim.pixelsPerAU;
ctx.beginPath();
ctx.strokeStyle = 'rgba(255,255,255,0.04)';
ctx.lineWidth = 1;
ctx.setLineDash([2, 8]);
ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
ctx.stroke();
ctx.setLineDash([]);
}

// small label painter
function drawLabel(x, y, r, body) {
if (body.name.startsWith('Asteroid-')) return;
ctx.font = `${Math.max(10, Math.min(14, r * 0.42))}px Inter, Arial`;
ctx.fillStyle = '#e8f6ff';
ctx.fillText(body.name, x + r + 6, y - r - 6);
}

/* ================================
Sun bloom and halo painters
================================ */

function drawSunBloom() {
// draw an extra subtle canvas halo near sun to enhance bloom when sun is off-center
const sun = sim.bodies[0];
const sp = worldToScreen(sun.r.x, sun.r.y);
const visR = sun.getVisualRadius();
const grd = ctx.createRadialGradient(sp.x, sp.y, visR * 0.2, sp.x, sp.y, visR * 6.0);
grd.addColorStop(0, 'rgba(255,220,120,0.16)');
grd.addColorStop(0.2, 'rgba(255,160,60,0.08)');
grd.addColorStop(0.6, 'rgba(255,110,30,0.02)');
grd.addColorStop(1, 'rgba(0,0,0,0)');
ctx.globalCompositeOperation = 'lighter';
ctx.beginPath();
ctx.fillStyle = grd;
ctx.arc(sp.x, sp.y, visR * 6.0, 0, Math.PI * 2);
ctx.fill();
ctx.globalCompositeOperation = 'source-over';
}

/* ================================
Warm-up and stable initialization
================================ */

function warmupSimulation() {
// run a modest number of steps to make initial trails and positions visually pleasing
const warmSteps = 320;
const stepSize = 0.6;
for (let i = 0; i < warmSteps; i++) {
velocityVerletStep(stepSize);
}
// cap trails
sim.trails = sim.trails.map(t => t.slice(-sim.trailLength));
sim.timeDays = 0;
sim.warmupDone = true;
}
warmupSimulation();

/* ================================
Reset simulation & presets
================================ */

function resetSimulation() {
sim.timeDays = 0;
sim.pan = { x: 0, y: 0 };
sim.centerOnSun = true;
sim.pixelsPerAU = CONFIG.pixelsPerAUDefault;
sim.dt = CONFIG.timeStepPerFrameDefault;
// re-setup bodies
setupDefaultBodies();
// re-generate starfield for variety
starfield.generate();
// refresh UI focus list
populateFocusList();
}

/* ================================
Start render loop
================================ */

let raf = requestAnimationFrame(renderFrame);

/* ================================
Accessibility & small enhancements
================================ */

// expose some controls to global for debugging in console (developer convenience)
window._sim = sim;
window._resetSimulation = resetSimulation;
window._bodies = sim.bodies;

/* ================================
Extra: ensure HUD focus list updates when bodies change
================================ */
(function periodicRefresh() {
populateFocusList();
setTimeout(periodicRefresh, 2000);
})();

/* ================================
End of script - creative commentary
================================ */
/*
FINAL NOTES:

* This simulation prioritizes visual beauty and long-term viewing.
* You can tune CONFIG parameters at the top to make orbits slower/faster, or to exaggerate gravity for more dramatic interactions.
* For better performance on long sessions, reduce trailLength and star layer counts.
* Enjoy exploring the solar system — click to focus, zoom with your wheel, and slow down time to watch the planets dance.
  */
