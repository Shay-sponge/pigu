import { Body, Sphere, Spring, Vec3, World } from 'cannon-es';
import { BufferAttribute, BufferGeometry, MathUtils, Vector3 } from 'three';

export type TouchMode = 'slap' | 'grab' | 'orbit';

type Contact = {
  point: Vector3;
  normal: Vector3;
  across: Vector3;
  along: Vector3;
  depth: number;
  velocity: number;
  delayed: number;
  target: number;
  held: boolean;
  pinch: boolean;
  shear: Vector3;
  shearVelocity: Vector3;
  shearTarget: Vector3;
  vertices: number[];
  profile: number[];
  gather: number[];
  shearWeights: number[];
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
  skinFold = 0;
  skinShear = 0;
  steps = 0;
  readonly centers = [new Vector3(-0.56, 0.28, 0), new Vector3(0.56, 0.28, 0)];

  constructor(private geometry: BufferGeometry) {
    this.attr = geometry.attributes.position as BufferAttribute;
    this.rest = new Float32Array(this.attr.array);
    // Locate tissue anchors from this model's posterior surface. Primitive
    // model coordinates are not valid after an anatomical rebuild.
    for (const center of this.centers) {
      let best = Infinity;
      for (let i = 0; i < this.attr.count; i++) {
        if (this.rest[i * 3 + 2] < 0) continue;
        const d = (this.rest[i * 3] - center.x) ** 2 + (this.rest[i * 3 + 1] - center.y) ** 2;
        if (d < best) { best = d; center.z = this.rest[i * 3 + 2]; }
      }
    }
    this.initialNormals = new Float32Array(geometry.attributes.normal.array);
    geometry.computeVertexNormals();
    this.restMeshNormals = new Float32Array(geometry.attributes.normal.array);
    geometry.attributes.normal.array.set(this.initialNormals);
    const offsets = [[0, 0, 0], [-0.22, 0.02, 0], [0.22, 0.02, 0], [0, 0.26, -0.04], [0, -0.25, -0.03], [0, 0, 0.13]];
    for (const center of this.centers) {
      for (const [x, y, z] of offsets) {
        const anchor = new Vec3(center.x + x, center.y + y, center.z - 0.08 + z);
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
      const backMask = MathUtils.smoothstep(z, -0.05, 0.38)
        * MathUtils.smootherstep(y, -0.62, -0.25)
        * (1 - MathUtils.smootherstep(y, 0.72, 1.16));
      // Pin the medial tissue to the common underlying body. A unilateral pull
      // cannot turn the narrow cleft into an opening between independent balls.
      const seam = MathUtils.smootherstep(Math.abs(x), 0.075, 0.34);
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
    this.muscleStiffness = MathUtils.lerp(108, 62, this.softness);
    // Damping ratio stays positive even at the bounciest setting. This damps
    // all velocity components; a zero-length spring only damps radially.
    const ratio = MathUtils.lerp(1.05, 0.67, this.bounce);
    this.muscleDamping = 2 * ratio * Math.sqrt(this.muscleStiffness * 0.13);
    for (const spring of this.springs) spring.stiffness = this.muscleStiffness;
  }

  private contact(point: Vector3, normal: Vector3, held: boolean, strength: number, tangent?: Vector3) {
    const outward = normal.clone().normalize();
    const kick = (0.005 + strength * 0.008) * 58 * 2;
    // Repeated taps at the same contact reinforce its motion rather than
    // stacking multiple independent dents through the same skin.
    const previous = this.contacts.find(c => c.pinch === held && !c.held
      && c.point.distanceToSquared(point) < (held ? 0.08 : 0.18) ** 2 && c.normal.dot(outward) > 0.85);
    if (previous) {
      if (held) {
        previous.held = true;
        previous.target = 0.017 + this.softness * 0.012;
        previous.shearTarget.set(0, 0, 0);
      } else previous.velocity = Math.min(1.7, previous.velocity + kick);
      return previous;
    }
    const across = tangent?.clone() ?? new Vector3(1, 0, 0);
    across.addScaledVector(outward, -across.dot(outward));
    if (across.lengthSq() < 0.001) across.set(0, 1, 0).addScaledVector(outward, -outward.y);
    across.normalize();
    const c: Contact = { point: point.clone(), normal: outward, across,
      along: new Vector3().crossVectors(outward, across).normalize(),
      depth: 0, velocity: 0, delayed: 0, target: held ? 0.017 + this.softness * 0.012 : 0,
      held, pinch: held, shear: new Vector3(), shearVelocity: new Vector3(), shearTarget: new Vector3(),
      vertices: [], profile: [], gather: [], shearWeights: [] };
    const radiusX = held ? 0.115 : 0.28;
    const radiusY = held ? 0.18 : 0.22;
    for (const i of this.activeVertices) {
      const dx = this.rest[i * 3] - point.x, dy = this.rest[i * 3 + 1] - point.y, dz = this.rest[i * 3 + 2] - point.z;
      const axial = dx * c.normal.x + dy * c.normal.y + dz * c.normal.z;
      const u = (dx * c.across.x + dy * c.across.y + dz * c.across.z) / radiusX;
      const v = (dx * c.along.x + dy * c.along.y + dz * c.along.z) / radiusY;
      const radius2 = u * u + v * v;
      const alignment = Math.max(0, this.initialNormals[i * 3] * c.normal.x
        + this.initialNormals[i * 3 + 1] * c.normal.y + this.initialNormals[i * 3 + 2] * c.normal.z);
      const seam = MathUtils.smootherstep(Math.abs(this.rest[i * 3]), 0.10, 0.28);
      const envelope = Math.exp(-(axial * axial) / 0.025) * alignment * seam;
      // Opposing finger pads gather a narrow fold between shallow contact
      // marks. A palm contact instead produces broad, shallow compression.
      // These are reduced surface modes, not a calibrated FEM skin solver.
      const ridge = Math.exp(-u * u / 0.45 - v * v);
      const pads = Math.exp(-(((u - 1.12) / 0.52) ** 2) - v * v)
        + Math.exp(-(((u + 1.12) / 0.52) ** 2) - v * v);
      const profile = held
        ? (0.90 * ridge - 0.36 * pads) * envelope
        : (-Math.exp(-radius2 * radius2) + 0.12 * Math.exp(-radius2 / 3)) / 0.88 * envelope;
      const gather = held ? -0.32 * u * Math.exp(-radius2 * 0.7) * envelope : 0;
      const shearWeight = held ? Math.exp(-radius2 * 0.35) * envelope : 0;
      if (Math.max(Math.abs(profile), Math.abs(gather), shearWeight) < 0.001) continue;
      c.vertices.push(i); c.profile.push(profile); c.gather.push(gather); c.shearWeights.push(shearWeight);
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
      node.applyImpulse(direction.scale((0.027 + strength * 0.065) * Math.exp(-d2 / 0.18) * resistance));
      const speed = node.velocity.length();
      if (speed > 0.9) node.velocity.scale(0.9 / speed, node.velocity);
    });
  }

  startGrab(point: Vector3, normal = new Vector3(0, 0, 1), tangent?: Vector3) {
    this.endGrab();
    this.grab = { point: point.clone(), target: point.clone(), normal: normal.clone().normalize(),
      contact: this.contact(point, normal, true, 0, tangent) };
  }
  moveGrab(target: Vector3) {
    if (!this.grab) return;
    this.grab.target.copy(target);
    const delta = target.clone().sub(this.grab.point);
    const axial = delta.dot(this.grab.normal);
    delta.addScaledVector(this.grab.normal, -axial);
    // Progressive resistance: long pointer travel adds less and less skin
    // stretch, rather than pulling a whole cheek freely toward the cursor.
    const length = delta.length(), limit = 0.065;
    if (length > 0) delta.multiplyScalar(limit * Math.tanh(length * 0.65 / limit) / length);
    this.grab.contact.shearTarget.copy(delta);
    this.grab.contact.target = (0.017 + this.softness * 0.012)
      + 0.009 * Math.tanh(Math.max(0, axial) / 0.08);
  }
  endGrab() {
    if (this.grab) {
      this.grab.contact.held = false;
      this.grab.contact.target = 0;
      this.grab.contact.shearTarget.set(0, 0, 0);
    }
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
        const delta = this.grab.contact.shearTarget.clone().multiplyScalar(0.12);
        this.nodes.forEach((node, i) => {
          const a = this.anchors[i], p = this.grab!.point;
          const w = Math.exp(-((p.x - a.x) ** 2 + (p.y - a.y) ** 2 + (p.z - a.z) ** 2 * 0.35) / 0.16);
          node.force.x += ((a.x + delta.x - node.position.x) * 42 - node.velocity.x * 1.2) * w;
          node.force.y += ((a.y + delta.y - node.position.y) * 42 - node.velocity.y * 1.2) * w;
          node.force.z += ((a.z + delta.z - node.position.z) * 42 - node.velocity.z * 1.2) * w;
        });
      }
      this.world.step(fixedStep);
      this.nodes.forEach((node, i) => {
        const delta = node.position.vsub(this.anchors[i]), length = delta.length();
        if (length > 0.075) {
          delta.scale(0.075 / length, delta);
          this.anchors[i].vadd(delta, node.position);
          node.velocity.scale(0.35, node.velocity);
        }
      });
      for (const c of this.contacts) {
        const omega = 58, ratio = c.held ? 1 : MathUtils.lerp(1, 0.86, this.bounce);
        const x = c.depth - c.target, velocity = c.velocity;
        const decay = Math.exp(-ratio * omega * fixedStep);
        // Exact damped-oscillator update preserves a brief impulse even when
        // the skin response is faster than the muscle simulation timestep.
        if (ratio < 0.9999) {
          const frequency = omega * Math.sqrt(1 - ratio * ratio);
          const cosine = Math.cos(frequency * fixedStep);
          const sine = Math.sin(frequency * fixedStep) / frequency;
          c.depth = c.target + decay * (x * cosine + (velocity + ratio * omega * x) * sine);
          c.velocity = decay * (velocity * cosine - (ratio * omega * velocity + omega * omega * x) * sine);
        } else {
          const b = velocity + omega * x;
          c.depth = c.target + (x + b * fixedStep) * decay;
          c.velocity = (velocity - omega * b * fixedStep) * decay;
        }
        // Fast elastic response plus a small delayed recovery component.
        // Times below are visual tuning, not universal human tissue constants.
        c.delayed += (c.target - c.delayed) * (1 - Math.exp(-fixedStep / 0.22));
        if (Math.abs(c.depth) > 0.04) { c.depth = MathUtils.clamp(c.depth, -0.04, 0.04); c.velocity *= 0.3; }
        const shearOmega = 42;
        const force = c.shearTarget.clone().sub(c.shear).multiplyScalar(shearOmega * shearOmega)
          .addScaledVector(c.shearVelocity, -2 * shearOmega);
        c.shearVelocity.addScaledVector(force, fixedStep);
        c.shear.addScaledVector(c.shearVelocity, fixedStep);
      }
      this.contacts = this.contacts.filter(c => c.held || Math.abs(c.depth) > 0.00001
        || Math.abs(c.delayed) > 0.00001 || Math.abs(c.velocity) > 0.0001 || c.shear.length() > 0.00001);
      this.accumulator -= fixedStep;
      this.steps++;
    }
    const offsets = this.nodes.map((n, i) => n.position.vsub(this.anchors[i]));
    this.muscleDisplacement = Math.max(...offsets.map(o => o.length()));
    this.skinIndentation = this.skinFold = this.skinShear = 0;
    for (const c of this.contacts) {
      const amount = 0.84 * c.depth + 0.16 * c.delayed;
      for (const profile of c.profile) {
        this.skinIndentation = Math.max(this.skinIndentation, -profile * amount);
        this.skinFold = Math.max(this.skinFold, profile * amount);
      }
      this.skinShear = Math.max(this.skinShear, c.shear.length());
    }
    this.energy = this.nodes.reduce((sum, n) => sum + n.velocity.lengthSquared() * n.mass, 0)
      + this.contacts.reduce((sum, c) => sum + c.velocity * c.velocity * 0.03 + c.shearVelocity.lengthSq() * 0.03, 0);
    const settle = this.muscleDisplacement < 0.00003
      && Math.max(this.skinIndentation, this.skinFold, this.skinShear) < 0.00001
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
        const i = c.vertices[j] * 3, amplitude = 0.84 * c.depth + 0.16 * c.delayed;
        const amount = c.profile[j] * amplitude, gather = c.gather[j] * amplitude, shear = c.shearWeights[j];
        array[i] += c.normal.x * amount + c.across.x * gather + c.shear.x * shear;
        array[i + 1] += c.normal.y * amount + c.across.y * gather + c.shear.y * shear;
        array[i + 2] += c.normal.z * amount + c.across.z * gather + c.shear.z * shear;
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
    this.muscleDisplacement = this.skinIndentation = this.skinFold = this.skinShear = 0;
    this.normalFrame = 0;
  }
}
