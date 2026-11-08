import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BufferGeometryLoader, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';

// Exercise the shipped source against the actual generated mesh in Node.
// Transpile in memory; no alternate physics implementation or test geometry.
const source = readFileSync(new URL('../src/physics.ts', import.meta.url), 'utf8');
let javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
for (const name of ['three', 'cannon-es']) javascript = javascript.replace(`from '${name}'`, `from '${import.meta.resolve(name)}'`);
const { TissuePhysics } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const model = JSON.parse(readFileSync(new URL('../public/models/adult-torso.json', import.meta.url), 'utf8'));
const geometry = new BufferGeometryLoader().parse(model);
const rest = new Float32Array(geometry.attributes.position.array);
const mesh = new Mesh(geometry, new MeshBasicMaterial());
mesh.updateMatrixWorld();
const hit = new Raycaster(new Vector3(0.56, 0.28, 3), new Vector3(0, 0, -1)).intersectObject(mesh)[0];
assert(hit, 'posterior contact exists on the generated mesh');
const normal = hit.normal ?? hit.face.normal;
function fixture() {
  const g = geometry.clone();
  return { g, tissue: new TissuePhysics(g) };
}
function advance(tissue, frames, dt = 1 / 120) { for (let i = 0; i < frames; i++) tissue.step(dt); }
function displacement(g, i) { return new Vector3().fromBufferAttribute(g.attributes.position, i).sub(new Vector3().fromArray(rest, i * 3)); }
function nearest(point) {
  let index = 0, distance = Infinity;
  for (let i = 0; i < rest.length; i += 3) {
    const d = new Vector3().fromArray(rest, i).distanceToSquared(point);
    if (d < distance) { index = i / 3; distance = d; }
  }
  return index;
}
function restored(g, tissue) {
  assert.equal(tissue.maxDisplacement, 0, 'simulation settles');
  assert.deepEqual(g.attributes.position.array, rest, 'surface returns exactly to the generated round shape');
  assert.deepEqual(g.attributes.normal.array, geometry.attributes.normal.array, 'rest shading restored');
}
function noInversions(g) {
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), u = new Vector3(), v = new Vector3(), old = new Vector3();
  const p = g.attributes.position, indices = g.index.array;
  const reversed = [];
  for (let j = 0; j < indices.length; j += 3) {
    const [ia, ib, ic] = indices.slice(j, j + 3);
    a.fromArray(rest, ia * 3); b.fromArray(rest, ib * 3); c.fromArray(rest, ic * 3);
    old.copy(b).sub(a).cross(u.copy(c).sub(a));
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    v.copy(b).sub(a).cross(u.copy(c).sub(a));
    if (v.dot(old) < -1e-15) reversed.push({ indices: [ia, ib, ic],
      center: [a.x, a.y, a.z], oldArea: old.length() / 2, area: v.length() / 2, cosine: v.dot(old) / v.length() / old.length() });
  }
  assert.equal(reversed.length, 0, `deformation does not invert surface triangles: ${JSON.stringify(reversed.slice(0, 4))}`);
}
const core = nearest(hit.point), opposite = nearest(new Vector3(-0.56, 0.28, hit.point.z));
const results = [];
{
  const { g, tissue } = fixture();
  tissue.startGrab(hit.point, normal);
  advance(tissue, 48);
  const inward = -displacement(g, core).dot(normal);
  const remote = displacement(g, opposite).length();
  assert(inward > 0.055 && inward < 0.16, 'holding without dragging makes a bounded local indentation');
  assert(remote < inward * 0.18, 'opposite cheek is not displaced like the pressed cheek');
  let medial = 0, ringBulge = 0;
  for (let i = 0; i < rest.length / 3; i++) {
    if (Math.abs(rest[i * 3]) < 0.025) medial = Math.max(medial, displacement(g, i).length());
    const d = new Vector3().fromArray(rest, i * 3).sub(hit.point);
    if (d.length() > 0.38 && d.length() < 0.62 && rest[i * 3 + 2] > hit.point.z - 0.25) {
      ringBulge = Math.max(ringBulge, displacement(g, i).dot(normal));
    }
  }
  assert(medial < 0.000001, 'joined medial surface remains pinned');
  assert(ringBulge > 0.0005, 'compression has a surrounding outward volume cue');
  noInversions(g);
  const stationary = nearest(new Vector3(-0.8, 0.45, 0.95));
  const stationaryNormal = new Vector3().fromBufferAttribute(g.attributes.normal, stationary);
  const originalNormal = new Vector3().fromBufferAttribute(geometry.attributes.normal, stationary);
  assert(stationaryNormal.distanceTo(originalNormal) < 0.001, 'press does not replace stationary skin shading with triangulation artifacts');
  tissue.endGrab(); advance(tissue, 48);
  assert(tissue.maxDisplacement < 0.004, 'released press recovers geometrically');
  assert(new Vector3().fromBufferAttribute(g.attributes.normal, core)
    .distanceTo(new Vector3().fromBufferAttribute(geometry.attributes.normal, core)) < 0.03,
  'recovered contact has no residual dent shading');
  advance(tissue, 192);
  restored(g, tissue);
  results.push({ test: 'local press / joined seam / compensating bulge / release', inward, remote, medial, ringBulge });
}
{
  const { g, tissue } = fixture();
  tissue.hit(hit.point, 0.65, new Vector3(0.2, 0.1, 0), normal);
  let peak = 0, indentation = 0, settlingTime = null;
  for (let frame = 0; frame < 180; frame++) {
    tissue.step(1 / 120);
    peak = Math.max(peak, tissue.maxDisplacement);
    indentation = Math.max(indentation, tissue.skinIndentation);
    if (frame === 4) assert(displacement(g, core).dot(normal) < -0.02, 'slap follows the contacted inward normal');
    if (frame > 10 && settlingTime === null && tissue.maxDisplacement < 0.004 && tissue.energy < 0.00001) settlingTime = (frame + 1) / 120;
  }
  assert(peak > 0.05 && peak < 0.2 && indentation > 0.04, 'impact combines bounded skin and muscle deformation');
  assert(settlingTime !== null && settlingTime < 0.9, 'default impact recovers promptly instead of persistent jelly wobble');
  restored(g, tissue);
  results.push({ test: 'normal-directed impact / default recovery', peak, indentation, settlingTime });
}
const corners = [];
for (const softness of [0, 1]) for (const bounce of [0, 1]) {
  const { g, tissue } = fixture();
  tissue.configure(softness, bounce);
  tissue.startGrab(hit.point, normal);
  tissue.moveGrab(hit.point.clone().add(new Vector3(10, -9, 8)));
  advance(tissue, 60);
  corners.push({ softness, bounce, heldDisplacement: tissue.maxDisplacement });
  assert(tissue.maxDisplacement < 0.3, 'extreme drag remains bounded at every parameter corner');
  assert(g.attributes.position.array.every(Number.isFinite), 'all positions remain finite');
  noInversions(g);
  tissue.endGrab(); advance(tissue, 300); restored(g, tissue);
}
results.push({ test: 'four parameter extremes / drag bounds / no inverted triangles / recovery', passed: true, corners });
{
  const { g, tissue } = fixture();
  tissue.configure(1, 1);
  let peak = 0;
  for (let i = 0; i < 24; i++) {
    tissue.hit(hit.point, 1, new Vector3(), normal);
    advance(tissue, 2);
    peak = Math.max(peak, tissue.maxDisplacement);
    noInversions(g);
  }
  assert(peak < 0.3, 'repeated taps at one point do not stack unbounded dents');
  advance(tissue, 300); restored(g, tissue);
  results.push({ test: '24 rapid taps at the same point / no inverted triangles / recovery', peak });
}
{
  const a = fixture(), b = fixture();
  for (const { tissue } of [a, b]) tissue.hit(hit.point, 0.65, new Vector3(), normal);
  advance(a.tissue, 18); advance(b.tissue, 9, 1 / 60);
  let error = 0;
  for (let i = 0; i < rest.length; i++) error = Math.max(error, Math.abs(a.g.attributes.position.array[i] - b.g.attributes.position.array[i]));
  assert(error < 0.00001, 'equal elapsed time gives the same fixed-step deformation at 60 and 120 frames');
  a.tissue.reset(); restored(a.g, a.tissue);
  results.push({ test: 'frame-rate independence / reset', error });
}
console.log(JSON.stringify({ passed: true, results }, null, 2));
