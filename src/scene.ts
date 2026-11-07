import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TissuePhysics, type TouchMode } from './physics';
import { createSkin } from './material';

// Couple model caches to the source fingerprint, including the mesh bytes.
const modelUrl = `${import.meta.env.BASE_URL}models/adult-torso.json?v=${__PIGU_BUILD__}`;
const capsUrl = `${import.meta.env.BASE_URL}models/torso-caps.json?v=${__PIGU_BUILD__}`;

type Callbacks = {
  hit: (point: THREE.Vector3, strength: number, x: number, y: number) => void;
  unlock: () => void;
  update: (energy: number, displacement: number) => void;
  error: (message: string) => void;
};

export class SoftScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();
  readonly controls: OrbitControls;
  readonly skin = createSkin();
  physics!: TissuePhysics;
  mode: TouchMode = 'slap';
  force = 0.65;
  speed = 1;
  hits = 0;
  frames = 0;
  fps = 0;
  ready = false;
  mesh!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private cursor = document.querySelector<HTMLElement>('#cursor')!;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private lastPointer = new THREE.Vector2();
  private pointerSpeed = new THREE.Vector3();
  private pointerTime = 0;
  private activePointer: number | null = null;
  private grabPlane = new THREE.Plane();
  private wasOrbiting = false;
  private isDown = false;
  private previous = performance.now();
  private fpsTime = 0;
  private fpsFrames = 0;
  private cameraDistance = 8.55;
  private viewTarget: THREE.Vector3 | null = null;
  private frameId = 0;
  private resizeObserver: ResizeObserver;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private host: HTMLElement, private callbacks: Callbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.setClearColor('#f1f4f0', 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Slap or squish the 3D model');
    this.renderer.domElement.tabIndex = 0;
    this.host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(33, 1, 0.1, 60);
    this.camera.position.set(2.35, 1.05, 7.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.05, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
    this.controls.minDistance = 5.9;
    this.controls.maxDistance = 10;
    this.controls.minPolarAngle = Math.PI * 0.33;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.minAzimuthAngle = -Math.PI * 0.55;
    this.controls.maxAzimuthAngle = Math.PI * 0.55;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.update();
    this.scene.background = new THREE.Color('#f1f4f0');
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment, 0.04).texture;
    this.scene.environmentIntensity = 0.25;
    environment.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#bec3b5', 0.65));
    const key = new THREE.DirectionalLight('#fff3e9', 2.7);
    key.position.set(-3.2, 6, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3; key.shadow.camera.right = 3;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -3;
    key.shadow.normalBias = 0.015;
    key.shadow.bias = -0.0003;
    key.shadow.radius = 5;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#e3efff', 0.75);
    fill.position.set(4, 1, 2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#f5fff0', 1.8);
    rim.position.set(2, 3, -3);
    this.scene.add(rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#77866b', opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.49;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.bindPointer();
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.ready = false;
      cancelAnimationFrame(this.frameId);
      callbacks.error('The graphics context was interrupted. Reload to restore the studio.');
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());
    this.resize();
  }

  async load() {
    const loader = new THREE.BufferGeometryLoader();
    const [geometry, caps] = await Promise.all([
      loader.loadAsync(modelUrl),
      loader.loadAsync(capsUrl),
    ]);
    geometry.setAttribute('restPosition', geometry.attributes.position.clone());
    this.mesh = new THREE.Mesh(geometry, this.skin.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.6;
    this.scene.add(this.mesh);
    const cap = new THREE.Mesh(caps, new THREE.MeshStandardMaterial({ color: '#b5c1ad', roughness: 0.8, side: THREE.DoubleSide }));
    this.scene.add(cap);
    this.physics = new TissuePhysics(geometry);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.ready = true;
    this.previous = performance.now();
    this.animate();
  }

  private resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.fov = width <= 820 ? 38 : 33;
    // Reserve fixed space for the interaction dock and the mobile title.
    this.camera.setViewOffset(width, height, width > 820 ? width * 0.01 : 0, width > 820 ? height * 0.025 : -height * 0.018, width, height);
    const distance = width <= 820
      ? Math.max(7.6, 4.8 / (width / height))
      : 8.55 * Math.max(1, 900 / height);
    this.cameraDistance = distance;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.controls.maxDistance = Math.max(10, distance + 1.5);
    this.controls.minDistance = width <= 820 ? distance * 0.78 : 5.9;
    this.camera.updateProjectionMatrix();
  }

  private getHit(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.mesh) return null;
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    return hit && hit.point.z > 0.08 && hit.point.y < 0.7 && hit.point.y > -0.85 ? hit : null;
  }

  private slap(point: THREE.Vector3, x: number, y: number) {
    this.physics.hit(point, this.force, this.pointerSpeed);
    this.hits++;
    this.skin.uniforms.uContact.value.copy(point);
    this.skin.uniforms.uFlush.value = 0.7;
    this.callbacks.hit(point, this.force, x, y);
  }

  private releasePointer() {
    this.isDown = false;
    this.activePointer = null;
    this.physics?.endGrab();
    this.cursor.classList.remove('down');
    this.controls.enableRotate = this.mode === 'orbit';
    this.wasOrbiting = false;
  }

  private bindPointer() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', event => {
      this.cursor.style.left = `${event.clientX}px`;
      this.cursor.style.top = `${event.clientY}px`;
      const now = performance.now();
      const elapsed = Math.max(8, now - this.pointerTime);
      this.pointerSpeed.set((event.clientX - this.lastPointer.x) / elapsed * 0.13, -(event.clientY - this.lastPointer.y) / elapsed * 0.13, 0).clampLength(0, 0.5);
      this.lastPointer.set(event.clientX, event.clientY);
      this.pointerTime = now;
      if (!this.ready) return;
      const hit = this.getHit(event);
      const active = !!hit && this.mode !== 'orbit';
      this.cursor.classList.toggle('active', active || (this.isDown && !this.wasOrbiting));
      canvas.style.cursor = active && event.pointerType === 'mouse' ? 'none' : this.mode === 'orbit' ? 'grab' : 'default';
      if (this.isDown && this.mode === 'grab' && !this.wasOrbiting) {
        const target = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.grabPlane, target)) this.physics.moveGrab(target);
      }
    });
    canvas.addEventListener('pointerdown', event => {
      if (!this.ready || event.button !== 0 || this.activePointer !== null) return;
      this.callbacks.unlock();
      const hit = this.getHit(event);
      this.isDown = true;
      this.activePointer = event.pointerId;
      this.controls.autoRotate = false;
      this.viewTarget = null;
      canvas.setPointerCapture(event.pointerId);
      if (this.mode === 'orbit' || !hit) {
        this.wasOrbiting = true;
        this.controls.enableRotate = true;
        return;
      }
      this.controls.enableRotate = false;
      this.cursor.classList.add('down');
      if (this.mode === 'slap') this.slap(hit.point, event.clientX, event.clientY);
      else {
        this.physics.startGrab(hit.point);
        const normal = this.camera.getWorldDirection(new THREE.Vector3());
        this.grabPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
      }
    }, { capture: true });
    canvas.addEventListener('pointerup', () => this.releasePointer());
    canvas.addEventListener('pointercancel', () => this.releasePointer());
    canvas.addEventListener('lostpointercapture', () => this.releasePointer());
    canvas.addEventListener('pointerleave', () => this.cursor.classList.remove('active'));
    window.addEventListener('blur', () => this.releasePointer());
    document.addEventListener('visibilitychange', () => {
      this.previous = performance.now();
      if (document.hidden) this.releasePointer();
    });
    canvas.addEventListener('keydown', event => {
      if ((event.code === 'Space' || event.code === 'Enter') && this.ready && !event.repeat) {
        event.preventDefault();
        this.callbacks.unlock();
        const side = this.hits % 2 ? -1 : 1;
        const p = new THREE.Vector3(side * 0.57, 0, 0.77);
        const screen = p.clone().project(this.camera);
        const rect = canvas.getBoundingClientRect();
        this.slap(p, rect.left + (screen.x + 1) * rect.width / 2, rect.top + (1 - screen.y) * rect.height / 2);
      }
    });
  }

  setMode(mode: TouchMode) {
    this.releasePointer();
    this.mode = mode;
    this.controls.enableRotate = mode === 'orbit';
    this.host.dataset.mode = mode;
  }

  setView(view: string) {
    const distance = this.cameraDistance * (view === 'side' ? 1.04 : 1);
    const angle = view === 'back' ? 0 : view === 'side' ? 1.22 : 0.32;
    this.viewTarget = new THREE.Vector3(Math.sin(angle) * distance, 0.95, Math.cos(angle) * distance);
    this.controls.autoRotate = false;
    if (this.reducedMotion) { this.camera.position.copy(this.viewTarget); this.viewTarget = null; }
  }

  setAutoRotate(enabled: boolean) {
    if (enabled) this.viewTarget = null;
    this.controls.autoRotate = enabled;
  }

  reset() {
    this.releasePointer();
    this.physics.reset();
    this.skin.uniforms.uFlush.value = 0;
    this.hits = 0;
    this.setView('quarter');
  }

  capture() { return this.renderer.domElement.toDataURL('image/png'); }

  diagnostics() {
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ready: this.ready, renderer: 'Three.js WebGLRenderer', threeRevision: THREE.REVISION,
      modelUrl, capsUrl,
      webgl: gl.getParameter(gl.VERSION), gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vertices: this.mesh?.geometry.attributes.position.count, triangles: this.renderer.info.render.triangles,
      frames: this.frames, fps: Math.round(this.fps), hits: this.hits,
      physicsSteps: this.physics?.steps, displacement: this.physics?.maxDisplacement,
      peakDisplacement: this.physics?.peakDisplacement, energy: this.physics?.energy,
      settings: { softness: this.physics?.softness, bounce: this.physics?.bounce, strength: this.force, timeScale: this.speed, mode: this.mode },
      canvas: { width: this.renderer.domElement.width, height: this.renderer.domElement.height },
      camera: this.camera.position.toArray(),
      cheekScreens: this.physics?.centers.map(center => {
        const p = center.clone().project(this.camera);
        return { x: (p.x + 1) * this.host.clientWidth / 2, y: (1 - p.y) * this.host.clientHeight / 2 };
      }),
    };
  }

  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);
    const now = performance.now(), elapsed = (now - this.previous) / 1000;
    const dt = Math.min(elapsed, 0.05);
    this.previous = now;
    if (document.hidden) return;
    this.physics.step(dt * this.speed);
    if (this.viewTarget) {
      this.camera.position.lerp(this.viewTarget, 1 - Math.exp(-dt * 8));
      if (this.camera.position.distanceTo(this.viewTarget) < 0.002) this.viewTarget = null;
    }
    if (this.controls.autoRotate) {
      const angle = this.controls.getAzimuthalAngle();
      // OrbitControls subtracts speed from azimuth; turn inward only once.
      if (angle < -1.2) this.controls.autoRotateSpeed = -Math.abs(this.controls.autoRotateSpeed);
      if (angle > 1.2) this.controls.autoRotateSpeed = Math.abs(this.controls.autoRotateSpeed);
    }
    this.controls.update(dt);
    this.skin.uniforms.uFlush.value *= Math.exp(-dt * 0.7);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    this.fpsFrames++;
    this.fpsTime += elapsed;
    if (this.fpsTime > 0.75) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0; this.fpsTime = 0;
    }
    this.callbacks.update(this.physics.energy, this.physics.maxDisplacement);
  };
}
