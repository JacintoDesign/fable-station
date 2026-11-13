import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { mulberry32 } from './rng.js';

// Textures are plain pixel arrays (no canvas, no image files) so they can be
// generated in the browser and in the Node test run alike.

function finish(data, size) {
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Hull plating: shaded panels, seams and rivets. Multiplied by vertex color. */
export function createHullTexture(seed = 11) {
  const size = 256;
  const cell = 32;
  const rand = mulberry32(seed);
  const data = new Uint8Array(size * size * 4);
  const cells = size / cell;
  const shade = [];
  for (let i = 0; i < cells * cells; i++) shade.push(208 + Math.floor(rand() * 40));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const lx = x % cell;
      const ly = y % cell;
      let v = shade[cy * cells + cx] + (rand() - 0.5) * 7;
      // Half of the panels get an extra seam across the middle.
      const split = shade[cy * cells + cx] % 2 === 0;
      if (lx === 0 || ly === 0) v = 138;
      else if (lx === 1 || ly === 1) v += 10;
      else if (split && ly === cell / 2) v = 168;
      const rivet = (lx === 4 || lx === cell - 4) && (ly === 4 || ly === cell - 4);
      if (rivet) v = 150;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
      data[i + 3] = 255;
    }
  }
  return finish(data, size);
}

/** Photovoltaic cells: blue cells, silver gaps, fine busbars. */
export function createSolarTexture(seed = 23) {
  const size = 256;
  const cellW = 64;
  const cellH = 32;
  const rand = mulberry32(seed);
  const data = new Uint8Array(size * size * 4);
  const cols = size / cellW;
  const rows = size / cellH;
  const tint = [];
  for (let i = 0; i < cols * rows; i++) tint.push(0.82 + rand() * 0.36);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const lx = x % cellW;
      const ly = y % cellH;
      const t = tint[Math.floor(y / cellH) * cols + Math.floor(x / cellW)];
      let r = 16 * t;
      let g = 34 * t;
      let b = 92 * t;
      // Soft sheen across each cell.
      const sheen = 1 + 0.25 * (ly / cellH);
      r *= sheen;
      g *= sheen;
      b *= sheen;
      if (lx < 2 || ly < 2) {
        r = 150;
        g = 158;
        b = 172;
      } else if (ly % 8 === 5) {
        r = 70;
        g = 92;
        b = 150;
      } else if (lx % 16 === 9) {
        r += 16;
        g += 22;
        b += 34;
      }
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, r);
      data[i + 1] = Math.min(255, g);
      data[i + 2] = Math.min(255, b);
      data[i + 3] = 255;
    }
  }
  return finish(data, size);
}
