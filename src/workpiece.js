// The hot workpiece: bloom -> rough ingot -> billet.
//
// The metal is a lattice of material points (40 x 8 x 8, interior included). The visible surface
// mesh is embedded in that lattice and follows it by trilinear interpolation, so the surface stays
// smooth and can't crumple however it's worked. Every blow moves the lattice points:
//
// Local frame: the anvil face is y = 0, the piece is centred on x/z and its long axis is x.
//   1. bend, if the bar is genuinely curved under the hammer (press a bridge straight, or rock);
//   2. sink: the struck part is pushed down onto the anvil (hot iron gives way);
//   3. squash the column under the round hammer face against the anvil;
//   4. flow, solved so the volume is kept. Metal takes the shortest way to a free surface:
//      along the bar (everything beyond the hammer shifts outward = the bar lengthens) and across
//      it (the struck slice widens). The top of the struck slice moves further than the bottom,
//      which mushrooms a spot that's hit too often;
//   5. curl: the struck face stretches a little more than the face on the anvil, so the ends lift.
import { B, V3, clamp, lerp, smooth, fbm3, interp, mat } from './util.js';

const NX = 64, NY = 14, NZ = 14;       // surface mesh resolution
const LX = 40, LY = 8, LZ = 8;         // material lattice resolution
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
    this.stage = 'consolidate';       // consolidate -> ingot -> billet -> done
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
    const node = this.node = new Float32Array(LX * LY * LZ * 3);
    for (let i = 0; i < LX; i++) for (let j = 0; j < LY; j++) for (let kk = 0; kk < LZ; kk++) {
      const q = L3(i, j, kk);
      node[q] = lerp(mnx, mxx, i / (LX - 1)); node[q + 1] = lerp(mny, mxy, j / (LY - 1)); node[q + 2] = lerp(mnz, mxz, kk / (LZ - 1));
    }
    this.vb = new Int32Array(n); this.vf = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const u = (pos[v * 3] - mnx) / (mxx - mnx) * (LX - 1), w = (pos[v * 3 + 1] - mny) / (mxy - mny) * (LY - 1), t = (pos[v * 3 + 2] - mnz) / (mxz - mnz) * (LZ - 1);
      const i = Math.min(LX - 2, Math.floor(u)), j = Math.min(LY - 2, Math.floor(w)), kk = Math.min(LZ - 2, Math.floor(t));
      this.vb[v] = (i * LY + j) * LZ + kk;
      this.vf[v * 3] = u - i; this.vf[v * 3 + 1] = w - j; this.vf[v * 3 + 2] = t - kk;
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
  // surface from lattice (trilinear)
  eval() {
    const N = this.node, p = this.pos, sY = LZ * 3, sX = LY * LZ * 3;
    for (let v = 0; v < this.n; v++) {
      const b = this.vb[v] * 3, fx = this.vf[v * 3], fy = this.vf[v * 3 + 1], fz = this.vf[v * 3 + 2];
      const gx = 1 - fx, gy = 1 - fy, gz = 1 - fz;
      const w000 = gx * gy * gz, w001 = gx * gy * fz, w010 = gx * fy * gz, w011 = gx * fy * fz;
      const w100 = fx * gy * gz, w101 = fx * gy * fz, w110 = fx * fy * gz, w111 = fx * fy * fz;
      for (let c = 0; c < 3; c++) {
        p[v * 3 + c] = w000 * N[b + c] + w001 * N[b + 3 + c] + w010 * N[b + sY + c] + w011 * N[b + sY + 3 + c]
          + w100 * N[b + sX + c] + w101 * N[b + sX + 3 + c] + w110 * N[b + sX + sY + c] + w111 * N[b + sX + sY + 3 + c];
      }
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
  settle() { const b = this.bounds(); this._move(-(b.minX + b.maxX) / 2, -b.minY, -(b.minZ + b.maxZ) / 2); }
  topAt(x, z = 0, R = HAMMER_R) {
    const p = this.pos; let top = -1;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - x, dz = p[i + 2] - z;
      if (dx * dx + dz * dz < R * R && p[i + 1] > top) top = p[i + 1];
    }
    return top;
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
    const zc = sl.zc;                       // the smith keeps the work under the hammer
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
    if (barLike && gap > Math.max(0.004, 0.3 * localThick)) {
      // genuinely curved under the hammer: bend rather than squash
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
        this.eval(); this.settle(); this.updateMesh();
        return { kind: 'press', amount: amt };
      }
      return { kind: 'rock', side: xl === null ? -1 : 1 };
    }

    // ---- sink the struck part down onto the anvil
    if (gap > 0.0002) {
      const sink = Math.min(gap, 0.004 + 0.0015 * v * v * plast);
      for (let i = 0; i < N.length; i += 3) {
        const w = 1 - smooth(R * 0.6, R * 2.4, Math.abs(N[i] - x0));
        if (w > 0) N[i + 1] -= sink * w;
      }
      for (let i = 1; i < N.length; i += 3) if (N[i] < 0) N[i] = 0;
      this.eval();
      top = this.topAt(x0, zc, R);
    }
    top = Math.max(top, 0.002);
    // ---- the flat hammer face comes down to height hp: every lattice column under the face whose
    // top is above hp is squashed (top to hp, bottom held by the anvil), so domes become flat facets
    const dh = 0.00045 * v * v * plast;
    const delta = clamp(dh / top, 0, 0.35);
    // vertical columns in world space (the lattice may be rolled any way up): a top/bottom
    // heightmap of the surface under the hammer, then every lattice point in a column is scaled
    const CELL = 0.004, RB = R * 1.4, nb = Math.ceil(2 * RB / CELL), P = this.pos;
    const ct = new Float32Array(nb * nb).fill(-1e9), cb = new Float32Array(nb * nb).fill(1e9);
    const binXZ = (x, z) => {
      const bx = Math.floor((x - x0 + RB) / CELL), bz = Math.floor((z - zc + RB) / CELL);
      return bx < 0 || bz < 0 || bx >= nb || bz >= nb ? -1 : bx * nb + bz;
    };
    for (let i = 0; i < P.length; i += 3) {
      const b = binXZ(P[i], P[i + 2]); if (b < 0) continue;
      if (P[i + 1] > ct[b]) ct[b] = P[i + 1]; if (P[i + 1] < cb[b]) cb[b] = P[i + 1];
    }
    // fill empty cells from neighbours (sparse surface sampling)
    for (let pass = 0; pass < 2; pass++) for (let bx = 0; bx < nb; bx++) for (let bz = 0; bz < nb; bz++) {
      const b = bx * nb + bz; if (ct[b] > -1e8) continue;
      let t = -1e9, lo = 1e9;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = bx + ox, Z = bz + oz; if (X < 0 || Z < 0 || X >= nb || Z >= nb) continue;
        const q = X * nb + Z; if (ct[q] > t) t = ct[q]; if (cb[q] < lo) lo = cb[q];
      }
      if (pass === 1 || t > -1e8) { ct[b] = t; cb[b] = lo; }
    }
    const hp = top * (1 - delta);
    for (let i = 0; i < N.length; i += 3) {
      const b = binXZ(N[i], N[i + 2]); if (b < 0) continue;
      const w = 1 - smooth(R * 0.85, R * 1.25, Math.hypot(N[i] - x0, N[i + 2] - zc));
      const yt = ct[b], yb = Math.max(0, cb[b]);
      if (w <= 0 || yt < -1e8 || yt <= hp || yb >= hp - 1e-4 || yt - yb < 1e-4) continue;
      const nt = lerp(yt, hp, w), s = clamp((nt - yb) / (yt - yb), 0.5, 1);
      N[i + 1] = yb + (N[i + 1] - yb) * s;
    }
    this.eval();
    // ---- flow outward, keeping the volume
    const Vc = this.volume(), dV = this.targetVol - Vc;
    if (dV > 0) {
      const halfW = Math.max(sl.halfW, 0.004), colH = Math.max(top * (1 - delta), 0.003);
      const fx = halfW / (halfW + R);                       // share that goes along the bar
      const area = colH * 2 * halfW * 0.85;
      const ux = fx / (2 * area), uz = (1 - fx) / (2 * colH * 2.6 * R);
      const N0 = N.slice();
      this._flow(x0, zc, ux * dV, uz * dV, top, halfW); this.eval();
      const got = this.volume() - Vc;
      if (got > 1e-12) { N.set(N0); const k = clamp(dV / got, 0.3, 3); this._flow(x0, zc, ux * dV * k, uz * dV * k, top, halfW); this.eval(); }
    }
    // ---- curl
    if (barLike && o.curl !== 0) {
      const kap = (o.curl ?? 0.008) * delta;
      for (let i = 0; i < N.length; i += 3) N[i + 1] += kap * Math.max(0, Math.abs(N[i] - x0) - R);
    }
    if (o.smooth) this._smoothNear(x0, zc, R * 1.8, o.smooth);
    // consolidation closes the sponge: the bloom shrinks toward its solid volume
    this.eval();
    const V = this.volume(), tv = this.targetVol;
    if (V > tv * 1.005) { const k = Math.pow(tv / V, 1 / 6); for (let i = 0; i < N.length; i++) N[i] *= k; this.eval(); }
    this.settle();
    this.updateMesh();
    return { kind: 'compress', delta };
  }
  _flow(x0, zc, Dx, Dz, top, halfW) {
    const N = this.node, R = HAMMER_R;
    for (let i = 0; i < N.length; i += 3) {
      const dx = N[i] - x0, ax = Math.abs(dx);
      const wx = 1 - smooth(R, R * 1.9, ax);
      const hb = lerp(1, 0.86 + 0.28 * clamp(N[i + 1] / Math.max(top, 1e-4), 0, 1.3), wx);
      N[i] += Math.sign(dx) * Dx * Math.min(1, ax / R) * hb;
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
    const k = Math.cbrt(this.targetVol / this.volume());
    for (let i = 0; i < this.node.length; i++) this.node[i] *= k;
    this.eval(); this.settle(); this.updateMesh();
  }
  // quarter turn about the long axis
  roll(dir = 1) {
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
