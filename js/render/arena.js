// Three.js 像素竞技场：低分辨率渲染 + 泛光，CC0 机器人模型，粒子与特效系统
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { STYLE_COLORS } from '../engine/actions.js';
import * as S from './sprites.js';
import { createUnitFx, patchMaterial, updateUnitFx, fallbackEmissive } from './unitfx.js';
import { createQuality } from './quality.js';

// RobotExpressive by Tomás Laulhé (CC0)，随 three.js 示例发布
const ROBOT_URLS = [
  'assets/RobotExpressive.glb',
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
  'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
];

const GIRL_URL = 'assets/models/girl.vrm';
const _cols = new Map();
const col = (style) => {
  const key = STYLE_COLORS[style] || style || '#ffffff';
  let c = _cols.get(key);
  if (!c) { c = new THREE.Color(key); _cols.set(key, c); }
  return c;
};
const rand = (a, b) => a + Math.random() * (b - a);
const ADD = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };
const dynAttr = (array, itemSize) => new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);

// ---------- 粒子系统（方形像素点，只模拟存活的那一段） ----------
class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.cap = max; this.count = 0; this.ring = 0;
    this.budget = 1e9; this.skipP = 0; this.frameEmits = 0; this.dirtyColor = false;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.colr = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.size0 = new Float32Array(max); this.shrink = new Uint8Array(max);
    g.setAttribute('position', dynAttr(this.pos, 3));
    g.setAttribute('color', dynAttr(this.colr, 3));
    g.setAttribute('size', dynAttr(this.size, 1));
    g.setAttribute('alpha', dynAttr(this.alpha, 1));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC=color; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=max(1.,floor(size*uScale/-mv.z)); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: additive
        ? `varying vec3 vC; varying float vA; void main(){ if(vA<0.02) discard; gl_FragColor=vec4(vC*vA,1.); }`
        : `varying vec3 vC; varying float vA; void main(){ if(vA<0.02) discard; gl_FragColor=vec4(vC,vA); }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  beginFrame() { this.frameEmits = 0; }
  setCap(n) {
    this.cap = Math.max(16, Math.min(this.max, n | 0));
    if (this.count > this.cap) this.count = this.cap;
  }
  emit(o) {
    if (this.skipP > 0 && Math.random() < this.skipP) return;
    if (this.frameEmits >= this.budget) return;
    this.frameEmits++;
    const i = this.count < this.cap ? this.count++ : (this.ring++ % this.cap);
    const i3 = i * 3, c = o.color, k = o.intensity ?? 1;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.colr[i3] = c.r * k; this.colr[i3 + 1] = c.g * k; this.colr[i3 + 2] = c.b * k;
    this.life[i] = this.maxLife[i] = o.life || 0.6;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 1.5;
    this.size0[i] = this.size[i] = o.size || 0.15; this.shrink[i] = o.shrink === false ? 0 : 1;
    this.alpha[i] = 1;
    this.dirtyColor = true;
  }
  swap(i, j) {
    if (i === j) return;
    const s3 = (a) => {
      const i3 = i * 3, j3 = j * 3;
      const x = a[i3], y = a[i3 + 1], z = a[i3 + 2];
      a[i3] = a[j3]; a[i3 + 1] = a[j3 + 1]; a[i3 + 2] = a[j3 + 2];
      a[j3] = x; a[j3 + 1] = y; a[j3 + 2] = z;
    };
    const s1 = (a) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
    s3(this.pos); s3(this.colr); s3(this.vel);
    s1(this.size); s1(this.alpha); s1(this.life); s1(this.maxLife);
    s1(this.grav); s1(this.drag); s1(this.size0); s1(this.shrink);
  }
  update(dt) {
    let i = 0;
    while (i < this.count) {
      const life = this.life[i] - dt;
      if (life <= 0) {
        const last = --this.count;
        if (i !== last) this.swap(i, last);
        this.dirtyColor = true;
        continue;
      }
      this.life[i] = life;
      const k = life / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.3; }
      this.alpha[i] = k < 0.3 ? k / 0.3 : 1;
      this.size[i] = this.shrink[i] ? this.size0[i] * (0.3 + 0.7 * k) : this.size0[i];
      i++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    if (!this.count) return;
    const a = geo.attributes;
    const touch = (attr, n) => { attr.clearUpdateRanges(); attr.addUpdateRange(0, n); attr.needsUpdate = true; };
    touch(a.position, this.count * 3);
    touch(a.size, this.count);
    touch(a.alpha, this.count);
    if (this.dirtyColor) { touch(a.color, this.count * 3); this.dirtyColor = false; }
  }
}

export class Arena {
  constructor(container, overlay, battle) {
    this.el = container; this.overlay = overlay; this.battle = battle;
    this.pixel = 3; this.views = new Map(); this.pviews = new Map(); this.lviews = new Map(); this.zviews = new Map(); this.bviews = new Map(); this.oviews = new Map();
    this.effects = []; this.numbers = []; this.plates = new Map(); this.lightReq = [];
    this.shakeAmt = 0; this.hover = null; this.rangeRing = null;
    this.projPool = [];
    this.q = { fx: 1, dust: true, torchParticles: true, buffParticles: true, pixel: 3, bloom: 0.9 };
    this.dynLightN = 8;
    this.initScene();
    this.quality = createQuality(this);
    this.loadRobot();
    battle.fx = this.makeFx();
    const onResize = () => { this.quality.syncPixel(); this.resize(); };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(this.el);
    else window.addEventListener('resize', onResize);
  }

  initScene() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.BasicShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.domElement.className = 'arena-canvas';
    this.el.prepend(r.domElement);
    const sc = this.scene = new THREE.Scene();
    sc.background = new THREE.Color('#07050d');
    sc.fog = new THREE.Fog('#07050d', 26, 48);
    const cam = this.camera = new THREE.PerspectiveCamera(36, 1.6, 0.1, 100);
    this.camBase = new THREE.Vector3(0, 19, 15.5);
    cam.position.copy(this.camBase); cam.lookAt(0, 0, 0.6);

    this._follow = new THREE.Vector3(); this._shake = new THREE.Vector3();
    this._proj = new THREE.Vector3(); this._pout = { x: 0, y: 0, vis: true };
    this._ndc = new THREE.Vector2(); this._hit = new THREE.Vector3();
    this._floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ba = new THREE.Vector3(); this._bt = new THREE.Vector3(); this._bd = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0); this._white = new THREE.Color(1, 1, 1);
    this._flashC = new THREE.Color();
    this._frozenVrm = new THREE.Color(0.05, 0.2, 0.45);
    this._frozenRobot = new THREE.Color(0.1, 0.3, 0.6);
    this._frozenSprite = new THREE.Color(0.1, 0.35, 0.8);

    sc.add(new THREE.HemisphereLight('#6b5cff', '#1a0f24', 0.9));
    sc.add(new THREE.AmbientLight('#2a2040', 0.6));
    const sun = this.sun = new THREE.DirectionalLight('#ffd9b0', 1.4);
    sun.position.set(-8, 18, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
    sc.add(sun);

    // 地面
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 21), new THREE.MeshStandardMaterial({ map: S.floorTexture(), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sc.add(ground);
    this.ground = ground;
    // 中心符文
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: S.runeTexture(16), color: new THREE.Color('#5b3cff').multiplyScalar(0.2), ...ADD }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = 0.01; sc.add(rune); this.centerRune = rune;

    // 墙与柱子
    const brick = new THREE.MeshStandardMaterial({ map: S.brickTexture(), roughness: 1 });
    brick.map.wrapS = brick.map.wrapT = THREE.RepeatWrapping;
    const wall = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), brick.clone());
      m.material.map = brick.map.clone(); m.material.map.repeat.set(Math.max(w, d) / 2, 0.7); m.material.map.needsUpdate = true;
      m.position.set(x, 0.7, z); m.castShadow = m.receiveShadow = true; sc.add(m);
    };
    wall(30, 1, 0, -10.5); wall(30, 1, 0, 10.5); wall(1, 21, -15, 0); wall(1, 21, 15, 0);
    this.torches = [];
    for (const [x, z] of [[-14, -9.5], [14, -9.5], [-14, 9.5], [14, 9.5], [0, -10]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.4, 1.2), brick);
      p.position.set(x, 1.7, z); p.castShadow = true; sc.add(p);
      const l = new THREE.PointLight('#ff8a3d', 18, 14, 1.6); l.position.set(x, 3.8, z); sc.add(l);
      this.torches.push({ x, z, l, seed: Math.random() * 10 });
    }
    // 动态光池
    this.lights = [];
    for (let i = 0; i < 8; i++) { const l = new THREE.PointLight('#fff', 0, 9, 1.4); l.position.y = 1.2; sc.add(l); this.lights.push(l); }

    this.glow = new Particles(sc, 7000, true);
    this.smoke = new Particles(sc, 2500, false);

    // 共享几何
    const flat = (g) => { g.rotateX(-Math.PI / 2); return g; };
    this.G = {
      ring: flat(new THREE.RingGeometry(0.9, 1, 32)),
      thinRing: flat(new THREE.RingGeometry(0.96, 1, 32)),
      disc: flat(new THREE.CircleGeometry(1, 24)),
      slash: new THREE.RingGeometry(0.75, 1.05, 16, 1, 0, Math.PI * 0.85),
      plane: new THREE.PlaneGeometry(1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
      ico: new THREE.IcosahedronGeometry(1, 0),
      bubble: new THREE.IcosahedronGeometry(1, 1),
      oct: new THREE.OctahedronGeometry(1, 0),
      cone: new THREE.ConeGeometry(1, 1, 5),
      box: new THREE.BoxGeometry(1, 1, 1),
    };
    for (const g of Object.values(this.G)) g.userData.shared = true;
    this.T = { glow: S.glowTexture(), rune: S.runeTexture(), noise: S.noiseDiscTexture() };
    this.spriteTex = { slime: S.slimeTexture(), dummy: S.dummyTexture(), totem: S.totemTexture(), robot: S.knightTexture(), girl: S.girlTexture(), drone: S.droneTexture() };

    // 光标 & 目标环 & 射程环
    this.reticle = new THREE.Mesh(this.G.thinRing, new THREE.MeshBasicMaterial({ color: new THREE.Color('#b3f0ff').multiplyScalar(1.5), ...ADD, opacity: 0.8 }));
    this.reticle.position.y = 0.03; this.reticle.scale.setScalar(0.5); sc.add(this.reticle);
    this.targetRing = new THREE.Mesh(this.G.ring, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b5c').multiplyScalar(2), ...ADD }));
    this.targetRing.position.y = 0.04; sc.add(this.targetRing);
    this.rangeRing = new THREE.Mesh(this.G.thinRing, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe066'), ...ADD, opacity: 0.5 }));
    this.rangeRing.position.y = 0.03; this.rangeRing.visible = false; sc.add(this.rangeRing);
    this.aoePreview = new THREE.Mesh(this.G.disc, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe066'), ...ADD, opacity: 0.18 }));
    this.aoePreview.position.y = 0.035; this.aoePreview.visible = false; sc.add(this.aoePreview);

    // 后处理
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(sc, cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.45, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.raycaster = new THREE.Raycaster();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const rw = Math.max(64, Math.floor(w / this.pixel)), rh = Math.max(48, Math.floor(h / this.pixel));
    this.renderer.setSize(rw, rh, false);
    this.composer.setSize(rw, rh);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const scale = rh * 0.5 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.glow.mat.uniforms.uScale.value = scale; this.smoke.mat.uniforms.uScale.value = scale;
    this.cssW = w; this.cssH = h;
  }
  setPixel(p) { this.pixel = p; this.resize(); }

  // 视觉等级：像素尺寸、泛光、阴影、灯光数量、粒子上限。灯光 visible 只在换档时改，避免每帧重编译着色器。
  applyQuality(preset) {
    const prevShadow = this.renderer.shadowMap.enabled;
    const prevSize = this.sun.shadow.mapSize.x;
    this.q = preset;
    this.pixel = preset.pixel;
    this.dynLightN = preset.dynLights;
    this.glow.setCap(preset.glowCap); this.smoke.setCap(preset.smokeCap);
    this.glow.budget = preset.glowBudget; this.smoke.budget = preset.smokeBudget;
    const skip = preset.fx >= 0.999 ? 0 : 1 - preset.fx;
    this.glow.skipP = this.smoke.skipP = skip;
    this.bloom.strength = preset.bloom;
    this.bloom.enabled = preset.bloom > 0;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    if (preset.shadows && prevSize !== preset.shadowSize) {
      this.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    if (prevShadow !== preset.shadows || (preset.shadows && prevSize !== preset.shadowSize)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.scene.traverse(o => {
        const mat = o.material;
        if (!mat) return;
        if (Array.isArray(mat)) for (const m of mat) m.needsUpdate = true;
        else mat.needsUpdate = true;
      });
    }
    this.torches.forEach((t, i) => {
      t.l.visible = i < preset.torches;
      if (!t.l.visible) t.l.intensity = 0;
    });
    this.lights.forEach((l, i) => {
      l.visible = i < preset.dynLights;
      if (!l.visible) l.intensity = 0;
    });
    this.resize();
  }

  // 一次性特效的几何大多共用，只释放自己 new 出来的；材质各自持有。
  releaseObj(obj) {
    if (!obj) return;
    this.scene.remove(obj);
    obj.traverse(o => {
      if (o.geometry && o.geometry.userData.own && !o.geometry.userData.shared) o.geometry.dispose();
      const mats = o.material ? [].concat(o.material) : [];
      for (const m of mats) {
        if (!m || m.userData.shared || m.userData.disposed) continue;
        m.userData.disposed = true;
        m.dispose();
      }
    });
  }

  // CC0 VRoid 少女模型（AvatarSample，VRoid 以 CC0 发布），使用 three-vrm 加载并程序化驱动骨骼
  async loadGirl() {
    try {
      const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
      const loader = new GLTFLoader();
      loader.register(p => new VRMLoaderPlugin(p));
      const gltf = await loader.loadAsync(GIRL_URL);
      const vrm = gltf.userData.vrm;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons?.(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      const box = new THREE.Box3().setFromObject(vrm.scene);
      this.girl = { vrm, h: box.max.y - box.min.y, used: false };
      for (const [u, v] of this.views) if (u.model === 'girl' && v.kind !== 'vrm') { this.disposeView(v); this.views.delete(u); }
      this.onGirlStatus?.(true);
    } catch (e) { console.warn('VRM 加载失败，使用像素精灵', e); this.onGirlStatus?.(false); }
  }

  async loadRobot() {
    this.loadGirl();
    const loader = new GLTFLoader();
    for (const url of ROBOT_URLS) {
      try {
        const gltf = await loader.loadAsync(url);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        this.robot = { scene: gltf.scene, clips: gltf.animations, h: box.max.y - box.min.y };
        for (const [u, v] of this.views) if (v.fallback) { this.disposeView(v); this.views.delete(u); }
        this.onAssetStatus?.(`模型已加载 (CC0 RobotExpressive)`);
        return;
      } catch (e) { /* 尝试下一个地址 */ }
    }
    this.onAssetStatus?.('模型加载失败，使用像素精灵');
  }

  // ---------- 单位视图 ----------
  makeUnitView(u) {
    const g = new THREE.Group();
    const v = { g, u, kind: 'sprite', last: { x: u.x, z: u.z }, yaw: 0, dead: false };
    const shadow = new THREE.Mesh(this.G.disc, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false }));
    shadow.scale.setScalar(u.radius * 1.1); shadow.position.y = 0.02; g.add(shadow);
    if (u.model === 'girl' && this.girl && !this.girl.used) {
      const gv = this.girl; gv.used = true;
      const m = gv.vrm.scene;
      m.scale.setScalar(1.9 * u.scale / gv.h);
      g.add(m);
      v.kind = 'vrm'; v.model = m; v.vrm = gv.vrm; v.yawOff = gv.yaw0 ??= m.rotation.y; v.height = 1.9 * u.scale; v.pose = { run: 0, cast: 0, dead: 0, dash: 0, hurt: 0, t: 0 };
      v.mats = [];
      m.traverse(o => { if (o.isMesh) for (const mt of [].concat(o.material)) if (mt.emissive) { mt.userData.em = mt.emissive.clone(); v.mats.push(mt); } });
      v.release = () => { gv.used = false; g.remove(m); };
    } else if (u.model === 'robot' && this.robot) {
      const m = SkeletonUtils.clone(this.robot.scene);
      const s = 1.9 * u.scale / this.robot.h;
      m.scale.setScalar(s);
      v.mats = [];
      const tint = u.tpl.tint ? new THREE.Color(u.tpl.tint) : null;
      m.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.material = o.material.clone();
        if (tint) { o.material.color.lerp(tint, 0.55); o.material.emissive = tint.clone().multiplyScalar(0.25); }
        o.material.userData.em = o.material.emissive.clone();
        v.mats.push(o.material);
      });
      g.add(m);
      v.kind = 'robot'; v.model = m;
      v.mixer = new THREE.AnimationMixer(m);
      v.actions = {};
      for (const c of this.robot.clips) v.actions[c.name] = v.mixer.clipAction(c);
      for (const n of ['Punch', 'Death', 'Jump']) if (v.actions[n]) { v.actions[n].setLoop(THREE.LoopOnce); v.actions[n].clampWhenFinished = true; }
      v.anim = null; this.playAnim(v, 'Idle');
      v.height = 1.9 * u.scale;
    } else {
      const key = u.model === 'robot' ? 'robot' : u.model;
      let t = this.spriteTex[key] || this.spriteTex.dummy;
      if (u.model === 'totem') t = S.totemTexture(STYLE_COLORS[u.tpl.style] || '#7fb2ff');
      const img = t.image;
      const hgt = ({ slime: 1.0, dummy: 2.0, totem: 1.9, robot: 1.8, girl: 1.9, drone: 0.8 }[key] || 1.5) * u.scale;
      const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
      if (u.tpl.tint) mat.color.set(u.tpl.tint);
      const sp = new THREE.Mesh(this.G.plane, mat);
      sp.geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      sp.geometry.userData.own = true;
      sp.scale.set(hgt * img.width / img.height, hgt, 1);
      sp.castShadow = true;
      g.add(sp);
      v.sprite = sp; v.mat = mat; v.baseScale = sp.scale.clone(); v.height = hgt;
      v.fallback = u.model === 'robot';
    }
    // Buff 着色特效：给可注入的材质打补丁（VRM 的 MToon 走自发光退化）
    v.fx = createUnitFx(v.height);
    if (v.kind !== 'vrm') for (const m of v.mats || [v.mat]) patchMaterial(m, v.fx);
    // 冰块 & 护盾
    v.ice = new THREE.Mesh(this.G.ico, new THREE.MeshStandardMaterial({ color: '#bff4ff', transparent: true, opacity: 0.55, emissive: '#3aa8ff', emissiveIntensity: 0.6, flatShading: true, roughness: 0.2 }));
    v.ice.scale.set(u.radius * 1.3, v.height * 0.62, u.radius * 1.3); v.ice.position.y = v.height * 0.5; v.ice.visible = false; g.add(v.ice);
    v.bubble = new THREE.Mesh(this.G.bubble, new THREE.MeshBasicMaterial({ color: new THREE.Color('#6fe3ff').multiplyScalar(0.9), ...ADD, wireframe: true, opacity: 0.6 }));
    v.bubble.scale.setScalar(Math.max(u.radius * 1.6, v.height * 0.62)); v.bubble.position.y = v.height * 0.5; v.bubble.visible = false; g.add(v.bubble);
    g.position.set(u.x, 0, u.z);
    this.scene.add(g);
    return v;
  }
  playAnim(v, name, fade = 0.15) {
    if (!v.actions || v.anim === name || !v.actions[name]) return;
    const next = v.actions[name], prev = v.actions[v.anim];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (name === 'Punch') next.timeScale = 1.8;
    if (prev) prev.fadeOut(fade);
    v.anim = name;
  }
  disposeView(v) { v.release?.(); this.releaseObj(v.g); }

  // VRM 程序化动作：待机呼吸 / 跑步 / 施法 / 冲刺 / 受击 / 倒地
  animateVRM(v, u, dt, frozen) {
    const P = v.pose, vrm = v.vrm, hb = vrm.humanoid;
    const B = (n) => hb.getNormalizedBoneNode(n);
    const ease = (k, target, s) => k + (target - k) * Math.min(1, dt * s);
    if (!frozen) P.t += dt * (u.moving ? 1.6 : 1);
    P.run = ease(P.run, u.moving && u.alive ? 1 : 0, 10);
    P.cast = ease(P.cast, u.attackT > 0 || u.casting ? 1 : 0, 18);
    P.dash = ease(P.dash, u.dash || u.knockV ? 1 : 0, 14);
    P.dead = ease(P.dead, u.alive ? 0 : 1, 5);
    P.hurt = Math.max(0, u.hurtT / 0.18);
    const t = P.t, r = P.run, s = Math.sin(t * 11), c = Math.cos(t * 11);
    const set = (n, x, y, z) => { const b = B(n); if (b) b.rotation.set(x, y, z); };
    const breath = Math.sin(t * 2.2) * 0.03;
    set('hips', -0.1 * r - 0.35 * P.dash, 0, 0);
    const hips = B('hips'); if (hips) hips.position.y = (hips.userData.y0 ??= hips.position.y) + Math.abs(s) * 0.05 * r + breath * 0.3;
    set('spine', 0.05 * r + 0.2 * P.dash - 0.25 * P.hurt, 0, 0);
    set('chest', breath, Math.sin(t * 1.3) * 0.04 * (1 - r), 0);
    set('neck', 0, 0, 0);
    set('head', -0.05 + breath, Math.sin(t * 0.7) * 0.15 * (1 - r) * (1 - P.cast), Math.sin(t * 1.1) * 0.06 * (1 - r));
    // 腿
    set('leftUpperLeg', -s * 0.8 * r - 0.5 * P.dash, 0, 0);
    set('rightUpperLeg', s * 0.8 * r + 0.3 * P.dash, 0, 0);
    set('leftLowerLeg', Math.max(0, c) * 1.1 * r + 0.5 * P.dash, 0, 0);
    set('rightLowerLeg', Math.max(0, -c) * 1.1 * r + 0.3 * P.dash, 0, 0);
    // 手臂：放下 → 摆臂 → 施法前举
    const down = 1.25;
    set('leftUpperArm', s * 0.6 * r + 0.8 * P.dash, 0, -down + 0.15 * Math.sin(t * 2) * (1 - r) + 0.25 * P.dash);
    set('rightUpperArm', -s * 0.6 * r * (1 - P.cast) + 0.8 * P.dash, 1.35 * P.cast, down * (1 - P.cast) - 0.15 * Math.sin(t * 2) * (1 - r) * (1 - P.cast) - 0.25 * P.dash + 0.15 * P.cast);
    set('leftLowerArm', 0, 0, -0.3 - 0.6 * r);
    set('rightLowerArm', 0, 0, 0.3 + 0.6 * r * (1 - P.cast));
    // 倒地
    v.model.rotation.x = -P.dead * 1.45;
    v.model.position.y = P.dead * 0.25;
    vrm.update(frozen ? 0 : dt);
    const flash = u.hurtT > 0 ? u.hurtT / 0.18 : 0;
    if (flash) this._flashC.setRGB(flash, flash * 0.6, flash * 0.7);
    for (const m of v.mats) {
      m.emissive.copy(m.userData.em);
      if (flash) m.emissive.add(this._flashC);
      if (frozen) m.emissive.add(this._frozenVrm);
    }
  }

  updateUnits(dt) {
    const b = this.battle;
    const alive = new Set(b.units);
    for (const [u, v] of this.views) if (!alive.has(u)) { this.disposeView(v); this.views.delete(u); }
    for (const u of b.units) {
      let v = this.views.get(u);
      if (!v) { v = this.makeUnitView(u); this.views.set(u, v); }
      const frozen = b.hasFlag(u, 'stun');
      const dx = u.x - v.last.x, dz = u.z - v.last.z;
      v.last.x = u.x; v.last.z = u.z;
      v.g.position.x = u.x; v.g.position.z = u.z;
      if (u.model === 'drone') v.g.position.y = 1.1 + Math.sin(u.anim * 4) * 0.15;
      // 朝向
      let wantYaw = v.yaw;
      if (Math.hypot(dx, dz) > 0.002) wantYaw = Math.atan2(dx, dz);
      else if (u.target?.alive && (u.attackT > 0 || u.casting)) wantYaw = Math.atan2(u.target.x - u.x, u.target.z - u.z);
      let dy = ((wantYaw - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      v.yaw += dy * Math.min(1, dt * 14);
      const flash = u.hurtT > 0 ? u.hurtT / 0.18 : 0;

      if (v.kind === 'vrm') {
        v.model.rotation.y = v.yaw + v.yawOff;
        this.animateVRM(v, u, dt, frozen);
      } else if (v.kind === 'robot') {
        v.model.rotation.y = v.yaw;
        if (!u.alive) this.playAnim(v, 'Death', 0.1);
        else if (u.dash || u.knockV) this.playAnim(v, 'Jump', 0.05);
        else if (u.attackT > 0) { if (v.anim !== 'Punch') this.playAnim(v, 'Punch', 0.05); }
        else if (u.moving) this.playAnim(v, 'Running');
        else if (v.anim !== 'Punch' || !v.actions.Punch.isRunning()) this.playAnim(v, 'Idle');
        v.mixer.update(frozen ? 0 : dt);
        if (flash) this._flashC.setRGB(flash * 1.6, flash * 1.6, flash * 1.6);
        for (const m of v.mats) {
          m.emissive.copy(m.userData.em);
          if (flash) m.emissive.add(this._flashC);
          if (frozen) m.emissive.add(this._frozenRobot);
        }
      } else {
        const sp = v.sprite;
        sp.quaternion.copy(this.camera.quaternion);
        const face = (u.facing || 1);
        let sy = 1, sx = 1;
        if (u.alive && !frozen) {
          const t = u.anim;
          if (u.model === 'slime') { sy = 1 + Math.sin(t * (u.moving ? 12 : 5)) * 0.12; sx = 2 - sy; }
          else if (u.model === 'totem') { sy = 1 + Math.sin(t * 4) * 0.03; }
          else sy = 1 + Math.sin(t * 6) * 0.03;
        }
        if (!u.alive) { sy = Math.max(0.05, sy * (v.deadT = Math.max(0, (v.deadT ?? 1) - dt * 2))); } else v.deadT = 1;
        sp.scale.set(v.baseScale.x * sx * face, v.baseScale.y * sy, 1);
        const lunge = u.attackT > 0 ? Math.sin(u.attackT / 0.22 * Math.PI) * 0.3 : 0;
        sp.position.x = lunge * face;
        v.mat.emissive.setRGB(flash * 2.2, flash * 2.2, flash * 2.2);
        if (frozen) v.mat.emissive.add(this._frozenSprite);
        v.mat.opacity = u.alive ? 1 : v.deadT;
      }
      // Buff 着色特效
      updateUnitFx(v.fx, u, this.battle.time);
      if (v.kind === 'vrm' && v.fx.active) {
        const e = fallbackEmissive(v.fx, this.battle.time);
        for (const m of v.mats) m.emissive.add(e);
      }
      // 冰冻、护盾
      v.ice.visible = u.alive && b.buffStacks(u, 'frozen') > 0;
      if (v.ice.visible) v.ice.rotation.y += dt * 0.3;
      const sh = b.shieldOf(u);
      v.bubble.visible = u.alive && sh > 0;
      if (v.bubble.visible) {
        v.bubble.rotation.y += dt * 0.8; v.bubble.rotation.x += dt * 0.3;
        v.bubble.material.opacity = 0.25 + 0.35 * Math.min(1, sh / (b.stat(u, 'maxHp') * 0.25)) + Math.sin(u.anim * 6) * 0.05;
      }
      // Buff 光环粒子（低画质关掉，角色着色器仍然保留）
      if (this.q.buffParticles && u.alive) for (const bf of u.buffs) {
        if (Math.random() < dt * (4 + bf.stacks)) {
          const a = Math.random() * 6.28, r = u.radius * rand(0.3, 1);
          this.glow.emit({ x: u.x + Math.cos(a) * r, y: rand(0.2, v.height), z: u.z + Math.sin(a) * r, vy: rand(0.6, 1.6),
            color: col(bf.def.color), intensity: 1.4, life: rand(0.4, 0.9), size: 0.12, drag: 0.5 });
        }
      }
      // 冲刺拖尾
      if (u.dash) {
        for (let i = 0; i < 6; i++) this.glow.emit({ x: u.x + rand(-0.3, 0.3), y: rand(0.2, v.height * 0.9), z: u.z + rand(-0.3, 0.3),
          vx: -u.dash.nx * rand(1, 4), vz: -u.dash.nz * rand(1, 4), color: col(u.dash.p.style), intensity: 2, life: rand(0.2, 0.5), size: rand(0.1, 0.22) });
        this.lightReq.push({ x: u.x, z: u.z, color: col(u.dash.p.style), i: 14 });
      }
    }
  }

  // ---------- 投射物 / 区域 / 光束 / 环绕 ----------
  updateProjectiles(dt) {
    const b = this.battle, live = new Set(b.projectiles);
    for (const [p, v] of this.pviews) if (!live.has(p) || p.dead) {
      this.pviews.delete(p);
      if (this.projPool.length < 48) { this.scene.remove(v); this.projPool.push(v); }
      else this.releaseObj(v);
    }
    for (const p of b.projectiles) {
      if (p.dead) continue;
      let v = this.pviews.get(p);
      const c = col(p.style);
      if (!v) {
        v = this.projPool.pop();
        if (v) {
          v.userData.core.material.color.copy(c).lerp(this._white, 0.6).multiplyScalar(2.2);
          v.userData.halo.material.color.copy(c).multiplyScalar(2);
          v.userData.core.scale.setScalar(0.16 * p.size);
          v.userData.halo.scale.setScalar(0.9 * p.size);
          this.scene.add(v);
        } else {
          v = new THREE.Group();
          const core = new THREE.Mesh(this.G.ico, new THREE.MeshBasicMaterial({ color: c.clone().lerp(this._white, 0.6).multiplyScalar(2.2) }));
          core.scale.setScalar(0.16 * p.size);
          const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, color: c.clone().multiplyScalar(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          halo.scale.setScalar(0.9 * p.size);
          v.add(core, halo); v.userData.core = core; v.userData.halo = halo;
          this.scene.add(v);
        }
        this.pviews.set(p, v);
      }
      v.position.set(p.x, p.y, p.z);
      v.userData.core.rotation.x += dt * 9; v.userData.core.rotation.y += dt * 7;
      const n = Math.ceil(3 * p.size);
      for (let i = 0; i < n; i++) this.glow.emit({ x: p.x + rand(-0.08, 0.08), y: p.y + rand(-0.08, 0.08), z: p.z + rand(-0.08, 0.08),
        vx: rand(-0.5, 0.5), vy: rand(-0.2, 0.8), vz: rand(-0.5, 0.5), color: c, intensity: 1.8, life: rand(0.15, 0.4), size: rand(0.08, 0.18) * p.size });
      if (p.style === 'fire' && Math.random() < 0.5) this.smoke.emit({ x: p.x, y: p.y, z: p.z, vy: 0.8, color: col('#2a1a18'), life: 0.6, size: 0.25 * p.size, shrink: false, drag: 2 });
      this.lightReq.push({ x: p.x, z: p.z, y: p.y, color: c, i: 10 * p.size });
    }
  }
  updateZones(dt) {
    const b = this.battle, live = new Set(b.zones);
    for (const [z, v] of this.zviews) if (!live.has(z)) { this.fadeOut(v, 0.4); this.zviews.delete(z); }
    for (const z of b.zones) {
      let v = this.zviews.get(z);
      const c = col(z.style);
      if (!v) {
        v = new THREE.Group();
        const d1 = new THREE.Mesh(this.G.disc, new THREE.MeshBasicMaterial({ map: this.T.noise, color: c.clone().multiplyScalar(0.7), ...ADD, opacity: 0.55 }));
        const d2 = new THREE.Mesh(this.G.disc, new THREE.MeshBasicMaterial({ map: this.T.rune, color: c.clone().multiplyScalar(1.3), ...ADD, opacity: 0.9 }));
        const edge = new THREE.Mesh(this.G.ring, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.8), ...ADD }));
        d1.position.y = 0.05; d2.position.y = 0.06; edge.position.y = 0.07;
        v.add(d1, d2, edge); v.userData = { d1, d2, edge, born: 0 };
        this.scene.add(v); this.zviews.set(z, v);
      }
      const ud = v.userData; ud.born = Math.min(1, ud.born + dt * 5);
      v.position.set(z.x, 0, z.z);
      v.scale.setScalar(z.radius * (0.5 + 0.5 * ud.born));
      ud.d1.rotation.y += dt * 0.6; ud.d2.rotation.y -= dt * 1.1;
      const left = z.p.duration - z.t;
      const fade = Math.min(1, left / 0.4);
      ud.d1.material.opacity = 0.55 * fade; ud.d2.material.opacity = (0.6 + Math.sin(z.t * 8) * 0.25) * fade; ud.edge.material.opacity = fade;
      const n = Math.min(36, Math.ceil(z.radius * z.radius * dt * 10));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * z.radius;
        this.glow.emit({ x: z.x + Math.cos(a) * r, y: 0.1, z: z.z + Math.sin(a) * r, vy: rand(0.8, 2.4), color: c, intensity: 1.5, life: rand(0.5, 1.1), size: rand(0.08, 0.2), drag: 0.6 });
      }
      if (z.style === 'poison' && Math.random() < dt * 10) {
        const a = Math.random() * 6.28, r = Math.random() * z.radius;
        this.smoke.emit({ x: z.x + Math.cos(a) * r, y: 0.3, z: z.z + Math.sin(a) * r, vy: 0.5, color: col('#2f6b1a'), life: 1.4, size: 0.8, shrink: false, drag: 1 });
      }
      this.lightReq.push({ x: z.x, z: z.z, color: c, i: 6 + z.radius * 2 });
    }
  }
  updateBeams(dt) {
    const b = this.battle, live = new Set(b.beams);
    for (const [bm, v] of this.bviews) if (!live.has(bm)) { this.releaseObj(v); this.bviews.delete(bm); }
    for (const bm of b.beams) {
      if (!bm.tgt) continue;
      let v = this.bviews.get(bm);
      const c = col(bm.style);
      if (!v) {
        v = new THREE.Group();
        const outer = new THREE.Mesh(this.G.cyl, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6), ...ADD, opacity: 0.7 }));
        const core = new THREE.Mesh(this.G.cyl, new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff').multiplyScalar(2.5), ...ADD }));
        v.add(outer, core); v.userData = { outer, core };
        this.scene.add(v); this.bviews.set(bm, v);
      }
      const a = this._ba.set(bm.owner.x, 1.1 * bm.owner.scale, bm.owner.z), t = this._bt.set(bm.tgt.x, 0.9, bm.tgt.z);
      const dir = this._bd.subVectors(t, a), len = dir.length();
      v.position.copy(a).addScaledVector(dir, 0.5);
      if (len > 1e-4) dir.multiplyScalar(1 / len);
      v.quaternion.setFromUnitVectors(this._up, dir);
      const w = bm.p.width * (0.16 + Math.sin(bm.t * 40) * 0.03) * (1 + bm.n * 0.02);
      v.userData.outer.scale.set(w, len, w); v.userData.core.scale.set(w * 0.35, len, w * 0.35);
      for (let i = 0; i < 4; i++) {
        const k = Math.random();
        this.glow.emit({ x: a.x + dir.x * len * k, y: a.y + dir.y * len * k, z: a.z + dir.z * len * k, vx: rand(-1, 1), vy: rand(-1, 1), vz: rand(-1, 1), color: c, intensity: 2, life: 0.3, size: 0.12 });
      }
      for (let i = 0; i < 3; i++) this.glow.emit({ x: t.x, y: t.y, z: t.z, vx: rand(-4, 4), vy: rand(0, 5), vz: rand(-4, 4), color: c, intensity: 2, life: 0.4, size: 0.14, gravity: 8 });
      this.lightReq.push({ x: t.x, z: t.z, color: c, i: 20 });
      this.lightReq.push({ x: a.x, z: a.z, color: c, i: 10 });
    }
  }
  updateOrbits(dt) {
    const b = this.battle, live = new Set(b.orbits);
    for (const [o, v] of this.oviews) if (!live.has(o)) { this.releaseObj(v); this.oviews.delete(o); }
    for (const o of b.orbits) {
      if (!o.points) continue;
      let v = this.oviews.get(o);
      const c = col(o.style);
      if (!v) {
        v = new THREE.Group();
        for (let i = 0; i < o.p.count; i++) {
          const m = new THREE.Mesh(this.G.oct, new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color('#fff'), 0.4).multiplyScalar(2) }));
          m.scale.set(0.12, 0.12, 0.5); v.add(m);
        }
        this.scene.add(v); this.oviews.set(o, v);
      }
      o.points.forEach((pt, i) => {
        const m = v.children[i]; if (!m) return;
        m.position.set(pt.x, 1, pt.z);
        m.rotation.y = -o.ang - i / o.p.count * Math.PI * 2;
        this.glow.emit({ x: pt.x, y: 1, z: pt.z, color: c, intensity: 1.8, life: 0.25, size: 0.16, vy: 0.2 });
      });
      this.lightReq.push({ x: o.owner.x, z: o.owner.z, color: c, i: 8 });
    }
  }

  // 蓄力/输入期间：粒子向施法者汇聚，越蓄越密
  updateInputFx(dt) {
    for (const s of this.battle.inputs) {
      const u = s.unit; if (!u.alive || s.done) continue;
      const styleKey = s.mode === 'qte' ? '#ffd166' : (STYLE_COLORS[s.ctx?.ability && this.battle.lib.abilities[s.ctx.ability]?.timeline?.find(b => b.p?.style)?.p.style] || '#ffd166');
      const v = this.views.get(u), c = col(styleKey);
      const n = Math.random() < dt * (14 + 70 * s.ratio) ? 1 + (s.ratio > 0.6 ? 1 : 0) : 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, r = 1.4 - 0.6 * s.ratio, y = (v?.height || 1.8) * rand(0.2, 0.9);
        this.glow.emit({ x: u.x + Math.cos(a) * r, y, z: u.z + Math.sin(a) * r, vx: -Math.cos(a) * 3, vz: -Math.sin(a) * 3, vy: 0, color: c, intensity: 1.6 + s.ratio * 1.4, life: 0.4, size: 0.1 + 0.1 * s.ratio, drag: 0 });
      }
      this.lightReq.push({ x: u.x, z: u.z, color: c, i: 4 + 14 * s.ratio });
    }
  }
  updateLasers(dt) {
    const b = this.battle, live = new Set(b.lasers);
    for (const [L, v] of this.lviews) if (!live.has(L)) { this.releaseObj(v); this.lviews.delete(L); }
    for (const L of b.lasers) {
      if (L.ex === undefined) continue;
      let v = this.lviews.get(L);
      const c = col(L.style);
      if (!v) {
        v = new THREE.Group();
        const mk = (color, op) => new THREE.Mesh(this.G.box, new THREE.MeshBasicMaterial({ color, ...ADD, opacity: op }));
        const outer = mk(c.clone().multiplyScalar(1.8), 0.75), core = mk(new THREE.Color('#fff').multiplyScalar(3), 1);
        const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, color: c.clone().multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        const end = muzzle.clone();
        v.add(outer, core, muzzle, end); v.userData = { outer, core, muzzle, end };
        this.scene.add(v); this.lviews.set(L, v);
      }
      const y = 1.0, len = Math.max(0.1, L.len);
      const fade = L.p.followInput && L.ctx.input ? (L.ctx.input.done ? 0 : 1) : L.p.duration > 0 ? Math.min(1, (Math.max(0.12, L.p.duration) - L.t) / 0.15) : 1 - L.t / 0.12;
      const w = (L.width ?? L.p.width) * (0.9 + Math.sin(L.t * 60) * 0.12) * Math.max(0, fade) * Math.min(1, L.t * 12 + 0.3);
      const ud = v.userData;
      for (const [m, k] of [[ud.outer, 1], [ud.core, 0.35]]) {
        m.position.set((L.fx + L.ex) / 2, y, (L.fz + L.ez) / 2);
        m.rotation.set(0, -L.angle, 0);
        m.scale.set(len, w * k * 0.6, w * k);
      }
      ud.muzzle.position.set(L.fx, y, L.fz); ud.muzzle.scale.setScalar(w * 2.2);
      ud.end.position.set(L.ex, y, L.ez); ud.end.scale.setScalar(w * 2.8);
      for (let i = 0; i < 4; i++) this.glow.emit({ x: L.ex, y, z: L.ez, vx: rand(-5, 5), vy: rand(0, 6), vz: rand(-5, 5), color: c, intensity: 2.4, life: 0.35, size: rand(0.1, 0.2), gravity: 10 });
      for (let i = 0; i < 2; i++) { const k = Math.random(); this.glow.emit({ x: L.fx + (L.ex - L.fx) * k, y: y + rand(-0.1, 0.1), z: L.fz + (L.ez - L.fz) * k, vy: rand(0.5, 1.5), color: c, intensity: 2, life: 0.3, size: 0.1 }); }
      this.lightReq.push({ x: L.ex, z: L.ez, color: c, i: 30 }, { x: L.fx, z: L.fz, color: c, i: 18 }, { x: (L.fx + L.ex) / 2, z: (L.fz + L.ez) / 2, color: c, i: 22 });
    }
  }

  // ---------- 一次性特效 ----------
  addEffect(obj, life, fn) { this.scene.add(obj); this.effects.push({ obj, t: 0, life, fn }); }
  fadeOut(group, life) {
    this.effects.push({ obj: group, t: 0, life, fn: (k) => group.traverse(o => { if (o.material) o.material.opacity = (o.material.userData.o0 ??= o.material.opacity) * (1 - k); }) });
  }
  ring(x, z, r0, r1, color, life, opts = {}) {
    const m = new THREE.Mesh(opts.thin ? this.G.thinRing : this.G.ring, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(opts.i ?? 2), ...ADD }));
    m.position.set(x, opts.y ?? 0.08, z);
    this.addEffect(m, life, (k) => { const e = 1 - Math.pow(1 - k, 3); m.scale.setScalar(r0 + (r1 - r0) * e); m.material.opacity = 1 - k; });
  }
  disc(x, z, r, color, life, op = 0.6) {
    const m = new THREE.Mesh(this.G.disc, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.5), ...ADD, opacity: op }));
    m.position.set(x, 0.06, z); m.scale.setScalar(r);
    this.addEffect(m, life, (k) => { m.material.opacity = op * (1 - k); });
  }
  burst(x, y, z, color, n, spd = 5, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, e = rand(-0.3, 1);
      const s = rand(0.3, 1) * spd;
      this.glow.emit({ x, y, z, vx: Math.cos(a) * s, vy: e * s * (o.up ?? 0.8), vz: Math.sin(a) * s,
        color, intensity: o.intensity ?? 2, life: rand(0.25, o.life ?? 0.7), size: rand(0.08, o.size ?? 0.22), gravity: o.gravity ?? 6, drag: o.drag ?? 2 });
    }
  }
  flashLight(x, z, color, i, life) {
    const e = { x, z, color, i, t: 0, life };
    this.effects.push({ obj: null, t: 0, life, fn: (k) => this.lightReq.push({ ...e, i: i * (1 - k) }) });
  }
  bolt(a, b, color, life = 0.18, segs = 9, jitter = 0.35) {
    const pts = []; for (let i = 0; i <= segs; i++) pts.push(new THREE.Vector3());
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.userData.own = true;
    const innerGeo = geo.clone();
    innerGeo.userData.own = true;
    const outer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(2.5), ...ADD }));
    const inner = new THREE.Line(innerGeo, new THREE.LineBasicMaterial({ color: col('#fff').clone().multiplyScalar(3), ...ADD }));
    const g = new THREE.Group(); g.add(outer, inner);
    const jit = () => {
      for (const ln of [outer, inner]) {
        const p = ln.geometry.attributes.position;
        for (let i = 0; i <= segs; i++) {
          const k = i / segs, j = (i === 0 || i === segs) ? 0 : jitter * (ln === inner ? 0.4 : 1);
          p.setXYZ(i, a.x + (b.x - a.x) * k + rand(-j, j), a.y + (b.y - a.y) * k + rand(-j, j), a.z + (b.z - a.z) * k + rand(-j, j));
        }
        p.needsUpdate = true;
      }
    };
    jit();
    this.addEffect(g, life, (k) => { if (Math.random() < 0.6) jit(); outer.material.opacity = inner.material.opacity = 1 - k; });
  }
  billboardSlash(x, y, z, color, rot, scale, life = 0.2, geo) {
    const m = new THREE.Mesh(geo || this.G.slash, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.6), ...ADD }));
    m.position.set(x, y, z); m.quaternion.copy(this.camera.quaternion); m.rotateZ(rot);
    this.addEffect(m, life, (k) => { m.scale.setScalar(scale * (0.7 + k * 0.6)); m.material.opacity = 1 - k * k; m.rotateZ(0.02); });
  }

  makeFx() {
    const A = this;
    const H = (u) => (A.views.get(u)?.height || 1.8);
    return {
      strike(src, t, vfx, style, i) {
        const c = col(style), y = H(t) * 0.55;
        if (vfx === 'slash') A.billboardSlash(t.x, y, t.z, c, (i % 2 ? 2.4 : 0.3) + rand(-0.4, 0.4), 1.1);
        else if (vfx === 'claw') for (let k = -1; k <= 1; k++) {
          const m = new THREE.Mesh(A.G.plane, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.5), ...ADD }));
          m.position.set(t.x, y, t.z); m.quaternion.copy(A.camera.quaternion); m.rotateZ(0.7); m.translateX(k * 0.28);
          A.addEffect(m, 0.22, (q) => { m.scale.set(0.07, 1.4 * Math.min(1, q * 4), 1); m.material.opacity = 1 - q; });
        } else if (vfx === 'pierce') {
          const m = new THREE.Mesh(A.G.plane, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.8), ...ADD }));
          m.position.set(t.x, y, t.z); m.quaternion.copy(A.camera.quaternion);
          m.rotateZ(Math.atan2(-(t.z - src.z) * 0.6, t.x - src.x));
          A.addEffect(m, 0.2, (q) => { m.scale.set(2.6 * (0.5 + q), 0.09 * (1 - q), 1); m.material.opacity = 1 - q; });
        } else A.ring(t.x, t.z, 0.2, 1.4, c, 0.25);
        A.burst(t.x, y, t.z, c, 10, 6, { up: 0.6 });
        if (style === 'blood') for (let k = 0; k < 6; k++) A.smoke.emit({ x: t.x, y, z: t.z, vx: rand(-3, 3), vy: rand(1, 4), vz: rand(-3, 3), color: new THREE.Color('#8a0018'), life: 0.7, size: 0.1, gravity: 14, drag: 0.5, shrink: false });
        A.flashLight(t.x, t.z, c, 14, 0.12);
      },
      muzzle(u, style) { A.burst(u.x, (u.id ? H(u) : 1.6) * 0.6, u.z, col(style), 10, 3); },
      fizzle(x, z, style) { A.burst(x, 1, z, col(style), 6, 2, { gravity: 0 }); },
      burstAt(x, z, style) { A.ring(x, z, 0.1, 1, col(style), 0.25, { y: 1, thin: true }); A.burst(x, 1, z, col(style), 12, 5); A.flashLight(x, z, col(style), 20, 0.15); },
      impact(x, z, style, size = 1) {
        const c = col(style);
        A.burst(x, 0.9, z, c, Math.ceil(12 * size), 5 * size);
        A.ring(x, z, 0.1, 1.1 * size, c, 0.3, { y: 0.9, thin: true });
        A.flashLight(x, z, c, 18 * size, 0.15);
      },
      explosion(x, z, r, style, scale = 1) {
        const c = col(style), white = new THREE.Color('#fff');
        A.ring(x, z, 0.2, r * 1.05, c, 0.4 * scale + 0.1, { i: 2.5 });
        A.ring(x, z, 0.1, r * 0.7, white, 0.25, { i: 1.5 });
        A.disc(x, z, r, c, 0.35, 0.55);
        A.flashLight(x, z, c, 40 * Math.min(2, scale * r / 2), 0.35);
        const n = Math.ceil((25 + r * 22) * scale);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * 6.28, s = rand(2, 7) * Math.sqrt(r) * 0.8;
          A.glow.emit({ x: x + Math.cos(a) * 0.3, y: 0.3, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * s, vy: rand(1, 6), vz: Math.sin(a) * s,
            color: Math.random() < 0.2 ? white : c, intensity: 2.2, life: rand(0.3, 0.9), size: rand(0.1, 0.28), gravity: 9, drag: 2.5 });
        }
        if (style === 'fire') {
          for (let i = 0; i < 14 * scale; i++) A.smoke.emit({ x: x + rand(-r, r) * 0.5, y: 0.4, z: z + rand(-r, r) * 0.5, vx: rand(-1, 1), vy: rand(1.5, 3.5), vz: rand(-1, 1), color: new THREE.Color('#1e1418'), life: rand(1, 1.8), size: rand(0.5, 1.1), shrink: false, drag: 1.4 });
          const sc = new THREE.Mesh(A.G.disc, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.55, depthWrite: false }));
          sc.position.set(x, 0.015, z); sc.scale.setScalar(r * 0.8);
          A.addEffect(sc, 4, (k) => { sc.material.opacity = 0.55 * (1 - k); });
        } else if (style === 'frost') {
          for (let i = 0; i < 8; i++) {
            const a = i / 8 * 6.28 + rand(-0.2, 0.2), d = rand(0.4, 0.9) * r;
            const s = new THREE.Mesh(A.G.cone, new THREE.MeshStandardMaterial({ color: '#bff4ff', emissive: '#3aa8ff', emissiveIntensity: 0.8, flatShading: true, transparent: true }));
            s.position.set(x + Math.cos(a) * d, 0, z + Math.sin(a) * d); s.rotation.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
            const hh = rand(0.6, 1.4);
            A.addEffect(s, 1.2, (k) => { const g = Math.min(1, k * 8); s.scale.set(0.25, hh * g, 0.25); s.position.y = hh * g * 0.5; s.material.opacity = k > 0.7 ? (1 - k) / 0.3 : 1; });
          }
        } else if (style === 'holy') {
          const p = new THREE.Mesh(A.G.cyl, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2), ...ADD }));
          p.position.set(x, 6, z);
          A.addEffect(p, 0.5, (k) => { p.scale.set(r * 0.5 * (1 - k), 12, r * 0.5 * (1 - k)); p.material.opacity = 1 - k; });
        } else if (style === 'storm') {
          for (let i = 0; i < 3; i++) A.bolt(new THREE.Vector3(x + rand(-1, 1), 12, z + rand(-1, 1)), new THREE.Vector3(x + rand(-r, r) * 0.4, 0, z + rand(-r, r) * 0.4), c, 0.25, 12, 0.8);
        } else if (style === 'shadow' || style === 'arcane') {
          for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28, d = r * rand(0.8, 1.3); A.glow.emit({ x: x + Math.cos(a) * d, y: rand(0.2, 1.5), z: z + Math.sin(a) * d, vx: -Math.cos(a) * d * 3, vz: -Math.sin(a) * d * 3, vy: 1, color: c, intensity: 2, life: 0.35, size: 0.15, drag: 0 }); }
          const rn = new THREE.Mesh(A.G.disc, new THREE.MeshBasicMaterial({ map: A.T.rune, color: c.clone().multiplyScalar(2), ...ADD }));
          rn.position.set(x, 0.08, z);
          A.addEffect(rn, 0.6, (k) => { rn.scale.setScalar(r * (0.6 + k * 0.5)); rn.rotation.y = k * 3; rn.material.opacity = 1 - k; });
        } else if (style === 'poison') {
          for (let i = 0; i < 16; i++) A.smoke.emit({ x: x + rand(-r, r) * 0.6, y: 0.3, z: z + rand(-r, r) * 0.6, vy: rand(0.5, 1.5), color: new THREE.Color('#2f6b1a'), life: 1.5, size: rand(0.6, 1), shrink: false });
        } else if (style === 'blood') {
          for (let i = 0; i < 30; i++) A.smoke.emit({ x, y: 0.8, z, vx: rand(-6, 6), vy: rand(2, 7), vz: rand(-6, 6), color: new THREE.Color('#9a0020'), life: 0.9, size: rand(0.1, 0.2), gravity: 16, drag: 0.6, shrink: false });
        }
      },
      telegraph(x, z, r, delay, style) {
        const c = col(style);
        const edge = new THREE.Mesh(A.G.ring, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6), ...ADD }));
        const fill = new THREE.Mesh(A.G.disc, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.8), ...ADD, opacity: 0.35 }));
        const base = new THREE.Mesh(A.G.disc, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.4), ...ADD, opacity: 0.2 }));
        edge.position.set(x, 0.07, z); fill.position.set(x, 0.06, z); base.position.set(x, 0.05, z);
        edge.scale.setScalar(r); base.scale.setScalar(r);
        A.addEffect(edge, delay, (k) => { edge.material.opacity = 0.6 + Math.sin(k * 40) * 0.3; });
        A.addEffect(base, delay, () => {});
        A.addEffect(fill, delay, (k) => { fill.scale.setScalar(Math.max(0.01, r * k)); });
        if (style === 'fire' && delay >= 0.4) {
          const m = new THREE.Mesh(A.G.ico, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb060').multiplyScalar(2.5) }));
          const from = new THREE.Vector3(x + 5, 16, z - 5);
          m.scale.setScalar(0.35 + r * 0.12);
          A.addEffect(m, delay, (k) => {
            const e = k * k;
            m.position.lerpVectors(from, new THREE.Vector3(x, 0.3, z), e); m.rotation.x += 0.3;
            for (let i = 0; i < 5; i++) A.glow.emit({ x: m.position.x + rand(-0.2, 0.2), y: m.position.y, z: m.position.z + rand(-0.2, 0.2), vy: 1, color: c, intensity: 2.5, life: 0.5, size: rand(0.15, 0.35) });
            A.smoke.emit({ x: m.position.x, y: m.position.y, z: m.position.z, color: col('#251615'), life: 1, size: 0.7, shrink: false });
            A.lightReq.push({ x: m.position.x, y: m.position.y, z: m.position.z, color: c, i: 30 });
          });
        }
      },
      lightning(a, b, style) {
        const c = col(style);
        A.bolt(new THREE.Vector3(a.x, H(a) * 0.6, a.z), new THREE.Vector3(b.x, H(b) * 0.6, b.z), c);
        A.burst(b.x, H(b) * 0.6, b.z, c, 12, 6);
        A.flashLight(b.x, b.z, c, 24, 0.15);
      },
      blink(u, from, to, style) {
        const c = col(style), h = H(u);
        for (const p of [from, to]) {
          A.ring(p.x, p.z, 0.2, 1.6, c, 0.35);
          for (let i = 0; i < 26; i++) A.glow.emit({ x: p.x + rand(-0.4, 0.4), y: rand(0, h), z: p.z + rand(-0.4, 0.4), vy: rand(1, 4), vx: rand(-1, 1), vz: rand(-1, 1), color: c, intensity: 2.2, life: rand(0.3, 0.7), size: rand(0.1, 0.2), drag: 2 });
        }
        const n = 30;
        for (let i = 0; i < n; i++) { const k = i / n; A.glow.emit({ x: from.x + (to.x - from.x) * k, y: rand(0.3, h), z: from.z + (to.z - from.z) * k, color: c, intensity: 1.6, life: rand(0.2, 0.45), size: 0.12, drag: 4 }); }
        A.flashLight(to.x, to.z, c, 30, 0.25);
      },
      dashStart(u, style) { A.ring(u.x, u.z, 0.3, 2, col(style), 0.3); },
      cast(u, a) {
        const c = new THREE.Color(a.color || '#fff');
        const rn = new THREE.Mesh(A.G.disc, new THREE.MeshBasicMaterial({ map: A.T.rune, color: c.clone().multiplyScalar(1.8), ...ADD }));
        rn.position.set(u.x, 0.09, u.z);
        A.addEffect(rn, 0.7, (k) => { rn.position.set(u.x, 0.09, u.z); rn.scale.setScalar(1.6 * Math.min(1, k * 5)); rn.rotation.y = k * 4; rn.material.opacity = 1 - k; });
        for (let i = 0; i < 20; i++) { const ang = Math.random() * 6.28, d = rand(1.2, 2); A.glow.emit({ x: u.x + Math.cos(ang) * d, y: rand(0.2, 1.6), z: u.z + Math.sin(ang) * d, vx: -Math.cos(ang) * d * 4, vz: -Math.sin(ang) * d * 4, color: c, intensity: 2, life: 0.25, size: 0.13, drag: 0 }); }
      },
      proc(u, a) {
        const c = new THREE.Color(a.color || '#fff');
        A.ring(u.x, u.z, 0.4, 1.2, c, 0.4, { thin: true });
        A.spawnText(u, `✧${a.name}`, a.color, 'proc');
      },
      heal(u) {
        const c = new THREE.Color('#4dff9a');
        for (let i = 0; i < 18; i++) A.glow.emit({ x: u.x + rand(-0.5, 0.5), y: rand(0, 0.5), z: u.z + rand(-0.5, 0.5), vy: rand(1.5, 3), color: c, intensity: 1.8, life: rand(0.6, 1), size: rand(0.1, 0.2), drag: 0.8 });
        A.ring(u.x, u.z, 0.3, 1.2, c, 0.5, { thin: true });
      },
      shieldUp(u) { A.ring(u.x, u.z, 0.3, 1.5, new THREE.Color('#6fe3ff'), 0.4); A.burst(u.x, H(u) * 0.5, u.z, new THREE.Color('#6fe3ff'), 16, 3); },
      buff(u, def) { A.burst(u.x, H(u) * 0.7, u.z, new THREE.Color(def.color), 6, 2, { gravity: 0 }); },
      dotTick(u, def) { A.burst(u.x, H(u) * 0.5, u.z, new THREE.Color(def.color), 4, 2.5, { gravity: -2 }); },
      death(u) {
        const c = u.team === 0 ? new THREE.Color('#6fe3ff') : new THREE.Color('#ff3b5c');
        A.burst(u.x, 0.8, u.z, c, 50, 8, { life: 1 });
        A.ring(u.x, u.z, 0.2, 3, c, 0.6);
        A.flashLight(u.x, u.z, c, 40, 0.4);
      },
      spawn(u) {
        const c = new THREE.Color(u.team === 0 ? '#6fe3ff' : '#ff9e6b');
        const p = new THREE.Mesh(A.G.cyl, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.1), ...ADD, opacity: 0.7 }));
        p.position.set(u.x, 4, u.z);
        A.addEffect(p, 0.5, (k) => { p.scale.set(0.5 * (1 - k), 8, 0.5 * (1 - k)); p.material.opacity = 0.7 * (1 - k); });
        A.ring(u.x, u.z, 0.2, 2, c, 0.5);
        const v = A.views.get(u); if (v?.kind === 'robot') { v.anim = null; A.playAnim(v, 'Idle', 0.01); }
      },
      zonePulse(z) { A.ring(z.x, z.z, 0.2, z.radius, col(z.style), 0.45, { thin: true, i: 1.2 }); },
      number: (u, amt, o) => A.spawnNumber(u, amt, o),
      text: (u, t, c) => A.spawnText(u, t, c),
      shake: (a) => { A.shakeAmt = Math.min(1.6, A.shakeAmt + a); },
      flash: (c, a) => A.onFlash?.(c, a),
    };
  }

  // ---------- DOM 浮字与血条 ----------
  project(x, y, z) {
    const v = this._proj.set(x, y, z).project(this.camera);
    const o = this._pout;
    o.x = (v.x + 1) / 2 * this.cssW; o.y = (1 - v.y) / 2 * this.cssH; o.vis = v.z < 1;
    return o;
  }
  spawnNumber(u, amt, o = {}) {
    const el = document.createElement('div');
    let cls = 'num ' + (o.type || '');
    if (o.crit) cls += ' crit';
    if (o.heal) cls += ' heal';
    if (o.shield) cls += ' shield';
    if (o.kind === 'dot') cls += ' dot';
    el.className = cls;
    el.textContent = (o.heal ? '+' : o.shield ? '⛨' : '') + amt + (o.crit ? '!' : '') + (o.absorbed ? ` (${o.absorbed})` : '');
    this.overlay.appendChild(el);
    const h = this.views.get(u)?.height || 1.8;
    this.numbers.push({ el, x: u.x, y: h + 0.3, z: u.z, t: 0, life: o.crit ? 1.1 : 0.85, dx: rand(-30, 30), crit: o.crit });
  }
  spawnText(u, text, color = '#fff', cls = '') {
    const el = document.createElement('div');
    el.className = 'num text ' + cls; el.textContent = text; el.style.color = color;
    this.overlay.appendChild(el);
    const h = this.views.get(u)?.height || 1.8;
    this.numbers.push({ el, x: u.x, y: h + 0.8, z: u.z, t: 0, life: 1.1, dx: 0 });
  }
  updateNumbers(dt) {
    this.numbers = this.numbers.filter(n => {
      n.t += dt;
      if (n.t >= n.life) { n.el.remove(); return false; }
      const k = n.t / n.life;
      const p = this.project(n.x, n.y, n.z);
      const pop = n.crit ? (k < 0.12 ? 1 + (0.12 - k) * 10 : 1) : (k < 0.1 ? 1.4 - k * 4 : 1);
      n.el.style.transform = `translate(${p.x + n.dx * k}px, ${p.y - k * 60}px) translate(-50%,-50%) scale(${pop})`;
      n.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
      return true;
    });
  }
  updatePlates() {
    const b = this.battle, seen = new Set();
    for (const u of b.units) {
      seen.add(u);
      let pl = this.plates.get(u);
      if (!pl) {
        const el = document.createElement('div');
        el.className = 'plate' + (u.team === 0 ? ' ally' : '') + (u.ai === 'boss' ? ' boss' : '');
        el.innerHTML = `<div class="pname"></div><div class="hpbar"><i class="ghost"></i><i class="hp"></i><i class="sh"></i></div><div class="castbar"><i></i></div><div class="buffs"></div>`;
        this.overlay.appendChild(el);
        pl = { el, name: el.querySelector('.pname'), ghost: el.querySelector('.ghost'), hp: el.querySelector('.hp'), sh: el.querySelector('.sh'),
          cast: el.querySelector('.castbar'), castI: el.querySelector('.castbar i'), buffs: el.querySelector('.buffs'), ghostPct: 1, sig: '' };
        this.plates.set(u, pl);
      }
      const h = (this.views.get(u)?.height || 1.8) + 0.45;
      const p = this.project(u.x, h, u.z);
      pl.el.style.display = u.alive && p.vis ? '' : 'none';
      if (!u.alive) continue;
      pl.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%,-100%)`;
      const max = b.stat(u, 'maxHp'), pct = Math.max(0, u.hp / max), sh = b.shieldOf(u);
      if (pl.name.textContent !== u.name) pl.name.textContent = u.name;
      pl.hp.style.width = pct * 100 + '%';
      pl.ghostPct = Math.max(pct, pl.ghostPct - 0.01);
      if (pl.ghostPct < pct) pl.ghostPct = pct;
      pl.ghost.style.width = pl.ghostPct * 100 + '%';
      pl.sh.style.width = Math.min(1, sh / max) * 100 + '%';
      if (u.casting && u.casting.end > u.casting.start) {
        pl.cast.style.display = '';
        pl.castI.style.width = Math.min(1, (b.time - u.casting.start) / (u.casting.end - u.casting.start)) * 100 + '%';
      } else pl.cast.style.display = 'none';
      const sig = u.buffs.map(x => x.id + x.stacks).join();
      if (sig !== pl.sig) {
        pl.sig = sig;
        pl.buffs.innerHTML = u.buffs.map(x => `<span class="bi ${x.def.debuff ? 'de' : ''}" style="--c:${x.def.color}" title="${x.def.name}">${x.def.icon}${x.stacks > 1 ? `<sub>${x.stacks}</sub>` : ''}</span>`).join('');
      }
    }
    for (const [u, pl] of this.plates) if (!seen.has(u)) { pl.el.remove(); this.plates.delete(u); }
  }

  // ---------- 拾取 ----------
  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hit = this._hit;
    this.raycaster.ray.intersectPlane(this._floor, hit);
    let unit = null, best = 1.4;
    for (const u of this.battle.units) {
      if (!u.alive) continue;
      // 用屏幕距离挑选，比射线更宽容
      const p = this.project(u.x, (this.views.get(u)?.height || 1.6) * 0.5, u.z);
      const d = Math.hypot(p.x - (clientX - r.left), p.y - (clientY - r.top)) / 40;
      if (d < best) { best = d; unit = u; }
    }
    return { point: { x: hit.x, z: hit.z }, unit };
  }

  // ---------- 主渲染 ----------
  render(dt) {
    const b = this.battle;
    this.lightReq.length = 0;
    this.glow.beginFrame(); this.smoke.beginFrame();
    this.updateUnits(dt);
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.updateBeams(dt);
    this.updateOrbits(dt);
    this.updateLasers(dt);
    this.updateInputFx(dt);
    this.effects = this.effects.filter(e => {
      e.t += dt;
      const k = Math.min(1, e.t / e.life);
      e.fn?.(k);
      if (k >= 1) { if (e.obj) this.releaseObj(e.obj); return false; }
      return true;
    });
    this.glow.update(dt); this.smoke.update(dt);
    // 火把（隐藏的灯保持 visible=false，避免点光源数量来回变导致着色器重编译）
    for (const t of this.torches) {
      if (!t.l.visible) continue;
      t.l.intensity = 14 + Math.sin(b.time * 13 + t.seed) * 3 + Math.random() * 3;
      if (this.q.torchParticles && Math.random() < dt * 30) this.glow.emit({ x: t.x + rand(-0.2, 0.2), y: 3.6, z: t.z + rand(-0.2, 0.2), vy: rand(1, 2.5), color: col('#ff8a3d'), intensity: 2, life: rand(0.3, 0.7), size: rand(0.1, 0.2), drag: 1 });
    }
    // 环境尘埃
    if (this.q.dust && Math.random() < dt * 20) this.glow.emit({ x: rand(-14, 14), y: rand(0.2, 4), z: rand(-10, 10), vx: rand(-0.2, 0.2), vy: rand(0.05, 0.3), color: col('#8a7dff'), intensity: 0.8, life: rand(2, 4), size: 0.06, drag: 0, shrink: false });
    this.centerRune.rotation.z += dt * 0.05;
    // 动态光
    this.lightReq.sort((x, y) => y.i - x.i);
    for (let i = 0; i < this.dynLightN; i++) {
      const l = this.lights[i], q = this.lightReq[i];
      if (!q) { l.intensity = 0; continue; }
      l.position.set(q.x, q.y ?? 1.2, q.z); l.color.copy(q.color); l.intensity = Math.min(60, q.i);
    }
    // 光标 / 目标
    const hero = b.hero;
    this.reticle.position.x = b.input.point.x; this.reticle.position.z = b.input.point.z;
    this.reticle.rotation.y += dt;
    const tg = hero?.target?.alive ? hero.target : null;
    this.targetRing.visible = !!tg;
    if (tg) { this.targetRing.position.x = tg.x; this.targetRing.position.z = tg.z; this.targetRing.scale.setScalar(tg.radius * (1.25 + Math.sin(b.time * 6) * 0.08)); }
    if (this.hover && hero) {
      this.rangeRing.visible = this.hover.range > 0;
      this.rangeRing.position.set(hero.x, 0.03, hero.z); this.rangeRing.scale.setScalar(this.hover.range || 1);
      this.aoePreview.visible = this.hover.radius > 0;
      const c = this.hover.center === 'self' ? hero : this.hover.center === 'target' ? (tg || hero) : b.input.point;
      this.aoePreview.position.set(c.x, 0.035, c.z); this.aoePreview.scale.setScalar(this.hover.radius || 1);
    } else { this.rangeRing.visible = this.aoePreview.visible = false; }
    // 镜头
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    const s = this.shakeAmt * this.shakeAmt * 0.6;
    const follow = this._follow;
    if (hero) follow.set(hero.x * 0.18, 0, hero.z * 0.12); else follow.set(0, 0, 0);
    this.camera.position.copy(this.camBase).add(follow).add(this._shake.set(rand(-s, s), rand(-s, s), rand(-s, s)));
    this.camera.lookAt(follow.x, 0, 0.6 + follow.z);
    if (this.bloom.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.updatePlates();
    this.updateNumbers(dt);
  }
}
