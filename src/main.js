import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createAmbience } from './audio.js';
import { partAt } from './batcher.js';
import { PARTS, VIEWS } from './data.js';
import { createPlanet } from './planet.js';
import { OrbitRig } from './rig.js';
import { createStars, createSun } from './sky.js';
import { buildStation } from './station.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarse = window.matchMedia('(pointer: coarse)').matches;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const state = {
  view: 0,
  paused: reduceQuery.matches, // reduced motion starts with the station still
  reduced: reduceQuery.matches,
  eclipse: false,
  eclipseAmount: 0,
  cinematic: false,
  selected: null,
};

// ---- Renderer -----------------------------------------------------------------
let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (error) {
  const note = document.createElement('p');
  note.className = 'fallback';
  note.textContent = 'Fable Station needs WebGL 2, which this browser or device has not made available.';
  document.body.append(note);
  $('hud').remove();
  $('veil').classList.add('lifted');
  throw error;
}
renderer.toneMapping = ACESFilmicToneMapping;
renderer.info.autoReset = false;

const scene = new Scene();
const camera = new PerspectiveCamera(40, 1, 0.5, 9000);

// ---- World --------------------------------------------------------------------
const PLANET_RADIUS = 600;
const PLANET_DISTANCE = 750;
const planetDir = new Vector3(0, -1, -0.25).normalize();
const sunDay = new Vector3(-0.6, 0.55, 0.45).normalize();
// In eclipse the sun swings round until it sits just behind the planet's limb.
const sunAxis = new Vector3().crossVectors(sunDay, planetDir).normalize();
const sunSweep = sunDay.angleTo(planetDir) - (Math.asin(PLANET_RADIUS / PLANET_DISTANCE) - 0.09);
const sunDir = sunDay.clone();

const station = buildStation();
scene.add(station.root);

const planet = createPlanet({
  radius: PLANET_RADIUS,
  center: planetDir.clone().multiplyScalar(PLANET_DISTANCE),
  lowDetail: coarse,
});
scene.add(planet.group);

const stars = createStars();
scene.add(stars);
const sun = createSun();
scene.add(sun);

const sunLight = new DirectionalLight(0xfff3e4, 3.4);
const planetLight = new DirectionalLight(0x5b8fe0, 0.7);
planetLight.position.copy(planetDir).multiplyScalar(100);
const ambient = new AmbientLight(0x8fa8d0, 0.08);
scene.add(sunLight, planetLight, ambient);

const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
station.materials.hullMap.anisotropy = anisotropy;
station.materials.solarMap.anisotropy = anisotropy;

// ---- Post-processing ------------------------------------------------------------
const composer = new EffectComposer(
  renderer,
  new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: coarse ? 0 : 4 }),
);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.45, 0.6, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function applyLighting() {
  const e = state.eclipseAmount;
  const k = e * e * (3 - 2 * e);
  sunDir.copy(sunDay).applyAxisAngle(sunAxis, sunSweep * k);
  const lit = 1 - smoothstep(0.5, 0.92, e);
  sunLight.position.copy(sunDir).multiplyScalar(100);
  sunLight.intensity = 3.4 * lit;
  planetLight.intensity = 0.04 + 0.66 * lit;
  // In shadow a little more fill keeps the station's silhouette readable.
  ambient.intensity = 0.36 - 0.28 * lit;
  planet.setSun(sunDir);
  bloom.strength = 0.45 + 0.35 * e;
  renderer.toneMappingExposure = 1 + 0.3 * e;
  audio.setEclipse(e);
}

// ---- Camera rig, picking and selection --------------------------------------------
const audio = createAmbience();
const raycaster = new Raycaster();
const pointer = new Vector2();
const tooltip = $('tooltip');
let pendingHover = null;
let dirty = 3;
const invalidate = () => {
  dirty = 3;
};

function pick(clientX, clientY) {
  pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  for (const hit of raycaster.intersectObjects(station.meshes, false)) {
    const part = partAt(hit.object, hit.faceIndex);
    if (part) return part;
  }
  return null;
}

const rig = new OrbitRig(camera, canvas, {
  onClick: (e) => select(pick(e.clientX, e.clientY)),
  onHover: (e) => {
    pendingHover = { x: e.clientX, y: e.clientY };
  },
  onInteract: () => {
    $('hint').classList.add('gone');
    hideTooltip();
  },
});
canvas.addEventListener('pointerleave', () => {
  pendingHover = null;
  hideTooltip();
});

function hideTooltip() {
  tooltip.classList.remove('on');
  canvas.classList.remove('hovering');
}

function updateHover() {
  if (!pendingHover) return;
  const { x, y } = pendingHover;
  pendingHover = null;
  if (rig.dragging || state.cinematic) return hideTooltip();
  const part = pick(x, y);
  if (!part) return hideTooltip();
  tooltip.textContent = PARTS[part].name;
  tooltip.style.transform = `translate(${Math.min(x + 14, window.innerWidth - 170)}px, ${y + 16}px)`;
  tooltip.classList.add('on');
  canvas.classList.add('hovering');
}

// A selected part is highlighted by drawing just its index range again with a
// glow material. The overlay shares the batch's buffers, so nothing is copied.
const highlight = new MeshBasicMaterial({
  color: 0x59d8ff,
  transparent: true,
  opacity: 0.3,
  blending: AdditiveBlending,
  depthWrite: false,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const overlayCache = new Map();
let overlays = [];

function overlayFor(mesh, range) {
  const key = `${mesh.uuid}:${range.start}`;
  let overlay = overlayCache.get(key);
  if (!overlay) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', mesh.geometry.attributes.position);
    geometry.setIndex(mesh.geometry.index);
    geometry.setDrawRange(range.start, range.count);
    geometry.boundingSphere = mesh.geometry.boundingSphere.clone();
    overlay = new Mesh(geometry, highlight);
    overlay.position.copy(mesh.position);
    overlay.raycast = () => {};
    overlay.renderOrder = 5;
    overlayCache.set(key, overlay);
  }
  return overlay;
}

function select(part) {
  for (const overlay of overlays) overlay.removeFromParent();
  overlays = [];
  state.selected = part;
  if (part) {
    for (const mesh of station.meshes) {
      for (const range of mesh.userData.ranges) {
        if (range.part !== part) continue;
        const overlay = overlayFor(mesh, range);
        mesh.parent.add(overlay);
        overlays.push(overlay);
      }
    }
    panel.classList.add('open');
  }
  renderPanel();
  invalidate();
}

// ---- Interface --------------------------------------------------------------------
const panel = $('panel');
const panelBody = $('panel-body');
const viewsNav = $('views');
const buttons = {
  pause: $('btn-pause'),
  eclipse: $('btn-eclipse'),
  audio: $('btn-audio'),
  cinematic: $('btn-cinematic'),
};

viewsNav.innerHTML = VIEWS.map(
  (view, i) =>
    `<button type="button" data-view="${i}"><kbd>${i + 1}</kbd><span class="long">${view.label}</span><span class="short">${view.short}</span></button>`,
).join('');
viewsNav.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-view]');
  if (button) setView(Number(button.dataset.view));
});

$('hint').textContent = coarse
  ? 'Drag to orbit · Pinch to zoom · Tap a part'
  : 'Drag to orbit · Scroll to zoom · Click a part';

const statRows = (stats) =>
  stats
    .map(([label, value]) =>
      typeof value === 'object' ? `<dt>${label}</dt><dd data-live="${value.live}"></dd>` : `<dt>${label}</dt><dd>${value}</dd>`,
    )
    .join('');

function renderPanel() {
  const view = VIEWS[state.view];
  const part = state.selected ? PARTS[state.selected] : null;
  $('panel-eyebrow').textContent = part ? 'Selected' : `View ${state.view + 1}`;
  $('panel-title').textContent = part ? part.name : view.label;
  panelBody.innerHTML = part
    ? `<p>${part.text}</p><dl class="stats">${statRows(part.stats)}</dl>
       <p style="margin:16px 0 0"><button type="button" class="clear" id="clear-selection">Back to ${view.label}</button></p>`
    : `<p>${view.text}</p><dl class="stats">${statRows(view.stats)}</dl>`;
  $('panel-head').setAttribute('aria-expanded', String(panel.classList.contains('open')));
  updateLive();
}
panelBody.addEventListener('click', (e) => {
  if (e.target.closest('#clear-selection')) select(null);
});
$('panel-head').addEventListener('click', () => {
  panel.classList.toggle('open');
  $('panel-head').setAttribute('aria-expanded', String(panel.classList.contains('open')));
});

function updateLive() {
  const e = state.eclipseAmount;
  const live = {
    mode: e > 0.5 ? 'Eclipse' : 'Daylight',
    draws: `${station.meshes.length} for ${station.pieceCount.toLocaleString('en')} pieces`,
    spin: state.paused ? '0 rpm (paused)' : '1.9 rpm',
    gravity: state.paused ? '0 g' : '0.36 g',
    solar: `${(10.8 * (1 - smoothstep(0.5, 0.92, e))).toFixed(1)} MW`,
    rotor: state.paused ? '0 rpm (paused)' : '8.6 rpm',
    load: `${Math.round(38 + 54 * e)} %`,
  };
  for (const node of panelBody.querySelectorAll('[data-live]')) {
    const text = live[node.dataset.live];
    if (node.textContent !== text) node.textContent = text;
  }
  const telemetry = `412 km · 7.66 km/s · ${live.mode}`;
  if ($('telemetry').textContent !== telemetry) $('telemetry').textContent = telemetry;
}

function setView(index, immediate = false) {
  state.view = index;
  rig.setView(VIEWS[index].camera, immediate || state.reduced ? 0 : 1.9);
  for (const button of viewsNav.children) {
    button.setAttribute('aria-current', String(Number(button.dataset.view) === index));
  }
  select(null);
}

function setPaused(paused) {
  state.paused = paused;
  buttons.pause.setAttribute('aria-pressed', String(paused));
  buttons.pause.querySelector('span').textContent = paused ? 'Paused' : 'Pause';
  buttons.pause.setAttribute('aria-label', paused ? 'Resume rotation' : 'Pause rotation');
  updateLive();
  invalidate();
}

function setEclipse(on) {
  state.eclipse = on;
  buttons.eclipse.setAttribute('aria-pressed', String(on));
  invalidate();
}

async function toggleAudio() {
  const on = await audio.toggle();
  buttons.audio.setAttribute('aria-pressed', String(on));
  audio.setEclipse(state.eclipseAmount);
}

const exitButton = $('exit-cinematic');
let exitTimer = 0;
function flashExit() {
  if (!state.cinematic) return;
  exitButton.classList.add('show');
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => exitButton.classList.remove('show'), 2800);
}
function setCinematic(on) {
  state.cinematic = on;
  document.body.classList.toggle('cinematic', on);
  buttons.cinematic.setAttribute('aria-pressed', String(on));
  $('hud').inert = on;
  hideTooltip();
  if (on) flashExit();
  else exitButton.classList.remove('show');
  invalidate();
}
window.addEventListener('pointermove', flashExit);
window.addEventListener('pointerdown', flashExit);

buttons.pause.addEventListener('click', () => setPaused(!state.paused));
buttons.eclipse.addEventListener('click', () => setEclipse(!state.eclipse));
buttons.audio.addEventListener('click', toggleAudio);
buttons.cinematic.addEventListener('click', () => setCinematic(!state.cinematic));
exitButton.addEventListener('click', () => setCinematic(false));

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key >= '1' && key <= '4') return setView(Number(key) - 1);
  if (key === 'h') return setCinematic(!state.cinematic);
  if (key === 'escape') {
    if (state.cinematic) setCinematic(false);
    else if (state.selected) select(null);
    return;
  }
  if (key === 'p') return setPaused(!state.paused);
  if (key === 'e') return setEclipse(!state.eclipse);
  if (key === 'm') return toggleAudio();

  // Keyboard orbit and zoom, unless focus is on a button that wants the key.
  if (e.target instanceof HTMLButtonElement) return;
  const turn = 0.12;
  if (key === 'arrowleft') rig.orbitBy(-turn, 0);
  else if (key === 'arrowright') rig.orbitBy(turn, 0);
  else if (key === 'arrowup') rig.orbitBy(0, -turn);
  else if (key === 'arrowdown') rig.orbitBy(0, turn);
  else if (key === '+' || key === '=') rig.zoomBy(0.88);
  else if (key === '-' || key === '_') rig.zoomBy(1 / 0.88);
  else return;
  e.preventDefault();
});

canvas.addEventListener('pointerdown', () => canvas.classList.add('dragging'));
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, () => canvas.classList.remove('dragging'));
}

// ---- Sizing and quality -------------------------------------------------------------
let pixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
const minPixelRatio = coarse ? 0.75 : 1;

function resize() {
  // A tab opened in the background can report a zero-sized window.
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const aspect = width / height;
  // Portrait screens get a wider lens and a little more distance so the station fits.
  const portrait = Math.min(1, Math.max(0, (1 - aspect) / 0.5));
  camera.fov = 40 + 18 * portrait;
  camera.aspect = aspect;
  // On wide screens, slide the picture left so the info panel does not cover the station.
  const shift = width > 900 ? Math.min(170, width * 0.14) : 0;
  if (shift) camera.setViewOffset(width, height, shift, 0, width, height);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  rig.radiusScale = 1 + 0.4 * portrait;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  stars.material.uniforms.uPixelRatio.value = pixelRatio;
  invalidate();
}
window.addEventListener('resize', resize);

// ---- Loop -----------------------------------------------------------------------------
let last = performance.now();
let simTime = 0;
let liveTime = 0;
let slowFrames = 0;
let frameCount = 0;
let liveClock = 0;
let firstFrame = true;
const debug = { calls: 0, triangles: 0, frames: 0 };

function frame(now) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(Math.max(rawDt, 0), 0.1);
  last = now;

  let changing = false;
  const targetEclipse = state.eclipse ? 1 : 0;
  if (state.eclipseAmount !== targetEclipse) {
    const stepSize = state.reduced ? 1 : dt / 4.5;
    const delta = targetEclipse - state.eclipseAmount;
    state.eclipseAmount += Math.sign(delta) * Math.min(Math.abs(delta), stepSize);
    applyLighting();
    changing = true;
  }

  if (state.cinematic && !state.reduced && !rig.dragging && !rig.tween) rig.goal.theta += dt * 0.045;
  const moving = rig.update(dt);
  updateHover();

  // With reduced motion and the station paused, nothing moves: only draw on change.
  const animating = !state.reduced || !state.paused || moving || changing;
  if (!animating && dirty <= 0) return;
  dirty = Math.max(0, dirty - 1);

  if (!state.paused) simTime += dt;
  if (!state.reduced) liveTime += dt;
  station.update(simTime, liveTime);
  planet.update(simTime);
  stars.material.uniforms.uTime.value = liveTime;
  stars.position.copy(camera.position);
  sun.userData.place(camera, sunDir);
  highlight.opacity = 0.26 + 0.1 * Math.sin(liveTime * 3);

  renderer.info.reset();
  composer.render(dt);
  debug.calls = renderer.info.render.calls;
  debug.triangles = renderer.info.render.triangles;
  debug.frames += 1;

  if (firstFrame) {
    firstFrame = false;
    $('veil').classList.add('lifted');
  }

  // Drop resolution a step if the device cannot hold a steady frame rate.
  frameCount += 1;
  if (frameCount > 60 && animating) {
    slowFrames = rawDt > 1 / 38 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && pixelRatio > minPixelRatio) {
      pixelRatio = Math.max(minPixelRatio, pixelRatio - 0.25);
      slowFrames = 0;
      frameCount = 0;
      resize();
    }
  }

  liveClock += dt;
  if (liveClock > 0.25 || changing) {
    liveClock = 0;
    updateLive();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    renderer.setAnimationLoop(null);
    audio.setActive(false);
  } else {
    last = performance.now();
    slowFrames = 0;
    frameCount = 0;
    invalidate();
    renderer.setAnimationLoop(frame);
    audio.setActive(true);
  }
});

reduceQuery.addEventListener('change', (e) => {
  state.reduced = e.matches;
  stars.material.uniforms.uTwinkle.value = e.matches ? 0 : 1;
  if (e.matches) setPaused(true);
  invalidate();
});

// ---- Start ----------------------------------------------------------------------------
stars.material.uniforms.uTwinkle.value = state.reduced ? 0 : 1;
if (window.matchMedia('(min-width: 721px)').matches) panel.classList.add('open');
resize();
applyLighting();
setPaused(state.paused);
setView(0, true);
if (!document.hidden) renderer.setAnimationLoop(frame);

window.__observatory = { state, station, rig, renderer, camera, debug, pick };
