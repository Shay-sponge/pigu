import { Body, Sphere, Spring, Vec3, World } from 'cannon-es';
import { BufferAttribute, BufferGeometry, MathUtils, Vector3 } from 'three';

export type TouchMode = 'slap' | 'grab' | 'orbit';

type Contact = {
  point: Vector3;
  normal: Vector3;
  depth: number;
  velocity: number;
  target: number;
  held: boolean;
  vertices: number[];
  profile: number[];
};

export class TissuePhysics {
  private world = new World({ gravity: new Vec3(0, 0, 0), allowSleep: false });
  private nodes: Body[] = [];
  private anchors: Vec3[] = [];
  private springs: Spring[] = [];
  private coupling: Spring[] = [];
  private contacts: Contact[] = [];
  private rest: Float32Array;
  private weights: Float32Array;
  private activeVertices: number[] = [];
  private initialNormals: Float32Array;
  private restMeshNormals: Float32Array;
  private attr: BufferAttribute;
  private accumulator = 0;
  private grab: { point: Vector3; target: Vector3; normal: Vector3; contact: Contact } | null = null;
  private normalFrame = 0;
  private muscleStiffness = 50;
  private muscleDamping = 3;
  softness = 0.68;
  bounce = 0.72;
  energy = 0;
  maxDisplacement = 0;
  peakDisplacement = 0;
  muscleDisplacement = 0;
  skinIndentation = 0;
  steps = 0;
  readonly centers = [new Vector3(-0.56, 0.28, 0.93), new Vector3(0.56, 0.28, 0.93)];

  constructor(private geometry: BufferGeometry) {
    this.attr = geometry.attributes.position as BufferAttribute;
    this.rest = new Float32Array(this.attr.array);
    this.initialNormals = new Float32Array(geometry.attributes.normal.array);
    geometry.computeVertexNormals();
    this.restMeshNormals = new Float32Array(geometry.attributes.normal.array);
    geometry.attributes.normal.array.set(this.initialNormals);
    const offsets = [[0, 0, 0], [-0.22, 0.02, 0], [0.22, 0.02, 0], [0, 0.26, -0.04], [0, -0.25, -0.03], [0, 0, 0.13]];
    for (const center of this.centers) {
      for (const [x, y, z] of offsets) {
        const anchor = new Vec3(center.x + x, center.y + y, center.z + z);
        const fixed = new Body({ mass: 0, position: anchor });
        const node = new Body({ mass: 0.13, position: anchor, shape: new Sphere(0.035), linearDamping: 0.03, collisionFilterGroup: 0 });
        this.world.addBody(fixed);
        this.world.addBody(node);
        this.anchors.push(anchor.clone());
        this.nodes.push(node);
        this.springs.push(new Spring(fixed, node, { restLength: 0, stiffness: 50, damping: 0 }));
      }
    }
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const distance = this.anchors[i].distanceTo(this.anchors[j]);
        if (distance < 0.48 || (i === 2 && j === 7)) {
          this.coupling.push(new Spring(this.nodes[i], this.nodes[j], { restLength: distance, stiffness: 16, damping: 0.45 }));
        }
      }
    }
    this.weights = new Float32Array(this.attr.count * this.nodes.length);
    for (let i = 0; i < this.attr.count; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1], z = this.rest[i * 3 + 2];
      const left = Math.exp(-((x + 0.56) ** 2 / 0.38 + (y - 0.18) ** 2 / 0.45));
      const right = Math.exp(-((x - 0.56) ** 2 / 0.38 + (y - 0.18) ** 2 / 0.45));
      const backMask = MathUtils.smoothstep(z, -0.12, 0.46);
      // Pin the medial tissue to the common underlying body. A unilateral pull
      // cannot turn the narrow cleft into an opening between independent balls.
      const seam = MathUtils.smootherstep(Math.abs(x), 0.10, 0.43);
      const envelope = Math.min(1, Math.max(left, right) * 1.25) * backMask * seam;
      if (envelope < 0.003) continue;
      this.activeVertices.push(i);
      let total = 0;
      for (let j = 0; j < this.nodes.length; j++) {
        const a = this.anchors[j];
        const d2 = (x - a.x) ** 2 + (y - a.y) ** 2 + (z - a.z) ** 2 * 0.45;
        const w = Math.exp(-d2 / 0.095);
        this.weights[i * this.nodes.length + j] = w;
        total += w;
      }
      for (let j = 0; j < this.nodes.length; j++) this.weights[i * this.nodes.length + j] *= envelope / Math.max(total, 1e-9);
    }
    this.configure(this.softness, this.bounce);
  }

  configure(softness: number, bounce: number) {
    this.softness = MathUtils.clamp(softness, 0, 1);
    this.bounce = MathUtils.clamp(bounce, 0, 1);
    this.muscleStiffness = MathUtils.lerp(85, 34, this.softness);
    // Damping ratio stays positive even at the bounciest setting. This damps
    // all velocity components; a zero-length spring only damps radially.
    const ratio = MathUtils.lerp(0.90, 0.48, this.bounce);
    this.muscleDamping = 2 * ratio * Math.sqrt(this.muscleStiffness * 0.13);
    for (const spring of this.springs) spring.stiffness = this.muscleStiffness;
  }

  private contact(point: Vector3, normal: Vector3, held: boolean, strength: number) {
    const outward = normal.clone().normalize();
    const kick = (0.04 + strength * 0.09) * 48 * 1.9;
    // Repeated taps at the same contact reinforce its motion rather than
    // stacking multiple independent dents through the same skin.
    const previous = !held && this.contacts.find(c => !c.held && c.point.distanceToSquared(point) < 0.18 ** 2 && c.normal.dot(outward) > 0.85);
    if (previous) {
      previous.velocity = Math.min(12, previous.velocity + kick);
      return previous;
    }
    const c: Contact = { point: point.clone(), normal: outward, depth: 0, velocity: 0,
      target: held ? 0.06 + this.softness * 0.045 : 0, held, vertices: [], profile: [] };
    const radius = 0.18 + this.softness * 0.055;
    for (const i of this.activeVertices) {
      const dx = this.rest[i * 3] - point.x, dy = this.rest[i * 3 + 1] - point.y, dz = this.rest[i * 3 + 2] - point.z;
      const axial = dx * c.normal.x + dy * c.normal.y + dz * c.normal.z;
      const radius2 = Math.max(0, dx * dx + dy * dy + dz * dz - axial * axial) / (radius * radius);
      const alignment = Math.max(0, this.initialNormals[i * 3] * c.normal.x
        + this.initialNormals[i * 3 + 1] * c.normal.y + this.initialNormals[i * 3 + 2] * c.normal.z);
      const seam = MathUtils.smootherstep(Math.abs(this.rest[i * 3]), 0.10, 0.28);
      // In the tangent plane the two Gaussians have equal, opposite integrals:
      // a small compensating bulge surrounds the central indentation. This is
      // an approximate volume cue, not a finite-element tissue simulation.
      const profile = (-Math.exp(-radius2) + 0.25 * Math.exp(-radius2 / 4)) / 0.75
        * Math.exp(-(axial * axial) / 0.06) * alignment * seam;
      if (Math.abs(profile) < 0.001) continue;
      c.vertices.push(i); c.profile.push(profile);
    }
    if (!held) c.velocity = kick;
    if (this.contacts.length >= 6) this.contacts.splice(this.contacts.findIndex(contact => !contact.held), 1);
    this.contacts.push(c);
    return c;
  }

  hit(point: Vector3, strength: number, velocity: Vector3, normal = new Vector3(0, 0, 1)) {
    strength = MathUtils.clamp(strength, 0, 1);
    const outward = normal.clone().normalize();
    const tangent = velocity.clone().addScaledVector(outward, -velocity.dot(outward)).clampLength(0, 0.3);
    const impulse = outward.multiplyScalar(-1).addScaledVector(tangent, 0.28).normalize();
    const direction = new Vec3(impulse.x, impulse.y, impulse.z);
    this.contact(point, normal, false, strength);
    this.nodes.forEach((node, i) => {
      const a = this.anchors[i];
      const d2 = (point.x - a.x) ** 2 + (point.y - a.y) ** 2 + (point.z - a.z) ** 2 * 0.35;
      const strain = node.position.distanceTo(a) / 0.10;
      const resistance = 1 / (1 + strain * strain);
      node.applyImpulse(direction.scale((0.095 + strength * 0.20) * Math.exp(-d2 / 0.19) * resistance));
      const speed = node.velocity.length();
      if (speed > 3.2) node.velocity.scale(3.2 / speed, node.velocity);
    });
  }

  startGrab(point: Vector3, normal = new Vector3(0, 0, 1)) {
    this.endGrab();
    this.grab = { point: point.clone(), target: point.clone(), normal: normal.clone().normalize(),
      contact: this.contact(point, normal, true, 0) };
  }
  moveGrab(target: Vector3) { if (this.grab) this.grab.target.copy(target); }
  endGrab() {
    if (this.grab) { this.grab.contact.held = false; this.grab.contact.target = 0; }
    this.grab = null;
  }

  step(dt: number) {
    this.accumulator += Math.max(0, Math.min(dt, 0.05));
    const fixedStep = 1 / 120;
    while (this.accumulator >= fixedStep) {
      for (const spring of this.springs) spring.applyForce();
      for (const spring of this.coupling) spring.applyForce();
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i], delta = node.position.vsub(this.anchors[i]);
        // Strain stiffening resists large pulls progressively instead of
        // stretching freely until hitting a hard distance limit.
        const strain = delta.length() / 0.23;
        const extra = this.muscleStiffness * 1.4 * strain * strain;
        node.force.x -= node.velocity.x * this.muscleDamping + delta.x * extra;
        node.force.y -= node.velocity.y * this.muscleDamping + delta.y * extra;
        node.force.z -= node.velocity.z * this.muscleDamping + delta.z * extra;
      }
      if (this.grab) {
        const delta = this.grab.target.clone().sub(this.grab.point);
        const axial = delta.dot(this.grab.normal);
        delta.addScaledVector(this.grab.normal, -axial).multiplyScalar(0.75)
          .addScaledVector(this.grab.normal, axial * 0.4 - 0.025).clampLength(0, 0.32);
        this.nodes.forEach((node, i) => {
          const a = this.anchors[i], p = this.grab!.point;
          const w = Math.exp(-((p.x - a.x) ** 2 + (p.y - a.y) ** 2 + (p.z - a.z) ** 2 * 0.35) / 0.16);
          node.force.x += ((a.x + delta.x - node.position.x) * 62 - node.velocity.x * 1.2) * w;
          node.force.y += ((a.y + delta.y - node.position.y) * 62 - node.velocity.y * 1.2) * w;
          node.force.z += ((a.z + delta.z - node.position.z) * 62 - node.velocity.z * 1.2) * w;
        });
      }
      this.world.step(fixedStep);
      this.nodes.forEach((node, i) => {
        const delta = node.position.vsub(this.anchors[i]), length = delta.length();
        if (length > 0.28) {
          delta.scale(0.28 / length, delta);
          this.anchors[i].vadd(delta, node.position);
          node.velocity.scale(0.35, node.velocity);
        }
      });
      for (const c of this.contacts) {
        const omega = 48, ratio = c.held ? 0.82 : MathUtils.lerp(0.82, 0.58, this.bounce);
        c.velocity += (omega * omega * (c.target - c.depth) - 2 * ratio * omega * c.velocity) * fixedStep;
        c.depth += c.velocity * fixedStep;
        if (Math.abs(c.depth) > 0.14) { c.depth = MathUtils.clamp(c.depth, -0.14, 0.14); c.velocity *= 0.3; }
      }
      this.contacts = this.contacts.filter(c => c.held || Math.abs(c.depth) > 0.00001 || Math.abs(c.velocity) > 0.0001);
      this.accumulator -= fixedStep;
      this.steps++;
    }
    const offsets = this.nodes.map((n, i) => n.position.vsub(this.anchors[i]));
    this.muscleDisplacement = Math.max(...offsets.map(o => o.length()));
    this.skinIndentation = this.contacts.reduce((max, c) => Math.max(max, Math.abs(c.depth)), 0);
    this.energy = this.nodes.reduce((sum, n) => sum + n.velocity.lengthSquared() * n.mass, 0)
      + this.contacts.reduce((sum, c) => sum + c.velocity * c.velocity * 0.03, 0);
    const settle = this.muscleDisplacement < 0.00003 && this.skinIndentation < 0.00001
      && this.energy < 0.0000001 && !this.grab;
    if (settle) {
      if (this.normalFrame !== 0) {
        this.attr.array.set(this.rest);
        this.attr.needsUpdate = true;
        this.geometry.attributes.normal.array.set(this.initialNormals);
        this.geometry.attributes.normal.needsUpdate = true;
        this.normalFrame = 0;
      }
      this.maxDisplacement = 0;
      return;
    }
    const array = this.attr.array;
    for (const i of this.activeVertices) {
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < offsets.length; j++) {
        const w = this.weights[i * offsets.length + j];
        x += offsets[j].x * w; y += offsets[j].y * w; z += offsets[j].z * w;
      }
      const side = Math.sign(this.rest[i * 3]);
      array[i * 3] = this.rest[i * 3] + x - side * z * 0.12;
      array[i * 3 + 1] = this.rest[i * 3 + 1] + y;
      array[i * 3 + 2] = this.rest[i * 3 + 2] + z;
    }
    for (const c of this.contacts) {
      for (let j = 0; j < c.vertices.length; j++) {
        const i = c.vertices[j] * 3, amount = c.profile[j] * c.depth;
        array[i] += c.normal.x * amount;
        array[i + 1] += c.normal.y * amount;
        array[i + 2] += c.normal.z * amount;
      }
    }
    this.maxDisplacement = 0;
    for (const i of this.activeVertices) {
      const d = Math.hypot(array[i * 3] - this.rest[i * 3], array[i * 3 + 1] - this.rest[i * 3 + 1], array[i * 3 + 2] - this.rest[i * 3 + 2]);
      this.maxDisplacement = Math.max(this.maxDisplacement, d);
    }
    this.peakDisplacement = Math.max(this.peakDisplacement, this.maxDisplacement);
    this.attr.needsUpdate = true;
    this.normalFrame++;
    this.geometry.computeVertexNormals();
    // Preserve the generator's smooth field shading. Use the change in mesh
    // normals, so marching-cubes triangle spacing does not leave a false dent
    // after the positions have recovered or change the stationary skin.
    const normals = this.geometry.attributes.normal.array;
    for (let i = 0; i < normals.length; i += 3) {
      const x = normals[i] - this.restMeshNormals[i] + this.initialNormals[i];
      const y = normals[i + 1] - this.restMeshNormals[i + 1] + this.initialNormals[i + 1];
      const z = normals[i + 2] - this.restMeshNormals[i + 2] + this.initialNormals[i + 2];
      const length = Math.hypot(x, y, z);
      normals[i] = x / length; normals[i + 1] = y / length; normals[i + 2] = z / length;
    }
  }

  reset() {
    this.grab = null;
    this.contacts = [];
    this.accumulator = 0;
    this.nodes.forEach((n, i) => {
      n.position.copy(this.anchors[i]);
      n.previousPosition.copy(this.anchors[i]);
      n.interpolatedPosition.copy(this.anchors[i]);
      n.velocity.setZero(); n.angularVelocity.setZero();
      n.force.setZero(); n.torque.setZero();
    });
    this.attr.array.set(this.rest);
    this.attr.needsUpdate = true;
    this.geometry.attributes.normal.array.set(this.initialNormals);
    this.geometry.attributes.normal.needsUpdate = true;
    this.maxDisplacement = this.peakDisplacement = this.energy = 0;
    this.muscleDisplacement = this.skinIndentation = 0;
    this.normalFrame = 0;
  }
}
