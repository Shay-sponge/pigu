import { Body, Sphere, Spring, Vec3, World } from 'cannon-es';
import { BufferAttribute, BufferGeometry, MathUtils, Vector3 } from 'three';

export type TouchMode = 'slap' | 'grab' | 'orbit';

export class TissuePhysics {
  private world = new World({ gravity: new Vec3(0, 0, 0), allowSleep: false });
  private nodes: Body[] = [];
  private anchors: Vec3[] = [];
  private springs: Spring[] = [];
  private coupling: Spring[] = [];
  private rest: Float32Array;
  private weights: Float32Array;
  private activeVertices: number[] = [];
  private initialNormals: Float32Array;
  private attr: BufferAttribute;
  private accumulator = 0;
  private grab: { point: Vector3; target: Vector3 } | null = null;
  private normalFrame = 0;
  softness = 0.68;
  bounce = 0.72;
  energy = 0;
  maxDisplacement = 0;
  peakDisplacement = 0;
  steps = 0;
  readonly centers = [new Vector3(-0.56, 0.28, 0.93), new Vector3(0.56, 0.28, 0.93)];

  constructor(private geometry: BufferGeometry) {
    this.attr = geometry.attributes.position as BufferAttribute;
    this.rest = new Float32Array(this.attr.array);
    this.initialNormals = new Float32Array(geometry.attributes.normal.array);
    const offsets = [[0, 0, 0], [-0.22, 0.02, 0], [0.22, 0.02, 0], [0, 0.26, -0.04], [0, -0.25, -0.03], [0, 0, 0.13]];
    for (const center of this.centers) {
      for (const [x, y, z] of offsets) {
        const anchor = new Vec3(center.x + x, center.y + y, center.z + z);
        const fixed = new Body({ mass: 0, position: anchor });
        const node = new Body({ mass: 0.13, position: anchor, shape: new Sphere(0.035), linearDamping: 0.4, collisionFilterGroup: 0 });
        this.world.addBody(fixed);
        this.world.addBody(node);
        this.anchors.push(anchor.clone());
        this.nodes.push(node);
        this.springs.push(new Spring(fixed, node, { restLength: 0, stiffness: 26, damping: 0.7 }));
      }
    }
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const distance = this.anchors[i].distanceTo(this.anchors[j]);
        if (distance < 0.48 || (i === 2 && j === 7)) {
          this.coupling.push(new Spring(this.nodes[i], this.nodes[j], { restLength: distance, stiffness: 8, damping: 0.12 }));
        }
      }
    }
    this.weights = new Float32Array(this.attr.count * this.nodes.length);
    for (let i = 0; i < this.attr.count; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1], z = this.rest[i * 3 + 2];
      const left = Math.exp(-((x + 0.56) ** 2 / 0.38 + (y - 0.18) ** 2 / 0.45));
      const right = Math.exp(-((x - 0.56) ** 2 / 0.38 + (y - 0.18) ** 2 / 0.45));
      const backMask = MathUtils.smoothstep(z, -0.12, 0.46);
      const seam = 0.28 + 0.72 * MathUtils.smoothstep(Math.abs(x), 0.015, 0.21);
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
    for (const spring of this.springs) {
      spring.stiffness = MathUtils.lerp(72, 17, this.softness);
      spring.damping = MathUtils.lerp(2.2, 0.3, this.bounce);
    }
  }

  hit(point: Vector3, strength: number, velocity: Vector3) {
    const side = point.x < 0 ? -1 : 1;
    const direction = new Vec3(
      side * 0.3 + MathUtils.clamp(velocity.x, -0.4, 0.4),
      -0.32 + MathUtils.clamp(velocity.y, -0.2, 0.2),
      -1,
    );
    direction.normalize();
    this.nodes.forEach((node, i) => {
      const a = this.anchors[i];
      const d2 = (point.x - a.x) ** 2 + (point.y - a.y) ** 2 + (point.z - a.z) ** 2 * 0.35;
      const weight = Math.exp(-d2 / 0.27);
      node.applyImpulse(direction.scale((0.13 + strength * 0.38) * weight));
    });
  }

  startGrab(point: Vector3) { this.grab = { point: point.clone(), target: point.clone() }; }
  moveGrab(target: Vector3) { if (this.grab) this.grab.target.copy(target); }
  endGrab() { this.grab = null; }

  step(dt: number) {
    this.accumulator += Math.min(dt, 0.05);
    const fixedStep = 1 / 120;
    while (this.accumulator >= fixedStep) {
      for (const spring of this.springs) spring.applyForce();
      for (const spring of this.coupling) spring.applyForce();
      // A zero-length spring damps radially; tissue drag also damps tangential motion.
      const drag = MathUtils.lerp(0.8, 0.14, this.bounce);
      for (const node of this.nodes) {
        node.force.x -= node.velocity.x * drag;
        node.force.y -= node.velocity.y * drag;
        node.force.z -= node.velocity.z * drag;
      }
      if (this.grab) {
        const delta = this.grab.target.clone().sub(this.grab.point).clampLength(0, 0.48);
        this.nodes.forEach((node, i) => {
          const a = this.anchors[i];
          const p = this.grab!.point;
          const w = Math.exp(-((p.x - a.x) ** 2 + (p.y - a.y) ** 2) / 0.23);
          node.force.x += ((a.x + delta.x - node.position.x) * 36 - node.velocity.x * 1.8) * w;
          node.force.y += ((a.y + delta.y - node.position.y) * 36 - node.velocity.y * 1.8) * w;
          node.force.z += ((a.z + delta.z - node.position.z) * 36 - node.velocity.z * 1.8) * w;
        });
      }
      this.world.step(fixedStep);
      this.nodes.forEach((node, i) => {
        const delta = node.position.vsub(this.anchors[i]);
        const length = delta.length();
        if (length > 0.48) {
          delta.scale(0.48 / length, delta);
          this.anchors[i].vadd(delta, node.position);
          node.velocity.scale(0.55, node.velocity);
        }
      });
      this.accumulator -= fixedStep;
      this.steps++;
    }
    this.energy = this.nodes.reduce((sum, n) => sum + n.velocity.lengthSquared() * n.mass, 0);
    const offsets = this.nodes.map((n, i) => n.position.vsub(this.anchors[i]));
    this.maxDisplacement = Math.max(...offsets.map(o => o.length()));
    this.peakDisplacement = Math.max(this.peakDisplacement, this.maxDisplacement);
    if (this.maxDisplacement < 0.00008 && !this.grab) {
      if (this.normalFrame !== 0) {
        this.attr.array.set(this.rest);
        this.attr.needsUpdate = true;
        this.geometry.attributes.normal.array.set(this.initialNormals);
        this.geometry.attributes.normal.needsUpdate = true;
        this.normalFrame = 0;
      }
      return;
    }
    const array = this.attr.array;
    for (const i of this.activeVertices) {
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < offsets.length; j++) {
        const w = this.weights[i * offsets.length + j];
        x += offsets[j].x * w; y += offsets[j].y * w; z += offsets[j].z * w;
      }
      // Lateral expansion maintains the impression of volume under compression.
      const side = Math.sign(this.rest[i * 3]);
      array[i * 3] = this.rest[i * 3] + x - side * z * 0.18;
      array[i * 3 + 1] = this.rest[i * 3 + 1] + y;
      array[i * 3 + 2] = this.rest[i * 3 + 2] + z;
    }
    this.attr.needsUpdate = true;
    this.normalFrame++;
    this.geometry.computeVertexNormals();
  }

  reset() {
    this.grab = null;
    this.accumulator = 0;
    this.nodes.forEach((n, i) => {
      n.position.copy(this.anchors[i]);
      n.previousPosition.copy(this.anchors[i]);
      n.interpolatedPosition.copy(this.anchors[i]);
      n.velocity.setZero();
      n.angularVelocity.setZero();
      n.force.setZero();
      n.torque.setZero();
    });
    this.attr.array.set(this.rest);
    this.attr.needsUpdate = true;
    this.geometry.attributes.normal.array.set(this.initialNormals);
    this.geometry.attributes.normal.needsUpdate = true;
    this.maxDisplacement = this.peakDisplacement = this.energy = 0;
    this.normalFrame = 0;
  }
}
