import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { LoopSubdivision } from 'three-subdivide';

const commit = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const root = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${commit}/`;
const targets = [
  ['macrodetails/caucasian-female-young.target', 0.5],
  ['macrodetails/asian-female-young.target', 0.5],
  ['macrodetails/universal-female-young-averagemuscle-averageweight.target', 0.78],
  ['macrodetails/universal-female-young-averagemuscle-maxweight.target', 0.22],
  ['buttocks/buttocks-volume-incr.target', 0.7],
  ['hip/hip-scale-horiz-incr.target', 0.16],
];
const upperGlute = { centerY: 0.56, depth: 0.26, width: 0.035, lift: 0.06 };
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
  if (y < -3.8 || y > 1.8 || Math.abs(x) > 2.65) continue;
  for (let j = i; j < i + 3; j++) {
    let px = -pos.getX(j) * 0.72;
    let py = (pos.getY(j) + 0.8) * 0.72;
    let pz = -pos.getZ(j) * 0.72;
    const rear = MathUtils.smoothstep(pz, -0.05, 0.42);
    const fullness = Math.exp(-((Math.abs(px) - 0.57) ** 2 / 0.2 + (py - 0.08) ** 2 / 0.3));
    // Round the upper cheeks while anchoring the cleft, waist, and lower fold.
    const upper = rear * MathUtils.smoothstep(Math.abs(px), 0.04, 0.25)
      * MathUtils.smoothstep(py, -0.25, 0.1) * (1 - MathUtils.smoothstep(py, 0.88, 1.28))
      * Math.exp(-((Math.abs(px) - 0.57) ** 2 / 0.26 + (py - upperGlute.centerY) ** 2 / 0.22));
    pz += rear * fullness * 0.27;
    px += Math.sign(px) * rear * fullness * 0.035;
    pz += upper * upperGlute.depth;
    px += Math.sign(px) * upper * upperGlute.width;
    py += upper * upperGlute.lift;
    cropped.push(px, py, pz);
    texcoords.push(uv.getX(j), uv.getY(j));
  }
}
const base = new BufferGeometry();
base.setAttribute('position', new Float32BufferAttribute(cropped, 3));
base.setAttribute('uv', new Float32BufferAttribute(texcoords, 2));
base.computeVertexNormals();
const subdivided = LoopSubdivision.modify(mergeVertices(base), 3, {
  split: false, uvSmooth: true, preserveEdges: false, flatOnly: false, maxTriangles: 180000,
});
const triangles = subdivided.index ? subdivided.toNonIndexed() : subdivided;
const lower = -1.48, upper = 1.43;
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
const tp = triangles.attributes.position, tu = triangles.attributes.uv;
for (let i = 0; i < tp.count; i += 3) {
  let poly = [0, 1, 2].map(j => [tp.getX(i+j), tp.getY(i+j), tp.getZ(i+j), tu.getX(i+j), tu.getY(i+j)]);
  poly = clip(clip(poly, lower, true), upper, false);
  for (const p of poly) {
    if (Math.abs(p[1] - upper) < 1e-5) top.push(p.slice(0, 3));
    if (Math.abs(p[1] - lower) < 1e-5) (p[0] < 0 ? bottomLeft : bottomRight).push(p.slice(0, 3));
  }
  for (let j = 1; j < poly.length - 1; j++) {
    for (const p of [poly[0], poly[j], poly[j+1]]) {
      clipped.push(...p.slice(0, 3));
      clippedUV.push(...p.slice(3));
    }
  }
}
const geometry = new BufferGeometry();
geometry.setAttribute('position', new Float32BufferAttribute(clipped, 3));
geometry.setAttribute('uv', new Float32BufferAttribute(clippedUV, 2));
const finalGeometry = mergeVertices(geometry, 1e-5);
finalGeometry.computeVertexNormals();
finalGeometry.computeBoundingBox();
const caps = [];
for (const points of [top, bottomLeft, bottomRight]) {
  const unique = [...new Map(points.map(p => [p.map(n => n.toFixed(5)).join(','), p])).values()];
  const center = [0, 1, 2].map(i => unique.reduce((s, p) => s + p[i], 0) / unique.length);
  unique.sort((a, b) => Math.atan2(a[2] - center[2], a[0] - center[0]) - Math.atan2(b[2] - center[2], b[0] - center[0]));
  for (let i = 0; i < unique.length; i++) {
    caps.push(...center, ...unique[i], ...unique[(i + 1) % unique.length]);
  }
}
const capGeometry = new BufferGeometry();
capGeometry.setAttribute('position', new Float32BufferAttribute(caps, 3));
capGeometry.computeVertexNormals();
function compact(g) {
  return JSON.stringify(g.toJSON(), (_key, value) => typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(6)) : value);
}
await writeFile('public/models/adult-torso.json', compact(finalGeometry));
await writeFile('public/models/torso-caps.json', compact(capGeometry));
await writeFile('public/licenses/MakeHuman-CC0.txt', await asset('LICENSE.ASSETS.md'));
const manifest = {
  source: 'MakeHuman community CC0 hm08 base mesh and adult female morph targets',
  sourceCommit: commit,
  baseSHA256: createHash('sha256').update(original).digest('hex'),
  targets, adultAgeBasis: 'MakeHuman young-adult morph (25 years); no child morphs',
  upperGlute,
  modelSHA256: createHash('sha256').update(compact(finalGeometry)).digest('hex'),
  vertices: finalGeometry.attributes.position.count,
  triangles: finalGeometry.index.count / 3,
  bounds: finalGeometry.boundingBox,
};
await writeFile('public/models/manifest.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
