// Floating first-person tools. One is shown at a time; the active station drives its pose.
// Convention for every tool: local +z points away from the camera, origin is the "working point"
// (fingertips, blade, pan centre, mallet head, tong jaws, rod tip).
import { B, V3, mat, damp, dampV, noiseTex } from './util.js';

export class Tools {
  constructor(scene, world) {
    this.s = scene; this.world = world;
    this.root = new B.TransformNode('toolRoot', scene);
    this.items = {}; this.cur = null; this.yaw = 0; this.snap = true;
    const wt = noiseTex(scene, 'toolWoodTex', { size: 128, scale: 4, sx: 1, sy: 8, c1: [95, 65, 38], c2: [150, 108, 66], contrast: 1.4 });
    this.leather = mat(scene, 'leather', [0.4, 0.26, 0.16], { spec: 0.12 });
    this.iron = mat(scene, 'toolIron', [0.2, 0.2, 0.22], { spec: 0.45, specPow: 48 });
    this.wood = mat(scene, 'toolWood', [1, 1, 1], { tex: wt });
    this.register('hand', this._hand());
    this.register('spade', this._spade());
    this.register('stick', this._stick());
    this.register('mallet', this._mallet());
    this.register('rod', this._rod());
    this.register('tongs', this._tongs());
    this.register('hammer', this._hammer());
  }
  register(name, node) {
    node.parent = this.root; node.setEnabled(false); this.items[name] = node;
    const ms = node.getChildMeshes(false);
    if (node instanceof B.AbstractMesh) ms.push(node);
    for (const m of ms) { m.isPickable = false; this.world.shadow.addShadowCaster(m); }
  }
  use(name) {
    if (this.cur === name) return;
    for (const [k, n] of Object.entries(this.items)) n.setEnabled(k === name);
    this.cur = name;
  }
  // Damped move toward a pose. Rotations are relative to the camera's facing (yaw).
  pose(pos, rx = 0, ry = 0, rz = 0, dt = 0.016, rate = 18) {
    const r = this.root.rotation;
    if (this.snap) {
      this.root.position.copyFrom(pos); r.set(rx, this.yaw + ry, rz); this.snap = false; return;
    }
    dampV(this.root.position, pos, rate, dt);
    r.x = damp(r.x, rx, rate, dt);
    let ty = this.yaw + ry, d = ty - r.y;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    r.y += d * (1 - Math.exp(-rate * dt));
    r.z = damp(r.z, rz, rate, dt);
  }
  setTongs(open) { // 0 closed .. 1 open
    if (!this.tongArms) return;
    this.tongArms[0].rotation.y = 0.1 * open; this.tongArms[1].rotation.y = -0.1 * open;
  }

  _hand() {
    const s = this.s, n = new B.TransformNode('hand', s);
    const palm = B.MeshBuilder.CreateBox('palm', { width: 0.085, height: 0.03, depth: 0.085 }, s);
    palm.parent = n; palm.material = this.leather; palm.position.z = -0.02;
    for (let i = 0; i < 4; i++) {
      const f = B.MeshBuilder.CreateCapsule('finger', { radius: 0.0115, height: 0.075, orientation: V3(0, 0, 1), tessellation: 8, subdivisions: 1 }, s);
      f.parent = n; f.material = this.leather;
      f.position.set(-0.03 + i * 0.02, -0.006, 0.05 - Math.abs(i - 1.5) * 0.006);
      f.rotation.x = 0.35;
    }
    const th = B.MeshBuilder.CreateCapsule('thumb', { radius: 0.012, height: 0.06, orientation: V3(0, 0, 1), tessellation: 8, subdivisions: 1 }, s);
    th.parent = n; th.material = this.leather; th.position.set(-0.052, -0.008, -0.005); th.rotation.y = -0.7;
    const cuff = B.MeshBuilder.CreateCylinder('cuff', { diameter: 0.08, height: 0.09, tessellation: 12 }, s);
    cuff.parent = n; cuff.material = this.leather; cuff.rotation.x = Math.PI / 2; cuff.position.z = -0.1;
    return n;
  }
  _spade() {
    const s = this.s, n = new B.TransformNode('spade', s);
    const blade = B.MeshBuilder.CreateBox('blade', { width: 0.15, height: 0.012, depth: 0.2 }, s);
    blade.parent = n; blade.material = this.iron; blade.position.z = 0.0;
    const d = V3(0, 0.6, -0.8).normalize();
    const shaft = B.MeshBuilder.CreateCylinder('shaft', { height: 0.85, diameter: 0.034, tessellation: 8 }, s);
    shaft.parent = n; shaft.material = this.wood; shaft.rotation.x = Math.atan2(d.z, d.y);
    shaft.position = V3(0, 0, -0.1).add(d.scale(0.425));
    const grip = B.MeshBuilder.CreateBox('grip', { width: 0.14, height: 0.03, depth: 0.03 }, s);
    grip.parent = n; grip.material = this.wood; grip.position = V3(0, 0, -0.1).add(d.scale(0.85));
    return n;
  }
  _stick() {
    const s = this.s, n = new B.TransformNode('stick', s);
    const d = V3(0, 0.75, -0.66).normalize();
    const c = B.MeshBuilder.CreateCylinder('stickMesh', { height: 0.9, diameterTop: 0.03, diameterBottom: 0.022, tessellation: 8 }, s);
    c.parent = n; c.material = this.wood; c.rotation.x = Math.atan2(d.z, d.y); c.position = d.scale(0.45);
    return n;
  }
  _mallet() {
    const s = this.s, n = new B.TransformNode('mallet', s);
    const head = B.MeshBuilder.CreateCylinder('malletHead', { diameter: 0.12, height: 0.2, tessellation: 14 }, s);
    head.parent = n; head.material = this.wood; head.rotation.z = Math.PI / 2;
    for (const x of [-0.085, 0.085]) {
      const band = B.MeshBuilder.CreateTorus('band', { diameter: 0.122, thickness: 0.012, tessellation: 16 }, s);
      band.parent = n; band.material = this.iron; band.rotation.z = Math.PI / 2; band.position.x = x;
    }
    const d = V3(0, -0.3, -0.95).normalize();
    const handle = B.MeshBuilder.CreateCylinder('malletHandle', { height: 0.55, diameter: 0.03, tessellation: 8 }, s);
    handle.parent = n; handle.material = this.wood; handle.rotation.x = Math.atan2(d.z, d.y); handle.position = d.scale(0.3);
    return n;
  }
  _rod() {
    const s = this.s, n = new B.TransformNode('rod', s);
    const d = V3(0, 0.35, -0.94).normalize();
    const c = B.MeshBuilder.CreateCylinder('rodMesh', { height: 1.0, diameterTop: 0.02, diameterBottom: 0.012, tessellation: 6 }, s);
    c.parent = n; c.material = this.iron; c.rotation.x = Math.atan2(d.z, d.y); c.position = d.scale(0.5);
    return n;
  }
  // Cross-peen forging hammer. Origin = centre of the striking face (bottom); the handle comes
  // back toward the smith (-z) and a little to the right.
  _hammer() {
    const s = this.s, n = new B.TransformNode('hammer', s);
    const steel = mat(s, 'hammerSteel', [0.32, 0.32, 0.34], { spec: 0.6, specPow: 64 });
    const face = B.MeshBuilder.CreateCylinder('hFace', { diameter: 0.044, height: 0.03, tessellation: 20 }, s);
    face.parent = n; face.material = steel; face.position.y = 0.015;
    const body = B.MeshBuilder.CreateBox('hBody', { width: 0.04, height: 0.07, depth: 0.04 }, s);
    body.parent = n; body.material = steel; body.position.y = 0.062;
    const peen = B.MeshBuilder.CreateCylinder('hPeen', { diameterTop: 0.006, diameterBottom: 0.04, height: 0.035, tessellation: 4 }, s);
    peen.parent = n; peen.material = steel; peen.position.y = 0.114; peen.rotation.y = Math.PI / 4; peen.scaling.z = 0.35;
    const d = V3(0.62, 0.55, -0.56).normalize();
    const handle = B.MeshBuilder.CreateCylinder('hHandle', { height: 0.3, diameterTop: 0.018, diameterBottom: 0.022, tessellation: 10 }, s);
    handle.parent = n; handle.material = this.wood;
    const at = V3(0, 0.062, 0).add(d.scale(0.15));
    handle.position = at;
    // align cylinder Y axis with d
    const axis = B.Vector3.Cross(B.Axis.Y, d).normalize(), ang = Math.acos(B.Vector3.Dot(B.Axis.Y, d));
    handle.rotationQuaternion = B.Quaternion.RotationAxis(axis, ang);
    return n;
  }
  _tongs() {
    const s = this.s, n = new B.TransformNode('tongs', s);
    const tilt = new B.TransformNode('tongTilt', s); tilt.parent = n; tilt.rotation.x = -0.36;
    this.tongArms = [];
    for (const side of [-1, 1]) {
      const arm = new B.TransformNode('tongArm', s); arm.parent = tilt; arm.position.set(0, 0, -0.08);
      const bar = B.MeshBuilder.CreateBox('tongBar', { width: 0.014, height: 0.014, depth: 0.62 }, s);
      bar.parent = arm; bar.material = this.iron; bar.position.set(side * 0.018, 0, -0.25);
      const jaw = B.MeshBuilder.CreateBox('tongJaw', { width: 0.016, height: 0.05, depth: 0.1 }, s);
      jaw.parent = arm; jaw.material = this.iron; jaw.position.set(side * 0.03, -0.01, 0.1); jaw.rotation.y = side * 0.25;
      this.tongArms.push(arm);
    }
    return n;
  }
}
