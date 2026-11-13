import { AdditiveBlending, BackSide, Group, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p, int octaves) {
    float sum = 0.0;
    float amp = 0.5;
    float total = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      sum += amp * noise(p);
      total += amp;
      p = p * 2.03 + vec3(13.1, 7.7, 3.3);
      amp *= 0.5;
    }
    return sum / total;
  }
`;

const VERTEX = /* glsl */ `
  varying vec3 vObject;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vObject = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SURFACE = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform float uSpin;
  uniform float uCloudTime;
  varying vec3 vObject;
  varying vec3 vWorld;
  varying vec3 vNormal;
  ${NOISE}

  void main() {
    // The ground slides past as the station orbits: spin the lookup about X.
    float cs = cos(uSpin);
    float sn = sin(uSpin);
    vec3 o = normalize(vObject);
    vec3 p = vec3(o.x, o.y * cs - o.z * sn, o.y * sn + o.z * cs);

    vec3 q = p * 3.3 + vec3(11.3, 4.7, 7.1);
    vec3 warp = vec3(fbm(q * 1.7 + 3.1, 3), fbm(q * 1.7 + 17.3, 3), fbm(q * 1.7 + 41.7, 3)) - 0.5;
    float h = fbm(q + warp * 0.9, LAND_OCTAVES);
    h += (fbm(p * 26.0 + 2.0, 3) - 0.5) * 0.05 + (noise(p * 150.0) - 0.5) * 0.012;

    float sea = 0.5;
    float land = smoothstep(sea, sea + 0.01, h);
    float elev = clamp((h - sea) / 0.22, 0.0, 1.0);
    float lat = abs(p.x);
    float dry = fbm(q * 1.4 + 50.0, 3);

    vec3 ocean = mix(vec3(0.008, 0.035, 0.12), vec3(0.02, 0.15, 0.22), smoothstep(sea - 0.1, sea, h));
    vec3 ground = mix(vec3(0.03, 0.085, 0.025), vec3(0.3, 0.21, 0.11), smoothstep(0.42, 0.6, dry + lat * 0.15));
    ground = mix(ground, vec3(0.09, 0.13, 0.04), smoothstep(0.0, 0.15, elev) * (1.0 - smoothstep(0.2, 0.5, elev)) * 0.6);
    ground = mix(ground, vec3(0.17, 0.14, 0.12), smoothstep(0.4, 0.75, elev));
    ground = mix(ground, vec3(0.8, 0.83, 0.87), smoothstep(0.8, 0.95, elev));
    vec3 albedo = mix(ocean, ground, land);
    albedo = mix(albedo, vec3(0.8, 0.84, 0.9), smoothstep(0.84, 0.9, lat + (h - 0.5) * 0.25));

    vec3 cq = p * 5.2 + vec3(uCloudTime, 0.0, uCloudTime * 0.6);
    float cwarp = fbm(cq * 2.0 + 9.0, 3) - 0.5;
    float c = fbm(cq + cwarp * 0.8, CLOUD_OCTAVES) + (fbm(cq * 6.0 + 4.0, 3) - 0.5) * 0.1;
    float cloud = smoothstep(0.5, 0.63, c) * smoothstep(0.3, 0.55, fbm(p * 1.4 + 30.0 + uCloudTime * 0.3, 2));

    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndl = dot(N, uSunDir);
    float day = smoothstep(-0.12, 0.22, ndl);
    float diffuse = max(ndl, 0.0);
    vec3 sunTint = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.3, ndl));

    vec3 color = albedo * sunTint * diffuse * 2.0;
    float spec = pow(max(dot(N, normalize(uSunDir + V)), 0.0), 90.0);
    color += sunTint * spec * 1.6 * (1.0 - land) * (1.0 - cloud);
    vec3 cloudColor = sunTint * (diffuse * 0.98 + 0.004);
    color = mix(color, cloudColor, cloud * 0.92);

    // City lights on the night side.
    float cities = land * (1.0 - smoothstep(0.25, 0.6, elev))
      * smoothstep(0.7, 0.9, noise(p * 95.0))
      * smoothstep(0.45, 0.62, fbm(p * 9.0 + 5.0, 3));
    color += vec3(1.0, 0.6, 0.26) * cities * (1.0 - day) * (1.0 - cloud * 0.9) * 1.8;

    // Air seen edge-on: blue haze by day, a warm band at the terminator.
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    color = mix(color, vec3(0.2, 0.42, 0.85) * (diffuse * 1.4 + 0.02), 0.06 * day);
    color += vec3(0.22, 0.48, 1.0) * fresnel * day * 0.7;
    float twilight = smoothstep(-0.15, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.25, ndl));
    color += vec3(1.0, 0.36, 0.1) * twilight * fresnel * 0.5;
    color += vec3(0.002, 0.004, 0.009);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const ATMOSPHERE = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uCenter;
  uniform float uRadius;
  varying vec3 vWorld;

  void main() {
    // How close does this view ray pass to the surface? Glow falls off with that height.
    vec3 ro = cameraPosition - uCenter;
    vec3 rd = normalize(vWorld - cameraPosition);
    vec3 closest = ro + rd * max(-dot(ro, rd), 0.0);
    float b = length(closest);
    float density = exp(-max(b - uRadius, 0.0) / (uRadius * 0.011));
    density *= 1.0 - smoothstep(uRadius * 1.03, uRadius * 1.065, b);

    float sun = dot(normalize(closest), uSunDir);
    float day = smoothstep(-0.35, 0.25, sun);
    vec3 color = mix(vec3(1.0, 0.42, 0.14), vec3(0.22, 0.5, 1.0), smoothstep(-0.1, 0.35, sun)) * day;
    // Forward scattering: the limb flares when the sun sits just behind it.
    float forward = pow(max(dot(rd, uSunDir), 0.0), 10.0);
    color += vec3(1.0, 0.45, 0.16) * forward * 2.6 * smoothstep(-0.6, -0.05, sun);

    gl_FragColor = vec4(color * density * 1.3, 1.0);
  }
`;

export function createPlanet({ radius, center, lowDetail = false }) {
  const group = new Group();
  group.name = 'planet';
  group.position.copy(center);

  const sunDir = { value: new Vector3(0, 1, 0) };
  const surface = new ShaderMaterial({
    defines: { LAND_OCTAVES: lowDetail ? 5 : 6, CLOUD_OCTAVES: lowDetail ? 4 : 5 },
    uniforms: { uSunDir: sunDir, uSpin: { value: 0 }, uCloudTime: { value: 0 } },
    vertexShader: VERTEX,
    fragmentShader: SURFACE,
  });
  const globe = new Mesh(new SphereGeometry(radius, 192, 128), surface);
  globe.name = 'planet:surface';
  group.add(globe);

  const atmosphere = new ShaderMaterial({
    uniforms: { uSunDir: sunDir, uCenter: { value: center.clone() }, uRadius: { value: radius } },
    vertexShader: VERTEX,
    fragmentShader: ATMOSPHERE,
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const shell = new Mesh(new SphereGeometry(radius * 1.07, 192, 128), atmosphere);
  shell.name = 'planet:atmosphere';
  group.add(shell);

  return {
    group,
    setSun(direction) {
      sunDir.value.copy(direction);
    },
    update(simTime) {
      surface.uniforms.uSpin.value = 0.6 + simTime * 0.0035;
      surface.uniforms.uCloudTime.value = simTime * 0.004;
    },
  };
}
