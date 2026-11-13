import { BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, Mesh, Vector3 } from 'three';

const IDENTITY = new Matrix4();
const _color = new Color();
const _v = new Vector3();
const _normalMatrix = new Matrix3();

/**
 * Collects many small geometry "pieces" and merges them into one mesh per
 * (node, material) pair. A node is an Object3D that moves as a unit, so
 * animated assemblies stay independent while everything that shares a node
 * and a material becomes a single draw call.
 *
 * Each merged mesh records which index ranges belong to which part, so
 * picking and highlighting still work per part after merging.
 */
export class Batcher {
  constructor() {
    this.pieces = [];
  }

  add(geometry, { node, material, part = null, color = 0xffffff, intensity = 1, matrix = IDENTITY, uvScale = null }) {
    this.pieces.push({ geometry, node, material, part, color, intensity, matrix, uvScale });
    return this;
  }

  get pieceCount() {
    return this.pieces.length;
  }

  build() {
    const byNode = new Map();
    for (const piece of this.pieces) {
      let byMaterial = byNode.get(piece.node);
      if (!byMaterial) byNode.set(piece.node, (byMaterial = new Map()));
      let bucket = byMaterial.get(piece.material);
      if (!bucket) byMaterial.set(piece.material, (bucket = []));
      bucket.push(piece);
    }

    const meshes = [];
    for (const [node, byMaterial] of byNode) {
      for (const [material, pieces] of byMaterial) {
        const mesh = mergePieces(pieces, material);
        mesh.name = `${node.name}:${material.name}`;
        node.add(mesh);
        meshes.push(mesh);
      }
    }
    for (const piece of this.pieces) piece.geometry.dispose();
    this.pieces = [];
    return meshes;
  }
}

function mergePieces(pieces, material) {
  // Keep each part's triangles contiguous so a part is one index range.
  const order = new Map();
  for (const p of pieces) if (!order.has(p.part)) order.set(p.part, order.size);
  const sorted = pieces
    .map((p, i) => [p, i])
    .sort((a, b) => order.get(a[0].part) - order.get(b[0].part) || a[1] - b[1])
    .map(([p]) => p);

  let vertexCount = 0;
  let indexCount = 0;
  for (const { geometry } of sorted) {
    const count = geometry.attributes.position.count;
    vertexCount += count;
    indexCount += geometry.index ? geometry.index.count : count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const ranges = [];

  let vOffset = 0;
  let iOffset = 0;
  for (const piece of sorted) {
    const { geometry, matrix, uvScale } = piece;
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const count = pos.count;
    _normalMatrix.getNormalMatrix(matrix);
    _color.set(piece.color);
    const r = _color.r * piece.intensity;
    const g = _color.g * piece.intensity;
    const b = _color.b * piece.intensity;
    const su = uvScale ? uvScale[0] : 1;
    const sv = uvScale ? uvScale[1] : 1;

    for (let i = 0; i < count; i++) {
      const v3 = (vOffset + i) * 3;
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      positions[v3] = _v.x;
      positions[v3 + 1] = _v.y;
      positions[v3 + 2] = _v.z;
      if (nor) {
        _v.fromBufferAttribute(nor, i).applyMatrix3(_normalMatrix).normalize();
        normals[v3] = _v.x;
        normals[v3 + 1] = _v.y;
        normals[v3 + 2] = _v.z;
      }
      colors[v3] = r;
      colors[v3 + 1] = g;
      colors[v3 + 2] = b;
      if (uv) {
        const v2 = (vOffset + i) * 2;
        uvs[v2] = uv.getX(i) * su;
        uvs[v2 + 1] = uv.getY(i) * sv;
      }
    }

    // A mirrored matrix flips triangle winding; swap two corners to undo it.
    const flip = matrix.determinant() < 0;
    const src = geometry.index;
    const n = src ? src.count : count;
    for (let i = 0; i < n; i += 3) {
      const a = (src ? src.getX(i) : i) + vOffset;
      const b2 = (src ? src.getX(i + 1) : i + 1) + vOffset;
      const c = (src ? src.getX(i + 2) : i + 2) + vOffset;
      indices[iOffset + i] = a;
      indices[iOffset + i + 1] = flip ? c : b2;
      indices[iOffset + i + 2] = flip ? b2 : c;
    }

    const last = ranges[ranges.length - 1];
    if (last && last.part === piece.part) last.count += n;
    else ranges.push({ part: piece.part, start: iOffset, count: n });

    vOffset += count;
    iOffset += n;
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(positions, 3));
  merged.setAttribute('normal', new BufferAttribute(normals, 3));
  merged.setAttribute('uv', new BufferAttribute(uvs, 2));
  merged.setAttribute('color', new BufferAttribute(colors, 3));
  merged.setIndex(new BufferAttribute(indices, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const mesh = new Mesh(merged, material);
  mesh.userData.batched = true;
  mesh.userData.pieceCount = sorted.length;
  mesh.userData.ranges = ranges;
  return mesh;
}

/** Which part owns the triangle that a raycast hit? */
export function partAt(mesh, faceIndex) {
  const ranges = mesh.userData.ranges;
  if (!ranges || faceIndex == null) return null;
  const index = faceIndex * 3;
  for (const range of ranges) {
    if (index >= range.start && index < range.start + range.count) return range.part;
  }
  return null;
}
