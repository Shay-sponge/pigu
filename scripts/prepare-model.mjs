import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BufferGeometry, Float32BufferAttribute, MathUtils, Triangle } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { LoopSubdivision } from 'three-subdivide';

const commit = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const root = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${commit}/`;
const targets = [
  ['macrodetails/caucasian-female-young.target', 0.5],
  ['macrodetails/asian-female-young.target', 0.5],
  ['macrodetails/universal-female-young-averagemuscle-averageweight.target', 0.88],
  ['macrodetails/universal-female-young-averagemuscle-maxweight.target', 0.12],
  ['buttocks/buttocks-volume-incr.target', 0.32],
  ['hip/hip-scale-horiz-incr.target', 0.08],
];
const gluteShape = {
  revision: 'anatomical-continuous-v5',
  method: 'Adult anatomical topology, restrained morphs, no primitive volume union',
  subdivision: 3,
  posteriorScale: 1.10,
  stanceInward: 0.08,
  lower: -1.48, upper: 1.85,
};
await mkdir('.cache/model', { recursive: true });
await mkdir('public/models', { recursive: true });
await mkdir('public/licenses', { recursive: true });
async function asset(path) {
  const filename = `.cache/model/${path.replaceAll('/', '_')}`;
  try { return await readFile(filename, 'utf8'); } catch {}
  const response = await fetch(root + path);
  if (!response.ok) throw new Error(`Asset ${path}: ${response.status}`);
  const text = await response.text();
  await writeFile(filename, text);
  return text;
}

const original = await asset('makehuman/data/3dobjs/base.obj');
const lines = original.split('\n');
const vertices = lines.filter(l => l.startsWith('v ')).map(l => l.trim().split(/\s+/).slice(1).map(Number));
for (const [target, weight] of targets) {
  const text = await asset(`makehuman/data/targets/${target}`);
  for (const line of text.split('\n')) {
    if (!/^\d+\s/.test(line)) continue;
    const [i, x, y, z] = line.trim().split(/\s+/).map(Number);
    vertices[i][0] += x * weight;
    vertices[i][1] += y * weight;
    vertices[i][2] += z * weight;
  }
}
let index = 0;
const obj = lines.map(l => l.startsWith('v ') ? `v ${vertices[index++].join(' ')}` : l).join('\n');
const body = new OBJLoader().parse(obj).getObjectByName('body');
if (!body) throw new Error('Missing MakeHuman body mesh');
const pos = body.geometry.attributes.position;
const uv = body.geometry.attributes.uv;
const cropped = [], texcoords = [];
for (let i = 0; i < pos.count; i += 3) {
  const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
  const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
  if (y < -3.8 || y > 2.7 || Math.abs(x) > 2.65) continue;
  for (let j = i; j < i + 3; j++) {
    let px = -pos.getX(j) * 0.72;
    const py = (pos.getY(j) + 0.8) * 0.72;
    let pz = -pos.getZ(j) * 0.72;
    // Gentle coordinate changes preserve the native curvature and anatomical
    // folds; no local lump, medial bridge or spherical reconstruction.
    pz *= 1 + (gluteShape.posteriorScale - 1) * MathUtils.smootherstep(pz, -0.06, 0.28);
    px -= Math.tanh(px / 0.24) * gluteShape.stanceInward
      * (1 - MathUtils.smootherstep(py, -0.65, 0.12));
    cropped.push(px, py, pz);
    texcoords.push(uv.getX(j), uv.getY(j));
  }
}
const base = new BufferGeometry();
base.setAttribute('position', new Float32BufferAttribute(cropped, 3));
base.setAttribute('uv', new Float32BufferAttribute(texcoords, 2));
base.computeVertexNormals();
base.deleteAttribute('uv');
base.deleteAttribute('normal');
const subdivision = LoopSubdivision.modify(mergeVertices(base, 1e-6), gluteShape.subdivision, {
  split: false, uvSmooth: true, preserveEdges: false, flatOnly: false, maxTriangles: 180000,
});
// Keep the anatomical surface flow through sacrum, gluteal fold and thighs.
// Subdivision smooths that topology without replacing the pelvis with spheres.
subdivision.deleteAttribute('normal');
subdivision.deleteAttribute('uv');
const subdivided = mergeVertices(subdivision, 1e-6);
subdivided.computeVertexNormals();
const triangles = subdivided.index ? subdivided.toNonIndexed() : subdivided;
const triangle = new Triangle();
const { lower, upper } = gluteShape;
const clipped = [], clippedUV = [], top = [], bottomLeft = [], bottomRight = [];
function clip(poly, height, above) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = above ? a[1] >= height : a[1] <= height;
    const bin = above ? b[1] >= height : b[1] <= height;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (height - a[1]) / (b[1] - a[1]);
      const p = a.map((v, k) => v + t * (b[k] - v));
      p[1] = height;
      out.push(p);
    }
  }
  return out;
}
const tp = triangles.attributes.position;
for (let i = 0; i < tp.count; i += 3) {
  let poly = [0, 1, 2].map(j => [
    tp.getX(i+j), tp.getY(i+j), tp.getZ(i+j), tp.getX(i+j) / 3 + 0.5, tp.getY(i+j) / 4 + 0.5,
  ]);
  poly = clip(clip(poly, lower, true), upper, false);
  for (const p of poly) {
    if (Math.abs(p[1] - upper) < 1e-5) top.push(p.slice(0, 3));
    if (Math.abs(p[1] - lower) < 1e-5) (p[0] < 0 ? bottomLeft : bottomRight).push(p.slice(0, 3));
  }
  for (let j = 1; j < poly.length - 1; j++) {
    for (const p of [poly[0], poly[j], poly[j+1]]) {
      clipped.push(...p.slice(0, 3));
      clippedUV.push(...p.slice(3, 5));
    }
  }
}
const geometry = new BufferGeometry();
geometry.setAttribute('position', new Float32BufferAttribute(clipped, 3));
geometry.setAttribute('uv', new Float32BufferAttribute(clippedUV, 2));
const finalGeometry = mergeVertices(geometry, 1e-6);
const validIndices = [];
const fp = finalGeometry.attributes.position, fi = finalGeometry.index;
for (let i = 0; i < fi.count; i += 3) {
  triangle.a.fromBufferAttribute(fp, fi.getX(i));
  triangle.b.fromBufferAttribute(fp, fi.getX(i + 1));
  triangle.c.fromBufferAttribute(fp, fi.getX(i + 2));
  if (triangle.getArea() > 1e-14) validIndices.push(fi.getX(i), fi.getX(i + 1), fi.getX(i + 2));
}
finalGeometry.setIndex(validIndices);
finalGeometry.computeVertexNormals();
finalGeometry.normalizeNormals();
finalGeometry.computeBoundingBox();
const caps = [];
for (const points of [top, bottomLeft, bottomRight]) {
  const unique = [...new Map(points.map(p => [p.map(n => n.toFixed(5)).join(','), p])).values()];
  const center = [0, 1, 2].map(i => unique.reduce((s, p) => s + p[i], 0) / unique.length);
  unique.sort((a, b) => Math.atan2(a[2] - center[2], a[0] - center[0]) - Math.atan2(b[2] - center[2], b[0] - center[0]));
  for (let i = 0; i < unique.length; i++) {
    const a = unique[i], b = unique[(i + 1) % unique.length];
    caps.push(...center, ...(points === top ? b : a), ...(points === top ? a : b));
  }
}
const capGeometry = new BufferGeometry();
capGeometry.setAttribute('position', new Float32BufferAttribute(caps, 3));
capGeometry.computeVertexNormals();
function compact(g) {
  // Omit Three.js's random UUID so identical inputs produce identical assets.
  return JSON.stringify(g.toJSON(), (key, value) => key === 'uuid' ? undefined
    : typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(8)) : value);
}
await writeFile('public/models/adult-torso.json', compact(finalGeometry));
await writeFile('public/models/torso-caps.json', compact(capGeometry));
await writeFile('public/licenses/MakeHuman-CC0.txt', await asset('LICENSE.ASSETS.md'));
const manifest = {
  source: 'MakeHuman community CC0 hm08 base mesh and adult female morph targets',
  sourceCommit: commit,
  baseSHA256: createHash('sha256').update(original).digest('hex'),
  targets, adultAgeBasis: 'MakeHuman young-adult morph (25 years); no child morphs',
  gluteShape,
  modelSHA256: createHash('sha256').update(compact(finalGeometry)).digest('hex'),
  vertices: finalGeometry.attributes.position.count,
  triangles: finalGeometry.index.count / 3,
  bounds: finalGeometry.boundingBox,
};
await writeFile('public/models/manifest.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
