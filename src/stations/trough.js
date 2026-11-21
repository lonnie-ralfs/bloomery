// Mixing trough: add clay, straw and water, then stir (press and rub around) until it's one even daub.
// The surface texture is painted from a mixedness grid, so you can see unmixed lumps and streaks.
import { B, V3, clamp, lerp, smooth, rand, mat, noiseTex, lump, fbm, seeded, arcPos, dampV } from '../util.js';

const TC = V3(3.65, 0, 2.5);
const L = 1.3, W = 0.62, H = 0.3;
const GX = 32, GZ = 16;
const WET = [0.3, 0.5], STRAW = [0.25, 0.5];

const band = (x, lo, hi, fall) => (x < lo ? clamp(1 - (lo - x) / fall) : x > hi ? clamp(1 - (x - hi) / fall) : 1);

export class TroughStation {
  constructor(g) {
    this.g = g; this.id = 'trough'; this.label = 'Mixing Trough';
    this.pose = { pos: V3(3.65, 1.55, 0.6), target: V3(3.65, 0.08, 2.5) };
    const s = g.scene;
    const plank = noiseTex(s, 'plankTex', { size: 128, scale: 2, sx: 8, sy: 1, c1: [82, 56, 34], c2: [138, 98, 62], contrast: 1.5 });
    const wood = mat(s, 'troughWood', [1, 1, 1], { tex: plank });
    const root = new B.TransformNode('trough', s); root.position.copyFrom(TC);
    const parts = [];
    const box = (w, h, d, x, y, z) => { const b = B.MeshBuilder.CreateBox('troughPart', { width: w, height: h, depth: d }, s); b.parent = root; b.position.set(x, y, z); b.material = wood; parts.push(b); return b; };
    box(L, 0.05, W, 0, 0.025, 0);
    box(L, H, 0.05, 0, H / 2, W / 2 - 0.025); box(L, H, 0.05, 0, H / 2, -W / 2 + 0.025);
    box(0.05, H, W, L / 2 - 0.025, H / 2, 0); box(0.05, H, W, -L / 2 + 0.025, H / 2, 0);
    g.world.caster(parts);
    for (const p of parts) p.isPickable = false;

    // mix surface
    this.tex = new B.DynamicTexture('mixTex', { width: 256, height: 128 }, s, true);
    this.surf = B.MeshBuilder.CreateGround('mixSurf', { width: L - 0.1, height: W - 0.1 }, s);
    this.surf.parent = root; this.surfMat = mat(s, 'mixMat', [1, 1, 1], { tex: this.tex, spec: 0.15 });
    this.surf.material = this.surfMat; this.surf.receiveShadows = true; this.surf.setEnabled(false);
    g.tag([this.surf], 'mix', null);
    this.small = document.createElement('canvas'); this.small.width = GX; this.small.height = GZ;

    // water bucket
    const staves = s.getTextureByName('staveTex');
    const wb = new B.TransformNode('waterBucket', s); wb.position.set(4.62, 0, 2.95);
    const bu = B.MeshBuilder.CreateCylinder('wbucket', { height: 0.34, diameterTop: 0.38, diameterBottom: 0.32, tessellation: 20, cap: B.Mesh.CAP_START, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    bu.parent = wb; bu.position.y = 0.17; bu.material = mat(s, 'wbucketMat', [1, 1, 1], { tex: staves });
    const wd = B.MeshBuilder.CreateDisc('wbWater', { radius: 0.17, tessellation: 20 }, s);
    wd.parent = wb; wd.rotation.x = Math.PI / 2; wd.position.y = 0.28; wd.material = mat(s, 'wbWaterMat', [0.18, 0.26, 0.3], { spec: 0.9, specPow: 80 });
    g.world.caster([bu]);
    g.tag([bu, wd], 'water', [bu]);
    this.bucketTop = V3(4.62, 0.4, 2.95);

    this.mix = { clay: 0, straw: 0, water: 0 };
    this.cells = new Float32Array(GX * GZ);
    const r = seeded(7);
    this.pat = Float32Array.from({ length: GX * GZ }, (_, i) => fbm((i % GX) * 0.35, Math.floor(i / GX) * 0.35, 3) * 0.7 + r() * 0.3);
    this.strands = Array.from({ length: 200 }, () => [r(), r(), r() * Math.PI, 6 + r() * 10]);
    this.blobs = [];
    this.mode = null; this.dirty = true; this._paintT = 0; this.hint = '';
    this.stick = V3(TC.x, 0.2, TC.z);
  }

  enter() { this.g.containers.place('trough'); }
  exit() { this.mode = null; this.g.sfx.loop('mud', 0); }
  accepts(act) { return ['clayBasket', 'straw', 'water'].includes(act) || (act === 'mix' && this.mix.clay > 0); }

  get level() { const m = this.mix; return 0.06 + Math.min(1, (m.clay + m.straw * 0.5 + m.water * 0.3) / 12) * 0.17; }
  get wet() { return this.mix.clay ? this.mix.water / this.mix.clay : 0; }
  get strawR() { return this.mix.clay ? this.mix.straw / this.mix.clay : 0; }
  get progress() { let s = 0; for (const c of this.cells) s += c; return this.mix.clay ? s / this.cells.length : 0; }
  get ready() { return this.mix.clay >= 1 && this.progress >= 0.85; }

  _unmix(f) { for (let i = 0; i < this.cells.length; i++) this.cells[i] *= f; this.dirty = true; }
  _surfPoint() { return V3(TC.x + rand(-0.45, 0.45), this.level + 0.02, TC.z + rand(-0.18, 0.18)); }

  down() {
    const g = this.g, hov = g.hover, st = g.state, m = this.mix;
    if (!hov) return;
    if (hov.act === 'clayBasket') {
      if (st.clay <= 0) return g.hud.toast('The basket is empty — dig clay at the Clay Bank');
      st.clay--; g.containers.refresh();
      const c = lump(g.scene, 'mixClump', 0.065, 0.32, rand(0, 9), 2); c.material = g.containers.clayMat;
      const from = g.containers.basketTop(), to = this._surfPoint();
      g.tweens.add(0.45, k => arcPos(from, to, 0.3, k, c.position), () => {
        m.clay++; this._unmix(m.clay / (m.clay + 1.2)); this.surf.setEnabled(true);
        c.position.y = this.level; c.scaling.y = 0.7; this.blobs.push({ m: c, x: to.x, z: to.z });
        g.sfx.play('squelch', 0.8);
      });
    } else if (hov.act === 'straw') {
      if (st.straw <= 0) return g.hud.toast('No straw — pull some from the pile at the Clay Bank');
      st.straw--; g.containers.refresh();
      const b = B.MeshBuilder.CreateCylinder('flyStraw', { height: 0.4, diameter: 0.1, tessellation: 8 }, g.scene);
      b.material = g.scene.getMaterialByName('bundleMat');
      const from = g.containers.strawTop(), to = this._surfPoint();
      g.tweens.add(0.45, k => { arcPos(from, to, 0.3, k, b.position); b.rotation.z = k * 1.5; }, () => {
        b.dispose(); m.straw++; this._unmix(0.85); g.sfx.play('straw', 0.5);
      });
    } else if (hov.act === 'water') {
      if (m.water >= 20) return;
      const d = B.MeshBuilder.CreateSphere('splash', { diameter: 0.12, segments: 6 }, g.scene);
      d.material = g.scene.getMaterialByName('wbWaterMat');
      const from = this.bucketTop.clone(), to = this._surfPoint();
      g.tweens.add(0.4, k => { arcPos(from, to, 0.25, k, d.position); d.scaling.set(1 + k, 1 - k * 0.6, 1 + k); }, () => {
        d.dispose(); m.water++; this._unmix(0.9); this.surf.setEnabled(m.clay > 0 || m.water > 0); g.sfx.play('splash', 0.7);
      });
    } else if (hov.act === 'mix') {
      this.mode = 'stir'; this.last = hov.point.clone();
    }
  }
  up() { this.mode = null; this.g.sfx.loop('mud', 0); }

  takeDaub() {
    const g = this.g, st = g.state, m = this.mix;
    if (!this.ready) return;
    const w = this.wet, sr = this.strawR, pr = this.progress;
    const ws = band(w, WET[0], WET[1], 0.3), ss = band(sr, STRAW[0], STRAW[1], 0.3), ms = smooth(0.6, 1, pr);
    const q = clamp(0.45 * ws + 0.35 * ss + 0.2 * ms);
    const amt = m.clay * 1.15 + m.straw * 0.15;
    st.daubQ = st.daub > 0 ? (st.daubQ * st.daub + q * amt) / (st.daub + amt) : q;
    st.daub += amt; st.daubBatches++;
    const notes = [];
    if (w < WET[0]) notes.push('too dry — it will crack as it dries');
    if (w > WET[1]) notes.push('too wet — it will slump and shrink-crack');
    if (sr < STRAW[0]) notes.push('not enough straw — weak walls');
    if (sr > STRAW[1]) notes.push('too much straw — crumbly');
    g.hud.toast(`Daub ready: ${amt.toFixed(1)} units, quality ${Math.round(q * 100)}%${notes.length ? ' — ' + notes.join(', ') : ' — lovely and even'}`, q > 0.8 ? 'good' : q > 0.55 ? 'warn' : 'bad', 5);
    this.mix = { clay: 0, straw: 0, water: 0 }; this.cells.fill(0);
    for (const b of this.blobs) b.m.dispose(); this.blobs = [];
    this.surf.setEnabled(false); this.dirty = true;
    g.sfx.play('squelch');
  }

  update(dt) {
    const g = this.g, tools = g.tools, hov = g.hover;
    this.surf.position.y = this.level;
    if (this.mode === 'stir') {
      const p = g.rayPlane(V3(0, this.level, 0), V3(0, 1, 0));
      tools.use('stick');
      if (p) {
        p.x = clamp(p.x, TC.x - L / 2 + 0.08, TC.x + L / 2 - 0.08); p.z = clamp(p.z, TC.z - W / 2 + 0.08, TC.z + W / 2 - 0.08);
        const d = B.Vector3.Distance(p, this.last); this.last.copyFrom(p);
        const w = this.wet, stiff = w < 0.15 ? 0.35 : w > 0.9 ? 1.3 : 1;
        this._stir(p, d * stiff);
        tools.pose(V3(p.x, this.level + 0.02, p.z), 0, 0, 0, dt, 30);
        g.sfx.loop('mud', Math.min(0.35, d / dt * 0.25), 250 + w * 300);
      }
      this.hint = this.ready ? 'Mixed! Click "Scoop out the daub" (or keep stirring)' : 'Keep rubbing it around — work out the lumps and streaks';
    } else {
      let p, tool = 'hand';
      if (hov && hov.act === 'mix') { tool = 'stick'; p = V3(hov.point.x, this.level + 0.06, hov.point.z); }
      else if (hov) p = hov.point.add(V3(0, 0.07, -0.05));
      else p = g.rayPlane(V3(0, 0.35, 0), V3(0, 1, 0));
      tools.use(tool);
      if (p) tools.pose(p, tool === 'hand' ? 0.35 : 0, 0, 0, dt, 18);
      this.hint = this._hint(hov);
    }
    // blobs flatten and sink as the mix gets worked
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i], c = this._cellAt(b.x, b.z), mx = c >= 0 ? this.cells[c] : 0;
      b.m.position.y = this.level - mx * 0.05; b.m.scaling.y = lerp(0.7, 0.15, mx);
      if (mx > 0.85) { b.m.dispose(); this.blobs.splice(i, 1); }
    }
    this._paintT -= dt;
    if (this.dirty && this._paintT <= 0) { this._paint(); this._paintT = 0.08; }
  }
  _hint(hov) {
    const m = this.mix, st = this.g.state;
    if (hov) {
      if (hov.act === 'clayBasket') return `Click to drop a clump of clay in (${st.clay} left)`;
      if (hov.act === 'straw') return `Click to add a bundle of straw (${st.straw} left)`;
      if (hov.act === 'water') return 'Click to pour in some water';
      if (hov.act === 'mix') return 'Press and rub around to mix';
    }
    if (!m.clay) return st.clay ? 'Click the clay basket to put clay in the trough' : 'Bring clay from the Clay Bank';
    if (!m.straw && st.straw) return 'Add straw — it binds the clay';
    if (this.wet < WET[0]) return 'Too dry to work — add water';
    if (this.ready) return 'Mixed! Click "Scoop out the daub" in the panel';
    return 'Press on the mix and rub it around until it\'s even';
  }
  _cellAt(x, z) {
    const u = (x - (TC.x - (L - 0.1) / 2)) / (L - 0.1), v = (z - (TC.z - (W - 0.1) / 2)) / (W - 0.1);
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    return Math.min(GZ - 1, Math.floor(v * GZ)) * GX + Math.min(GX - 1, Math.floor(u * GX));
  }
  _stir(p, d) {
    if (d <= 0) return;
    const R = 0.13, cw = (L - 0.1) / GX, cz = (W - 0.1) / GZ;
    for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
      const x = TC.x - (L - 0.1) / 2 + (i + 0.5) * cw, z = TC.z - (W - 0.1) / 2 + (j + 0.5) * cz;
      const dd = Math.hypot(x - p.x, z - p.z);
      if (dd < R) { const k = j * GX + i; this.cells[k] = Math.min(1, this.cells[k] + d * 3 * (1 - dd / R)); }
    }
    this.dirty = true;
  }
  _paint() {
    this.dirty = false;
    const m = this.mix, sctx = this.small.getContext('2d'), img = sctx.createImageData(GX, GZ), d = img.data;
    const w = clamp(this.wet / 0.6), sr = clamp(this.strawR);
    const clayDry = [158, 98, 62], clayWet = [104, 62, 42], puddle = [74, 66, 58], strawC = [196, 166, 96];
    const U = clayDry.map((c, i) => lerp(lerp(c, clayWet[i], w), strawC[i], sr * 0.12));
    for (let k = 0; k < GX * GZ; k++) {
      const p = this.pat[k];
      let un = p < 0.55 ? clayDry.map((c, i) => c * (0.85 + p * 0.3)) : p < 0.72 && m.water ? puddle : p >= 0.72 && m.straw ? strawC : clayDry;
      if (!m.clay) un = puddle;
      const t = this.cells[k];
      d[k * 4] = lerp(un[0], U[0], t); d[k * 4 + 1] = lerp(un[1], U[1], t); d[k * 4 + 2] = lerp(un[2], U[2], t); d[k * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const ctx = this.tex.getContext();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.small, 0, 0, 256, 128);
    const n = Math.min(this.strands.length, m.straw * 45);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < n; i++) {
      const [u, v, a, len] = this.strands[i];
      ctx.strokeStyle = `rgba(${210 - i % 30},${178 - i % 25},${100},0.85)`;
      ctx.beginPath(); ctx.moveTo(u * 256, v * 128); ctx.lineTo(u * 256 + Math.cos(a) * len, v * 128 + Math.sin(a) * len); ctx.stroke();
    }
    this.tex.update();
    this.surfMat.specularColor.set(0.1 + w * 0.3, 0.1 + w * 0.3, 0.1 + w * 0.3);
  }

  panel() {
    this.g.hud.panel('Mixing daub', [
      { id: 'wet', label: 'Wetness (water per clay)', min: 0, max: 1, bands: [{ from: WET[0], to: WET[1], cls: 'good' }, { from: 0.75, to: 1, cls: 'bad' }] },
      { id: 'straw', label: 'Straw per clay', min: 0, max: 0.8, bands: [{ from: STRAW[0], to: STRAW[1], cls: 'good' }] },
      { id: 'mixed', label: 'Mixed', min: 0, max: 1, bands: [{ from: 0.85, to: 1, cls: 'good' }] },
      { id: 'contents', type: 'text' },
      { id: 'take', type: 'button', label: 'Scoop out the daub', onClick: () => this.takeDaub() },
      { id: 'tip', type: 'text', html: 'Good daub is stiff but workable: roughly <b>1 water per 2–3 clay</b>, and <b>1 straw per 3 clay</b>.' },
    ]);
  }
  panelUpdate() {
    const h = this.g.hud, m = this.mix, st = this.g.state;
    h.set('wet', this.wet, m.clay ? this.wet.toFixed(2) : '—');
    h.set('straw', this.strawR, m.clay ? this.strawR.toFixed(2) : '—');
    h.set('mixed', this.progress, Math.round(this.progress * 100) + '%');
    h.text('contents', `<b>In the trough:</b> ${m.clay} clay · ${m.straw} straw · ${m.water} water<br><b>Daub stored:</b> ${st.daub.toFixed(1)} units`);
    h.enable('take', this.ready);
  }
}
