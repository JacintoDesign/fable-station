import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mulberry32 } from './rng.js';

const STAR_DISTANCE = 5000;
const SUN_DISTANCE = 4000;

/** Seeded starfield: a uniform scatter plus a denser band for the galactic plane. */
export function createStars({ seed = 4242, count = 7000 } = {}) {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const bandNormal = new Vector3(0.35, 0.8, -0.48).normalize();
  const v = new Vector3();
  const color = new Color();

  for (let i = 0; i < count; i++) {
    // Uniform direction on the sphere.
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    v.set(s * Math.cos(a), z, s * Math.sin(a));
    if (i % 5 < 2) {
      // Squash toward the band's plane.
      const off = v.dot(bandNormal);
      v.addScaledVector(bandNormal, -off * (0.75 + rand() * 0.22)).normalize();
    }
    positions.set([v.x * STAR_DISTANCE, v.y * STAR_DISTANCE, v.z * STAR_DISTANCE], i * 3);

    const magnitude = Math.pow(rand(), 5); // most stars are faint
    const temperature = rand();
    if (temperature < 0.2) color.setRGB(1.0, 0.78, 0.6);
    else if (temperature < 0.75) color.setRGB(1.0, 0.96, 0.9);
    else color.setRGB(0.72, 0.84, 1.0);
    const brightness = 0.3 + magnitude * 1.7;
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
    sizes[i] = 1.2 + magnitude * 2.2;
    phases[i] = rand();
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));

  const material = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTwinkle: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uTwinkle;
      varying vec3 vColor;
      void main() {
        float twinkle = 1.0 + uTwinkle * 0.22 * sin(uTime * (0.6 + aPhase * 1.7) + aPhase * 40.0);
        vColor = aColor * twinkle;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vColor * smoothstep(0.5, 0.08, d), 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  const points = new Points(geometry, material);
  points.name = 'stars';
  points.frustumCulled = false;
  return points;
}

/** The sun's disc and glare, drawn as one camera-facing quad. The planet hides it by depth. */
export function createSun() {
  const material = new ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(0.03, 0.022, d) * 40.0;
        float glare = 0.012 / (d * d + 0.003);
        float fade = 1.0 - smoothstep(0.45, 1.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * (disc + glare) * fade, 1.0);
      }
    `,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.name = 'sun';
  mesh.scale.setScalar(2800);
  mesh.frustumCulled = false;
  mesh.userData.place = (camera, direction) => {
    mesh.position.copy(camera.position).addScaledVector(direction, SUN_DISTANCE);
    mesh.quaternion.copy(camera.quaternion);
  };
  return mesh;
}
