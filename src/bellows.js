// A hinged leather bellows (same gesture as the furnace one): press on it, move the mouse down to
// blow and up to refill. Output feeds an air model: air ≈ full strokes per second.
import { B, V3, clamp, lerp, mat } from './util.js';

export class Bellows {
  constructor(g, name, pos, scale = 1) {
    this.g = g; const s = g.scene;
    const wood = s.getMaterialByName('bellowsWood') || mat(s, 'bellowsWood', [1, 1, 1], { tex: s.getTextureByName('plankTex') });
    const leather = s.getMaterialByName('bellowsLeather') || mat(s, 'bellowsLeather', [0.32, 0.2, 0.12], { spec: 0.15, back: false });
    const root = this.root = new B.TransformNode(name, s);
    root.position.copyFrom(pos); root.scaling.setAll(scale);
    const vis = [];
    const box = (w, h, d, x, y, z, m = wood, p = root) => { const b = B.MeshBuilder.CreateBox(name + 'Part', { width: w, height: h, depth: d }, s); b.parent = p; b.position.set(x, y, z); b.material = m; vis.push(b); return b; };
    box(0.12, 0.17, 0.5, -1.45, 0.085, 0); box(0.12, 0.17, 0.5, -0.95, 0.085, 0);
    box(0.78, 0.03, 0.46, -1.19, 0.2, 0);
    this.pivot = new B.TransformNode(name + 'Pivot', s); this.pivot.parent = root; this.pivot.position.set(-0.8, 0.232, 0);
    box(0.76, 0.025, 0.46, -0.38, 0.0125, 0, wood, this.pivot);
    box(0.035, 0.26, 0.035, -0.72, 0.13, 0, wood, this.pivot);
    box(0.04, 0.04, 0.3, -0.72, 0.27, 0, wood, this.pivot);
    this.grip = new B.TransformNode(name + 'Grip', s); this.grip.parent = this.pivot; this.grip.position.set(-0.72, 0.3, 0);
    const noz = B.MeshBuilder.CreateCylinder(name + 'Nozzle', { height: 0.26, diameterTop: 0.035, diameterBottom: 0.1, tessellation: 12 }, s);
    noz.parent = root; noz.rotation.z = -Math.PI / 2; noz.position.set(-0.7, 0.255, 0); noz.material = s.getMaterialByName('nozzleMat') || mat(s, 'nozzleMat', [0.2, 0.18, 0.17]);
    vis.push(noz);
    this.bag = B.MeshBuilder.CreateRibbon(name + 'Bag', { pathArray: this._paths(0), closePath: true, updatable: true, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    this.bag.parent = root; this.bag.material = leather;
    const hit = B.MeshBuilder.CreateBox(name + 'Hit', { width: 1.0, height: 0.75, depth: 0.6 }, s);
    hit.parent = root; hit.position.set(-1.17, 0.33, 0); hit.visibility = 0;
    g.tag([hit], 'bellows', vis);
    g.world.caster([...vis, this.bag]);
    this.h = 1; this.hT = 1; this.P = 0; this.air = 0; this.out = 0; this.grabbed = false;
  }
  _paths(theta) {
    const pts = [], x0 = -1.54, x1 = -0.83, z0 = -0.2, z1 = 0.2, n = 5;
    for (let i = 0; i < n; i++) pts.push([lerp(x0, x1, i / n), z0]);
    for (let i = 0; i < n; i++) pts.push([x1, lerp(z0, z1, i / n)]);
    for (let i = 0; i < n; i++) pts.push([lerp(x1, x0, i / n), z1]);
    for (let i = 0; i < n; i++) pts.push([x0, lerp(z1, z0, i / n)]);
    const px = -0.8, py = 0.232, c = Math.cos(theta), sn = Math.sin(theta), bot = [], mid = [], top = [];
    for (const [x, z] of pts) {
      const dx = x - px, tx = px + dx * c, ty = py - dx * sn;
      const b = V3(x, 0.215, z), t = V3(tx, ty, z), m = B.Vector3.Center(b, t);
      const ox = x + 1.18, len = Math.hypot(ox, z) || 1, bul = 0.035 * (ty - 0.215) / 0.3 + 0.01;
      m.x += ox / len * bul; m.z += z / len * bul;
      bot.push(b); mid.push(m); top.push(t);
    }
    return [bot, mid, top];
  }
  grab() { this.grabbed = true; this.y0 = this.g.input.y; this.h0 = this.h; this.hT = this.h; }
  release() { this.grabbed = false; }
  gripPos() { this.grip.computeWorldMatrix(true); return this.grip.getAbsolutePosition(); }
  // rdt: real seconds (bellows follow the hand); sdt: sim seconds (air model)
  step(rdt, sdt) {
    const inp = this.g.input, prev = this.h;
    if (this.grabbed) {
      this.hT = clamp(this.h0 + (this.y0 - inp.y) / (0.22 * inp.h), 0, 1);
      const dh = this.hT - this.h;
      this.h += dh < 0 ? Math.max(dh, -3.5 * rdt) : Math.min(dh, 6 * rdt);
    } else this.h = Math.min(1, this.h + 0.5 * rdt);
    this.out = rdt > 0 ? Math.max(0, (prev - this.h) / rdt) : 0;
    this.P += this.out * sdt; this.P -= this.P * 0.8 * sdt;
    this.air = Math.min(1.6, this.P * 0.8);
    const th = this.h * 0.38;
    this.pivot.rotation.z = -th;
    B.MeshBuilder.CreateRibbon(null, { pathArray: this._paths(th), instance: this.bag });
  }
}
