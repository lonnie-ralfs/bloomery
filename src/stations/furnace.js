// The bloomery furnace: build it coil by coil, fit the tuyere, plug the arch, dry it, then smelt.
// Everything happens from one viewpoint and every action is a single mouse gesture:
//   bellows  : press on the bellows and move the mouse down/up (down = blow)
//   charge   : click the charcoal basket / ore bucket
//   tap slag : click the tap hole
//   break out: swing the mallet down through the front plug
//   extract  : drag the bloom out with the tongs onto the stump
import { B, V3, clamp, lerp, damp, dampV, smooth, rand, mat, noiseTex, lump, tempColor, ease, arcPos, flareTex } from '../util.js';
import { SmeltSim, FILL_CAP, SLAG_CAP, BAND } from '../sim.js';
import { makeBloom } from '../bloom.js';
import { purity } from '../state.js';

const C = V3(0, 0, 6);
export const NC = 8;
const CH = 0.12, TR = 0.075, R0 = 0.34, GAP = 0.5;
const courseR = i => R0 - i * 0.009;
const courseY = i => 0.07 + i * CH;
const TOP = courseY(NC - 1) + TR * 0.6;
const TUY_Y = 0.255;
const needArc = i => (i < 2 ? Math.PI * 2 - GAP * 2 : Math.PI * 2);
const WET = [0.42, 0.29, 0.21], DRY = [0.8, 0.64, 0.49];
const PLUG_Z = C.z - R0 * Math.cos(GAP) - 0.01;
const TAP_POS = V3(0, 0.06, PLUG_Z - 0.065);
const PIT = V3(0, 0.004, 5.3);
const STUMP = V3(1.25, 0, 5.5), STUMP_H = 0.4;

export class FurnaceStation {
  constructor(g) {
    this.g = g; this.id = 'furnace'; this.label = 'Furnace';
    this.pose = { pos: V3(0, 1.75, 3.7), target: V3(0, 0.5, 6) };
    this.sim = new SmeltSim();
    this.s = g.scene;
    Object.assign(this, {
      courses: [], partial: null, cracks: [], puddles: [], debris: [], flying: [],
      mode: null, anim: false, h: 1, hT: 1, pumpOut: 0, broken: false, placed: false, plugHP: 3, hitCool: 0,
      embers: false, crackAcc: 0, pending: 0, chargeCool: 0, hint: '', status: '', tc: new B.Color3(), _phase: null,
      bloom: null, bloomT: 20, bloomMass: 0,
    });
    this._materials(); this._site(); this._bellows(); this._props(); this._fx();
    this._ghost();
  }

  // ------------------------------------------------------------------ construction of scene objects
  _materials() {
    const s = this.s;
    const ct = noiseTex(s, 'furnClayTex', { size: 256, scale: 8, c1: [180, 176, 170], c2: [240, 236, 230], contrast: 1.1, speck: 0.05, speckColor: [150, 140, 120] });
    ct.uScale = 10; ct.vScale = 1;
    this.clayMat = mat(s, 'furnClay', WET, { tex: ct, spec: 0.06 });
    this.plugMat = mat(s, 'plugClay', WET, { tex: ct, spec: 0.06 });
    this.patchMat = mat(s, 'patchClay', [0.5, 0.34, 0.24], { tex: ct });
    this.crackMat = mat(s, 'crackMat', [0.04, 0.03, 0.02]);
    this.ghostMat = new B.StandardMaterial('ghostMat', s);
    this.ghostMat.emissiveColor = new B.Color3(1, 0.72, 0.38); this.ghostMat.disableLighting = true; this.ghostMat.alpha = 0.22;
    const et = noiseTex(s, 'emberTex', { size: 128, scale: 16, c1: [8, 4, 2], c2: [255, 220, 170], contrast: 3.2, bias: -0.08 });
    this.chargeMat = mat(s, 'chargeMat', [0.06, 0.05, 0.05]); this.chargeMat.emissiveTexture = et;
    this.chargeMat.emissiveColor = new B.Color3(0, 0, 0);
    this.slagMatBase = mat(s, 'slagStream', [0.1, 0.06, 0.05]); this.slagMatBase.emissiveColor = new B.Color3(1, 0.5, 0.15);
  }
  _site() {
    const s = this.s, g = this.g;
    const pad = B.MeshBuilder.CreateDisc('pad', { radius: 0.65, tessellation: 36 }, s);
    pad.rotation.x = Math.PI / 2; pad.position.set(C.x, 0.006, C.z);
    const pm = mat(s, 'padMat', [0.3, 0.22, 0.17]); pm.zOffset = -2; pad.material = pm; pad.receiveShadows = true; pad.isPickable = false;
    const floor = B.MeshBuilder.CreateDisc('hearth', { radius: R0 - 0.05, tessellation: 28 }, s);
    floor.rotation.x = Math.PI / 2; floor.position.set(C.x, 0.012, C.z); floor.material = mat(s, 'hearthMat', [0.06, 0.05, 0.05]);
    floor.isPickable = false; this.floor = floor;

    this.zone = B.MeshBuilder.CreateCylinder('buildZone', { height: 1.25, diameter: 1.05, tessellation: 16 }, s);
    this.zone.position.set(C.x, 0.62, C.z); this.zone.visibility = 0;
    g.tag([this.zone], 'buildZone', null);

    // tuyere lying on the ground until fitted
    this.tuyere = B.MeshBuilder.CreateCylinder('tuyere', { height: 0.34, diameter: 0.075, tessellation: 14 }, s);
    this.tuyere.material = mat(s, 'tuyereMat', [0.72, 0.55, 0.42]);
    this.tuyere.rotation.z = -Math.PI / 2; this.tuyere.rotation.y = 0.5; this.tuyere.position.set(-0.75, 0.038, 5.35);
    const bore = B.MeshBuilder.CreateDisc('tuyereBore', { radius: 0.022, tessellation: 12 }, s);
    bore.parent = this.tuyere; bore.rotation.x = -Math.PI / 2; bore.position.y = 0.171; bore.material = mat(s, 'boreMat', [0.03, 0.02, 0.02]);
    g.world.caster(this.tuyere);
    g.tag([this.tuyere], 'tuyerePipe');

    this.arch = B.MeshBuilder.CreateBox('archZone', { width: 0.38, height: 0.3, depth: 0.16 }, s);
    this.arch.position.set(0, 0.14, PLUG_Z); this.arch.visibility = 0;
    g.tag([this.arch], 'arch', null);

    // the burning charge seen from above
    this.charge = B.MeshBuilder.CreateDisc('charge', { radius: courseR(NC - 1) - 0.04, tessellation: 28 }, s);
    this.charge.rotation.x = Math.PI / 2; this.charge.position.set(C.x, 0.3, C.z); this.charge.material = this.chargeMat;
    this.charge.isPickable = false; this.charge.setEnabled(false);

    // slag pit in front of the tap hole
    const pit = B.MeshBuilder.CreateDisc('slagPit', { radius: 0.3, tessellation: 24 }, s);
    pit.rotation.x = Math.PI / 2; pit.position.copyFrom(PIT);
    const pitM = mat(s, 'pitMat', [0.16, 0.12, 0.1]); pitM.zOffset = -3; pit.material = pitM; pit.isPickable = false;
    this.stream = B.MeshBuilder.CreateTube('slagStream', { path: [TAP_POS.add(V3(0, 0, -0.01)), V3(0, 0.035, (TAP_POS.z + PIT.z) / 2), V3(0, 0.012, PIT.z + 0.05)], radius: 0.013, tessellation: 8 }, s);
    this.stream.material = this.slagMatBase; this.stream.setEnabled(false); this.stream.isPickable = false;
  }
  _bellows() {
    const s = this.s, g = this.g;
    const wt = s.getTextureByName('plankTex');
    const wood = mat(s, 'bellowsWood', [1, 1, 1], { tex: wt });
    const leather = mat(s, 'bellowsLeather', [0.32, 0.2, 0.12], { spec: 0.15, back: false });
    const root = this.bel = new B.TransformNode('bellows', s); root.position.set(0, 0, C.z);
    const vis = [];
    const box = (w, h, d, x, y, z, m = wood, p = root) => { const b = B.MeshBuilder.CreateBox('bel', { width: w, height: h, depth: d }, s); b.parent = p; b.position.set(x, y, z); b.material = m; vis.push(b); return b; };
    box(0.12, 0.17, 0.5, -1.45, 0.085, 0); box(0.12, 0.17, 0.5, -0.95, 0.085, 0);
    box(0.78, 0.03, 0.46, -1.19, 0.2, 0);
    this.pivot = new B.TransformNode('belPivot', s); this.pivot.parent = root; this.pivot.position.set(-0.8, 0.232, 0);
    box(0.76, 0.025, 0.46, -0.38, 0.0125, 0, wood, this.pivot);
    box(0.035, 0.26, 0.035, -0.72, 0.13, 0, wood, this.pivot);
    const bar = box(0.04, 0.04, 0.3, -0.72, 0.27, 0, wood, this.pivot);
    this.grip = new B.TransformNode('belGrip', s); this.grip.parent = this.pivot; this.grip.position.set(-0.72, 0.3, 0);
    const noz = B.MeshBuilder.CreateCylinder('nozzle', { height: 0.26, diameterTop: 0.035, diameterBottom: 0.1, tessellation: 12 }, s);
    noz.parent = root; noz.rotation.z = -Math.PI / 2; noz.position.set(-0.7, TUY_Y, 0); noz.material = mat(s, 'nozzleMat', [0.2, 0.18, 0.17], { spec: 0.3 });
    vis.push(noz);
    // leather bag: ribbon between the boards, rebuilt as the top board moves
    this.bagPaths = this._bagPaths(0);
    this.bag = B.MeshBuilder.CreateRibbon('bag', { pathArray: this.bagPaths, closePath: true, updatable: true, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    this.bag.parent = root; this.bag.material = leather; vis.push(this.bag);
    const hit = B.MeshBuilder.CreateBox('bellowsHit', { width: 1.0, height: 0.75, depth: 0.6 }, s);
    hit.parent = root; hit.position.set(-1.17, 0.33, 0); hit.visibility = 0;
    g.tag([hit], 'bellows', vis.filter(m => m !== this.bag));
    g.world.caster(vis);
  }
  _bagPaths(theta) {
    const pts = [];
    const x0 = -1.54, x1 = -0.83, z0 = -0.2, z1 = 0.2, n = 5;
    for (let i = 0; i < n; i++) pts.push([lerp(x0, x1, i / n), z0]);
    for (let i = 0; i < n; i++) pts.push([x1, lerp(z0, z1, i / n)]);
    for (let i = 0; i < n; i++) pts.push([lerp(x1, x0, i / n), z1]);
    for (let i = 0; i < n; i++) pts.push([x0, lerp(z1, z0, i / n)]);
    const px = -0.8, py = 0.232, c = Math.cos(theta), sn = Math.sin(theta);
    const bot = [], mid = [], top = [];
    for (const [x, z] of pts) {
      const dx = x - px;
      const tx = px + dx * c, ty = py - dx * sn;
      const b = V3(x, 0.215, z), t = V3(tx, ty, z);
      const m = B.Vector3.Center(b, t);
      const ox = x + 1.18, len = Math.hypot(ox, z) || 1, bul = 0.035 * (ty - 0.215) / 0.3 + 0.01;
      m.x += ox / len * bul; m.z += z / len * bul;
      bot.push(b); mid.push(m); top.push(t);
    }
    return [bot, mid, top];
  }
  _props() {
    const s = this.s, g = this.g;
    // charcoal basket
    const wicker = s.getTextureByName('wickerTex');
    const cb = new B.TransformNode('charcoalBasket', s); cb.position.set(0.95, 0, 6.1);
    const bk = B.MeshBuilder.CreateCylinder('coalBasket', { height: 0.3, diameterTop: 0.55, diameterBottom: 0.42, tessellation: 20, cap: B.Mesh.CAP_START, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    bk.parent = cb; bk.position.y = 0.15; bk.material = mat(s, 'coalBasketMat', [1, 1, 1], { tex: wicker });
    const coalMat = mat(s, 'coal', [0.05, 0.05, 0.055], { spec: 0.25, specPow: 50 });
    this.coalMat = coalMat;
    const coal = lump(s, 'coalBase', 0.04, 0.4, 2, 1); coal.material = coalMat; coal.parent = cb; coal.isPickable = false;
    const ms = [];
    for (let i = 0; i < 40; i++) {
      const a = rand(0, 6.28), r = Math.sqrt(Math.random()) * 0.2;
      ms.push(B.Matrix.Compose(V3(1, 1, 1).scale(rand(0.7, 1.3)), B.Quaternion.RotationYawPitchRoll(rand(0, 6), rand(0, 6), 0), V3(Math.cos(a) * r, 0.28 + (0.2 - r) * 0.25 + rand(0, 0.03), Math.sin(a) * r)));
    }
    coal.thinInstanceAdd(ms);
    const hit = B.MeshBuilder.CreateCylinder('coalHit', { height: 0.45, diameter: 0.58 }, s);
    hit.parent = cb; hit.position.y = 0.22; hit.visibility = 0;
    g.tag([hit], 'charcoal', [bk]);
    g.world.caster([bk, coal]);
    this.coalTop = cb.position.add(V3(0, 0.38, 0));
    // stump to set the bloom on
    const bark = s.getTextureByName('plankTex');
    const st = B.MeshBuilder.CreateCylinder('stump', { height: STUMP_H, diameterTop: 0.38, diameterBottom: 0.46, tessellation: 16 }, s);
    st.position.set(STUMP.x, STUMP_H / 2, STUMP.z); st.material = mat(s, 'stumpMat', [0.75, 0.62, 0.5], { tex: bark });
    g.world.caster(st); st.isPickable = false; this.stump = st;
    // light
    this.light = new B.PointLight('furnLight', V3(C.x, TOP + 0.7, C.z), s);
    this.light.intensity = 0; this.light.range = 9; this.light.diffuse = new B.Color3(1, 0.55, 0.2); this.light.specular = new B.Color3(0.4, 0.2, 0.1);
    this.archLight = new B.PointLight('archLight', V3(0, 0.15, PLUG_Z - 0.3), s);
    this.archLight.intensity = 0; this.archLight.range = 2.5; this.archLight.diffuse = new B.Color3(1, 0.5, 0.15);
  }
  _fx() {
    const s = this.s, fl = flareTex(s);
    const fire = this.fire = new B.ParticleSystem('fire', 700, s);
    fire.particleTexture = fl; fire.emitter = V3(C.x, TOP - 0.04, C.z);
    fire.minEmitBox = V3(-0.17, 0, -0.17); fire.maxEmitBox = V3(0.17, 0, 0.17);
    fire.minSize = 0.07; fire.maxSize = 0.2; fire.minLifeTime = 0.2; fire.maxLifeTime = 0.55;
    fire.emitRate = 0; fire.blendMode = B.ParticleSystem.BLENDMODE_ADD; fire.gravity = V3(0, 1.8, 0);
    fire.direction1 = V3(-0.15, 1, -0.15); fire.direction2 = V3(0.15, 1.5, 0.15); fire.minEmitPower = 0.3; fire.maxEmitPower = 0.9;
    fire.color1 = new B.Color4(1, 0.6, 0.2, 1); fire.color2 = new B.Color4(1, 0.35, 0.08, 1); fire.colorDead = new B.Color4(0.2, 0.04, 0, 0);
    fire.start();
    const smoke = this.smoke = new B.ParticleSystem('smoke', 400, s);
    smoke.particleTexture = fl; smoke.emitter = V3(C.x, TOP + 0.05, C.z);
    smoke.minEmitBox = V3(-0.15, 0, -0.15); smoke.maxEmitBox = V3(0.15, 0, 0.15);
    smoke.minSize = 0.25; smoke.maxSize = 0.7; smoke.minLifeTime = 2.5; smoke.maxLifeTime = 4.5;
    smoke.minScaleX = 1; smoke.maxScaleX = 1.5;
    smoke.emitRate = 0; smoke.blendMode = B.ParticleSystem.BLENDMODE_STANDARD; smoke.gravity = V3(0.15, 0.25, 0.05);
    smoke.direction1 = V3(-0.1, 1, -0.1); smoke.direction2 = V3(0.1, 1, 0.1); smoke.minEmitPower = 0.3; smoke.maxEmitPower = 0.6;
    smoke.color1 = new B.Color4(0.25, 0.23, 0.22, 0.35); smoke.color2 = new B.Color4(0.35, 0.33, 0.32, 0.25); smoke.colorDead = new B.Color4(0.4, 0.4, 0.4, 0);
    smoke.addSizeGradient(0, 0.3); smoke.addSizeGradient(1, 1.4);
    smoke.start();
    const sp = this.sparks = new B.ParticleSystem('sparks', 300, s);
    sp.particleTexture = fl; sp.emitter = V3(C.x, TOP, C.z);
    sp.minEmitBox = V3(-0.12, 0, -0.12); sp.maxEmitBox = V3(0.12, 0, 0.12);
    sp.minSize = 0.012; sp.maxSize = 0.03; sp.minLifeTime = 0.4; sp.maxLifeTime = 1.1;
    sp.emitRate = 0; sp.blendMode = B.ParticleSystem.BLENDMODE_ADD; sp.gravity = V3(0, -2.5, 0);
    sp.direction1 = V3(-0.8, 2, -0.8); sp.direction2 = V3(0.8, 3.5, 0.8); sp.minEmitPower = 0.6; sp.maxEmitPower = 1.6;
    sp.color1 = new B.Color4(1, 0.85, 0.4, 1); sp.color2 = new B.Color4(1, 0.55, 0.15, 1); sp.colorDead = new B.Color4(0.5, 0.1, 0, 0);
    sp.start();
  }
  _burst(n, at) { if (at) this.sparks.emitter = at; this.sparks.manualEmitCount = n; }

  // ------------------------------------------------------------------ state helpers
  get phase() {
    const f = this.g.state.furnace;
    if (f.courses < NC || !f.tuyere || !f.plug) return 'build';
    if (!f.dried) return 'dry';
    if (!this.broken) return 'smelt';
    if (!this.placed) return 'extract';
    return 'done';
  }
  get reduced() { return this.sim.chargedOre > 0 && this.sim.ore < 0.1 && this.pending <= 0; }
  get breakReady() { return this.reduced && (this.g.state.ore < 0.05 || this.allowEarly); }
  get openCracks() { return this.cracks.filter(c => !c.patched).length; }
  _wall() { return clamp(1 - 0.1 * this.openCracks - (1 - this.g.state.daubQ) * 0.25, 0.3, 1); }

  accepts(act) {
    const f = this.g.state.furnace, ph = this.phase;
    if (act === 'bellows') return ph === 'build' || ph === 'dry' || ph === 'smelt';
    switch (ph) {
      case 'build':
        if (act === 'buildZone') return f.courses < NC && (f.courses < 2 || f.tuyere);
        if (act === 'tuyerePipe') return f.courses >= 2 && !f.tuyere;
        if (act === 'arch') return f.courses >= NC && !f.plug;
        return false;
      case 'dry': return (act === 'buildZone' && !f.drying) || act === 'crack';
      case 'smelt': return ['charcoal', 'oreBucket', 'tap', 'crack'].includes(act) || (act === 'buildZone' && !this.sim.lit && this.sim.F > 0);
      case 'extract': return act === 'bloom';
    }
    return false;
  }

  enter() { this.g.containers.place('furnace'); }
  exit() { if (this.mode === 'drag') this._releaseBloom(); this.mode = null; }

  // ------------------------------------------------------------------ input
  down() {
    const g = this.g, hov = g.hover;
    if (this.anim || !hov) return;
    switch (hov.act) {
      case 'bellows': this.mode = 'pump'; this.y0 = g.input.y; this.h0 = this.h; this.hT = this.h; break;
      case 'buildZone':
        if (this.phase === 'build') this._startLay();
        else if (this.phase === 'dry') this._startDrying();
        else this._relight();
        break;
      case 'tuyerePipe': this._fitTuyere(); break;
      case 'arch': this._placePlug(); break;
      case 'crack': this._patch(hov.mesh.metadata.crack); break;
      case 'charcoal': this._chargeCharcoal(); break;
      case 'oreBucket': this._chargeOre(); break;
      case 'tap': this._tap(); break;
      case 'bloom': this.mode = 'drag'; g.sfx.play('clink', 0.8); break;
    }
  }
  up() {
    if (this.mode === 'drag') this._releaseBloom();
    if (this.mode === 'lay') this.lastA = null;
    this.mode = null;
  }

  // ------------------------------------------------------------------ building
  _ghost() {
    if (this.ghost) { this.ghost.dispose(); this.ghost = null; }
    const f = this.g.state.furnace, i = f.courses;
    if (i >= NC || (i >= 2 && !f.tuyere)) return;
    this.ghost = this._courseMesh(i, i < 2 ? GAP : 0, needArc(i), 1, 'ghost', TR * 0.9);
    this.ghost.material = this.ghostMat; this.ghost.isPickable = false;
  }
  _courseMesh(i, start, arc, dir, name, rad = TR) {
    const R = courseR(i), y = courseY(i), n = Math.max(2, Math.ceil(arc / (Math.PI * 2) * 56));
    const path = [];
    for (let k = 0; k <= n; k++) { const a = start + dir * arc * k / n; path.push(V3(C.x + R * Math.sin(a), y, C.z - R * Math.cos(a))); }
    const m = B.MeshBuilder.CreateTube(name, { path, radius: rad, tessellation: 12, cap: B.Mesh.CAP_ALL }, this.s);
    m.scaling.y = 1; m.isPickable = false;
    return m;
  }
  _startLay() {
    const g = this.g, f = g.state.furnace;
    if (!this.partial) {
      if (g.state.daub < 1) { g.hud.toast(g.state.daubBatches ? 'Out of daub — mix another batch at the trough' : 'You need daub — mix clay, straw and water at the trough'); return; }
      g.state.daub -= 1;
      this.partial = { i: f.courses, dir: 0, start: 0, prog: 0, acc0: 0, mesh: null, built: 0, pressA: null };
    }
    this.mode = 'lay'; this.lastA = null;
    g.sfx.play('squelch', 0.6);
  }
  _updateLay(dt) {
    const g = this.g, P = this.partial, i = P.i, y = courseY(i), R = courseR(i);
    const p = g.rayPlane(V3(0, y, 0), V3(0, 1, 0));
    if (p) {
      const dx = p.x - C.x, dz = p.z - C.z, r = Math.hypot(dx, dz), a = Math.atan2(dx, -dz);
      if (r > 0.1) {
        if (P.pressA == null) P.pressA = a;
        if (this.lastA != null) {
          let d = a - this.lastA;
          while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          if (!P.dir) {
            P.acc0 += d;
            if (Math.abs(P.acc0) > 0.12) { P.dir = Math.sign(P.acc0); P.start = i < 2 ? P.dir * GAP : P.pressA; }
          } else {
            const before = P.prog;
            P.prog = clamp(P.prog + d * P.dir, 0, needArc(i));
            if (P.prog > before) g.sfx.loop('mud', 0.18, 300);
          }
        }
        this.lastA = a;
      }
    }
    if (P.dir && Math.abs(P.prog - P.built) > 0.04) {
      if (P.mesh) P.mesh.dispose();
      P.mesh = P.prog > 0.03 ? this._courseMesh(i, P.start, P.prog, P.dir, 'course') : null;
      if (P.mesh) { P.mesh.material = this.clayMat; this.g.world.caster(P.mesh); }
      P.built = P.prog;
    }
    const tipA = P.dir ? P.start + P.dir * P.prog : (P.pressA ?? 0);
    const tip = V3(C.x + (R + TR * 0.6) * Math.sin(tipA), y + 0.07, C.z - (R + TR * 0.6) * Math.cos(tipA));
    g.tools.use('hand'); g.tools.pose(tip, 0.9, 0, 0, dt, 25);
    const pct = Math.round(P.prog / needArc(i) * 100);
    this.hint = `Sweep around the furnace to lay coil ${i + 1} of ${NC} (${pct}%)`;
    if (P.prog >= needArc(i) - 1e-3) this._finishCourse();
  }
  _finishCourse() {
    const g = this.g, f = g.state.furnace, P = this.partial;
    if (P.mesh) P.mesh.dispose();
    // full rings overlap their own start a little so there's no seam
    const m = this._courseMesh(P.i, P.start, needArc(P.i) + (P.i < 2 ? 0 : 0.25), P.dir, 'course');
    m.material = this.clayMat; g.world.caster(m);
    this.courses.push(m); this.partial = null; this.mode = null;
    f.courses++;
    g.sfx.play('thunk', 0.5); g.sfx.loop('mud', 0);
    if (f.courses === 2) g.hud.toast('Two courses up. Fit the tuyere (the clay air pipe by the bellows) before going higher.');
    if (f.courses === NC) g.hud.toast('Walls done. Plug the front arch with daub (click the opening).', 'good');
    this._ghost();
  }
  _fitTuyere() {
    const g = this.g, t = this.tuyere, from = t.position.clone(), to = V3(-0.42, TUY_Y, C.z), r0 = t.rotation.y;
    this.anim = true;
    g.tweens.add(0.6, k => { arcPos(from, to, 0.25, ease.inOut(k), t.position); t.rotation.y = lerp(r0, 0, k); }, () => {
      g.state.furnace.tuyere = true; this.anim = false; g.sfx.play('thunk', 0.6); this._ghost();
      g.hud.toast('Tuyere fitted — the bellows nozzle now blows into the furnace.');
    });
  }
  _placePlug() {
    const g = this.g;
    if (g.state.daub < 1) return g.hud.toast('Not enough daub to plug the arch — mix more at the trough');
    g.state.daub -= 1;
    this._makePlug();
    g.state.furnace.plug = true; g.sfx.play('squelch');
    g.hud.toast('Arch plugged (with a small tap hole for the slag). Now dry the furnace: click it to light a gentle fire.');
  }
  _makePlug() {
    const s = this.s, g = this.g;
    const w = 2 * R0 * Math.sin(GAP) + 0.05;
    this.plug = B.MeshBuilder.CreateBox('plug', { width: w, height: 0.26, depth: 0.12 }, s);
    this.plug.position.set(0, 0.13, PLUG_Z + 0.01); this.plug.material = this.plugMat; g.world.caster(this.plug); this.plug.isPickable = false;
    this.tapHole = B.MeshBuilder.CreateDisc('tapHole', { radius: 0.024, tessellation: 14, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    this.tapHole.position.copyFrom(TAP_POS); this.tapHole.material = mat(s, 'tapHoleMat', [0.03, 0.02, 0.02]); this.tapHole.isPickable = false;
    this.tapHit = B.MeshBuilder.CreateBox('tapHit', { width: 0.12, height: 0.1, depth: 0.06 }, s);
    this.tapHit.position.copyFrom(TAP_POS); this.tapHit.visibility = 0;
    g.tag([this.tapHit], 'tap', null);
  }
  _startDrying() {
    const g = this.g, f = g.state.furnace;
    f.drying = true; this.crackAcc = 0;
    g.sfx.play('crack', 0.3);
    g.hud.toast('A small wood fire is drying the walls. A little air speeds it up — too much and the clay cracks.');
  }
  _addCrack() {
    const s = this.s, g = this.g;
    const a = rand(-1.15, 1.15), y = rand(0.36, 0.9);
    const ci = clamp(Math.round((y - 0.07) / CH), 0, NC - 1), R = courseR(ci) + TR * 0.93;
    const node = new B.TransformNode('crack', s);
    node.position.set(C.x + R * Math.sin(a), y, C.z - R * Math.cos(a));
    node.rotation.y = Math.PI - a;
    const segs = [];
    let yy = -0.06, xx = 0;
    for (let k = 0; k < 3; k++) {
      const len = rand(0.04, 0.07);
      const b = B.MeshBuilder.CreateBox('crackSeg', { width: 0.007, height: len, depth: 0.014 }, s);
      b.parent = node; b.material = this.crackMat; b.isPickable = false;
      const ang = rand(-0.6, 0.6);
      b.rotation.z = ang; b.position.set(xx - Math.sin(ang) * len / 2, yy + Math.cos(ang) * len / 2, 0);
      xx -= Math.sin(ang) * len; yy += Math.cos(ang) * len;
      segs.push(b);
    }
    const hit = B.MeshBuilder.CreateBox('crackHit', { width: 0.08, height: 0.2, depth: 0.06 }, s);
    hit.parent = node; hit.position.y = 0.0; hit.visibility = 0;
    const c = { node, segs, hit, patched: false };
    g.tag([hit], 'crack', segs);
    hit.metadata.crack = c;
    this.cracks.push(c);
    g.sfx.play('crack', 0.7);
    this.sim.wall = this._wall();
  }
  _patch(c) {
    const g = this.g;
    if (!c || c.patched) return;
    if (g.state.daub < 0.25) return g.hud.toast('No daub left to patch with — mix more at the trough');
    g.state.daub -= 0.25; c.patched = true;
    c.segs.forEach(m => m.dispose()); c.hit.dispose();
    const p = lump(this.s, 'patch', 0.05, 0.25, rand(0, 9), 2);
    p.parent = c.node; p.scaling.set(0.9, 1.7, 0.35); p.material = this.patchMat; p.isPickable = false;
    g.world.caster(p);
    g.sfx.play('squelch');
    this.sim.wall = this._wall();
    if (!this.openCracks) g.hud.toast('All cracks patched.', 'good');
  }
  _relight() { this.sim.lit = true; this.sim.T = Math.max(this.sim.T, 420); this.g.sfx.play('whoosh'); this.g.hud.toast('Relit with a burning brand.'); }

  // ------------------------------------------------------------------ smelting actions
  _throw(from, to, n, makeMesh, dur, onLand) {
    let landed = false;
    for (let i = 0; i < n; i++) {
      const m = makeMesh(i), d = dur * rand(0.85, 1.1), off = V3(rand(-0.06, 0.06), 0, rand(-0.06, 0.06));
      const f = from.add(off), t = to.add(off.scale(1.5));
      this.g.tweens.add(d, k => { arcPos(f, t, 0.45, k, m.position); m.rotation.x += 0.2; }, () => {
        m.dispose(); if (!landed) { landed = true; onLand(); }
      });
    }
  }
  _chargeCharcoal() {
    const g = this.g, sim = this.sim, ph = this.phase;
    if (ph !== 'smelt') return g.hud.toast('Finish building and drying the furnace first');
    if (this.chargeCool > 0) return;
    if (!sim.canAdd(1 + this.pending)) return g.hud.toast('The furnace is full — let it burn down a little');
    this.chargeCool = 0.3; this.pending += 1;
    this._throw(this.coalTop, V3(C.x, TOP + 0.05, C.z), 4, () => { const m = lump(this.s, 'flyCoal', 0.035, 0.4, rand(0, 9), 1); m.material = this.coalMat; return m; }, 0.5, () => {
      this.pending -= 1;
      sim.addCharcoal(1);
      sim.wall = this._wall();
      if (!sim.lit && (this.embers || sim.T > 350)) { sim.lit = true; sim.T = Math.max(sim.T, 300); g.hud.toast('The drying embers catch — the charcoal is alight. Work the bellows to bring up the heat.', 'good', 4.5); }
      g.sfx.play('coal'); this._burst(12);
    });
  }
  _chargeOre() {
    const g = this.g, st = g.state, sim = this.sim;
    if (this.phase !== 'smelt') return g.hud.toast('The furnace isn\'t ready for ore yet');
    if (this.chargeCool > 0) return;
    if (st.ore <= 0.01) return g.hud.toast('The ore bucket is empty — pan more iron sand at the stream');
    if (!sim.lit) return g.hud.toast('Fill the furnace with charcoal first — it lights from the drying embers');
    if (!sim.canAdd(0.45 + this.pending)) return g.hud.toast('The furnace is full');
    const kg = Math.min(1, st.ore), iron = kg * purity();
    st.ore -= kg; st.oreIronKg -= iron;
    if (st.ore < 0.01) { st.ore = 0; st.oreIronKg = 0; }
    g.containers.refresh();
    if (sim.T < 1000) g.hud.toast('Charging ore cold — it won\'t reduce until ~1000 °C and smothers the fire', 'warn');
    this.chargeCool = 0.3; this.pending += 0.45;
    const sandMat = this.s.getMaterialByName('ironGrainMat');
    this._throw(g.containers.bucketTop(), V3(C.x, TOP + 0.05, C.z), 10, () => { const m = B.MeshBuilder.CreateSphere('flyOre', { diameter: 0.025, segments: 3 }, this.s); m.material = sandMat; return m; }, 0.5, () => {
      this.pending -= 0.45; sim.addOre(kg, iron); g.sfx.play('pour', 0.6); this._burst(25);
    });
  }
  _tap() {
    const g = this.g, sim = this.sim;
    if (this.anim) return;
    this.anim = true;
    g.tools.use('rod');
    const from = g.tools.root.position.clone(), to = TAP_POS.add(V3(0, 0.01, -0.02));
    g.tweens.add(0.22, k => { B.Vector3.LerpToRef(from, to, ease.in(k), g.tools.root.position); }, () => {
      const r = sim.openTap();
      g.sfx.play('clink');
      if (r === 'empty') g.hud.toast('Hardly any slag to tap yet');
      else if (r === 'cold') g.hud.toast('The slag is too cold and sticky to run — get the furnace hotter first', 'warn');
      else { this._newPuddle(); g.sfx.play('hiss', 0.8); this._burst(18, TAP_POS.clone()); }
      g.tweens.add(0.3, k => { B.Vector3.LerpToRef(to, from, ease.out(k), g.tools.root.position); }, () => { this.anim = false; this.sparks.emitter = V3(C.x, TOP, C.z); });
    });
  }
  _newPuddle(amount = 0) {
    const s = this.s;
    const d = B.MeshBuilder.CreateDisc('slagPuddle', { radius: 1, tessellation: 20 }, s);
    d.rotation.x = Math.PI / 2;
    d.position.set(PIT.x + rand(-0.06, 0.06), 0.008 + this.puddles.length * 0.002, PIT.z + rand(-0.06, 0.04));
    const m = mat(s, 'slagPuddleMat', [0.1, 0.08, 0.08], { spec: 0.5, specPow: 60 });
    m.emissiveTexture = s.getTextureByName('emberTex'); m.zOffset = -4;
    d.material = m; d.isPickable = false;
    const p = { m: d, mat: m, amount, T: 1250 };
    d.scaling.setAll(0.04);
    this.puddles.push(p);
    return p;
  }

  // ------------------------------------------------------------------ break-out and extraction
  _updateMallet(dt) {
    const g = this.g, inp = g.input;
    g.tools.use('mallet');
    const p = g.rayPlane(V3(0, 0, PLUG_Z - 0.12), V3(0, 0, 1));
    const tilt = clamp(inp.vy * 0.22, -0.5, 1.0);
    if (p) g.tools.pose(p.add(V3(0, 0.03, 0)), 0.15 + tilt, 0, 0, dt, 30);
    this.hint = 'Swing down hard through the plug to break it open';
    if (inp.vy > 1.8 && this.hitCool <= 0) { this.hitCool = 0.3; this._hitPlug(inp.vy); }
  }
  _hitPlug(v) {
    const g = this.g;
    const dmg = clamp((v - 1.2) / 2, 0.3, 1.4);
    this.plugHP -= dmg;
    g.sfx.play('crack', clamp(v / 4, 0.4, 1)); g.sfx.play('thunk', 0.6);
    g.shake = 0.012 + dmg * 0.012;
    for (let i = 0; i < 2 + Math.round(dmg * 3); i++) this._debris(V3(rand(-0.12, 0.12), rand(0.05, 0.24), PLUG_Z - 0.06), 0.02 + rand(0, 0.02));
    const k = clamp(1 - this.plugHP / 3);
    this.plugMat.diffuseColor = new B.Color3(...DRY.map(c => c * (1 - k * 0.35)));
    if (this.plugHP <= 0) this._breakOpen();
    else g.hud.toast(dmg < 0.5 ? 'Weak blow — swing faster' : 'The plug cracks…', 'info', 1.5);
  }
  _debris(p, r) {
    const m = lump(this.s, 'debris', r, 0.4, rand(0, 9), 1);
    m.material = this.plugMat; m.position.copyFrom(p); m.isPickable = false;
    this.debris.push({ m, r, v: V3(rand(-0.6, 0.6), rand(0.3, 1.4), rand(-1.4, -0.5)), rest: false });
  }
  _breakOpen() {
    const g = this.g, sim = this.sim;
    this.broken = true; sim.lit = false; sim.tapping = false; sim.F = Math.min(sim.F, 0.3);
    this.plug.dispose(); this.tapHole.dispose(); this.tapHit.dispose();
    for (let i = 0; i < 10; i++) this._debris(V3(rand(-0.15, 0.15), rand(0.03, 0.25), PLUG_Z - 0.03), 0.025 + rand(0, 0.03));
    if (sim.slag > 0.1) { const p = this._newPuddle(sim.slag); p.T = Math.max(900, sim.T); sim.slag = 0; }
    this.bloomMass = sim.bloom;
    const mass = Math.max(0.12, this.bloomMass);
    this.bloom = makeBloom(this.s, mass);
    const r = this.bloom.metadata.radius;
    this.bloom.position.set(0, r * 0.65 + 0.015, C.z - 0.18);
    this.bloomT = Math.max(1150, sim.T);
    g.world.caster(this.bloom);
    g.tag([this.bloom], 'bloom');
    this.bloom.metadata.radius = r;
    g.sfx.play('crack'); g.shake = 0.04;
    this._burst(60, V3(0, 0.15, PLUG_Z));
    g.hud.toast(this.bloomMass < 0.15 ? 'The front is open… there\'s barely any iron in there.' : 'The front is open — the bloom glows in the hearth. Grab it with the tongs.', this.bloomMass < 0.15 ? 'bad' : 'good', 4.5);
  }
  _updateDrag(dt) {
    const g = this.g, b = this.bloom, r = b.metadata.radius;
    const p = g.rayPlane(V3(0, 0.3, 0), V3(0, 1, 0));
    if (p) {
      const t = V3(clamp(p.x, -1.2, 1.6), 0.32 + r, clamp(p.z, 4.5, 6.2));
      dampV(b.position, t, 10, dt);
    }
    b.rotation.y += g.input.vx * dt * 0.5;
    g.tools.use('tongs'); g.tools.setTongs(0.15);
    g.tools.pose(b.position.add(V3(0, 0.02, -r * 0.6)), 0.1, 0, 0, dt, 30);
    const near = Math.hypot(b.position.x - STUMP.x, b.position.z - STUMP.z) < 0.3;
    this.hint = near ? 'Release to set the bloom on the stump' : 'Carry the bloom to the stump (front right)';
  }
  _releaseBloom() {
    const g = this.g, b = this.bloom, r = b.metadata.radius, from = b.position.clone();
    this.mode = null;
    const near = Math.hypot(b.position.x - STUMP.x, b.position.z - STUMP.z) < 0.3;
    const to = near ? V3(STUMP.x, STUMP_H + r * 0.7, STUMP.z) : V3(from.x, r * 0.7, from.z);
    g.tweens.add(0.25, k => B.Vector3.LerpToRef(from, to, ease.in(k), b.position), () => {
      g.sfx.play('thunk', 0.8); this._burst(30, to.clone());
      if (near && !this.placed) { this.placed = true; this._finish(); }
      else if (!near) g.hud.toast('Set it on the stump');
    });
  }
  _finish() {
    const g = this.g, R = this.sim.result(g.state.ore);
    R.M = this.bloomMass;
    const pct = v => Math.round(v * 100) + '%';
    const lvl = v => (v < 0.08 ? 'low' : v < 0.25 ? 'moderate' : 'heavy');
    const cons = v => (v > 0.9 ? 'dense' : v > 0.75 ? 'good' : v > 0.55 ? 'spongy' : 'loose and crumbly');
    g.hud.modal(`
      <h2>Bloom extracted</h2>
      <div class="grade">${R.grade} — <b>${R.score}</b>/100</div>
      <table>
        <tr><td>Bloom mass</td><td>${R.M.toFixed(2)} kg</td></tr>
        <tr><td>Yield (of the iron in your ore)</td><td>${pct(R.yieldPct)}</td></tr>
        <tr><td>Carbon</td><td>~${R.C.toFixed(2)}% — ${R.type}</td></tr>
        <tr><td>Consolidation</td><td>${cons(R.compaction)} (${pct(R.compaction)})</td></tr>
        <tr><td>Slag inclusions</td><td>${lvl(R.incl)}</td></tr>
        <tr><td>Ore charged / charcoal burned</td><td>${R.charged.toFixed(1)} kg / ${Math.round(R.charcoal)} scoops</td></tr>
        <tr><td>Slag taps</td><td>${R.taps}</td></tr>
        <tr><td>Furnace walls</td><td>${pct(R.integ)}</td></tr>
      </table>
      <ul>${R.notes.map(n => `<li>${n}</li>`).join('')}</ul>
      <p style="color:var(--dim)">Next: take the bloom to the forge, bring it to welding heat, then consolidate it on the anvil — gentle taps first while it's fragile.</p>`,
      [{ label: 'On to the forge', onClick: () => g.goTo('forge') }, { label: 'Smelt again', onClick: () => location.reload() }]);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g, hov = g.hover, inp = g.input;
    this.hitCool -= dt; this.chargeCool -= dt;
    if (this.anim) { this.hint = ''; return; }
    if (this.mode === 'pump') {
      this.hT = clamp(this.h0 + (this.y0 - inp.y) / (0.22 * inp.h), 0, 1);
      this.grip.computeWorldMatrix(true);
      g.tools.use('hand'); g.tools.pose(this.grip.getAbsolutePosition(), 1.1, 0, 0, dt, 40);
      this.hint = 'Move down to blow, up to refill. Steady strokes hold the heat.';
      return;
    }
    if (this.mode === 'lay') return this._updateLay(dt);
    if (this.mode === 'drag') return this._updateDrag(dt);
    if (this.phase === 'smelt' && this.breakReady && !(hov && hov.act === 'tap')) {
      const ah = this.s.pick(inp.x, inp.y, m => m === this.arch);
      if (ah && ah.hit) return this._updateMallet(dt);
    }
    const tool = hov && hov.act === 'tap' ? 'rod' : this.phase === 'extract' ? 'tongs' : 'hand';
    g.tools.use(tool);
    if (tool === 'tongs') g.tools.setTongs(1);
    let p = hov ? hov.point.clone() : g.rayPlane(V3(0, 0, 5.3), V3(0, 0, 1));
    if (p) {
      const toCam = g.camera.position.subtract(p).normalize();
      p.addInPlace(toCam.scale(tool === 'rod' ? 0.03 : 0.08));
      g.tools.pose(p, tool === 'hand' ? 0.4 : 0.1, 0, 0, dt, 20);
    }
    this.hint = this._hoverHint(hov) || this.status;
  }

  simulate(dt, active) {
    const g = this.g, f = g.state.furnace, sim = this.sim;
    // bellows mechanics run in real time (dt may be sped up by the dev time scale)
    const rdt = dt / g.timeScale, prevH = this.h;
    if (this.mode === 'pump') {
      const maxDown = 3.5 * (1 - 0.6 * sim.choke), dh = this.hT - this.h;
      this.h += dh < 0 ? Math.max(dh, -maxDown * rdt) : Math.min(dh, 6 * rdt);
    } else this.h = Math.min(1, this.h + 0.5 * rdt);
    const out = rdt > 0 ? Math.max(0, (prevH - this.h) / rdt) : 0;
    this.pumpOut = out;
    // the tuyere must be in for air to reach the furnace
    sim.override = f.drying && !f.dried ? 160 : null;
    const ev = sim.step(dt, f.tuyere ? out : 0);

    if (f.drying && !f.dried) {
      f.dry = Math.min(1, f.dry + (1 + 2.5 * sim.airEff) / 24 * dt);
      if (sim.airEff > 0.35) {
        this.crackAcc += (sim.airEff - 0.35) * dt * 1.5;
        if (this.crackAcc >= 1) { this.crackAcc -= 1; this._addCrack(); g.hud.toast('Crack! Drying too fast — go gently', 'bad'); }
      }
      if (f.dry >= 1) {
        f.dried = true; f.drying = false; this.embers = true;
        const n = Math.round((1 - g.state.daubQ) * 5);
        for (let i = 0; i < n; i++) this._addCrack();
        g.hud.toast(n ? `Dry. ${n} crack${n > 1 ? 's' : ''} opened as the clay shrank — patch them with daub (click each).` : 'Dry, and not a single crack. Fill it with charcoal.', n ? 'warn' : 'good', 5);
      }
    }
    const dk = f.dried ? 1 : f.dry;
    this.clayMat.diffuseColor.set(lerp(WET[0], DRY[0], dk), lerp(WET[1], DRY[1], dk), lerp(WET[2], DRY[2], dk));
    if (this.plug && !this.broken && this.plugHP >= 3) this.plugMat.diffuseColor.copyFrom(this.clayMat.diffuseColor);

    for (const e of ev) {
      if (e === 'frozen') g.hud.toast('The slag froze in the tap hole — get it hotter, then tap again', 'bad');
      if (e === 'drained') g.hud.toast('Slag drained. Tap hole sealed itself.', 'good', 2);
      if (e === 'fuellow' && !this.broken) g.hud.toast('Charcoal is running low — add a scoop', 'warn');
      if (e === 'fireout') g.hud.toast('The fire has gone out', 'bad');
      if (e === 'scorch') g.hud.toast('Over 1480 °C — the furnace walls are glazing and eroding!', 'bad');
    }
    this.status = this._advice();
    this._visuals(dt, active);
  }

  _visuals(dt, active) {
    const g = this.g, sim = this.sim, f = g.state.furnace, T = sim.T, tc = tempColor(T, this.tc);
    const built = f.courses >= NC, hot = sim.lit || sim.override != null;
    const air = sim.airEff;
    // bellows
    const th = this.h * 0.38;
    this.pivot.rotation.z = -th;
    B.MeshBuilder.CreateRibbon(null, { pathArray: this._bagPaths(th), instance: this.bag });
    // charge column
    this.charge.setEnabled(built && !this.broken);
    if (built) this.charge.position.y = 0.3 + clamp((sim.fill + this.pending) / FILL_CAP) * (TOP - 0.36);
    const flick = 0.85 + 0.15 * Math.sin(g.time * 23) * Math.sin(g.time * 7.3);
    const cg = hot ? (0.3 + 0.7 * Math.min(1, air)) * flick : 0;
    this.chargeMat.emissiveColor.set(tc.r * cg, tc.g * cg, tc.b * cg);
    this.chargeMat.emissiveTexture.uOffset = g.time * 0.01;
    // flames, smoke
    const flame = hot ? smooth(450, 1450, T) : 0;
    this.fire.emitRate = flame > 0 ? 10 + 300 * flame * (0.35 + air) : 0;
    this.fire.color1.set(tc.r, tc.g, tc.b, 1); this.fire.color2.set(tc.r, tc.g * 0.6, tc.b * 0.4, 1);
    this.fire.maxSize = 0.12 + 0.15 * flame;
    const fresh = sim.sink > 2 ? 1 : 0;
    this.smoke.emitRate = (sim.lit ? 6 + 18 * (1 - smooth(900, 1350, T)) + fresh * 25 : 0) + (f.drying ? 30 : 0) + (this.broken && T > 400 ? 8 : 0);
    // light
    this.light.intensity = hot ? (0.15 + 1.1 * smooth(500, 1450, T)) * flick : 0;
    this.light.diffuse.set(1, 0.4 + tc.g * 0.5, 0.15 + tc.b * 0.5);
    // walls glow faintly when very hot
    const wg = smooth(1100, 1550, T) * 0.35;
    this.clayMat.emissiveColor.set(wg, wg * 0.25, 0);
    if (this.plug && !this.broken) { const pg = smooth(0.5, 1, sim.slagLevel) * smooth(1000, 1300, T) * 0.5; this.plugMat.emissiveColor.set(pg, pg * 0.3, 0); }
    // slag stream
    const flowing = sim.tapFlow > 0;
    this.stream.setEnabled(flowing);
    if (flowing) {
      const p = this.puddles[this.puddles.length - 1];
      if (p) { p.amount += sim.tapFlow * dt; p.T = Math.max(p.T, T - 50); }
      this.slagMatBase.emissiveColor = tempColor(T - 50);
    }
    for (const p of this.puddles) {
      const r = 0.05 + Math.sqrt(p.amount) * 0.15;
      p.m.scaling.set(r, r, 1);
      p.T = flowing && p === this.puddles[this.puddles.length - 1] ? p.T : Math.max(20, p.T - (p.T - 20) * dt / 25);
      const pc = tempColor(p.T); p.mat.emissiveColor = pc;
    }
    // bloom cooling
    if (this.bloom) {
      this.bloomT = Math.max(20, this.bloomT - (this.bloomT - 20) * dt / 120);
      const bc = tempColor(this.bloomT); this.bloom.material.emissiveColor = bc;
      this.archLight.intensity = this.placed ? 0 : smooth(500, 1200, this.bloomT) * 1.5;
    }
    // debris physics
    for (const d of this.debris) {
      if (d.rest) continue;
      d.v.y -= 9.8 * dt; d.m.position.addInPlace(d.v.scale(dt)); d.m.rotation.x += dt * 5;
      if (d.m.position.y < d.r * 0.6) { d.m.position.y = d.r * 0.6; d.v.y *= -0.3; d.v.x *= 0.5; d.v.z *= 0.5; if (Math.abs(d.v.y) < 0.2) d.rest = true; }
    }
    if (this.ghost) this.ghostMat.alpha = 0.16 + 0.1 * Math.sin(g.time * 3);
    // audio (quieter when you're at another station)
    const v = active ? 1 : 0.12;
    g.sfx.loop('fire', hot ? (0.05 + 0.3 * smooth(500, 1450, T) * (0.4 + air)) * v : 0, 180 + air * 500);
    g.sfx.loop('bellows', Math.min(0.4, this.pumpOut * 0.18) * v, 380 + this.pumpOut * 120);
    g.sfx.loop('slag', flowing ? 0.12 * v : 0);
  }

  // ------------------------------------------------------------------ guidance text
  _hoverHint(hov) {
    if (!hov) return '';
    const st = this.g.state, sim = this.sim;
    switch (hov.act) {
      case 'bellows': return 'Press and move the mouse down/up to work the bellows';
      case 'buildZone':
        if (this.phase === 'build') return st.daub >= 1 || this.partial ? 'Press and sweep around the furnace to lay a coil of daub' : 'You need daub — mix it at the trough';
        if (this.phase === 'dry') return 'Click to light a small drying fire inside';
        return 'Click to relight the fire';
      case 'tuyerePipe': return 'Click to fit the tuyere (clay air pipe) into the wall';
      case 'arch': return 'Click to plug the front arch with daub';
      case 'crack': return `Click to patch the crack (0.25 daub, ${st.daub.toFixed(1)} left)`;
      case 'charcoal': return 'Click: add a scoop of charcoal';
      case 'oreBucket': return st.ore > 0 ? `Click: charge 1 kg of iron sand (${st.ore.toFixed(1)} kg left)` : 'The ore bucket is empty';
      case 'tap': return sim.tapping ? 'Slag is running' : 'Click: open the tap hole and let the slag run';
      case 'bloom': return 'Grab the bloom with the tongs and drag it out';
    }
    return '';
  }
  _advice() {
    const sim = this.sim, st = this.g.state, f = st.furnace, T = Math.round(sim.T);
    switch (this.phase) {
      case 'build':
        if (f.courses >= 2 && !f.tuyere) return 'Fit the tuyere: click the clay pipe lying by the bellows';
        if (f.courses >= NC) return 'Click the front opening to plug the arch';
        if (st.daub < 1 && !this.partial) return 'Out of daub — mix some at the trough';
        return `Lay course ${f.courses + 1} of ${NC}: press on the furnace and sweep around`;
      case 'dry':
        return f.drying ? `Drying… ${Math.round(f.dry * 100)}%. A few gentle strokes speed it up` : 'Click the furnace to light a small drying fire';
      case 'smelt':
        if (!sim.lit && sim.F <= 0) return this.embers ? 'Fill the furnace: click the charcoal basket (the drying embers will light it)' : 'Add charcoal';
        if (!sim.lit) return 'The fire is out — click the furnace to relight it';
        if (sim.tapping) return sim.T < 1150 ? 'Slag is running… keep it hot or it will freeze' : 'Slag is running out of the tap hole';
        if (sim.slagLevel > 0.9) return '⚠ Slag is drowning the tuyere — tap it now (click the tap hole)';
        if (sim.F < 0.8 && sim.fill < FILL_CAP - 1) return 'Charcoal is low — add a scoop';
        if (!sim.reachedHeat) return `Pump the bellows to preheat — bring it up to 1100 °C (${T} °C)`;
        if (sim.T > 1400) return 'Too hot! The iron is soaking up carbon — ease off the bellows';
        if (sim.T < 1100 && sim.ore > 0.2) return 'Too cold to reduce the ore — pump harder';
        if (sim.slagLevel > 0.7) return 'Slag is rising toward the tuyere — tap it soon';
        if (this.breakReady && st.ore < 0.05) return 'All ore reduced. Stop pumping, then swing the mallet down through the front plug';
        if (st.ore > 0 && sim.ore < 0.5 && sim.canAdd(1.45 + this.pending)) return 'Room for a charge: one scoop of charcoal and 1 kg of iron sand';
        if (st.ore <= 0 && sim.ore > 0.1) return 'Hold the heat steady while the last ore reduces';
        if (st.ore <= 0 && sim.chargedOre === 0) return 'No iron sand! Pan some at the stream';
        if (this.breakReady) return 'Swing the mallet down through the front plug to open it';
        return 'Keep it in the green band with steady strokes';
      case 'extract': return 'Drag the bloom out onto the stump with the tongs';
    }
    return 'Done. Take the bloom to the Forge (D).';
  }

  panel() {
    const ph = this.phase, h = this.g.hud;
    this._phase = ph;
    if (ph === 'build') h.panel('Furnace — construction', [
      { id: 'status', type: 'text', cls: 'status' },
      { id: 'courses', label: 'Wall courses', min: 0, max: NC },
      { id: 'info', type: 'text' },
      { id: 'tip', type: 'text', html: 'A shaft furnace about a metre tall. The two lowest courses leave an <b>arch</b> at the front: it gets plugged now and broken open at the end to pull the bloom out.' },
    ]);
    else if (ph === 'dry') h.panel('Furnace — drying', [
      { id: 'status', type: 'text', cls: 'status' },
      { id: 'dry', label: 'Dry', min: 0, max: 1 },
      { id: 'air', label: 'Air', min: 0, max: 1.6, bands: [{ from: 0, to: 0.35, cls: 'good' }, { from: 0.35, to: 1.6, cls: 'bad' }] },
      { id: 'info', type: 'text' },
    ]);
    else if (ph === 'smelt') h.panel('Smelt', [
      { id: 'status', type: 'text', cls: 'status' },
      { id: 'temp', label: 'Temperature', min: 0, max: 1650, marker: true, bands: [{ from: BAND[0], to: BAND[1], cls: 'good' }, { from: 1000, to: BAND[0], cls: 'warn' }, { from: 1400, to: 1650, cls: 'bad' }] },
      { id: 'air', label: 'Air (bellows)', min: 0, max: 1.6 },
      { id: 'fill', label: 'Furnace charge', min: 0, max: FILL_CAP, color: '#8a7a6a' },
      { id: 'slag', label: 'Slag level (tuyere at 100%)', min: 0, max: 1.3, bands: [{ from: 0.7, to: 0.9, cls: 'warn' }, { from: 0.9, to: 1.3, cls: 'bad' }], color: '#c0703a' },
      { id: 'info', type: 'text' },
      { id: 'early', type: 'button', label: 'Finish the smelt (leave the rest of the ore)', onClick: () => { this.allowEarly = true; this.g.hud.toast('Stop blowing, then swing the mallet down through the front plug.'); } },
    ]);
    else h.panel('Bloom', [{ id: 'status', type: 'text', cls: 'status' }, { id: 'info', type: 'text' }]);
  }
  panelUpdate() {
    if (this.phase !== this._phase) this.panel();
    const h = this.g.hud, sim = this.sim, st = this.g.state, f = st.furnace;
    h.text('status', this.status);
    switch (this._phase) {
      case 'build':
        h.set('courses', f.courses, `${f.courses} / ${NC}`);
        h.text('info', `<b>Daub:</b> ${st.daub.toFixed(1)} units${st.daubBatches ? ` (quality ${Math.round(st.daubQ * 100)}%)` : ''} · each course takes 1, the plug 1<br><b>Tuyere:</b> ${f.tuyere ? 'fitted' : 'not fitted'} · <b>Arch:</b> ${f.plug ? 'plugged' : 'open'}`);
        break;
      case 'dry':
        h.set('dry', f.dry, Math.round(f.dry * 100) + '%');
        h.set('air', sim.airEff, sim.airEff.toFixed(2));
        h.text('info', `<b>Cracks:</b> ${this.openCracks} · <b>Daub left:</b> ${st.daub.toFixed(1)}`);
        break;
      case 'smelt': {
        const T = sim.T, zone = T > 1400 ? 'too hot' : T >= BAND[0] ? 'reducing' : T >= 1000 ? 'warming' : 'cold';
        h.set('temp', T, `${Math.round(T)} °C · ${zone}`);
        h.set('air', sim.airEff, sim.choke > 0.3 ? 'choked by slag!' : sim.airEff.toFixed(2));
        h.set('fill', sim.fill + this.pending, `${sim.F.toFixed(1)} charcoal · ${sim.ore.toFixed(1)} kg ore`);
        h.set('slag', sim.slagLevel, `${Math.round(sim.slagLevel * 100)}%${sim.tapping ? ' · running' : ''}`);
        const C = sim.carbon, cTxt = !sim.bloom ? '—' : C < 0.2 ? 'soft iron' : C < 0.8 ? 'steely' : C < 1.5 ? 'high carbon' : 'cast-iron risk!';
        h.show('early', this.reduced && st.ore >= 0.05 && !this.allowEarly);
        h.text('info', `<b>Bloom (est.):</b> ${sim.bloom.toFixed(2)} kg · ${cTxt}<br><b>Iron sand:</b> ${sim.chargedOre.toFixed(1)} kg charged, ${st.ore.toFixed(1)} kg in the bucket<br><b>Walls:</b> ${Math.round(sim.integrity * 100)}%${this.openCracks ? ` · ${this.openCracks} unpatched crack${this.openCracks > 1 ? 's' : ''}` : ''}`);
        break;
      }
      default:
        h.text('info', `<b>Bloom:</b> ${this.bloomMass.toFixed(2)} kg · ${Math.round(this.bloomT)} °C`);
    }
  }

  // ------------------------------------------------------------------ dev shortcut
  instantBuild() {
    const g = this.g, f = g.state.furnace;
    if (this.partial && this.partial.mesh) this.partial.mesh.dispose();
    this.partial = null;
    while (f.courses < NC) {
      const i = f.courses, m = this._courseMesh(i, i < 2 ? GAP : 0, needArc(i) + (i < 2 ? 0 : 0.25), 1, 'course');
      m.material = this.clayMat; g.world.caster(m); this.courses.push(m); f.courses++;
    }
    if (!f.tuyere) { this.tuyere.position.set(-0.42, TUY_Y, C.z); this.tuyere.rotation.y = 0; f.tuyere = true; }
    if (!f.plug) { this._makePlug(); f.plug = true; }
    f.dry = 1; f.dried = true; f.drying = false; this.embers = true;
    if (g.state.daubQ === 0) g.state.daubQ = 0.85;
    this.sim.wall = this._wall();
    this._ghost();
  }
}
