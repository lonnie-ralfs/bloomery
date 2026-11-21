// The hot workpiece: bloom -> rough ingot -> billet.
//
// The metal is a lattice of material points (interior included). The visible surface mesh is
// embedded in it by a tricubic B-spline, so the surface is smooth (no kinks) and can't crumple
// however it's worked. Every blow moves the lattice points:
//
// Local frame: the anvil face is y = 0, the piece is centred on x/z and its long axis is x
// (or y when it's stood on end to square the ends).
//   1. bend: a lifted bar is pressed straight between its supports, a slightly lifted end swings
//      down, a badly curved bar rocks;
//   2. squeeze the columns under the round hammer face between two planes: the hammer flattens
//      the top, the anvil flattens the underside;
//   3. (relax the material along the bar so it stays smooth and evenly spread);
//   4. flow, solved so the volume is kept. Metal takes the shortest way to a free surface:
//      along the bar (everything beyond the hammer shifts outward = the bar lengthens) and across
//      it (the struck slice widens). The top of the struck slice moves further than the bottom,
//      which mushrooms a spot that's hit too often;
//   5. curl: the struck face stretches a little more than the face on the anvil, so the ends lift.
import { B, V3, clamp, lerp, smooth, fbm3, interp, mat } from './util.js';
import { BarModel } from './bar.js';

const NX = 64, NY = 14, NZ = 14;       // surface mesh resolution
const LX = 42, LY = 10, LZ = 10;       // material lattice (incl. a one-node margin each side)
export const DENSITY = 7870;
export const HAMMER_R = 0.022;
const PLAST = [[600, 0.03], [750, 0.15], [900, 0.45], [1050, 0.8], [1200, 1], [1350, 1.1]];
export const plasticity = T => interp(PLAST, T);
const L3 = (i, j, k) => ((i * LY + j) * LZ + k) * 3;

function sdBox(x, y, z, bx, by, bz) {
  const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}

export class Workpiece {
  constructor(g, o = {}) {
    this.g = g;
    this.mass = o.mass ?? 2;          // kg (iron + slag)
    this.slag = o.slag ?? 0.12;       // fraction of mass that is slag inclusions
    this.carbon = o.carbon ?? 0.4;
    this.T = o.T ?? 1000;
    this.porosity = 0.35;             // the bloom is a sponge; consolidation closes it up
    this.cohesion = 0;
    this._stage = 'consolidate';      // consolidate -> ingot -> billet -> done
    this.location = 'none';
    this.stats = { blows: 0, crumbled: 0, coldHits: 0, burned: 0, slagOut: 0, consHeat: 0, consBlows: 0, startMass: this.mass };
    this.root = new B.TransformNode('pieceRoot', g.scene);
    this._build(o.seed ?? Math.random() * 10);
    this._tongs();
  }
  get solidVol() { return this.mass / DENSITY; }
  get targetVol() { return this.solidVol / (1 - this.porosity); }

  // ------------------------------------------------------------------ build
  _build(seed) {
    const s = this.g.scene, key = new Map(), lat = [], tris = [];
    const id = (i, j, k) => {
      const kk = (i * 1000 + j) * 1000 + k;
      let v = key.get(kk);
      if (v === undefined) { v = lat.length; key.set(kk, v); lat.push([i, j, k]); }
      return v;
    };
    const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);
    for (const sj of [0, NY]) for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) quad(id(i, sj, k), id(i + 1, sj, k), id(i + 1, sj, k + 1), id(i, sj, k + 1));
    for (const sk of [0, NZ]) for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) quad(id(i, j, sk), id(i + 1, j, sk), id(i + 1, j + 1, sk), id(i, j + 1, sk));
    for (const si of [0, NX]) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) quad(id(si, j, k), id(si, j + 1, k), id(si, j + 1, k + 1), id(si, j, k + 1));
    const n = lat.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
    // bloom: a lumpy, pitted ellipsoid
    for (let v = 0; v < n; v++) {
      const [i, j, k] = lat[v];
      const x = i / NX * 2 - 1, y = j / NY * 2 - 1, z = k / NZ * 2 - 1;
      const sx = x * Math.sqrt(Math.max(0, 1 - y * y / 2 - z * z / 2 + y * y * z * z / 3));
      const sy = y * Math.sqrt(Math.max(0, 1 - z * z / 2 - x * x / 2 + z * z * x * x / 3));
      const sz = z * Math.sqrt(Math.max(0, 1 - x * x / 2 - y * y / 2 + x * x * y * y / 3));
      const lumps = fbm3(sx * 2.2 + seed, sy * 2.2, sz * 2.2 + seed * 0.7, 3);
      const pits = fbm3(sx * 6 + 9 + seed, sy * 6, sz * 6, 2);
      const f = 1 + (lumps - 0.5) * 0.45 - smooth(0.55, 0.78, pits) * 0.1;
      pos[v * 3] = sx * 1.25 * f; pos[v * 3 + 1] = sy * 0.8 * f; pos[v * 3 + 2] = sz * 1.0 * f;
      const c = 1 - (smooth(0.5, 0.75, pits) * 0.45 + smooth(0.55, 0.75, lumps) * 0.25);
      col[v * 4] = c; col[v * 4 + 1] = c * 0.95; col[v * 4 + 2] = c * 0.92; col[v * 4 + 3] = 1;
    }
    for (let t = 0; t < tris.length; t += 3) { // outward winding
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      if (nx * (pos[a] + pos[b] + pos[c]) + ny * (pos[a + 1] + pos[b + 1] + pos[c + 1]) + nz * (pos[a + 2] + pos[b + 2] + pos[c + 2]) < 0) { const tmp = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = tmp; }
    }
    this.pos = pos; this.idx = Uint32Array.from(tris); this.col = col; this.n = n;
    // Babylon is left-handed (clockwise = front face): render with the winding flipped.
    // this.idx keeps the right-handed winding the volume maths uses.
    this.ridx = new Uint32Array(this.idx.length);
    for (let t = 0; t < this.idx.length; t += 3) { this.ridx[t] = this.idx[t]; this.ridx[t + 1] = this.idx[t + 2]; this.ridx[t + 2] = this.idx[t + 1]; }
    // scale to the bloom's volume
    const k = Math.cbrt(this.targetVol / this.volume());
    for (let i = 0; i < pos.length; i++) pos[i] *= k;

    // embed the surface in a lattice of material points
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
    for (let i = 0; i < pos.length; i += 3) {
      mnx = Math.min(mnx, pos[i]); mxx = Math.max(mxx, pos[i]); mny = Math.min(mny, pos[i + 1]); mxy = Math.max(mxy, pos[i + 1]); mnz = Math.min(mnz, pos[i + 2]); mxz = Math.max(mxz, pos[i + 2]);
    }
    const pad = 0.002; mnx -= pad; mxx += pad; mny -= pad; mxy += pad; mnz -= pad; mxz += pad;
    // Cubic B-spline lattice: nodes 1..L-2 span the piece, nodes 0 and L-1 are a one-cell margin so
    // every surface point has its full 4x4x4 neighbourhood (uniform B-splines reproduce the rest
    // shape exactly and give a surface with no kinks along cell edges)
    const node = this.node = new Float32Array(LX * LY * LZ * 3);
    const at = (lo, hi, i, L) => lo + (hi - lo) * (i - 1) / (L - 3);
    for (let i = 0; i < LX; i++) for (let j = 0; j < LY; j++) for (let kk = 0; kk < LZ; kk++) {
      const q = L3(i, j, kk);
      node[q] = at(mnx, mxx, i, LX); node[q + 1] = at(mny, mxy, j, LY); node[q + 2] = at(mnz, mxz, kk, LZ);
    }
    const bs = (t, out, o) => {
      const t2 = t * t, t3 = t2 * t, u = 1 - t;
      out[o] = u * u * u / 6; out[o + 1] = (3 * t3 - 6 * t2 + 4) / 6; out[o + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; out[o + 3] = t3 / 6;
    };
    this.vb = new Int32Array(n); this.vw = new Float32Array(n * 12);
    for (let v = 0; v < n; v++) {
      const u = 1 + (pos[v * 3] - mnx) / (mxx - mnx) * (LX - 3), w = 1 + (pos[v * 3 + 1] - mny) / (mxy - mny) * (LY - 3), t = 1 + (pos[v * 3 + 2] - mnz) / (mxz - mnz) * (LZ - 3);
      const i = clamp(Math.floor(u), 1, LX - 3), j = clamp(Math.floor(w), 1, LY - 3), kk = clamp(Math.floor(t), 1, LZ - 3);
      this.vb[v] = ((i - 1) * LY + (j - 1)) * LZ + (kk - 1);
      bs(u - i, this.vw, v * 12); bs(w - j, this.vw, v * 12 + 4); bs(t - kk, this.vw, v * 12 + 8);
    }
    this.eval(); this.settle();

    const m = this.mesh = new B.Mesh('workpiece', s);
    const vd = new B.VertexData();
    vd.positions = this.pos; vd.indices = this.ridx; vd.colors = col;
    const nrm = new Float32Array(n * 3);
    B.VertexData.ComputeNormals(this.pos, this.ridx, nrm); vd.normals = nrm;
    vd.applyToMesh(m, true);
    m.parent = this.root;
    m.metadata = { glowScale: 0.35 }; // keep the halo modest so the shape stays readable
    this.mat = mat(s, 'pieceMat', [0.36, 0.33, 0.31], { spec: 0.35, specPow: 40 });
    m.material = this.mat; m.isPickable = false;
    this.g.world.caster(m);
  }
  // surface from lattice (tricubic B-spline)
  eval() {
    const N = this.node, p = this.pos, W = this.vw;
    for (let v = 0; v < this.n; v++) {
      const base = this.vb[v], o = v * 12;
      let x = 0, y = 0, z = 0;
      for (let a = 0; a < 4; a++) {
        const wa = W[o + a];
        for (let b = 0; b < 4; b++) {
          const wab = wa * W[o + 4 + b], row = base + (a * LY + b) * LZ;
          for (let c = 0; c < 4; c++) {
            const w = wab * W[o + 8 + c], q = (row + c) * 3;
            x += w * N[q]; y += w * N[q + 1]; z += w * N[q + 2];
          }
        }
      }
      p[v * 3] = x; p[v * 3 + 1] = y; p[v * 3 + 2] = z;
    }
  }
  _tongs() {
    const s = this.g.scene, iron = this.g.tools.iron;
    const t = this.tongs = new B.TransformNode('holdTongs', s); t.parent = this.root;
    this.tongJaws = [];
    for (const side of [-1, 1]) {
      const bar = B.MeshBuilder.CreateBox('holdTongBar', { width: 0.5, height: 0.012, depth: 0.012 }, s);
      bar.parent = t; bar.material = iron; bar.position.set(-0.25, side * 0.012, -0.03 * (1 + side * 0.2));
      bar.rotation.y = -0.35; bar.isPickable = false;
      const jaw = B.MeshBuilder.CreateBox('holdTongJaw', { width: 0.05, height: 0.01, depth: 0.03 }, s);
      jaw.parent = t; jaw.material = iron; jaw.isPickable = false; jaw.metadata = { side };
      this.tongJaws.push(jaw);
      this.g.world.caster([bar, jaw]);
    }
    this._placeTongs();
  }
  _placeTongs() {
    const b = this.bounds(), h = b.maxY - b.minY;
    let zc = 0, cnt = 0;
    for (let i = 0; i < this.pos.length; i += 3) if (this.pos[i] < b.minX + 0.02) { zc += this.pos[i + 2]; cnt++; }
    this.tongs.position.set(b.minX + 0.015, b.minY + h * 0.5, cnt ? zc / cnt : 0);
    for (const j of this.tongJaws) j.position.y = j.metadata.side * h * 0.5;
  }
  // ------------------------------------------------------------------ bar mode (ingot + billet)
  // Once the bloom has set it is converted to a section-based bar (bar.js): a stack of cross-
  // sections that can't fold, conserves volume exactly, and squares and draws out cleanly.
  get stage() { return this._stage; }
  set stage(s) { this._stage = s; if (s !== 'consolidate' && !this.bar && this.mesh) this.toBar(); }
  toBar() {
    this.bar = BarModel.fromSurface(this.pos);
    this.bar.setVolume(this.targetVol);
    this._syncBar(true);
  }
  _syncBar(rebuild = false) {
    const g = this.bar.mesh();
    const grew = g.nv !== this.n;
    this.pos = g.pos; this.idx = g.rh; this.ridx = g.bab; this.n = g.nv;
    if (grew || rebuild) {
      this.col = new Float32Array(this.n * 4).fill(1);
      this.mesh.setVerticesData(B.VertexBuffer.PositionKind, this.pos, true);
      this.mesh.setVerticesData(B.VertexBuffer.ColorKind, this.col, true);
      const nrm = new Float32Array(this.n * 3); B.VertexData.ComputeNormals(this.pos, this.ridx, nrm);
      this.mesh.setVerticesData(B.VertexBuffer.NormalKind, nrm, true);
      this.mesh.setIndices(this.ridx);
      this.mesh.refreshBoundingInfo(); this._placeTongs();
    } else this.updateMesh();
  }
  get upright() { return this.bar ? this.bar.upright : false; }
  updateMesh() {
    const m = this.mesh;
    m.updateVerticesData(B.VertexBuffer.PositionKind, this.pos);
    const nrm = new Float32Array(this.n * 3);
    B.VertexData.ComputeNormals(this.pos, this.ridx, nrm);
    m.updateVerticesData(B.VertexBuffer.NormalKind, nrm);
    m.updateVerticesData(B.VertexBuffer.ColorKind, this.col);
    m.refreshBoundingInfo();
    this._placeTongs();
  }

  // ------------------------------------------------------------------ geometry queries (surface)
  volume() {
    if (this.bar) return this.bar.volume();
    const pos = this.pos, I = this.idx; let v = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
         - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
         + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    }
    return v / 6;
  }
  bounds() {
    const p = this.pos; const b = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9 };
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < b.minX) b.minX = p[i]; if (p[i] > b.maxX) b.maxX = p[i];
      if (p[i + 1] < b.minY) b.minY = p[i + 1]; if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
      if (p[i + 2] < b.minZ) b.minZ = p[i + 2]; if (p[i + 2] > b.maxZ) b.maxZ = p[i + 2];
    }
    return b;
  }
  _move(dx, dy, dz) {
    for (const a of [this.node, this.pos]) for (let i = 0; i < a.length; i += 3) { a[i] += dx; a[i + 1] += dy; a[i + 2] += dz; }
  }
  // rest on the anvil (lowest point at y = 0), centred on x and z
  settle() {
    if (this.bar) { this.bar.settle(); return this._syncBar(); }
    const b = this.bounds(); this._move(-(b.minX + b.maxX) / 2, -b.minY, -(b.minZ + b.maxZ) / 2);
  }
  topAt(x, z = 0, R = HAMMER_R) {
    const p = this.pos; let top = -1;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - x, dz = p[i + 2] - z;
      if (dx * dx + dz * dz < R * R && p[i + 1] > top) top = p[i + 1];
    }
    return top;
  }
  // Where across the width the hammer lands: on the high spot, as a smith does (on a piece wider
  // than the face, always hitting the centre line would just cut a groove). Kept on the work.
  strikeZ(x0, sl = this.sliceAt(x0)) {
    if (!sl) return 0;
    const p = this.pos, R = HAMMER_R;
    if (sl.halfW <= R * 0.6) return sl.zc;
    let best = -1, zs = 0, n = 0;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - x0) < R * 0.5 && p[i + 1] > best) best = p[i + 1];
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - x0) < R * 0.5 && p[i + 1] > best - 0.002) { zs += p[i + 2]; n++; }
    const lim = sl.halfW - R * 0.6;
    return clamp(n ? zs / n : sl.zc, sl.zc - lim, sl.zc + lim);
  }
  sliceAt(x0, R = HAMMER_R) {
    const p = this.pos; let lo = 1e9, hi = -1e9;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - x0) < R) { if (p[i + 2] < lo) lo = p[i + 2]; if (p[i + 2] > hi) hi = p[i + 2]; }
    return lo > hi ? null : { zc: (lo + hi) / 2, halfW: (hi - lo) / 2 };
  }
  bottomProfile(nb = 48) {
    const b = this.bounds(), L = Math.max(1e-4, b.maxX - b.minX), bot = new Float32Array(nb).fill(1e9), p = this.pos;
    for (let i = 0; i < p.length; i += 3) {
      const k = Math.min(nb - 1, Math.floor((p[i] - b.minX) / L * nb));
      if (p[i + 1] < bot[k]) bot[k] = p[i + 1];
    }
    for (let k = 1; k < nb; k++) if (bot[k] > 1e8) bot[k] = bot[k - 1];
    return { bot, nb, x: k => b.minX + (k + 0.5) / nb * L };
  }
  dims() { const b = this.bounds(); return { L: b.maxX - b.minX, H: b.maxY - b.minY, W: b.maxZ - b.minZ }; }

  // ------------------------------------------------------------------ deformation (on the lattice)
  // returns { kind: 'compress' | 'press' | 'rock' | 'miss', delta }
  blow(x0, v, o = {}) {
    if (this.bar) {
      const plast = plasticity(this.T) * (o.soft ?? 1);
      if (this.bar.upright) { const r = this.bar.upset(v, plast); this._syncBar(); return r; }
      const zc = this.strikeZ(x0);
      const r = this.bar.draw(x0, zc, v, plast, { bending: o.bending, curl: o.curl, smooth: o.smooth });
      // tiny drift from resampling: keep the volume exact
      const V = this.bar.volume(), tv = this.targetVol;
      if (Math.abs(V / tv - 1) > 0.003) this.bar.setVolume(tv);
      this._syncBar();
      return r;
    }
    const N0 = this.node.slice(), V0 = this.volume();
    const r = this._blow(x0, v, o);
    // safety net: never accept a blow that folds the material
    const V = this.volume(), d = this.dims();
    if (!(V > V0 * 0.75 && V < V0 * 1.08 && d.L < 1.2 && d.H < 0.3 && d.W < 0.3)) {
      this.node.set(N0); this.eval(); this.settle(); this.updateMesh();
      return { kind: 'miss' };
    }
    return r;
  }
  _blow(x0, v, o = {}) {
    const R = HAMMER_R, N = this.node;
    const sl = this.sliceAt(x0);
    if (!sl) return { kind: 'miss' };
    const zc = this.strikeZ(x0, sl);        // the hammer finds the high spot across the width
    let top = this.topAt(x0, zc, R);
    if (top < 0) return { kind: 'miss' };
    const plast = plasticity(this.T) * (o.soft ?? 1);
    const d = this.dims();
    const sec = Math.max(0.004, Math.min(top, sl.halfW * 2));   // local section, not the (curl-inflated) bounding box
    const barLike = o.bending && d.L / sec > 2.6;
    const pr = this.bottomProfile(48);
    let gap = 1e9;
    for (let k = 0; k < pr.nb; k++) if (Math.abs(pr.x(k) - x0) < R) gap = Math.min(gap, pr.bot[k]);
    if (gap > 1e8) gap = 0;

    const localThick = Math.max(0.004, top - gap);
    const rockThr = Math.max(0.004, 0.3 * localThick);
    // ---- a lifted bar bends as a whole around where it rests, before (or instead of) squashing.
    // Whole-bar bending keeps it smooth; pushing just the struck spot down is what made it wavy.
    if (barLike && gap > 0.0008) {
      let xl = null, xr = null;
      for (let k = 0; k < pr.nb; k++) {
        if (pr.bot[k] > 0.0015) continue;
        const x = pr.x(k);
        if (x < x0) xl = x; else if (xr === null) xr = x;
      }
      if (xl !== null && xr !== null) { // bridged between two supports: press it straight
        const amt = Math.min(gap, 0.0025 * v * v * plast + 0.0005);
        for (let i = 0; i < N.length; i += 3) {
          const x = N[i], hat = x <= xl || x >= xr ? 0 : x < x0 ? (x - xl) / (x0 - xl) : (xr - x) / (xr - x0);
          N[i + 1] -= amt * hat;
        }
        this.eval();
        if (gap > rockThr) { this.settle(); this.updateMesh(); return { kind: 'press', amount: amt }; }
      } else if (gap > rockThr) {
        return { kind: 'rock', side: xl === null ? -1 : 1 };
      } else { // slightly lifted overhanging end: it swings down about where it rests
        const xc = xl ?? xr, span = x0 - xc;
        if (Math.abs(span) > 1e-3) {
          for (let i = 0; i < N.length; i += 3) { const f = (N[i] - xc) / span; if (f > 0) N[i + 1] -= gap * f; }
          this.eval();
        }
      }
      top = Math.max(this.topAt(x0, zc, R), 0.002);
    }
    top = Math.max(top, 0.002);
    // ---- squeezed between two flat faces: the hammer comes down to height hp and the anvil holds
    // the underside at y = 0. Each vertical column under the face is mapped so its top goes to the
    // hammer plane and its underside onto the anvil plane — both faces flatten.
    const dh = 0.0006 * v * v * plast;
    const delta = clamp(dh / top, 0, 0.35);
    const hp = top * (1 - delta);
    // how far a blow drives a lifted underside onto the anvil: a soft lump gives way locally; a bar
    // bends as a whole (handled above), so here it only flattens small bumps — local dips make waves
    const drive = barLike ? 0.0015 : Math.min(0.004 + 0.002 * v * v * plast, 0.03);
    this._squeezeColumns(x0, zc, delta, drive);
    // ---- flow outward, keeping the volume
    const Vc = this.volume(), dV = this.targetVol - Vc;
    if (dV > 0) {
      const halfW = Math.max(sl.halfW, 0.004), colH = Math.max(top * (1 - delta), 0.003);
      const fx = halfW / (halfW + R);                       // share that goes along the bar
      const area = colH * 2 * halfW * 0.85;
      const ux = fx / (2 * area), uz = (1 - fx) / (2 * colH * 2.6 * R);
      const N0 = N.slice();
      // sideways spread is symmetric about the bar's own centre line (spreading from an off-centre
      // strike point would bend the bar sideways)
      this._flow(x0, sl.zc, ux * dV, uz * dV, top, halfW); this.eval();
      const got = this.volume() - Vc;
      if (got > 1e-12) { N.set(N0); const k = clamp(dV / got, 0.3, 3); this._flow(x0, sl.zc, ux * dV * k, uz * dV * k, top, halfW); this.eval(); }
    }
    // ---- curl
    if (barLike && o.curl !== 0) {
      const kap = (o.curl ?? 0.008) * delta;
      for (let i = 0; i < N.length; i += 3) N[i + 1] += kap * Math.max(0, Math.abs(N[i] - x0) - R);
    }
    if (o.smooth) {
      if (this.stage === 'consolidate') this._smoothNear(x0, zc, R * 1.8, o.smooth);
      else this._relax(x0, zc, R * 2.6, o.smooth);
    }
    // consolidation closes the sponge: the bloom shrinks toward its solid volume
    this.eval();
    const V = this.volume(), tv = this.targetVol;
    if (V > tv * 1.005) { const k = Math.pow(tv / V, 1 / 6); for (let i = 0; i < N.length; i++) N[i] *= k; this.eval(); }
    this.settle();
    this.updateMesh();
    return { kind: 'compress', delta };
  }
  // Which lattice axis currently points up (rolls and stand-ups are quarter turns, so one does),
  // and whether index 0 is at the bottom.
  _upAxis() {
    const N = this.node, d = [0, 0, 0];
    const mi = LX >> 1, mj = LY >> 1, mk = LZ >> 1;
    d[0] = N[L3(mi + 1, mj, mk) + 1] - N[L3(mi, mj, mk) + 1];
    d[1] = N[L3(mi, mj + 1, mk) + 1] - N[L3(mi, mj, mk) + 1];
    d[2] = N[L3(mi, mj, mk + 1) + 1] - N[L3(mi, mj, mk) + 1];
    let ax = 0; for (let a = 1; a < 3; a++) if (Math.abs(d[a]) > Math.abs(d[ax])) ax = a;
    return { ax, up: d[ax] > 0 };
  }
  // Squeeze between two flat faces. The lattice lines that run vertically are the columns. Each
  // column under the hammer gets one straight-line remap: its top comes down to the hammer face,
  // and the column is pushed down as a unit until its underside meets the anvil (then it
  // compresses). Neighbouring columns get smoothly varying remaps, so the smooth surface can't
  // fold, both faces end up flat, and a piece stood on end is upset with both ends flattened.
  _squeezeColumns(x0, zc, delta, drive) {
    const N = this.node, R = HAMMER_R, { ax, up } = this._upAxis();
    const S = [LX, LY, LZ], o1 = ax === 0 ? 1 : 0, o2 = ax === 2 ? 1 : 2, n = S[ax];
    const idx = (a, b, c) => { const t = [0, 0, 0]; t[ax] = a; t[o1] = b; t[o2] = c; return L3(t[0], t[1], t[2]); };
    // the planes in lattice terms: lattice tops/bottoms stand a fixed margin off the surface
    let topMax = -1e9, floor = 1e9;
    const lines = [];
    for (let b = 0; b < S[o1]; b++) for (let c = 0; c < S[o2]; c++) {
      let yt = -1e9, yb = 1e9, sx = 0, sz = 0;
      for (let a = 0; a < n; a++) { const q = idx(a, b, c); yt = Math.max(yt, N[q + 1]); yb = Math.min(yb, N[q + 1]); sx += N[q]; sz += N[q + 2]; }
      const w = 1 - smooth(R * 0.85, R * 1.3, Math.hypot(sx / n - x0, sz / n - zc));
      lines.push({ b, c, yt, yb, w });
      floor = Math.min(floor, yb);
      if (w > 0.99) topMax = Math.max(topMax, yt);
    }
    if (topMax < -1e8) return;
    const hp = floor + (topMax - floor) * (1 - delta);
    for (const L of lines) {
      if (L.w <= 0 || L.yt - L.yb < 1e-5) continue;
      const nt = L.yt > hp ? lerp(L.yt, hp, L.w) : L.yt;
      const push = L.yt - nt;
      const nb = Math.max(floor, L.yb - Math.min(push + 0.0005 * L.w, drive) * L.w);
      if (nt <= nb + 1e-4) continue;
      const s = (nt - nb) / (L.yt - L.yb);
      for (let a = 0; a < n; a++) { const q = idx(a, L.b, L.c); N[q + 1] = nb + (N[q + 1] - L.yb) * s; }
    }
    this.eval();
  }
  // Project the surface under the hammer onto the two planes (hammer face at hp, anvil at 0).
  // Lattice points move vertically by the remaining error, blended through the column's height
  // (top error near the top, bottom error near the bottom). A few iterations converge because the
  // B-spline surface is a smooth average of the points around it.
  _squeeze(x0, zc, hp, drive) {
    const N = this.node, P = this.pos, R = HAMMER_R;
    const CELL = 0.007, RB = R * 1.6, nb = Math.ceil(2 * RB / CELL);
    const ct = new Float32Array(nb * nb), cb = new Float32Array(nb * nb);
    const et = new Float32Array(nb * nb), eb = new Float32Array(nb * nb), tt = new Float32Array(nb * nb), bt = new Float32Array(nb * nb), has = new Uint8Array(nb * nb), hasF = new Float32Array(nb * nb);
    const sample = (A, x, z) => { // bilinear lookup
      const fx = (x - x0 + RB) / CELL - 0.5, fz = (z - zc + RB) / CELL - 0.5;
      const ix = clamp(Math.floor(fx), 0, nb - 2), iz = clamp(Math.floor(fz), 0, nb - 2), tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1);
      return lerp(lerp(A[ix * nb + iz], A[(ix + 1) * nb + iz], tx), lerp(A[ix * nb + iz + 1], A[(ix + 1) * nb + iz + 1], tx), tz);
    };
    for (let it = 0; it < 4; it++) {
      ct.fill(-1e9); cb.fill(1e9);
      for (let i = 0; i < P.length; i += 3) {
        const bx = Math.floor((P[i] - x0 + RB) / CELL), bz = Math.floor((P[i + 2] - zc + RB) / CELL);
        if (bx < 0 || bz < 0 || bx >= nb || bz >= nb) continue;
        const b = bx * nb + bz; if (P[i + 1] > ct[b]) ct[b] = P[i + 1]; if (P[i + 1] < cb[b]) cb[b] = P[i + 1];
      }
      // a cell that only caught one face (sparse sampling) isn't a column: drop it and fill from neighbours
      let thick = 0;
      for (let b = 0; b < nb * nb; b++) if (ct[b] > -1e8) thick = Math.max(thick, ct[b] - cb[b]);
      for (let b = 0; b < nb * nb; b++) if (ct[b] > -1e8 && ct[b] - cb[b] < thick * 0.3) { ct[b] = -1e9; cb[b] = 1e9; }
      // errors: how far each part of the top sits above the hammer face and the underside above the anvil
      for (let b = 0; b < nb * nb; b++) {
        if (it === 0) has[b] = ct[b] > -1e8 ? 1 : 0;
        if (ct[b] < -1e8 || !has[b]) { et[b] = NaN; eb[b] = NaN; continue; }
        // Targets are fixed on the first pass. The hammer brings the top down to its face; the
        // column is pushed down as a unit, so its underside drops by the same amount until it meets
        // the anvil (never below). Later passes just correct toward those targets.
        if (it === 0) {
          const push = Math.max(0, ct[b] - hp);
          tt[b] = ct[b] - push;
          bt[b] = Math.max(0, cb[b] - Math.min(push + 0.0005, drive));
        }
        et[b] = clamp(ct[b] - tt[b], -0.003, 0.05); eb[b] = clamp(cb[b] - bt[b], -0.003, 0.05);
      }
      // fill gaps and blur once so neighbouring lattice points get similar corrections
      for (const A of [et, eb, ct, cb]) {
        const T = A.slice();
        for (let bx = 0; bx < nb; bx++) for (let bz = 0; bz < nb; bz++) {
          let s = 0, c = 0;
          for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
            const X = bx + ox, Z = bz + oz; if (X < 0 || Z < 0 || X >= nb || Z >= nb) continue;
            const q = T[X * nb + Z]; if (Number.isNaN(q) || q < -1e8 || q > 1e8) continue; s += q; c++;
          }
          if (c) A[bx * nb + bz] = (Number.isNaN(T[bx * nb + bz]) || T[bx * nb + bz] < -1e8 || T[bx * nb + bz] > 1e8 || it === 0) ? s / c : (T[bx * nb + bz] * 2 + s / c) / 3;
          else A[bx * nb + bz] = 0;
        }
      }
      if (it === 0) for (let b = 0; b < nb * nb; b++) hasF[b] = has[b];
      let moved = 0;
      for (let i = 0; i < N.length; i += 3) {
        const r = Math.hypot(N[i] - x0, N[i + 2] - zc); if (r > RB) continue;
        // only where there really is a column of metal (not past the end or beside the bar)
        const w = (1 - smooth(R * 0.85, R * 1.25, r)) * smooth(0.5, 0.95, sample(hasF, N[i], N[i + 2])); if (w <= 0) continue;
        const yt = sample(ct, N[i], N[i + 2]), yb = sample(cb, N[i], N[i + 2]);
        const h = yt - yb; if (!(h > 1e-4)) continue;
        const t = clamp((N[i + 1] - yb) / h, 0, 1);               // 0 = underside, 1 = top
        const dy = -(sample(et, N[i], N[i + 2]) * t + sample(eb, N[i], N[i + 2]) * (1 - t)) * w;
        N[i + 1] += dy; moved = Math.max(moved, Math.abs(dy));
      }
      this.eval();
      if (moved < 1e-4) break;
    }
  }
  _flow(x0, zc, Dx, Dz, top, halfW) {
    const N = this.node, R = HAMMER_R;
    for (let i = 0; i < N.length; i += 3) {
      const dx = N[i] - x0, ax = Math.abs(dx);
      const wx = 1 - smooth(R, R * 1.9, ax);
      // barrelling: gripped by the hammer above and the anvil below, the struck slice bulges most
      // at mid-height. Repeated blows on one spot make that spot flare out (mushroom).
      const hy = clamp(N[i + 1] / Math.max(top, 1e-4), 0, 1);
      const hb = lerp(1, 0.78 + 0.44 * Math.sin(Math.PI * hy), wx);
      // lengthwise flow is the same at every height (varying it shears the bar into wrinkles)
      N[i] += Math.sign(dx) * Dx * Math.min(1, ax / R);
      N[i + 2] += clamp((N[i + 2] - zc) / halfW, -1.3, 1.3) * Dz * wx * hb;
    }
  }
  // relax the lattice near the blow (keeps the material evenly spread, softens hammer marks)
  _smoothNear(x0, zc, R, amt) {
    const N = this.node, T = N.slice();
    for (let i = 1; i < LX - 1; i++) for (let j = 0; j < LY; j++) for (let k = 0; k < LZ; k++) {
      const q = L3(i, j, k);
      const r = Math.hypot(N[q] - x0, N[q + 2] - zc);
      if (r > R) continue;
      const w = amt * (1 - r / R);
      const nb = [L3(i - 1, j, k), L3(i + 1, j, k)];
      if (this.stage === 'consolidate') {
        if (j > 0) nb.push(L3(i, j - 1, k)); if (j < LY - 1) nb.push(L3(i, j + 1, k));
        if (k > 0) nb.push(L3(i, j, k - 1)); if (k < LZ - 1) nb.push(L3(i, j, k + 1));
      }
      // vertical only on bars (softens hammer marks without rounding the corners); full on the bloom
      for (let c = this.stage === 'consolidate' ? 0 : 1; c < (this.stage === 'consolidate' ? 3 : 2); c++) {
        let sum = 0; for (const n of nb) sum += T[n + c];
        N[q + c] = lerp(N[q + c], sum / nb.length, w);
      }
    }
    // the welded surface loses its dark slag pits
    const p = this.pos;
    for (let v = 0; v < this.n; v++) {
      const r = Math.hypot(p[v * 3] - x0, p[v * 3 + 2] - zc);
      if (r > R) continue;
      const w = amt * 2 * (1 - r / R), ci = v * 4;
      this.col[ci] = lerp(this.col[ci], 1, w); this.col[ci + 1] = lerp(this.col[ci + 1], 0.95, w); this.col[ci + 2] = lerp(this.col[ci + 2], 0.92, w);
    }
  }
  // Relax the material along the bar's length near the blow: evens out node spacing and irons out
  // small waves, without touching the cross-section (so square corners stay square).
  _relax(x0, zc, RR, amt) {
    const N = this.node, T = N.slice();
    for (let i = 1; i < LX - 1; i++) for (let j = 0; j < LY; j++) for (let k = 0; k < LZ; k++) {
      const q = L3(i, j, k), r = Math.hypot(N[q] - x0, N[q + 2] - zc);
      if (r > RR) continue;
      // leave the freshly flattened face alone; smooth the ring around it where waves form
      const w = amt * (1 - r / RR) * smooth(HAMMER_R * 0.8, HAMMER_R * 1.3, r), a = L3(i - 1, j, k), b = L3(i + 1, j, k);
      for (let c = 0; c < 3; c++) N[q + c] = lerp(N[q + c], (T[a + c] + T[b + c]) / 2, w);
    }
  }
  // stand the work on end (or lay it back down) — bar stages only
  tip() {
    if (!this.bar) return;
    this.bar.upright = !this.bar.upright;
    this._syncBar(true);
  }
  // end for end while stood up
  flipEnds() { if (this.bar) { this.bar.flipEnds(); this._syncBar(); } }
  // a hard blow on a fragile bloom knocks a chunk off
  crumble(x0, lossKg) {
    const N = this.node, top = this.topAt(x0, 0, HAMMER_R * 1.5);
    this.mass -= lossKg; this.stats.crumbled += lossKg;
    const d = this.dims(), side = Math.random() < 0.5 ? -1 : 1;
    const hx = x0, hy = Math.max(top, 0.01) * 0.75, hz = side * d.W * 0.4;
    const Rc = 0.02 + Math.cbrt(lossKg / Math.max(this.mass, 0.1)) * 0.06;
    for (let i = 0; i < N.length; i += 3) {
      const dd = Math.hypot(N[i] - hx, N[i + 1] - hy, N[i + 2] - hz);
      if (dd < Rc) { const k = (1 - dd / Rc) * 0.5; N[i + 1] -= (N[i + 1] - hy * 0.5) * k; N[i + 2] -= N[i + 2] * k; }
    }
    this.eval();
    const kk = Math.cbrt(this.targetVol / this.volume());
    if (kk < 1) { for (let i = 0; i < N.length; i++) N[i] *= kk; this.eval(); }
    this.settle(); this.updateMesh();
    return V3(hx, hy, hz);
  }
  // shrink straight to the target volume (used when skipping consolidation)
  densify() {
    if (this.bar) { this.bar.setVolume(this.targetVol); return this._syncBar(); }
    const k = Math.cbrt(this.targetVol / this.volume());
    for (let i = 0; i < this.node.length; i++) this.node[i] *= k;
    this.eval(); this.settle(); this.updateMesh();
  }
  // quarter turn about the long axis
  roll(dir = 1) {
    if (this.bar) { this.bar.roll(dir); return this._syncBar(); }
    const b = this.bounds(), yc = (b.minY + b.maxY) / 2;
    for (const a of [this.node, this.pos]) for (let i = 0; i < a.length; i += 3) {
      const y = a[i + 1] - yc, z = a[i + 2];
      a[i + 1] = yc + z * dir; a[i + 2] = -y * dir;
    }
    this.settle(); this.updateMesh();
  }

  // ------------------------------------------------------------------ shape match against a square-section bar
  // ratio = length / side of a square-section bar; ratio 0 = "whatever length it is now"
  target(ratio) {
    if (!ratio) { // square with the same area as the body's own section
      const p = this.pos, b = this.bounds(), lim = (b.maxX - b.minX) * 0.3;
      let y1 = 0, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) < lim) { y1 = Math.max(y1, p[i + 1]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]); }
      const s = Math.sqrt(Math.max(1e-6, y1 * (z1 - z0) * 0.92));
      return { L: (b.maxX - b.minX) * 0.94, s };
    }
    const s = Math.cbrt(this.targetVol / ratio); return { L: s * ratio, s };
  }
  // Body: how square, even and straight the section is over the middle 84% (drawn ends taper and
  // get dressed or cut off later). Length: how close the bar is to the target length (billets only).
  fit(tg, judgeLength = true) {
    const p = this.pos, hs = tg.s / 2, b = this.bounds(), Lp = b.maxX - b.minX, lim = Lp * 0.42;
    let sum = 0, n = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]) > lim) continue;
      const d = sdBox(0, p[i + 1] - hs, p[i + 2], 1, hs, hs); sum += d * d; n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    const body = Math.exp(-((rms / (0.12 * tg.s)) ** 2));
    const len = judgeLength ? Math.exp(-(((Lp * 0.94 - tg.L) / (0.15 * tg.L)) ** 2)) : 1;
    this.lastFit = { body, len };
    return body * len;
  }

  // ------------------------------------------------------------------ heat
  coolRate() { const d = this.dims(); const th = Math.max(0.01, Math.min(d.H, d.W)); return 0.0055 * Math.pow(0.06 / th, 0.7); }
  simulate(dt, envT = null, kHeat = 0) {
    if (envT != null) this.T += (envT - this.T) * (1 - Math.exp(-kHeat * dt));
    else this.T -= (this.T - 20) * (1 - Math.exp(-this.coolRate() * dt));
    if (this.T > 1000) this.mass -= this.mass * 0.00015 * dt; // scale lost to oxidation
  }
  dispose() { this.root.dispose(false, true); }
}
