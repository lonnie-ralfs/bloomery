// Stream: pan iron sand. Scoop from the dark sand bed, dip the pan in the water (hold the button)
// and shake side to side. Light quartz washes over the lip; heavy black iron sand stays — unless
// you shake too violently. Empty the concentrate into the ore bucket.
import { B, V3, clamp, damp, dampV, smooth, rand, mat, noiseTex, lump, ease, lerp } from '../util.js';
import { purity } from '../state.js';

const IRON_GRAINS = 22, LIGHT_GRAINS = 46, GRAIN_KG = 0.065;
const WATER_Z = -3.75; // pan is over water when z < this
const SHAKE_GOOD = [1.2, 3.2], SHAKE_MAX = 3.4;

export class StreamStation {
  constructor(g) {
    this.g = g; this.id = 'stream'; this.label = 'Stream';
    this.pose = { pos: V3(-4.2, 1.5, -1.55), target: V3(-4.3, 0.1, -3.95) };
    const s = g.scene;

    // water
    const water = B.MeshBuilder.CreateGround('water', { width: 22, height: 2.4 }, s);
    water.position.set(-4, 0.02, -4.95);
    const wt = noiseTex(s, 'waterTex', { size: 256, scale: 8, sx: 1, sy: 2, c1: [34, 58, 70], c2: [96, 128, 136], contrast: 1.5 });
    wt.uScale = 8; wt.vScale = 1;
    const wm = mat(s, 'waterMat', [1, 1, 1], { tex: wt, spec: 0.9, specPow: 80 });
    wm.alpha = 0.9; wm.zOffset = -2;
    water.material = wm; water.receiveShadows = true; water.isPickable = false;
    this.waterTex = wt;
    // stones along both banks
    for (let i = 0; i < 46; i++) {
      const st = g.world.stoneBase.createInstance('bankStone' + i);
      const side = i % 2 ? -3.72 : -6.18;
      st.position.set(rand(-14, 6), 0.01, side + rand(-0.12, 0.12));
      const k = rand(0.2, 0.6); st.scaling.set(k, k * 0.5, k); st.rotation.y = rand(0, 6); st.isPickable = false;
    }
    // sand bed
    const bedTex = noiseTex(s, 'bedTex', { size: 256, scale: 16, c1: [88, 80, 66], c2: [150, 134, 108], speck: 0.3, speckColor: [24, 24, 27] });
    bedTex.uScale = 2; bedTex.vScale = 1;
    const bed = B.MeshBuilder.CreateGround('sandBed', { width: 1.7, height: 0.75 }, s);
    bed.position.set(-5.0, 0.012, -3.35);
    const bedMat = mat(s, 'bedMat', [1, 1, 1], { tex: bedTex }); bedMat.zOffset = -3; bed.material = bedMat;
    bedMat.opacityTexture = s.getTextureByName('yardFade');
    bed.receiveShadows = true;
    g.tag([bed], 'sandBed');
    this.bed = bed;

    // pan (a tool)
    this.pan = new B.TransformNode('pan', s);
    const panMesh = B.MeshBuilder.CreateCylinder('panMesh', { height: 0.07, diameterTop: 0.44, diameterBottom: 0.22, tessellation: 32, cap: B.Mesh.CAP_START, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    panMesh.parent = this.pan; panMesh.material = mat(s, 'panMat', [0.2, 0.17, 0.15], { spec: 0.35, specPow: 40 });
    const rim = B.MeshBuilder.CreateTorus('panRim', { diameter: 0.44, thickness: 0.012, tessellation: 32 }, s);
    rim.parent = this.pan; rim.position.y = 0.035; rim.material = panMesh.material;
    const waterIn = B.MeshBuilder.CreateDisc('panWater', { radius: 0.17, tessellation: 24 }, s);
    waterIn.parent = this.pan; waterIn.rotation.x = Math.PI / 2; waterIn.position.y = -0.005;
    waterIn.material = mat(s, 'panWaterMat', [0.25, 0.35, 0.4], { spec: 0.9, specPow: 80, alpha: 0.45 });
    waterIn.isPickable = false; this.panWater = waterIn;
    g.tools.register('pan', this.pan);

    // grain bases (kept far below ground; instances are what you see)
    this.ironBase = B.MeshBuilder.CreateSphere('ironGrain', { diameter: 0.016, segments: 3 }, s);
    this.ironBase.material = mat(s, 'ironGrainMat', [0.07, 0.07, 0.08], { spec: 0.6, specPow: 60 });
    this.lightBase = B.MeshBuilder.CreateSphere('lightGrain', { diameter: 0.02, segments: 3 }, s);
    this.lightBase.material = mat(s, 'lightGrainMat', [0.78, 0.7, 0.55], { spec: 0.1 });
    for (const b of [this.ironBase, this.lightBase]) { b.position.y = -50; b.isPickable = false; }
    this.grains = [];

    this.panPos = V3(-4.3, 0.35, -3.5); this.prevPos = this.panPos.clone(); this.vel = V3(); this.acc = V3();
    this.E = 0; this.busy = false; this.submerged = false; this.hint = '';
  }

  enter() { this.g.containers.place('stream'); this.g.tools.use('pan'); this.panPos.copyFrom(this.g.tools.root.position); }
  exit() { this.g.sfx.loop('water', 0); this.g.sfx.loop('mud', 0); }
  accepts(act) { return (act === 'sandBed' && !this.grains.length) || (act === 'oreBucket' && this.grains.length > 0); }

  get ironLeft() { return this.grains.filter(q => q.heavy && !q.lost).length; }
  get lightLeft() { return this.grains.filter(q => !q.heavy && !q.lost).length; }

  down() {
    const hov = this.g.hover;
    if (this.busy) return;
    if (hov && hov.act === 'sandBed' && !this.grains.length) return this._scoop(hov.point);
    if (hov && hov.act === 'oreBucket' && this.grains.length) return this._empty();
  }
  up() {}

  _scoop(p) {
    this.busy = true;
    const from = this.panPos.clone(), dip = V3(p.x, 0.05, p.z);
    this.g.tweens.add(0.3, k => { B.Vector3.LerpToRef(from, dip, ease.out(k), this.panPos); }, () => {
      this.g.sfx.play('dig', 0.6); this.g.sfx.play('pour', 0.5);
      this._fill();
      const lift = V3(p.x, 0.32, p.z - 0.25);
      this.g.tweens.add(0.35, k => { B.Vector3.LerpToRef(dip, lift, ease.out(k), this.panPos); }, () => { this.busy = false; });
    });
  }
  _fill() {
    const mk = heavy => {
      const inst = (heavy ? this.ironBase : this.lightBase).createInstance('grain');
      inst.parent = this.pan; inst.isPickable = false;
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.15;
      return { inst, heavy, x: Math.cos(a) * r, z: Math.sin(a) * r, vx: 0, vz: 0, lost: false };
    };
    for (let i = 0; i < IRON_GRAINS; i++) this.grains.push(mk(true));
    for (let i = 0; i < LIGHT_GRAINS; i++) this.grains.push(mk(false));
  }
  _empty() {
    this.busy = true;
    const g = this.g, from = this.panPos.clone(), to = g.containers.bucketTop().add(V3(0, 0.12, -0.05));
    g.tweens.add(0.4, k => { B.Vector3.LerpToRef(from, to, ease.inOut(k), this.panPos); this.tilt = k * 0.9; }, () => {
      const iron = this.ironLeft, light = this.lightLeft;
      const ironKg = iron * GRAIN_KG, lightKg = light * GRAIN_KG * 0.8;
      g.state.ore += ironKg + lightKg; g.state.oreIronKg += ironKg; g.state.orePanned += ironKg + lightKg;
      for (const q of this.grains) q.inst.dispose();
      this.grains = [];
      g.containers.refresh(); g.sfx.play('pour', 0.8);
      const pur = Math.round(iron / Math.max(1, iron + light) * 100);
      g.hud.toast(`+${(ironKg + lightKg).toFixed(2)} kg of iron sand (${pur}% pure). Bucket: ${g.state.ore.toFixed(1)} kg`, pur >= 80 ? 'good' : 'warn');
      g.tweens.add(0.35, k => { this.tilt = (1 - k) * 0.9; }, () => { this.busy = false; this.tilt = 0; });
    });
  }

  update(dt) {
    const g = this.g, inp = g.input;
    g.tools.use('pan');
    let target = this.panPos.clone();
    if (!this.busy) {
      const p = g.rayPlane(V3(0, 0.3, 0), V3(0, 1, 0));
      if (p) { target.x = clamp(p.x, -5.8, -2.8); target.z = clamp(p.z, -4.7, -3.0); }
      const overWater = target.z < WATER_Z;
      this.submerged = inp.down && overWater;
      const overBed = g.hover && g.hover.act === 'sandBed';
      target.y = this.submerged ? 0.06 : overBed ? 0.17 : 0.3;
      dampV(this.panPos, target, this.submerged ? 22 : 14, dt);
    } else this.submerged = false;

    // velocity / acceleration of the pan
    const v = this.panPos.subtract(this.prevPos).scale(1 / Math.max(dt, 1e-3));
    const a = v.subtract(this.vel).scale(1 / Math.max(dt, 1e-3));
    dampV(this.acc, a, 20, dt); this.vel.copyFrom(v); this.prevPos.copyFrom(this.panPos);

    const spd = this.submerged ? Math.abs(inp.vx) + 0.4 * Math.abs(inp.vy) : 0;
    this.E = damp(this.E, spd, this.submerged ? 5 : 3, dt);
    const roll = clamp(-this.vel.x * 0.12, -0.3, 0.3);
    const pitch = this.submerged ? 0.2 : (this.tilt || 0);
    g.tools.pose(this.panPos, pitch, 0, roll, dt, 40);
    this.panWater.setEnabled(this.grains.length > 0 && !this.busy);

    this._grains(dt);

    // sound
    g.sfx.loop('water', 0.05 + (this.submerged ? 0.12 + this.E * 0.05 : 0), 1500 + this.E * 300);

    // hint
    const il = this.ironLeft, ll = this.lightLeft;
    if (!this.grains.length) this.hint = g.hover && g.hover.act === 'sandBed' ? 'Click to scoop a pan of sand' : 'Click the dark sand bed by the bank to scoop a pan of sand';
    else if (ll <= 5) this.hint = 'Concentrated! Click the ore bucket to empty the pan';
    else if (!this.submerged) this.hint = 'Hold the mouse button over the water to dip the pan, then shake side to side';
    else if (this.E < SHAKE_GOOD[0]) this.hint = 'Shake harder — side to side';
    else if (this.E > SHAKE_MAX) this.hint = 'Too wild! The heavy black iron sand is washing out';
    else this.hint = 'Good — the light sand is washing over the lip';
  }

  _grains(dt) {
    const E = this.E, sub = this.submerged;
    const lamL = sub ? 0.3 * smooth(0.5, 1.4, E) : 0;
    const lamH = sub ? 0.4 * smooth(3.2, 4.6, E) : 0;
    const damping = Math.exp(-8 * dt);
    for (const q of this.grains) {
      if (q.lost) continue;
      const mob = q.heavy ? 0.3 : 1;
      q.vx += (-this.acc.x * 0.08 * mob + (Math.random() - 0.5) * E * mob * 3) * dt;
      q.vz += (-this.acc.z * 0.08 * mob + (Math.random() - 0.5) * E * mob * 3 + (q.heavy ? 0 : E * 0.05)) * dt;
      q.vx *= damping; q.vz *= damping;
      q.x += q.vx * dt; q.z += q.vz * dt;
      const r = Math.hypot(q.x, q.z);
      if (r > 0.16) { const k = 0.16 / r; q.x *= k; q.z *= k; q.vx *= -0.4; q.vz *= -0.4; }
      const rr = Math.min(0.16, r);
      const y = -0.03 + (rr > 0.11 ? (rr - 0.11) / 0.11 * 0.07 : 0) + (q.heavy ? 0.003 : 0.01 + E * 0.003);
      q.inst.position.set(q.x, y, q.z);
      const lam = q.heavy ? lamH : lamL;
      if (lam > 0 && Math.random() < 1 - Math.exp(-lam * dt)) this._lose(q);
    }
  }
  _lose(q) {
    q.lost = true;
    const from = q.inst.position.clone(), to = V3(q.x * 0.4, 0.05, 0.27);
    this.g.tweens.add(0.5, k => {
      if (q.inst.isDisposed()) return;
      q.inst.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k) - k * k * 0.15, lerp(from.z, to.z, k));
      q.inst.scaling.setAll(1 - k * 0.6);
    }, () => {
      q.inst.dispose();
      const i = this.grains.indexOf(q); if (i >= 0) this.grains.splice(i, 1);
    });
  }

  simulate(dt) { this.waterTex.uOffset += dt * 0.045; }

  panel() {
    this.g.hud.panel('Panning iron sand', [
      { id: 'shake', label: 'Shake', min: 0, max: 5, bands: [{ from: SHAKE_GOOD[0], to: SHAKE_GOOD[1], cls: 'good' }, { from: SHAKE_MAX, to: 5, cls: 'bad' }] },
      { id: 'pan', type: 'text' },
      { id: 'bucket', type: 'text' },
      { id: 'tip', type: 'text', html: 'Black grains are iron sand (heavy). Pale grains are quartz (light). A cleaner concentrate makes less slag and more iron. ~4 kg is enough for a good smelt; more ore = a bigger bloom.' },
    ]);
  }
  panelUpdate() {
    const h = this.g.hud, il = this.ironLeft, ll = this.lightLeft;
    h.set('shake', this.E, this.submerged ? this.E.toFixed(1) : '—');
    h.text('pan', this.grains.length ? `<b>Pan:</b> ${il} iron grains · ${ll} quartz grains` : '<b>Pan:</b> empty');
    const st = this.g.state;
    h.text('bucket', `<b>Ore bucket:</b> ${st.ore.toFixed(2)} kg · ${Math.round(purity() * 100)}% pure`);
  }
}
