// Things the player carries between stations: clay basket, straw bundles, ore bucket.
// Each is moved to the current station's spot when the player arrives there.
import { B, V3, mat, noiseTex, lump, rand } from './util.js';

export class Containers {
  constructor(g) {
    this.g = g;
    const s = g.scene;
    const wicker = noiseTex(s, 'wickerTex', { size: 128, scale: 4, sx: 6, sy: 2, c1: [90, 62, 32], c2: [170, 128, 70], contrast: 1.8 });
    const staves = noiseTex(s, 'staveTex', { size: 128, scale: 2, sx: 8, sy: 1, c1: [70, 46, 26], c2: [128, 88, 52], contrast: 1.5 });
    const straw = noiseTex(s, 'bundleTex', { size: 128, scale: 2, sx: 1, sy: 16, c1: [150, 118, 52], c2: [222, 190, 112], contrast: 1.4 });
    const sand = noiseTex(s, 'oreSandTex', { size: 128, scale: 16, c1: [28, 27, 30], c2: [70, 66, 62], speck: 0.15, speckColor: [150, 140, 120] });
    this.clayMat = mat(s, 'clumpMat', [0.48, 0.29, 0.19], { spec: 0.15 });
    const iron = mat(s, 'hoopMat', [0.15, 0.15, 0.16], { spec: 0.3 });

    // ---- clay basket ----
    this.clayBasket = new B.TransformNode('clayBasket', s);
    const bk = B.MeshBuilder.CreateCylinder('basket', { height: 0.26, diameterTop: 0.48, diameterBottom: 0.36, tessellation: 20, cap: B.Mesh.CAP_START, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    bk.parent = this.clayBasket; bk.position.y = 0.13; bk.material = mat(s, 'wicker', [1, 1, 1], { tex: wicker });
    const rim = B.MeshBuilder.CreateTorus('basketRim', { diameter: 0.48, thickness: 0.03, tessellation: 24 }, s);
    rim.parent = this.clayBasket; rim.position.y = 0.26; rim.material = bk.material;
    this.clumps = [];
    for (let i = 0; i < 12; i++) {
      const c = lump(s, 'clump', 0.065, 0.32, i, 2);
      c.material = this.clayMat; c.parent = this.clayBasket;
      const layer = Math.floor(i / 5), k = i % 5, a = k / 5 * Math.PI * 2 + layer * 0.6;
      const rr = layer === 2 ? 0.05 : 0.12;
      c.position.set(Math.cos(a) * rr, 0.07 + layer * 0.075, Math.sin(a) * rr);
      c.rotation.set(rand(0, 3), rand(0, 3), 0);
      c.setEnabled(false); this.clumps.push(c);
    }
    g.tag([bk, rim, ...this.clumps], 'clayBasket', [bk, rim]);

    // ---- straw stack ----
    this.strawStack = new B.TransformNode('strawStack', s);
    this.bundles = [];
    const bm = mat(s, 'bundleMat', [1, 1, 1], { tex: straw });
    for (let i = 0; i < 6; i++) {
      const b = B.MeshBuilder.CreateCylinder('bundle', { height: 0.55, diameterTop: 0.11, diameterBottom: 0.14, tessellation: 10 }, s);
      b.material = bm; b.parent = this.strawStack; b.rotation.z = Math.PI / 2; b.rotation.y = rand(-0.15, 0.15);
      const row = i < 3 ? 0 : i < 5 ? 1 : 2, k = i < 3 ? i : i < 5 ? i - 3 : 0;
      const n = row === 0 ? 3 : row === 1 ? 2 : 1;
      b.position.set(0, 0.065 + row * 0.11, (k - (n - 1) / 2) * 0.135);
      const tie = B.MeshBuilder.CreateTorus('tie', { diameter: 0.125, thickness: 0.012, tessellation: 12 }, s);
      tie.parent = b; tie.material = mat(s, 'tieMat', [0.35, 0.3, 0.18]);
      b.setEnabled(false); this.bundles.push(b);
    }
    g.tag(this.bundles, 'straw');

    // ---- ore bucket ----
    this.oreBucket = new B.TransformNode('oreBucket', s);
    const bu = B.MeshBuilder.CreateCylinder('bucket', { height: 0.32, diameterTop: 0.36, diameterBottom: 0.3, tessellation: 20, cap: B.Mesh.CAP_START, sideOrientation: B.Mesh.DOUBLESIDE }, s);
    bu.parent = this.oreBucket; bu.position.y = 0.16; bu.material = mat(s, 'staves', [1, 1, 1], { tex: staves });
    const hoops = [];
    for (const y of [0.06, 0.26]) {
      const h = B.MeshBuilder.CreateTorus('hoop', { diameter: y < 0.1 ? 0.31 : 0.35, thickness: 0.015, tessellation: 24 }, s);
      h.parent = this.oreBucket; h.position.y = y; h.material = iron; hoops.push(h);
    }
    this.oreFill = B.MeshBuilder.CreateDisc('oreFill', { radius: 0.155, tessellation: 20 }, s);
    this.oreFill.parent = this.oreBucket; this.oreFill.rotation.x = Math.PI / 2;
    this.oreFill.material = mat(s, 'oreFillMat', [1, 1, 1], { tex: sand, spec: 0.2 });
    g.tag([bu, ...hoops, this.oreFill], 'oreBucket', [bu, ...hoops]);

    for (const n of [this.clayBasket, this.strawStack, this.oreBucket])
      for (const m of n.getChildMeshes(false)) { g.world.shadow.addShadowCaster(m); m.receiveShadows = true; }

    this.spots = {
      clayBasket: { clay: V3(-4.4, 0, 1.95), trough: V3(2.65, 0, 2.15) },
      strawStack: { clay: V3(-3.72, 0, 1.95), trough: V3(4.6, 0, 2.05) },
      oreBucket: { stream: V3(-3.55, 0, -3.3), furnace: V3(1.5, 0, 6.5) },
    };
    this.place('stream');
    this.refresh();
  }
  place(stationId) {
    for (const [name, spots] of Object.entries(this.spots)) {
      const p = spots[stationId];
      if (p) this[name].position.copyFrom(p);
    }
  }
  refresh() {
    const st = this.g.state;
    this.clumps.forEach((c, i) => c.setEnabled(i < st.clay));
    this.bundles.forEach((b, i) => b.setEnabled(i < st.straw));
    const k = Math.min(1, st.ore / 9);
    this.oreFill.setEnabled(st.ore > 0.01);
    this.oreFill.position.y = 0.03 + k * 0.26;
    const r = 0.15 + k * 0.025; this.oreFill.scaling.set(r / 0.155, r / 0.155, 1);
  }
  // world position where the next clay clump / straw bundle will sit
  nextClump() { const c = this.clumps[Math.min(11, this.g.state.clay)]; c.computeWorldMatrix(true); return c.getAbsolutePosition().clone(); }
  nextBundle() { const b = this.bundles[Math.min(5, this.g.state.straw)]; b.computeWorldMatrix(true); return b.getAbsolutePosition().clone(); }
  bucketTop() { return this.oreBucket.position.add(V3(0, 0.36, 0)); }
  basketTop() { return this.clayBasket.position.add(V3(0, 0.3, 0)); }
  strawTop() { return this.strawStack.position.add(V3(0, 0.25, 0)); }
}
