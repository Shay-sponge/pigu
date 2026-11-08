import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { BufferGeometryLoader, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';

const approvedHash = 'edbce69fd80a0e23bd2dc7ea96c2303ff7c96928ed51ccacf7bbb5e97ed628e6';
const bytes = readFileSync(new URL('../public/models/adult-torso.json', import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), approvedHash, 'user-approved model remains unchanged');
const source = readFileSync(new URL('../src/physics.ts', import.meta.url), 'utf8');
let javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
for (const name of ['three', 'cannon-es']) javascript = javascript.replace(`from '${name}'`, `from '${import.meta.resolve(name)}'`);
const { TissuePhysics } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const geometry = new BufferGeometryLoader().parse(JSON.parse(bytes));
const rest = new Float32Array(geometry.attributes.position.array);
const mesh = new Mesh(geometry, new MeshBasicMaterial());
mesh.updateMatrixWorld();
const hit = new Raycaster(new Vector3(0.56, 0.28, 3), new Vector3(0, 0, -1)).intersectObject(mesh)[0];
assert(hit);
const normal = (hit.normal ?? hit.face.normal).clone().normalize();
const across = new Vector3(1, 0, 0).addScaledVector(normal, -normal.x).normalize();
const along = new Vector3().crossVectors(normal, across).normalize();
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
  assert.equal(tissue.maxDisplacement, 0, 'recovery settles');
  assert.deepEqual(g.attributes.position.array, rest, 'exact restoration of approved geometry');
  assert.deepEqual(g.attributes.normal.array, geometry.attributes.normal.array, 'exact restoration of shading');
}
function noInversions(g) {
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), u = new Vector3(), v = new Vector3(), old = new Vector3();
  const p = g.attributes.position, indices = g.index.array;
  let reversed = 0;
  for (let j = 0; j < indices.length; j += 3) {
    const [ia, ib, ic] = indices.slice(j, j + 3);
    a.fromArray(rest, ia * 3); b.fromArray(rest, ib * 3); c.fromArray(rest, ic * 3);
    old.copy(b).sub(a).cross(u.copy(c).sub(a));
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    v.copy(b).sub(a).cross(u.copy(c).sub(a));
    if (v.dot(old) < -1e-15) reversed++;
  }
  assert.equal(reversed, 0, 'no inverted surface triangles');
}
const core = nearest(hit.point), opposite = nearest(new Vector3(-0.56, 0.28, hit.point.z));
const results = [];
{
  const { g, tissue } = fixture();
  tissue.startGrab(hit.point, normal, across);
  advance(tissue, 12);
  const earlyFold = displacement(g, core).dot(normal);
  advance(tissue, 108);
  const fold = displacement(g, core).dot(normal);
  const pads = [-1, 1].map(side => displacement(g, nearest(hit.point.clone().addScaledVector(across, side * 0.13))).dot(normal));
  const alongFold = displacement(g, nearest(hit.point.clone().addScaledVector(along, 0.11))).dot(normal);
  const acrossFold = displacement(g, nearest(hit.point.clone().addScaledVector(across, 0.11))).dot(normal);
  assert(fold > 0.012 && fold < 0.035, 'pinch raises a modest fold, not a spherical depression');
  assert(pads.every(d => d < 0 && d > -0.012), 'both finger contacts remain shallow');
  assert(alongFold > 0 && alongFold > acrossFold, 'fold is elongated rather than radially symmetric');
  assert(fold > earlyFold && fold < earlyFold * 1.25, 'small delayed compliance follows fast elastic response');
  assert(displacement(g, opposite).length() < 0.0005, 'pinch is local, not a whole-cheek translation');
  let deepest = 0, medial = 0;
  for (let i = 0; i < rest.length / 3; i++) {
    const d = displacement(g, i);
    if (Math.abs(rest[i * 3]) < 0.025) medial = Math.max(medial, d.length());
    if (new Vector3().fromArray(rest, i * 3).distanceTo(hit.point) < 0.5) deepest = Math.max(deepest, -d.dot(normal));
  }
  assert(deepest < 0.012 && medial < 0.000001, 'no large cavity and no movement of the fixed cleft');
  noInversions(g);
  tissue.endGrab(); advance(tissue, 24);
  const releasedFold = displacement(g, core).dot(normal);
  assert(releasedFold > 0 && releasedFold < fold * 0.15, 'release has fast recovery with a small fading tail');
  advance(tissue, 336); restored(g, tissue);
  results.push({ test: 'small fold, shallow opposing contacts, locality, delayed recovery', earlyFold, fold, pads, deepest, releasedFold });
}
{
  const { g, tissue } = fixture();
  tissue.startGrab(hit.point, normal, across);
  const samples = [];
  for (const travel of [0.04, 0.12, 0.30]) {
    tissue.moveGrab(hit.point.clone().addScaledVector(across, travel));
    advance(tissue, 60);
    samples.push({ travel, shear: tissue.skinShear, displacement: tissue.maxDisplacement });
    noInversions(g);
  }
  assert(samples.every(s => s.shear > 0 && s.displacement < 0.09), 'local skin traction stays bounded');
  const firstSlope = (samples[1].shear - samples[0].shear) / 0.08;
  const lastSlope = (samples[2].shear - samples[1].shear) / 0.18;
  assert(lastSlope < firstSlope, 'additional pointer travel produces less extension as skin tightens');
  tissue.endGrab(); advance(tissue, 360); restored(g, tissue);
  results.push({ test: 'tangential traction and progressive resistance', samples, firstSlope, lastSlope });
}
{
  const { g, tissue } = fixture();
  tissue.hit(hit.point, 0.65, new Vector3(0.2, 0.1, 0), normal);
  let peak = 0, indentation = 0, settlingTime = null;
  for (let frame = 0; frame < 180; frame++) {
    tissue.step(1 / 120);
    peak = Math.max(peak, tissue.maxDisplacement);
    indentation = Math.max(indentation, tissue.skinIndentation);
    if (frame === 4) assert(displacement(g, core).dot(normal) < -0.002, 'slap is inward compression');
    if (frame > 10 && settlingTime === null && tissue.maxDisplacement < 0.002 && tissue.energy < 0.00001) settlingTime = (frame + 1) / 120;
  }
  assert(peak > 0.006 && peak < 0.03 && indentation < 0.012, `slap produces only a shallow surface response: ${JSON.stringify({ peak, indentation, settlingTime })}`);
  assert(settlingTime !== null && settlingTime < 0.65, 'subcutaneous motion is brief and damped');
  advance(tissue, 180); restored(g, tissue);
  results.push({ test: 'shallow palm contact and brief damped recoil', peak, indentation, settlingTime });
}
for (const softness of [0, 1]) for (const bounce of [0, 1]) {
  const { g, tissue } = fixture();
  tissue.configure(softness, bounce);
  tissue.startGrab(hit.point, normal, across);
  tissue.moveGrab(hit.point.clone().add(new Vector3(10, -9, 8)));
  advance(tissue, 120);
  assert(tissue.maxDisplacement < 0.10, 'extreme grab retains limited skin stretch');
  noInversions(g);
  tissue.endGrab(); advance(tissue, 360); restored(g, tissue);
}
results.push({ test: 'four parameter extremes and release', passed: true });
{
  const { g, tissue } = fixture();
  let peak = 0;
  for (let i = 0; i < 24; i++) {
    tissue.startGrab(hit.point, normal, across);
    advance(tissue, 4);
    peak = Math.max(peak, tissue.maxDisplacement);
    tissue.endGrab();
    advance(tissue, 2);
  }
  assert(peak < 0.04, 'rapid re-grabbing does not stack folds at one location');
  const fold = tissue.skinFold;
  tissue.hit(hit.point, 1, new Vector3(), normal);
  advance(tissue, 4);
  assert(tissue.skinFold <= fold + 0.003, 'slapping after pinch cannot kick the old fold upward');
  advance(tissue, 360); restored(g, tissue);
  results.push({ test: 'rapid re-grab and transition from pinch to slap', peak });
}
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
  assert(peak < 0.10, 'rapid impacts cannot create a deep cumulative crater');
  advance(tissue, 360); restored(g, tissue);
  results.push({ test: 'rapid repeat impact bounds', peak });
}
{
  const a = fixture(), b = fixture();
  for (const { tissue } of [a, b]) tissue.startGrab(hit.point, normal, across);
  advance(a.tissue, 18); advance(b.tissue, 9, 1 / 60);
  let error = 0;
  for (let i = 0; i < rest.length; i++) error = Math.max(error, Math.abs(a.g.attributes.position.array[i] - b.g.attributes.position.array[i]));
  assert(error < 0.00001, 'equal elapsed time has equal deformation');
  a.tissue.reset(); restored(a.g, a.tissue);
  results.push({ test: 'frame-rate independence and reset', error });
}
console.log(JSON.stringify({ passed: true, approvedModelSHA256: approvedHash, results }, null, 2));
