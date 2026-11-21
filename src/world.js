// Environment: dusk sky, ground, yard, trees, lights, shadow/glow/highlight layers, and the
// (not yet playable) forge corner for the next phase.
import { B, V3, mat, noiseTex, lump, rand } from './util.js';

export function buildWorld(scene) {
  scene.clearColor = new B.Color4(0.42, 0.36, 0.38, 1);
  scene.ambientColor = new B.Color3(0.3, 0.3, 0.34);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.022;
  scene.fogColor = new B.Color3(0.5, 0.42, 0.42);

  const hemi = new B.HemisphericLight('hemi', V3(0, 1, 0), scene);
  hemi.intensity = 0.5; hemi.diffuse = new B.Color3(0.72, 0.78, 1); hemi.groundColor = new B.Color3(0.28, 0.22, 0.2);
  hemi.specular = B.Color3.Black();
  const sun = new B.DirectionalLight('sun', V3(-0.55, -0.62, 0.55).normalize(), scene);
  sun.position = V3(10, 14, -6); sun.intensity = 1.5; sun.diffuse = new B.Color3(1, 0.78, 0.58);
  sun.specular = new B.Color3(0.4, 0.3, 0.2);
  const shadow = new B.ShadowGenerator(2048, sun);
  shadow.usePercentageCloserFiltering = true; shadow.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
  shadow.bias = 0.0006; shadow.normalBias = 0.015; shadow.darkness = 0.25;
  sun.shadowMinZ = 1; sun.shadowMaxZ = 40;

  const glow = new B.GlowLayer('glow', scene, { mainTextureFixedSize: 512, blurKernelSize: 40 });
  glow.intensity = 0.85;
  glow.customEmissiveColorSelector = (mesh, sub, material, result) => {
    const e = material && material.emissiveColor, k = (mesh.metadata && mesh.metadata.glowScale) ?? 1;
    if (e) result.set(e.r * k, e.g * k, e.b * k, 1); else result.set(0, 0, 0, 1);
  };
  const hl = new B.HighlightLayer('hl', scene);
  hl.blurHorizontalSize = 0.5; hl.blurVerticalSize = 0.5; hl.innerGlow = false;

  // ---- sky ----
  const sky = B.MeshBuilder.CreateSphere('sky', { diameter: 400, segments: 16, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const st = new B.DynamicTexture('skyTex', { width: 8, height: 256 }, scene, false);
  const ctx = st.getContext();
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#243156'); grad.addColorStop(0.32, '#5a5a80'); grad.addColorStop(0.45, '#c58a72');
  grad.addColorStop(0.5, '#eaa274'); grad.addColorStop(0.53, '#7a6262'); grad.addColorStop(1, '#2a2424');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 8, 256); st.update();
  const sm = new B.StandardMaterial('skyMat', scene);
  sm.emissiveTexture = st; sm.disableLighting = true; sm.fogEnabled = false; sm.backFaceCulling = false;
  sky.material = sm; sky.infiniteDistance = true; sky.isPickable = false;
  glow.addExcludedMesh(sky);

  // ---- ground ----
  const gt = noiseTex(scene, 'groundTex', { size: 512, scale: 16, c1: [48, 54, 32], c2: [104, 98, 62], contrast: 1.5, speck: 0.03, speckColor: [72, 62, 46] });
  gt.uScale = gt.vScale = 16;
  const ground = B.MeshBuilder.CreateGround('ground', { width: 90, height: 90 }, scene);
  ground.material = mat(scene, 'groundMat', [1, 1, 1], { tex: gt, spec: 0 });
  ground.receiveShadows = true; ground.isPickable = false;

  // worn dirt yard with a soft edge
  const dirt = noiseTex(scene, 'dirtTex', { size: 256, scale: 8, c1: [72, 56, 40], c2: [122, 100, 74], contrast: 1.3, speck: 0.05, speckColor: [52, 42, 32] });
  dirt.uScale = dirt.vScale = 5;
  const fade = new B.DynamicTexture('yardFade', { width: 128, height: 128 }, scene, false);
  const fc = fade.getContext(), fg = fc.createRadialGradient(64, 64, 20, 64, 64, 64);
  fg.addColorStop(0, 'rgba(255,255,255,1)'); fg.addColorStop(0.7, 'rgba(255,255,255,0.85)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
  fc.fillStyle = fg; fc.fillRect(0, 0, 128, 128); fade.update(); fade.hasAlpha = true;
  const yard = B.MeshBuilder.CreateGround('yard', { width: 18, height: 16 }, scene);
  yard.position.set(-0.5, 0.004, 1.5);
  const ym = mat(scene, 'yardMat', [1, 1, 1], { tex: dirt, spec: 0 });
  ym.opacityTexture = fade; ym.zOffset = -1; yard.material = ym; yard.receiveShadows = true; yard.isPickable = false;

  // ---- trees (instances) ----
  const bark = mat(scene, 'bark', [0.28, 0.2, 0.14]);
  const leaves = mat(scene, 'leaves', [0.16, 0.25, 0.14]);
  const parts = [];
  const trunk = B.MeshBuilder.CreateCylinder('trunk', { height: 2.4, diameterTop: 0.14, diameterBottom: 0.3, tessellation: 7 }, scene);
  trunk.position.y = 1.2; trunk.material = bark; parts.push(trunk);
  [[1.6, 2.2, 2.4], [2.5, 1.7, 2.0], [3.3, 1.1, 1.6]].forEach(([y, d, h]) => {
    const c = B.MeshBuilder.CreateCylinder('cone', { height: h, diameterTop: 0, diameterBottom: d, tessellation: 8 }, scene);
    c.position.y = y + h / 2 - 0.3; c.material = leaves; parts.push(c);
  });
  const tree = B.Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  tree.isPickable = false;
  for (let i = 0; i < 80; i++) {
    const a = rand(0, Math.PI * 2), r = rand(13, 34);
    const t = i === 0 ? tree : tree.createInstance('tree' + i);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r + 1);
    const sc = rand(0.8, 1.6); t.scaling.set(sc, sc * rand(0.9, 1.3), sc); t.rotation.y = rand(0, 6);
    t.isPickable = false;
  }

  // scattered stones
  const stoneMat = mat(scene, 'stone', [0.42, 0.4, 0.38], { spec: 0.05 });
  const stoneBase = lump(scene, 'stoneBase', 0.2, 0.35, 3, 2);
  stoneBase.material = stoneMat; stoneBase.position.y = -10; stoneBase.isPickable = false;
  for (let i = 0; i < 26; i++) {
    const s = stoneBase.createInstance('stone' + i);
    const a = rand(0, 6.28), r = rand(7, 12);
    s.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r + 1);
    const k = rand(0.4, 1.4); s.scaling.set(k, k * 0.55, k * rand(0.8, 1.2)); s.rotation.y = rand(0, 6);
    s.isPickable = false;
  }

  const w = { hemi, sun, shadow, glow, hl, ground, sky, stoneBase, stoneMat };
  w.caster = (meshes, receive = true) => {
    for (const m of [].concat(meshes)) { shadow.addShadowCaster(m); if (receive) m.receiveShadows = true; }
  };
  buildForgeCorner(scene, w);
  return w;
}

// Open shed over the forge and anvil (those are built by their stations), plus the quench
// barrel for a later phase.
function buildForgeCorner(scene, w) {
  const root = new B.TransformNode('forgeCorner', scene);
  root.position.set(6.4, 0, -1.6);
  const wood = mat(scene, 'shedWood', [0.36, 0.26, 0.17]);
  const ms = [];
  const box = (n, wdt, h, d, x, y, z, m) => { const b = B.MeshBuilder.CreateBox(n, { width: wdt, height: h, depth: d }, scene); b.parent = root; b.position.set(x, y, z); b.material = m; ms.push(b); return b; };
  for (const [x, z] of [[-2.1, -1.45], [2.1, -1.45], [-2.1, 1.4], [2.1, 1.4]]) box('post', 0.13, 2.4, 0.13, x, 1.2, z, wood);
  const roof = box('roof', 4.6, 0.08, 3.3, 0, 2.45, 0, wood); roof.rotation.x = 0.1;
  const barrel = B.MeshBuilder.CreateCylinder('quench', { diameter: 0.55, height: 0.6, tessellation: 16 }, scene);
  barrel.parent = root; barrel.position.set(1.55, 0.3, -1.0); barrel.material = wood; ms.push(barrel);
  const water = B.MeshBuilder.CreateDisc('quenchWater', { radius: 0.25, tessellation: 16 }, scene);
  water.parent = root; water.rotation.x = Math.PI / 2; water.position.set(1.55, 0.58, -1.0);
  water.material = mat(scene, 'quenchWaterMat', [0.08, 0.12, 0.14], { spec: 0.8, specPow: 64 });
  for (const m of [...ms, water]) m.isPickable = false;
  w.caster(ms);
}
