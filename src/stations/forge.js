// Forge: the workpiece goes into the fire when you arrive. Work the bellows to heat it; watch the
// colour. Too long at white heat and it burns (sparks, lost metal).
import { B, V3, clamp, smooth, rand, mat, noiseTex, lump, tempColor, flareTex } from '../util.js';
import { Bellows } from '../bellows.js';

const F = V3(7.4, 0, -1.1), HEARTH_Y = 0.74;
export const WELD = [1150, 1320], FORGE = [950, 1250], BURN = 1340;

export class ForgeStation {
  constructor(g) {
    this.g = g; this.id = 'forge'; this.label = 'Forge';
    this.pose = { pos: V3(6.9, 1.62, -2.55), target: V3(7.08, 0.62, -1.12) };
    const s = g.scene;
    const stoneTex = noiseTex(s, 'forgeStoneTex', { size: 256, scale: 8, c1: [70, 64, 60], c2: [130, 122, 112], contrast: 1.6, speck: 0.05, speckColor: [40, 36, 34] });
    stoneTex.uScale = 2; stoneTex.vScale = 2;
    const stone = mat(s, 'forgeStoneMat', [1, 1, 1], { tex: stoneTex });
    const parts = [];
    const box = (w, h, d, x, y, z, m = stone) => { const b = B.MeshBuilder.CreateBox('forgePart', { width: w, height: h, depth: d }, s); b.position.set(x, y, z); b.material = m; b.isPickable = false; parts.push(b); return b; };
    box(1.0, HEARTH_Y - 0.06, 0.85, F.x, (HEARTH_Y - 0.06) / 2, F.z);
    // raised rim around the hearth
    box(1.0, 0.08, 0.12, F.x, HEARTH_Y, F.z - 0.365); box(1.0, 0.08, 0.12, F.x, HEARTH_Y, F.z + 0.365);
    box(0.12, 0.08, 0.61, F.x - 0.44, HEARTH_Y, F.z); box(0.12, 0.08, 0.61, F.x + 0.44, HEARTH_Y, F.z);
    // chimney hood at the back
    box(0.9, 0.9, 0.15, F.x, HEARTH_Y + 0.5, F.z + 0.4);
    box(0.3, 1.2, 0.3, F.x, HEARTH_Y + 1.5, F.z + 0.4);
    g.world.caster(parts);
    // coal bed
    const et = s.getTextureByName('emberTex');
    this.bedMat = mat(s, 'forgeBedMat', [0.05, 0.045, 0.045]); this.bedMat.emissiveTexture = et;
    const bed = B.MeshBuilder.CreateGround('forgeBed', { width: 0.78, height: 0.6 }, s);
    bed.position.set(F.x, HEARTH_Y - 0.01, F.z); bed.material = this.bedMat; bed.isPickable = false;
    const coal = lump(s, 'forgeCoal', 0.035, 0.4, 4, 1); coal.material = s.getMaterialByName('coal'); coal.isPickable = false;
    coal.position.set(F.x, HEARTH_Y - 0.01, F.z);
    const ms = [];
    for (let i = 0; i < 45; i++) {
      const x = rand(-0.36, 0.36), z = rand(-0.27, 0.27), edge = Math.max(Math.abs(x) / 0.36, Math.abs(z) / 0.27);
      if (Math.abs(x) < 0.24 && Math.abs(z) < 0.17) continue; // leave the firepit open so the work is visible
      ms.push(B.Matrix.Compose(V3(1, 1, 1).scale(rand(0.6, 1.2)), B.Quaternion.RotationYawPitchRoll(rand(0, 6), rand(0, 6), 0), V3(x, edge * 0.03, z)));
    }
    coal.thinInstanceAdd(ms);
    // bellows on the left, blowing in through the side
    this.bellows = new Bellows(g, 'forgeBellows', V3(F.x - 0.5 + 0.57 * 0.75, 0.36, F.z), 0.75);
    box(0.75, 0.36, 0.4, F.x - 0.5 + 0.57 * 0.75 - 0.88, 0.18, F.z);
    const tuy = B.MeshBuilder.CreateCylinder('forgeTuyere', { height: 0.14, diameter: 0.05, tessellation: 10 }, s);
    tuy.rotation.z = Math.PI / 2; tuy.position.set(F.x - 0.5, 0.36 + 0.255 * 0.75, F.z); tuy.material = s.getMaterialByName('tuyereMat'); tuy.isPickable = false;

    // fire
    const fl = flareTex(s);
    const fire = this.fire = new B.ParticleSystem('forgeFire', 400, s);
    fire.particleTexture = fl; fire.emitter = V3(F.x, HEARTH_Y + 0.01, F.z);
    fire.minEmitBox = V3(-0.16, 0, -0.12); fire.maxEmitBox = V3(0.16, 0, 0.12);
    fire.minSize = 0.05; fire.maxSize = 0.14; fire.minLifeTime = 0.2; fire.maxLifeTime = 0.45;
    fire.blendMode = B.ParticleSystem.BLENDMODE_ADD; fire.gravity = V3(0, 1.2, 0);
    fire.direction1 = V3(-0.1, 1, -0.1); fire.direction2 = V3(0.1, 1.4, 0.1); fire.minEmitPower = 0.2; fire.maxEmitPower = 0.6;
    fire.color1 = new B.Color4(1, 0.6, 0.2, 1); fire.color2 = new B.Color4(1, 0.35, 0.08, 1); fire.colorDead = new B.Color4(0.2, 0.04, 0, 0);
    fire.emitRate = 0; fire.start();
    const sp = this.sparks = new B.ParticleSystem('burnSparks', 300, s);
    sp.particleTexture = fl; sp.emitter = V3(F.x, HEARTH_Y + 0.05, F.z);
    sp.minEmitBox = V3(-0.1, 0, -0.05); sp.maxEmitBox = V3(0.1, 0.03, 0.05);
    sp.minSize = 0.01; sp.maxSize = 0.025; sp.minLifeTime = 0.3; sp.maxLifeTime = 0.9;
    sp.blendMode = B.ParticleSystem.BLENDMODE_ADD; sp.gravity = V3(0, -1, 0);
    sp.direction1 = V3(-1, 2.5, -1); sp.direction2 = V3(1, 4, 1); sp.minEmitPower = 0.6; sp.maxEmitPower = 1.5;
    sp.color1 = new B.Color4(1, 1, 0.8, 1); sp.color2 = new B.Color4(1, 0.8, 0.4, 1); sp.colorDead = new B.Color4(1, 0.3, 0, 0);
    sp.emitRate = 0; sp.start();
    this.light = new B.PointLight('forgeLight', V3(F.x, HEARTH_Y + 0.4, F.z - 0.2), s);
    this.light.range = 5; this.light.diffuse = new B.Color3(1, 0.5, 0.2); this.light.intensity = 0.3;
    this.fireT = 800; this.tc = new B.Color3(); this.hint = ''; this.status = ''; this.burnWarned = false;
  }

  enter() {
    const p = this.g.ensurePiece();
    if (p) this.place(p);
  }
  place(p) {
    p.location = 'forge'; p.root.setEnabled(true);
    p.root.position.set(F.x + 0.04, HEARTH_Y - 0.008, F.z - 0.02);
    p.root.rotation.set(0, 0.35, 0.04);
  }
  exit() { this.bellows.release(); this.mode = null; this.g.sfx.loop('bellows', 0); }
  accepts(act) { return act === 'bellows'; }
  down() { const h = this.g.hover; if (h && h.act === 'bellows') { this.mode = 'pump'; this.bellows.grab(); } }
  up() { this.mode = null; this.bellows.release(); }

  update(dt) {
    const g = this.g, hov = g.hover;
    if (this.mode === 'pump') {
      g.tools.use('hand'); g.tools.pose(this.bellows.gripPos(), 1.1, 0, 0, dt, 40);
      this.hint = 'Move down to blow, up to refill';
      return;
    }
    let p = hov ? hov.point.clone() : g.rayPlane(V3(0, 0, F.z - 0.5), V3(0, 0, 1));
    g.tools.use('hand');
    if (p) { p.addInPlace(g.camera.position.subtract(p).normalize().scale(0.08)); g.tools.pose(p, 0.4, 0, 0, dt, 20); }
    this.hint = hov ? 'Press and move the mouse down/up to work the bellows' : this.status;
  }

  simulate(dt, active) {
    const g = this.g, b = this.bellows, p = g.piece;
    b.step(dt / g.timeScale, dt);
    this.fireT = 800 + 650 * (1 - Math.exp(-1.2 * b.air));
    if (p) {
      if (p.location === 'forge') {
        const d = p.dims(), th = Math.max(0.01, Math.min(d.H, d.W));
        p.simulate(dt, this.fireT, 0.09 * Math.sqrt(0.06 / th));
        if (p.T >= WELD[0]) p.stats.weldHeat = true;
        if (p.T > BURN) {
          const loss = p.mass * 0.005 * dt; p.mass -= loss; p.stats.burned += loss;
          this.sparks.emitRate = 150;
          if (!this.burnWarned) { this.burnWarned = true; g.hud.toast('It\'s burning! Sparks mean the iron is being lost — ease off the bellows', 'bad'); }
        } else { this.sparks.emitRate = 0; if (p.T < BURN - 40) this.burnWarned = false; }
      } else p.simulate(dt);
      const e = tempColor(p.T); p.mat.emissiveColor = e.scale(0.62);
    }
    // fire visuals
    const tc = tempColor(this.fireT, this.tc), fl = 0.85 + 0.15 * Math.sin(g.time * 19) * Math.sin(g.time * 5.1);
    const k = (0.12 + 0.6 * Math.min(1, b.air)) * fl;
    this.bedMat.emissiveColor.set(tc.r * k, tc.g * k, tc.b * k);
    this.fire.emitRate = 20 + 200 * b.air;
    this.fire.color1.set(tc.r, tc.g, tc.b, 1);
    this.light.intensity = (0.3 + 0.9 * b.air) * fl;
    const v = active ? 1 : 0.1;
    g.sfx.loop('bellows', Math.min(0.4, b.out * 0.18) * v, 380 + b.out * 120);
    if (active) g.sfx.loop('fire', 0.06 + 0.2 * Math.min(1, b.air), 200 + b.air * 400);
    this.status = this._advice();
  }
  _advice() {
    const p = this.g.piece;
    if (!p) return 'No workpiece yet — finish the smelt and set the bloom on the stump';
    const T = p.T, cons = p.stage === 'consolidate', band = cons ? WELD : FORGE;
    if (p.location !== 'forge') return 'Bring the work back to the fire';
    if (T > BURN) return 'Burning! Stop pumping';
    if (T >= band[0]) return cons ? 'Welding heat — take it to the anvil (A) and consolidate it with gentle blows' : 'Forging heat — take it to the anvil (A)';
    return `Heating… ${Math.round(T)} °C. Pump the bellows to bring it to ${cons ? 'welding heat (bright yellow-orange)' : 'forging heat (orange-yellow)'}`;
  }
  panel() {
    const p = this.g.piece, cons = !p || p.stage === 'consolidate', band = cons ? WELD : FORGE;
    this.g.hud.panel('Forge', [
      { id: 'status', type: 'text', cls: 'status' },
      { id: 'temp', label: cons ? 'Work temperature (welding heat)' : 'Work temperature (forging heat)', min: 0, max: 1450, marker: true, bands: [{ from: band[0], to: band[1], cls: 'good' }, { from: BURN, to: 1450, cls: 'bad' }] },
      { id: 'fire', label: 'Fire', min: 700, max: 1450 },
      { id: 'air', label: 'Air (bellows)', min: 0, max: 1.6 },
      { id: 'info', type: 'text', html: 'Colour is your thermometer: dull red ~750 °C, cherry ~850, orange ~1000, yellow ~1150, bright yellow-white ~1300. White and sparking is burning.' },
    ]);
    this._cons = cons;
  }
  panelUpdate() {
    const p = this.g.piece, h = this.g.hud;
    if (p && (p.stage === 'consolidate') !== this._cons) this.panel();
    h.text('status', this.status);
    h.set('temp', p ? p.T : 0, p ? `${Math.round(p.T)} °C` : '—');
    h.set('fire', this.fireT, `${Math.round(this.fireT)} °C`);
    h.set('air', this.bellows.air, this.bellows.air.toFixed(2));
  }
}
