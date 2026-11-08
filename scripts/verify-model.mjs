import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BufferGeometryLoader, Triangle, Vector3 } from 'three';

const manifest = JSON.parse(readFileSync('public/models/manifest.json'));
const bytes = readFileSync('public/models/adult-torso.json');
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.modelSHA256);
const body = new BufferGeometryLoader().parse(JSON.parse(bytes));
const p = body.attributes.position, n = body.attributes.normal, index = body.index.array;
const triangle = new Triangle(), faceNormal = new Vector3(), averageNormal = new Vector3();
assert(p.array.every(Number.isFinite) && n.array.every(Number.isFinite));
const edges = new Map(), adjacent = Array.from({ length: p.count }, () => []);
for (let i = 0; i < index.length; i += 3) {
  const [a, b, c] = index.slice(i, i + 3);
  triangle.setFromAttributeAndIndices(p, a, b, c);
  assert(triangle.getArea() > 1e-12, 'nondegenerate triangles');
  triangle.getNormal(faceNormal);
  averageNormal.set(0, 0, 0);
  for (const j of [a, b, c]) averageNormal.add(new Vector3().fromBufferAttribute(n, j));
  assert(faceNormal.dot(averageNormal) > 0, 'outward consistent normals');
  for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
    adjacent[u].push(v); adjacent[v].push(u);
  }
}
const seen = new Set(), pending = [index[0]];
while (pending.length) {
  const i = pending.pop();
  if (seen.has(i)) continue;
  seen.add(i);
  for (const j of adjacent[i]) if (!seen.has(j)) pending.push(j);
}
assert.equal(seen.size, p.count, 'one connected anatomical surface');
const boundaries = [];
for (const [key, count] of edges) {
  assert(count <= 2, 'no nonmanifold edges');
  if (count !== 1) continue;
  const endpoints = key.split(',').map(Number);
  for (const i of endpoints) assert(Math.min(
    Math.abs(p.getY(i) - manifest.gluteShape.upper),
    Math.abs(p.getY(i) - manifest.gluteShape.lower)) < 1e-6, 'only intended torso and thigh cuts');
  boundaries.push(key);
}
assert(p.count < 80000, 'web mesh keeps shared vertices within the render budget');
console.log(JSON.stringify({ passed: true, vertices: p.count, triangles: index.length / 3,
  components: 1, boundaryEdges: boundaries.length, modelSHA256: manifest.modelSHA256 }, null, 2));
