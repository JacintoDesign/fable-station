import { BoxGeometry, Group, Matrix4, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { Batcher, partAt } from '../src/batcher.js';
import { PARTS } from '../src/data.js';
import { buildStation, RING_SPIN } from '../src/station.js';

const station = buildStation();
const { nodes, meshes, root } = station;
const meshesIn = (node) => meshes.filter((mesh) => mesh.parent === node);
const names = (list) => list.map((mesh) => mesh.name).sort();

describe('station batching', () => {
  it('merges hundreds of pieces into a handful of draw calls', () => {
    // Every mesh has exactly one material, so one mesh is one draw call.
    for (const mesh of meshes) expect(Array.isArray(mesh.material)).toBe(false);
    expect(station.pieceCount).toBeGreaterThan(900);
    expect(meshes.length).toBeLessThanOrEqual(12);

    // Nothing renderable exists outside the batched list.
    const found = [];
    root.traverse((object) => object.isMesh && found.push(object));
    expect(found.length).toBe(meshes.length);
  });

  it('draws all static structure with one mesh per material', () => {
    expect(names(meshesIn(nodes.core))).toEqual(['core:glow', 'core:hull', 'core:solar']);
    const pieces = meshesIn(nodes.core).reduce((sum, mesh) => sum + mesh.userData.pieceCount, 0);
    expect(pieces).toBeGreaterThan(400);
  });

  it('never creates two meshes for the same node and material', () => {
    const seen = new Set();
    for (const mesh of meshes) {
      const key = `${mesh.parent.uuid}|${mesh.material.uuid}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('keeps each animated assembly in a node of its own', () => {
    expect(names(meshesIn(nodes.ring))).toEqual(['ring:glow', 'ring:hull']);
    expect(names(meshesIn(nodes.dish))).toEqual(['dish:hull']);
    expect(names(meshesIn(nodes.rotor))).toEqual(['rotor:hull']);
    expect(names(meshesIn(nodes.ship))).toEqual(['ship:glow', 'ship:hull']);
    expect(names(meshesIn(nodes.beacons))).toEqual(['beacons:beacon']);
    const animated = [nodes.ring, nodes.dish, nodes.rotor, nodes.ship];
    expect(new Set(animated).size).toBe(4);
    for (const node of animated) expect(node).not.toBe(nodes.core);
  });

  it('moves animated nodes without touching the static batch', () => {
    const snapshot = (node) => node.matrix.clone();
    station.update(0, 0);
    root.updateMatrixWorld(true);
    const before = Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, snapshot(node)]));
    const corePositions = meshesIn(nodes.core).map((mesh) => mesh.geometry.attributes.position.version);

    station.update(10, 10);
    root.updateMatrixWorld(true);
    expect(nodes.ring.rotation.y).toBeCloseTo(10 * RING_SPIN);
    for (const name of ['ring', 'dish', 'rotor', 'ship']) {
      expect(nodes[name].matrix.equals(before[name])).toBe(false);
    }
    expect(nodes.core.matrix.equals(before.core)).toBe(true);
    // Animation moves nodes; it never rewrites merged vertex data.
    expect(meshesIn(nodes.core).map((mesh) => mesh.geometry.attributes.position.version)).toEqual(corePositions);
    station.update(0, 0);
  });

  it('produces valid merged geometry with part ranges that tile the index buffer', () => {
    for (const mesh of meshes) {
      const { index, attributes } = mesh.geometry;
      const vertexCount = attributes.position.count;
      expect(index.count % 3).toBe(0);
      let max = 0;
      for (let i = 0; i < index.count; i++) max = Math.max(max, index.getX(i));
      expect(max).toBeLessThan(vertexCount);
      for (const value of attributes.position.array) expect(Number.isFinite(value)).toBe(true);

      let cursor = 0;
      for (const range of mesh.userData.ranges) {
        expect(range.start).toBe(cursor);
        expect(range.count).toBeGreaterThan(0);
        cursor += range.count;
      }
      expect(cursor).toBe(index.count);
    }
  });

  it('keeps every part selectable after merging', () => {
    const parts = new Set();
    for (const mesh of meshes) {
      const seenHere = new Set();
      for (const range of mesh.userData.ranges) {
        if (range.part === null) continue;
        // A part is one contiguous range per mesh, so it can be highlighted with a draw range.
        expect(seenHere.has(range.part)).toBe(false);
        seenHere.add(range.part);
        parts.add(range.part);
        expect(partAt(mesh, range.start / 3)).toBe(range.part);
        expect(partAt(mesh, (range.start + range.count) / 3 - 1)).toBe(range.part);
      }
    }
    expect([...parts].sort()).toEqual([...station.partIds].sort());
    for (const part of parts) expect(PARTS[part], `info for ${part}`).toBeDefined();
    expect([...parts].filter((part) => part.startsWith('solar-')).length).toBe(12);
  });
});

describe('Batcher', () => {
  it('merges by node and material and bakes transforms into vertices', () => {
    const a = new Group();
    const b = new Group();
    const red = new MeshBasicMaterial();
    const blue = new MeshBasicMaterial();
    const batcher = new Batcher();
    batcher.add(new BoxGeometry(1, 1, 1), { node: a, material: red, part: 'one' });
    batcher.add(new BoxGeometry(1, 1, 1), { node: a, material: blue, part: 'one' });
    batcher.add(new BoxGeometry(1, 1, 1), { node: a, material: red, part: 'two', matrix: new Matrix4().makeTranslation(10, 0, 0) });
    batcher.add(new BoxGeometry(1, 1, 1), { node: b, material: red, part: 'two' });
    batcher.add(new BoxGeometry(1, 1, 1), { node: a, material: red, part: 'one' });
    const meshes = batcher.build();

    expect(meshes.length).toBe(3);
    const merged = meshes.find((mesh) => mesh.parent === a && mesh.material === red);
    expect(merged.userData.pieceCount).toBe(3);
    expect(merged.geometry.index.count).toBe(36 * 3);
    // Pieces are regrouped so that 'one' is a single range even though it was added around 'two'.
    expect(merged.userData.ranges).toEqual([
      { part: 'one', start: 0, count: 72 },
      { part: 'two', start: 72, count: 36 },
    ]);
    expect(merged.geometry.boundingBox.max.x).toBeCloseTo(10.5);
  });

  it('keeps triangles facing outward under a mirrored transform', () => {
    const node = new Group();
    const batcher = new Batcher();
    batcher.add(new BoxGeometry(1, 1, 1), { node, material: new MeshBasicMaterial(), matrix: new Matrix4().makeScale(-1, 1, 1) });
    const [mesh] = batcher.build();
    const { position, normal } = mesh.geometry.attributes;
    const index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const ab = [position.getX(b) - position.getX(a), position.getY(b) - position.getY(a), position.getZ(b) - position.getZ(a)];
      const ac = [position.getX(c) - position.getX(a), position.getY(c) - position.getY(a), position.getZ(c) - position.getZ(a)];
      const face = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const dot = face[0] * normal.getX(a) + face[1] * normal.getY(a) + face[2] * normal.getZ(a);
      expect(dot).toBeGreaterThan(0);
    }
  });
});
