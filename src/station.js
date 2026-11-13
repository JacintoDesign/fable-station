import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { Batcher } from './batcher.js';
import { mulberry32 } from './rng.js';
import { createHullTexture, createSolarTexture } from './textures.js';

const C = {
  white: 0xdfe3e8,
  pale: 0xc9cfd6,
  grey: 0x8d96a1,
  dark: 0x363b44,
  black: 0x0c0f15,
  gold: 0xc9973f,
  copper: 0xb5653a,
  orange: 0xd2602b,
  navy: 0x15233f,
};

export const RING_SPIN = 0.2; // rad/s, about 1.9 rpm
export const ROTOR_SPIN = 0.9; // rad/s, about 8.6 rpm
const RING_RADIUS = 9;
const TUBE_RADIUS = 1.05;
const TRUSS_Y = -6;
const REACTOR_Y = -15.6;
const UP = new Vector3(0, 1, 0);

/** Translate / rotate (Euler XYZ) / scale in one call. */
function xf(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
  return new Matrix4().compose(
    new Vector3(px, py, pz),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(1, 1, 1),
  );
}

/** A frame on a circle about the Y axis: local X points outward, Z along the tangent. */
function radial(angle, radius, y = 0) {
  return new Matrix4()
    .makeTranslation(radius * Math.cos(angle), y, radius * Math.sin(angle))
    .multiply(new Matrix4().makeRotationY(-angle));
}

function createMaterials() {
  const hullMap = createHullTexture();
  const solarMap = createSolarTexture();
  const hull = new MeshStandardMaterial({ map: hullMap, vertexColors: true, roughness: 0.62, metalness: 0.25 });
  hull.name = 'hull';
  const solar = new MeshStandardMaterial({
    map: solarMap,
    vertexColors: true,
    roughness: 0.32,
    metalness: 0.5,
    side: DoubleSide,
    emissive: 0x24408c,
    emissiveMap: solarMap,
    emissiveIntensity: 0.3,
  });
  solar.name = 'solar';
  const glow = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  glow.name = 'glow';
  const beacon = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  beacon.name = 'beacon';
  const plasma = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        vPos = position;
        vNormal = normalMatrix * normal;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        float swirl = sin(vPos.y * 9.0 + uTime * 2.2 + sin(vPos.x * 7.0 + uTime * 1.3) * 1.5)
                    * sin(vPos.z * 8.0 - uTime * 1.7);
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.5);
        vec3 color = mix(vec3(0.08, 0.5, 1.0), vec3(0.6, 0.95, 1.0), 0.5 + 0.5 * swirl) * (0.9 + 0.35 * swirl);
        color += vec3(0.3, 0.6, 1.0) * fresnel * 0.9;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  plasma.name = 'plasma';
  return { hull, solar, glow, beacon, plasma, hullMap, solarMap };
}

/**
 * Builds the whole station. Static structure goes into the `core` node;
 * anything that moves gets a node of its own. Every node ends up with one
 * mesh per material.
 */
export function buildStation({ seed = 20261113 } = {}) {
  const rand = mulberry32(seed);
  const root = new Group();
  root.name = 'station';

  const nodes = {};
  for (const name of ['core', 'ring', 'dish', 'rotor', 'ship', 'beacons']) {
    const node = new Group();
    node.name = name;
    nodes[name] = node;
    root.add(node);
  }
  nodes.dish.position.set(0, 12.6, 0);
  nodes.dish.rotation.order = 'YXZ';
  nodes.rotor.position.set(0, REACTOR_Y, 0);

  const materials = createMaterials();
  const batcher = new Batcher();
  const partIds = new Set();

  const put = (geometry, node, material, part, color, matrix, options) => {
    if (part) partIds.add(part);
    batcher.add(geometry, { node: nodes[node], material: materials[material], part, color, matrix, ...options });
  };

  /** A thin cylinder between two points. */
  const strut = (node, part, a, b, radius, color, segments = 6) => {
    const delta = new Vector3().subVectors(b, a);
    const length = delta.length();
    const matrix = new Matrix4().compose(
      new Vector3().addVectors(a, b).multiplyScalar(0.5),
      new Quaternion().setFromUnitVectors(UP, delta.normalize()),
      new Vector3(1, 1, 1),
    );
    put(new CylinderGeometry(radius, radius, length, segments, 1, true), node, 'hull', part, color, matrix, {
      uvScale: [1, Math.max(1, length / 2)],
    });
  };
  const V = (x, y, z) => new Vector3(x, y, z);

  // ---- Spine -------------------------------------------------------------
  put(new CylinderGeometry(0.9, 0.9, 23, 24), 'core', 'hull', 'spine', C.white, xf(0, -0.5, 0), { uvScale: [6, 10] });
  for (const y of [-11, -8.2, -4.4, -2.4, 2.4, 4.8, 9.2]) {
    put(new CylinderGeometry(1.12, 1.12, 0.35, 24), 'core', 'hull', 'spine', C.grey, xf(0, y, 0));
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    put(new CapsuleGeometry(0.52, 1.0, 6, 14), 'core', 'hull', 'spine', C.gold, radial(a, 1.5, -3.4), { uvScale: [2, 2] });
    put(new SphereGeometry(0.6, 16, 12), 'core', 'hull', 'spine', C.pale, radial(a + Math.PI / 4, 1.55, 3.6));
  }

  // ---- Hub and spokes (turn with the ring) --------------------------------
  put(new CylinderGeometry(1.75, 1.75, 3, 32), 'ring', 'hull', 'hub', C.white, xf(), { uvScale: [6, 2] });
  for (const y of [-1.5, 1.5]) {
    put(new CylinderGeometry(1.95, 1.95, 0.3, 32), 'ring', 'hull', 'hub', C.grey, xf(0, y, 0));
  }
  for (const y of [-0.6, 0.6]) {
    put(new CylinderGeometry(1.77, 1.77, 0.1, 32, 1, true), 'ring', 'glow', 'hub', 0x7fd8ff, xf(0, y, 0), { intensity: 1.8 });
  }
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const at = (r, y) => dir.clone().multiplyScalar(r).setY(y);
    strut('ring', 'hub', at(1.7, 0), at(8.0, 0), 0.3, C.white, 10);
    strut('ring', 'hub', at(1.85, 1.4), at(8.1, 0.5), 0.05, C.dark);
    strut('ring', 'hub', at(1.85, -1.4), at(8.1, -0.5), 0.05, C.dark);
    if (k % 2 === 0) {
      put(new BoxGeometry(0.9, 0.8, 0.8), 'ring', 'hull', 'hub', C.orange, radial(a, 3.4 + rand() * 3, 0));
    }
  }

  // ---- Habitat ring --------------------------------------------------------
  const SEGMENTS = 12;
  const step = (Math.PI * 2) / SEGMENTS;
  const gap = 0.05;
  for (let i = 0; i < SEGMENTS; i++) {
    const start = i * step + gap / 2;
    // Torus arcs lie in XY; tip them into XZ, then swing each one into place.
    const matrix = new Matrix4().makeRotationY(-start).multiply(new Matrix4().makeRotationX(Math.PI / 2));
    put(new TorusGeometry(RING_RADIUS, TUBE_RADIUS, 16, 10, step - gap), 'ring', 'hull', 'habitat', i % 2 ? C.white : C.pale, matrix, {
      uvScale: [4, 4],
    });
    put(new TorusGeometry(TUBE_RADIUS + 0.11, 0.1, 8, 24), 'ring', 'hull', 'habitat', C.grey, radial(i * step, RING_RADIUS));

    // Windows: six rows around the tube, lit at random.
    for (const row of [40, -40, 90, -90, 140, -140]) {
      const v = (row * Math.PI) / 180;
      for (let j = 0; j < 6; j++) {
        const a = start + (0.12 + (0.76 * (j + 0.5)) / 6) * (step - gap);
        const matrix2 = radial(a, RING_RADIUS)
          .multiply(new Matrix4().makeRotationZ(v))
          .multiply(new Matrix4().makeTranslation(TUBE_RADIUS - 0.01, 0, 0));
        const lit = rand() < 0.72;
        const pick = rand();
        const tone = pick < 0.5 ? 0xffd9a0 : pick < 0.8 ? 0xfff1d6 : 0xbfe3ff;
        if (lit) {
          put(new BoxGeometry(0.05, 0.2, 0.36), 'ring', 'glow', 'habitat', tone, matrix2, { intensity: 1.1 + rand() * 1.1 });
        } else {
          put(new BoxGeometry(0.05, 0.2, 0.36), 'ring', 'hull', 'habitat', C.black, matrix2);
        }
      }
    }

    // Equipment boxes on the inner (hub-facing) side.
    for (let j = 0; j < 2; j++) {
      const a = start + (0.2 + rand() * 0.6) * (step - gap);
      const h = 0.15 + rand() * 0.2;
      const matrix3 = radial(a, RING_RADIUS)
        .multiply(new Matrix4().makeRotationZ(Math.PI + (rand() - 0.5) * 0.5))
        .multiply(new Matrix4().makeTranslation(TUBE_RADIUS + h / 2 - 0.04, 0, 0));
      put(new BoxGeometry(h, 0.3 + rand() * 0.4, 0.4 + rand() * 0.7), 'ring', 'hull', 'habitat', rand() < 0.5 ? C.grey : C.dark, matrix3);
    }
  }
  put(new TorusGeometry(RING_RADIUS - TUBE_RADIUS - 0.06, 0.05, 6, 96), 'ring', 'hull', 'habitat', C.dark, xf(0, 0, 0, Math.PI / 2));

  // ---- Power truss -----------------------------------------------------------
  const half = 0.5;
  const trussEnd = 20.6;
  const corners = [
    [half, half],
    [half, -half],
    [-half, -half],
    [-half, half],
  ];
  for (const [dy, dz] of corners) {
    strut('core', 'truss', V(-trussEnd, TRUSS_Y + dy, dz), V(trussEnd, TRUSS_Y + dy, dz), 0.06, C.grey);
  }
  const bays = 28;
  const bay = (trussEnd * 2) / bays;
  for (let i = 0; i <= bays; i++) {
    const x = -trussEnd + i * bay;
    for (let c = 0; c < 4; c++) {
      const [y0, z0] = corners[c];
      const [y1, z1] = corners[(c + 1) % 4];
      strut('core', 'truss', V(x, TRUSS_Y + y0, z0), V(x, TRUSS_Y + y1, z1), 0.04, C.grey, 5);
      if (i < bays) {
        const flip = (i + c) % 2 === 0;
        strut(
          'core',
          'truss',
          V(x, TRUSS_Y + (flip ? y0 : y1), flip ? z0 : z1),
          V(x + bay, TRUSS_Y + (flip ? y1 : y0), flip ? z1 : z0),
          0.03,
          C.pale,
          5,
        );
      }
    }
  }
  put(new BoxGeometry(2.6, 1.7, 2.6), 'core', 'hull', 'truss', C.grey, xf(0, TRUSS_Y, 0), { uvScale: [2, 1] });

  // ---- Solar wings: three stations per side, one wing fore and one aft -----
  const tilt = 0.38;
  let wingIndex = 0;
  for (const x of [-18.5, -13.5, -8.5, 8.5, 13.5, 18.5]) {
    for (const side of [1, -1]) {
      wingIndex += 1;
      const part = `solar-${String(wingIndex).padStart(2, '0')}`;
      const frame = xf(x, TRUSS_Y, 0, 0, side > 0 ? 0 : Math.PI, 0).multiply(new Matrix4().makeRotationZ(tilt * side));
      const local = (matrix) => frame.clone().multiply(matrix);
      const shade = 0.9 + rand() * 0.2;
      const tint = [shade, shade, shade];
      const tintHex = (Math.round(tint[0] * 255) << 16) | (Math.round(tint[1] * 255) << 8) | Math.round(tint[2] * 255);

      put(new BoxGeometry(0.55, 0.55, 0.9), 'core', 'hull', part, C.gold, local(xf(0, 0, 0.85)));
      put(new CylinderGeometry(0.07, 0.07, 11.6, 6, 1, true), 'core', 'hull', part, C.grey, local(xf(0, 0, 6.4, Math.PI / 2)));
      for (const bx of [-0.63, 0.63]) {
        put(new PlaneGeometry(1.05, 10.6), 'core', 'solar', part, tintHex, local(xf(bx, 0, 6.8, -Math.PI / 2)), {
          uvScale: [1, 10],
        });
        const edge = bx + Math.sign(bx) * 0.545;
        put(new BoxGeometry(0.04, 0.04, 10.6), 'core', 'hull', part, C.pale, local(xf(edge, 0, 6.8)));
      }
      for (const z of [1.46, 6.8, 12.14]) {
        put(new BoxGeometry(2.44, 0.06, 0.08), 'core', 'hull', part, C.pale, local(xf(0, 0, z)));
      }
    }
  }

  // ---- Radiator fins ---------------------------------------------------------
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const y = -9.7;
    put(new BoxGeometry(6, 3.2, 0.08), 'core', 'hull', 'radiators', 0xeceff2, radial(a, 4.3, y), { uvScale: [6, 3] });
    put(new BoxGeometry(0.5, 3.4, 0.34), 'core', 'hull', 'radiators', C.dark, radial(a, 1.1, y));
    put(new BoxGeometry(0.1, 3.3, 0.14), 'core', 'hull', 'radiators', C.grey, radial(a, 7.32, y));
    for (let j = 0; j < 6; j++) {
      const py = y - 1.25 + j * 0.5;
      put(new BoxGeometry(5.8, 0.06, 0.11), 'core', 'glow', 'radiators', 0xff5a22, radial(a, 4.3, py), { intensity: 0.55 });
    }
  }

  // ---- Reactor ---------------------------------------------------------------
  put(new CylinderGeometry(1.0, 2.7, 0.7, 32), 'core', 'hull', 'reactor', C.grey, xf(0, -12.5, 0), { uvScale: [6, 1] });
  put(new CylinderGeometry(2.7, 2.7, 0.15, 32), 'core', 'hull', 'reactor', C.dark, xf(0, -12.93, 0));
  put(new CylinderGeometry(0.6, 0.6, 0.6, 16), 'core', 'hull', 'reactor', C.dark, xf(0, -13.2, 0));
  put(new CylinderGeometry(1.5, 1.95, 0.5, 24), 'core', 'hull', 'reactor', C.pale, xf(0, REACTOR_Y + 2.05, 0), { uvScale: [4, 1] });
  put(new CylinderGeometry(1.95, 1.35, 0.6, 24), 'core', 'hull', 'reactor', C.pale, xf(0, REACTOR_Y - 2.1, 0), { uvScale: [4, 1] });
  put(new CylinderGeometry(0.85, 1.45, 1.1, 24), 'core', 'hull', 'reactor', C.dark, xf(0, REACTOR_Y - 2.95, 0));
  put(new CylinderGeometry(1.3, 1.3, 0.05, 24), 'core', 'glow', 'reactor', 0x66c8ff, xf(0, REACTOR_Y - 3.5, 0), { intensity: 0.9 });
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    put(new BoxGeometry(0.16, 3.7, 0.3), 'core', 'hull', 'reactor', k % 2 ? C.dark : C.copper, radial(a, 2.0, REACTOR_Y));
  }
  for (const dy of [1.15, 0.6, -0.6, -1.15]) {
    put(new TorusGeometry(2.08, 0.11, 8, 40), 'core', 'hull', 'reactor', C.copper, xf(0, REACTOR_Y + dy, 0, Math.PI / 2));
  }
  for (const dy of [1.78, -1.78]) {
    put(new TorusGeometry(1.6, 0.04, 6, 40), 'core', 'glow', 'reactor', 0x7fd8ff, xf(0, REACTOR_Y + dy, 0, Math.PI / 2), {
      intensity: 2,
    });
  }

  // Containment rotor: spins inside the cage.
  put(new TorusGeometry(1.62, 0.07, 8, 40), 'rotor', 'hull', 'reactor', C.grey, xf(0, 0, 0, Math.PI / 2));
  for (let k = 0; k < 10; k++) {
    put(new BoxGeometry(0.34, 0.9, 0.06), 'rotor', 'hull', 'reactor', k % 2 ? C.pale : C.dark, radial((k * Math.PI) / 5, 1.62));
  }

  // ---- Docking modules -------------------------------------------------------
  const DOCK_Y = 6.6;
  put(new SphereGeometry(1.35, 24, 16), 'core', 'hull', 'docking', C.white, xf(0, DOCK_Y, 0), { uvScale: [4, 2] });
  for (const s of [1, -1]) {
    const rz = (-s * Math.PI) / 2; // cylinder top toward ±X
    put(new CylinderGeometry(0.85, 0.85, 3.6, 20), 'core', 'hull', 'docking', C.white, xf(s * 3, DOCK_Y, 0, 0, 0, rz), {
      uvScale: [5, 3],
    });
    put(new CylinderGeometry(0.55, 0.85, 0.5, 20), 'core', 'hull', 'docking', C.grey, xf(s * 5.05, DOCK_Y, 0, 0, 0, rz));
    put(new CylinderGeometry(0.5, 0.5, 0.3, 20), 'core', 'hull', 'docking', C.dark, xf(s * 5.45, DOCK_Y, 0, 0, 0, rz));
    put(new TorusGeometry(0.5, 0.04, 6, 24), 'core', 'glow', 'docking', s > 0 ? 0x7dffb0 : 0xffb347, xf(s * 5.61, DOCK_Y, 0, 0, Math.PI / 2), {
      intensity: 1.8,
    });
    for (let j = 0; j < 4; j++) {
      for (const z of [0.85, -0.85]) {
        if (rand() < 0.25) continue;
        put(new BoxGeometry(0.26, 0.18, 0.04), 'core', 'glow', 'docking', 0xffe2b0, xf(s * (1.9 + j * 0.7), DOCK_Y + 0.1, z), {
          intensity: 1.6 + rand(),
        });
      }
    }
  }
  // Cupola arm (+Z) and airlock (-Z).
  put(new CylinderGeometry(0.7, 0.7, 2.6, 18), 'core', 'hull', 'docking', C.pale, xf(0, DOCK_Y, 2.5, Math.PI / 2), { uvScale: [4, 2] });
  put(new SphereGeometry(0.66, 18, 12), 'core', 'hull', 'docking', C.navy, xf(0, DOCK_Y, 3.9));
  put(new TorusGeometry(0.68, 0.035, 6, 24), 'core', 'glow', 'docking', 0x9fe0ff, xf(0, DOCK_Y, 3.8), { intensity: 1.5 });
  put(new CylinderGeometry(0.6, 0.6, 1.7, 18), 'core', 'hull', 'docking', C.gold, xf(0, DOCK_Y, -2.1, Math.PI / 2), { uvScale: [3, 1] });
  put(new CylinderGeometry(0.45, 0.45, 0.3, 18), 'core', 'hull', 'docking', C.dark, xf(0, DOCK_Y, -3.05, Math.PI / 2));
  put(new TorusGeometry(0.45, 0.04, 6, 24), 'core', 'glow', 'docking', 0x7dffb0, xf(0, DOCK_Y, -3.21), { intensity: 1.8 });

  // ---- Comms dish ------------------------------------------------------------
  put(new CylinderGeometry(0.25, 0.42, 1.5, 12), 'core', 'hull', 'comms', C.grey, xf(0, 11.7, 0));
  const profile = [];
  const bowl = (r) => 0.5 + 0.16 * r * r;
  const DISH_R = 2.3;
  for (let i = 0; i <= 12; i++) profile.push(new Vector2((DISH_R * i) / 12, bowl((DISH_R * i) / 12) - 0.06));
  for (let i = 12; i >= 0; i--) profile.push(new Vector2((DISH_R * i) / 12, bowl((DISH_R * i) / 12)));
  put(new LatheGeometry(profile, 40), 'dish', 'hull', 'comms', C.white, xf(), { uvScale: [8, 4] });
  put(new SphereGeometry(0.36, 14, 10), 'dish', 'hull', 'comms', C.dark, xf());
  put(new CylinderGeometry(0.16, 0.16, 0.5, 10), 'dish', 'hull', 'comms', C.dark, xf(0, 0.25, 0));
  const focus = V(0, 2.1, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    strut('dish', 'comms', V(Math.cos(a) * 2.1, bowl(2.1), Math.sin(a) * 2.1), focus, 0.03, C.grey, 5);
  }
  put(new CylinderGeometry(0.12, 0.22, 0.4, 10), 'dish', 'hull', 'comms', C.orange, xf(0, 2.05, 0));

  // ---- Supply ship (nose toward +Z) -----------------------------------------
  const RX = Math.PI / 2;
  put(new CylinderGeometry(0.5, 0.5, 2, 16), 'ship', 'hull', 'ship', C.white, xf(0, 0, 0, RX), { uvScale: [3, 2] });
  put(new CylinderGeometry(0.18, 0.5, 0.7, 16), 'ship', 'hull', 'ship', C.pale, xf(0, 0, 1.35, RX));
  put(new CylinderGeometry(0.1, 0.1, 0.25, 8), 'ship', 'hull', 'ship', C.dark, xf(0, 0, 1.8, RX));
  put(new CylinderGeometry(0.56, 0.56, 0.6, 16), 'ship', 'hull', 'ship', C.gold, xf(0, 0, -1.1, RX));
  put(new CylinderGeometry(0.2, 0.42, 0.5, 14), 'ship', 'hull', 'ship', C.dark, xf(0, 0, -1.6, RX));
  put(new CylinderGeometry(0.34, 0.34, 0.04, 14), 'ship', 'glow', 'ship', 0x8fd0ff, xf(0, 0, -1.86, RX), { intensity: 2.6 });
  put(new BoxGeometry(0.3, 0.1, 0.04), 'ship', 'glow', 'ship', 0xffe2b0, xf(0, 0.2, 1.52), { intensity: 2 });
  for (const s of [1, -1]) {
    put(new BoxGeometry(1.7, 0.03, 0.7), 'ship', 'hull', 'ship', C.navy, xf(s * 1.5, 0, -0.5));
    put(new BoxGeometry(0.3, 0.05, 0.08), 'ship', 'hull', 'ship', C.grey, xf(s * 0.6, 0, -0.5));
  }

  // ---- Navigation beacons (blink together, so they share one material) ------
  const beaconAt = (x, y, z, color) =>
    batcher.add(new SphereGeometry(0.12, 8, 6), {
      node: nodes.beacons,
      material: materials.beacon,
      color,
      intensity: 3,
      matrix: xf(x, y, z),
    });
  beaconAt(-trussEnd - 0.2, TRUSS_Y, 0, 0xff3b30);
  beaconAt(trussEnd + 0.2, TRUSS_Y, 0, 0x3bff6a);
  beaconAt(0, REACTOR_Y - 3.7, 0, 0xffffff);
  beaconAt(0, 11.1, 0.5, 0xffffff);
  beaconAt(0, DOCK_Y + 1.42, 0, 0xff3b30);

  const pieceCount = batcher.pieceCount;
  const meshes = batcher.build();

  // The plasma core has its own animated shader, so it stays a separate mesh.
  const plasmaGeometry = new SphereGeometry(1.15, 32, 24);
  const plasma = new Mesh(plasmaGeometry, materials.plasma);
  plasma.name = 'core:plasma';
  plasma.position.set(0, REACTOR_Y, 0);
  plasma.userData.ranges = [{ part: 'reactor', start: 0, count: plasmaGeometry.index.count }];
  plasma.userData.pieceCount = 1;
  root.add(plasma);
  meshes.push(plasma);

  const reactorLight = new PointLight(0x6fd6ff, 40, 40, 2);
  reactorLight.position.set(0, REACTOR_Y, 0);
  root.add(reactorLight);

  const shipTangent = new Vector3();
  const SHIP_TILT = 0.35;

  /** simTime drives rotation and orbits (it stops when paused); liveTime drives glows. */
  function update(simTime, liveTime) {
    nodes.ring.rotation.y = simTime * RING_SPIN;
    nodes.rotor.rotation.y = -simTime * ROTOR_SPIN;
    nodes.dish.rotation.y = 0.6 + Math.sin(simTime * 0.06) * 0.9;
    nodes.dish.rotation.x = 0.75 + Math.sin(simTime * 0.11) * 0.15;

    const a = 1.1 + simTime * 0.06;
    const r = 27;
    const ship = nodes.ship;
    ship.position.set(Math.cos(a) * r, 2 + Math.sin(a) * r * Math.sin(SHIP_TILT), Math.sin(a) * r * Math.cos(SHIP_TILT));
    shipTangent.set(-Math.sin(a), Math.cos(a) * Math.sin(SHIP_TILT), Math.cos(a) * Math.cos(SHIP_TILT)).add(ship.position);
    ship.lookAt(shipTangent);

    const blink = (liveTime * 0.7) % 1 < 0.12 ? 1 : 0.06;
    materials.beacon.color.setScalar(blink);
    materials.plasma.uniforms.uTime.value = liveTime;
    reactorLight.intensity = 38 + Math.sin(liveTime * 3.1) * 6;
  }
  update(0, 0);

  return { root, nodes, meshes, materials, partIds: [...partIds], pieceCount, reactorLight, update };
}
