// Clay bank + straw pile. Dig: press on the bank and pull toward you (mouse down), release to lift
// the clump. The bank mesh is carved where you dig. Straw: press on the pile and pull up.
import { B, V3, clamp, lerp, rand, mat, noiseTex, lump, fbm, ease, arcPos } from '../util.js';

const BC = V3(-5.35, 0, 2.8); // bank centre
const DIG_R = 0.2, DIG_DEPTH = 0.09;

export class ClayStation {
  constructor(g) {
    this.g = g; this.id = 'clay'; this.label = 'Clay Bank';
    this.pose = { pos: V3(-4.65, 1.6, 0.3), target: V3(-4.7, 0.12, 2.65) };
    const s = g.scene;

    // clay bank: updatable ground displaced into a mound
    const bank = this.bank = B.MeshBuilder.CreateGround('clayBank', { width: 2.2, height: 2.2, subdivisions: 44, updatable: true }, s);
    bank.position.copyFrom(BC);
    const pos = bank.getVerticesData(B.VertexBuffer.PositionKind);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2], r = Math.hypot(x / 1.0, z / 0.9);
      const base = r < 1 ? 0.44 * Math.pow(1 - r * r, 1.3) : 0;
      pos[i + 1] = base * (0.82 + 0.36 * fbm(x * 2.5 + 5, z * 2.5 + 1, 3)) - 0.012;
    }
    bank.updateVerticesData(B.VertexBuffer.PositionKind, pos);
    this._normals();
    const cols = new Float32Array(pos.length / 3 * 4).fill(1);
    bank.setVerticesData(B.VertexBuffer.ColorKind, cols, true);
    const ct = noiseTex(s, 'clayBankTex', { size: 256, scale: 8, c1: [120, 66, 42], c2: [176, 108, 70], contrast: 1.4, speck: 0.03, speckColor: [90, 80, 70] });
    ct.uScale = ct.vScale = 2;
    bank.material = mat(s, 'clayBankMat', [1, 1, 1], { tex: ct, spec: 0.08 });
    g.world.caster(bank);
    g.tag([bank], 'clayBank');

    // straw pile
    const st = noiseTex(s, 'strawTex', { size: 256, scale: 2, sx: 1, sy: 16, c1: [140, 110, 50], c2: [215, 186, 110], contrast: 1.4 });
    const strawMat = mat(s, 'strawMat', [1, 1, 1], { tex: st, spec: 0.05 });
    const mound = this.mound = B.MeshBuilder.CreateSphere('strawMound', { diameter: 1, segments: 16 }, s);
    mound.scaling.set(1.3, 0.62, 1.05); mound.position.set(-3.55, 0.02, 3.2); mound.material = strawMat;
    const strand = B.MeshBuilder.CreateCylinder('strand', { height: 0.22, diameter: 0.006, tessellation: 3 }, s);
    strand.material = mat(s, 'strandMat', [0.78, 0.66, 0.4]);
    strand.parent = mound;
    const mats = [];
    for (let i = 0; i < 260; i++) {
      const a = rand(0, Math.PI * 2), el = rand(0.05, 1.45);
      const p = V3(Math.cos(a) * Math.cos(el) * 0.49, Math.sin(el) * 0.49, Math.sin(a) * Math.cos(el) * 0.49);
      // lie the strands along the surface: tangent direction, mostly horizontal
      const q = B.Quaternion.RotationYawPitchRoll(a + Math.PI / 2 + rand(-0.6, 0.6), Math.PI / 2 + rand(-0.25, 0.25), 0);
      mats.push(B.Matrix.Compose(V3(1 / 1.3, rand(0.6, 1.3) / 0.62, 1 / 1.05), q, p));
    }
    strand.thinInstanceAdd(mats);
    strand.isPickable = false;
    g.world.caster([mound]);
    g.tag([mound], 'strawPile');

    // a carried clump / bundle shown while digging or pulling
    this.heldClump = lump(s, 'heldClump', 0.07, 0.32, 5, 2);
    this.heldClump.material = g.containers.clayMat; this.heldClump.setEnabled(false); this.heldClump.isPickable = false;
    this.heldBundle = B.MeshBuilder.CreateCylinder('heldBundle', { height: 0.45, diameterTop: 0.09, diameterBottom: 0.12, tessellation: 8 }, s);
    this.heldBundle.material = strawMat; this.heldBundle.setEnabled(false); this.heldBundle.isPickable = false;

    this.mode = null; this.hint = '';
  }

  enter() { this.g.containers.place('clay'); }
  exit() { this.mode = null; this.heldClump.setEnabled(false); this.heldBundle.setEnabled(false); }
  accepts(act) { return act === 'clayBank' || act === 'strawPile'; }

  _normals() {
    const pos = this.bank.getVerticesData(B.VertexBuffer.PositionKind), n = [];
    B.VertexData.ComputeNormals(pos, this.bank.getIndices(), n);
    this.bank.updateVerticesData(B.VertexBuffer.NormalKind, n);
  }
  heightAt(p) {
    const pos = this.bank.getVerticesData(B.VertexBuffer.PositionKind);
    let best = 1e9, h = 0;
    const lx = p.x - BC.x, lz = p.z - BC.z;
    for (let i = 0; i < pos.length; i += 3) {
      const d = (pos[i] - lx) ** 2 + (pos[i + 2] - lz) ** 2;
      if (d < best) { best = d; h = pos[i + 1]; }
    }
    return h;
  }
  carve(p) {
    const pos = this.bank.getVerticesData(B.VertexBuffer.PositionKind);
    const col = this.bank.getVerticesData(B.VertexBuffer.ColorKind);
    const lx = p.x - BC.x, lz = p.z - BC.z;
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 4) {
      const d = Math.hypot(pos[i] - lx, pos[i + 2] - lz);
      if (d > DIG_R) continue;
      const f = (1 - (d / DIG_R) ** 2) ** 2;
      pos[i + 1] = Math.max(-0.012, pos[i + 1] - DIG_DEPTH * f);
      const c = lerp(col[j], 0.55, f * 0.7);
      col[j] = c; col[j + 1] = c * 0.95; col[j + 2] = c * 0.92;
    }
    this.bank.updateVerticesData(B.VertexBuffer.PositionKind, pos);
    this.bank.updateVerticesData(B.VertexBuffer.ColorKind, col);
    this._normals();
    this.bank.refreshBoundingInfo();
  }

  down() {
    const g = this.g, hov = g.hover, st = g.state;
    if (!hov) return;
    if (hov.act === 'clayBank') {
      if (st.clay >= st.clayCap) return g.hud.toast('The basket is full — take it to the trough');
      if (this.heightAt(hov.point) < 0.05) return g.hud.toast('Dug out here — try a fuller part of the bank');
      this.mode = 'dig'; this.y0 = g.input.y; this.pt = hov.point.clone(); this.ready = false;
      g.sfx.play('dig', 0.7);
    } else if (hov.act === 'strawPile') {
      if (st.straw >= st.strawCap) return g.hud.toast('You can\'t carry more straw');
      this.mode = 'pull'; this.y0 = g.input.y; this.pt = hov.point.clone(); this.ready = false;
      g.sfx.play('straw', 0.5);
    }
  }
  up() {
    const g = this.g, st = g.state;
    if (this.mode === 'dig') {
      this.heldClump.setEnabled(false);
      if (this.ready) {
        this.carve(this.pt);
        const c = this.heldClump.clone('flyClump'); c.setEnabled(true);
        const from = this.heldClump.position.clone(), to = g.containers.nextClump();
        g.tweens.add(0.5, k => arcPos(from, to, 0.35, k, c.position), () => {
          c.dispose(); st.clay++; st.clayDug++; g.containers.refresh(); g.sfx.play('thunk', 0.6);
          if (st.clay === 8) g.hud.toast('8 clumps — enough clay for a furnace', 'good');
        });
        g.sfx.play('squelch');
      }
    } else if (this.mode === 'pull') {
      this.heldBundle.setEnabled(false);
      if (this.ready) {
        const b = this.heldBundle.clone('flyBundle'); b.setEnabled(true);
        const from = b.position.clone(), to = g.containers.nextBundle();
        g.tweens.add(0.55, k => { arcPos(from, to, 0.4, k, b.position); b.rotation.z = lerp(0.3, Math.PI / 2, k); }, () => {
          b.dispose(); st.straw++; st.strawPulled++; g.containers.refresh(); g.sfx.play('straw', 0.4);
        });
        this.mound.scaling.y = Math.max(0.35, this.mound.scaling.y * 0.97);
      }
    }
    this.mode = null;
  }

  update(dt) {
    const g = this.g, inp = g.input, tools = g.tools, hov = g.hover;
    if (this.mode === 'dig') {
      const pull = clamp((inp.y - this.y0) / (0.09 * inp.h), 0, 1.3);
      if (pull >= 1 && !this.ready) { this.ready = true; g.sfx.play('squelch', 0.6); }
      const toCam = g.camera.position.subtract(this.pt); toCam.y = 0; toCam.normalize();
      const p = this.pt.add(toCam.scale(pull * 0.16)).add(V3(0, pull * 0.12 - 0.03, 0));
      tools.use('spade'); tools.pose(p, lerp(1.0, 0.25, Math.min(1, pull)), 0, 0, dt, 25);
      this.heldClump.setEnabled(this.ready);
      if (this.ready) this.heldClump.position.copyFrom(tools.root.position).addInPlace(V3(0, 0.04, 0.05));
      this.hint = this.ready ? 'Release to lift the clump' : 'Keep pulling toward you…';
      return;
    }
    if (this.mode === 'pull') {
      const pull = clamp((this.y0 - inp.y) / (0.08 * inp.h), 0, 1.4);
      if (pull >= 1 && !this.ready) { this.ready = true; g.sfx.play('straw', 0.5); }
      const p = this.pt.add(V3(0, pull * 0.3, -pull * 0.08));
      tools.use('hand'); tools.pose(p, 0.6, 0, 0, dt, 25);
      this.heldBundle.setEnabled(pull > 0.25);
      this.heldBundle.position.copyFrom(tools.root.position).addInPlace(V3(0, -0.08 - (1 - Math.min(1, pull)) * 0.1, 0.04));
      this.heldBundle.rotation.z = 0.3;
      this.hint = this.ready ? 'Release to toss the bundle on the pile' : 'Pull up to tug a bundle loose…';
      return;
    }
    let p, tool = 'hand', rx = 0.35;
    if (hov && hov.act === 'clayBank') { tool = 'spade'; rx = 0.45; p = hov.point.add(V3(0, 0.05, 0)); }
    else if (hov) p = hov.point.add(V3(0, 0.06, -0.04));
    else p = g.rayPlane(V3(0, 0.25, 0), V3(0, 1, 0));
    tools.use(tool);
    if (p) tools.pose(p, rx, 0, 0, dt, 18);
    const st = g.state;
    if (hov && hov.act === 'clayBank') this.hint = 'Press and pull the mouse toward you to dig a clump';
    else if (hov && hov.act === 'strawPile') this.hint = 'Press and pull up to tug out a bundle of straw';
    else if (st.clay < 8) this.hint = `Dig clay from the bank (${st.clay} in the basket)`;
    else if (st.straw < 3) this.hint = `Pull straw from the pile (${st.straw} bundles)`;
    else this.hint = 'You have enough. Head to the Mixing Trough (D)';
  }

  panel() {
    this.g.hud.panel('Clay bank & straw', [
      { id: 'clay', label: 'Clay basket', min: 0, max: 12, bands: [{ from: 8, to: 12, cls: 'good' }] },
      { id: 'straw', label: 'Straw bundles', min: 0, max: 6, bands: [{ from: 3, to: 6, cls: 'good' }] },
      { id: 'tip', type: 'text', html: 'One furnace takes about <b>8 clumps of clay</b> and <b>3 bundles of straw</b>. The straw binds the clay so it doesn\'t crack as it dries and heats.' },
    ]);
  }
  panelUpdate() {
    const st = this.g.state;
    this.g.hud.set('clay', st.clay, `${st.clay} / 8`);
    this.g.hud.set('straw', st.straw, `${st.straw} / 3`);
  }
}
