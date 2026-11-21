// Section-based bar model for the ingot and billet stages.
//
// A forged bar is a stack of cross-sections along its length. Each slice is an outline of K points
// (z across, y up) at a position x along the bar. The mesh is a tube through the outlines with flat
// end caps, so it can't fold or crumple, and volume is exact: sum of section area x spacing.
//
// Local frame (lying): anvil face y = 0, bar along x, centred on x and z.
// Upright (stood on end to square the ends): the same data, shown rotated so the bar's x is up.
import { clamp, lerp, smooth } from './util.js';

export const K = 24;
const R = 0.022; // hammer face radius

function area(P) { // shoelace on (z, y)
  let a = 0;
  for (let k = 0; k < K; k++) { const j = (k + 1) % K; a += P[2 * k] * P[2 * j + 1] - P[2 * j] * P[2 * k + 1]; }
  return Math.abs(a) / 2;
}
function centroid(P) { let z = 0, y = 0; for (let k = 0; k < K; k++) { z += P[2 * k]; y += P[2 * k + 1]; } return [z / K, y / K]; }
function scaleAbout(P, cz, cy, sz, sy) { for (let k = 0; k < K; k++) { P[2 * k] = cz + (P[2 * k] - cz) * sz; P[2 * k + 1] = cy + (P[2 * k + 1] - cy) * sy; } }

export class BarModel {
  constructor() { this.x = []; this.P = []; this.upright = false; }

  // Sample a closed surface (flat xyz array) into cross-sections along x.
  static fromSurface(pos) {
    const b = new BarModel();
    let mnx = 1e9, mxx = -1e9;
    for (let i = 0; i < pos.length; i += 3) { mnx = Math.min(mnx, pos[i]); mxx = Math.max(mxx, pos[i]); }
    const L = mxx - mnx, n = clamp(Math.round(L / 0.004), 14, 140), dx = L / n;
    for (let s = 0; s < n; s++) {
      const xs = mnx + (s + 0.5) * dx, pts = [];
      for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i] - xs) < dx * 0.9) pts.push(pos[i + 2], pos[i + 1]);
      const P = new Float32Array(2 * K);
      if (pts.length < 12) { b.x.push(xs); b.P.push(null); continue; }
      let cz = 0, cy = 0; for (let i = 0; i < pts.length; i += 2) { cz += pts[i]; cy += pts[i + 1]; }
      cz /= pts.length / 2; cy /= pts.length / 2;
      const r = new Float32Array(K).fill(-1);
      for (let i = 0; i < pts.length; i += 2) {
        const a = Math.atan2(pts[i + 1] - cy, pts[i] - cz), k = Math.min(K - 1, Math.floor((a + Math.PI) / (2 * Math.PI) * K));
        r[k] = Math.max(r[k], Math.hypot(pts[i] - cz, pts[i + 1] - cy));
      }
      for (let k = 0; k < K; k++) if (r[k] < 0) { // fill gaps from the nearest filled bins
        let a = 1, c = 1; while (r[(k - a + K) % K] < 0 && a < K) a++; while (r[(k + c) % K] < 0 && c < K) c++;
        r[k] = lerp(r[(k - a + K) % K], r[(k + c) % K], a / (a + c));
      }
      const rs = r.map((v, k) => (r[(k + K - 1) % K] + 2 * v + r[(k + 1) % K]) / 4);
      for (let k = 0; k < K; k++) { const a = -Math.PI + (k + 0.5) / K * 2 * Math.PI; P[2 * k] = cz + rs[k] * Math.cos(a); P[2 * k + 1] = cy + rs[k] * Math.sin(a); }
      b.x.push(xs); b.P.push(P);
    }
    for (let s = 0; s < n; s++) if (!b.P[s]) { // copy a neighbour for empty slices
      let t = s; while (t < n && !b.P[t]) t++; if (t >= n) { t = s; while (t >= 0 && !b.P[t]) t--; }
      b.P[s] = b.P[t].slice();
    }
    // the set bloom starts as a clean rough form: settle the sponge's lumps
    for (let i = 0; i < 3; i++) b._smoothAlong(0.5);
    for (const P of b.P) { const Q = P.slice(); for (let k = 0; k < K; k++) { const a = (k + K - 1) % K, c = (k + 1) % K; P[2 * k] = (Q[2 * a] + 2 * Q[2 * k] + Q[2 * c]) / 4; P[2 * k + 1] = (Q[2 * a + 1] + 2 * Q[2 * k + 1] + Q[2 * c + 1]) / 4; } }
    b.settle();
    return b;
  }

  get n() { return this.x.length; }
  volume() {
    let v = 0;
    for (let s = 0; s < this.n - 1; s++) v += (area(this.P[s]) + area(this.P[s + 1])) / 2 * (this.x[s + 1] - this.x[s]);
    return v;
  }
  // scale every section about its own centre to hit a volume
  setVolume(V) {
    const k = Math.sqrt(V / Math.max(1e-12, this.volume()));
    for (const P of this.P) { const [cz, cy] = centroid(P); scaleAbout(P, cz, cy, k, k); }
    this.settle();
  }
  settle() {
    let ymin = 1e9, zmin = 1e9, zmax = -1e9;
    for (const P of this.P) for (let k = 0; k < K; k++) { ymin = Math.min(ymin, P[2 * k + 1]); zmin = Math.min(zmin, P[2 * k]); zmax = Math.max(zmax, P[2 * k]); }
    const dz = -(zmin + zmax) / 2, dx = -(this.x[0] + this.x[this.n - 1]) / 2;
    for (const P of this.P) for (let k = 0; k < K; k++) { P[2 * k] += dz; P[2 * k + 1] -= ymin; }
    for (let s = 0; s < this.n; s++) this.x[s] += dx;
  }
  height() { let h = 0; for (const P of this.P) for (let k = 0; k < K; k++) h = Math.max(h, P[2 * k + 1]); return h; }
  bottoms() { return this.P.map(P => { let m = 1e9; for (let k = 0; k < K; k++) m = Math.min(m, P[2 * k + 1]); return m; }); }

  // ------------------------------------------------------------------ a blow on the bar lying down
  draw(x0, zc, v, plast, o = {}) {
    const n = this.n, X = this.x, L = X[n - 1] - X[0];
    // local section under the hammer
    let top = -1, zlo = 1e9, zhi = -1e9, bot = 1e9;
    for (let s = 0; s < n; s++) {
      if (Math.abs(X[s] - x0) > R) continue;
      const P = this.P[s];
      for (let k = 0; k < K; k++) {
        zlo = Math.min(zlo, P[2 * k]); zhi = Math.max(zhi, P[2 * k]); bot = Math.min(bot, P[2 * k + 1]);
        if (Math.abs(P[2 * k] - zc) < R) top = Math.max(top, P[2 * k + 1]);
      }
    }
    if (top < 0) return { kind: 'miss' };
    const halfW = Math.max(0.003, (zhi - zlo) / 2), sliceZ = (zlo + zhi) / 2;
    const sec = Math.max(0.004, Math.min(top - bot, halfW * 2));
    const barLike = o.bending !== false && L / sec > 2.6;
    const gap = bot, thick = Math.max(0.004, top - gap), rockThr = Math.max(0.004, 0.3 * thick);

    // ---- a lifted bar bends as a whole around where it rests
    if (barLike && gap > 0.0008) {
      const bs = this.bottoms();
      let xl = null, xr = null;
      for (let s = 0; s < n; s++) { if (bs[s] > 0.0015) continue; if (X[s] < x0) xl = X[s]; else if (xr === null) xr = X[s]; }
      if (xl !== null && xr !== null) { // bridged between two supports: press it straight
        const amt = Math.min(gap, 0.0025 * v * v * plast + 0.0005);
        for (let s = 0; s < n; s++) {
          const x = X[s], hat = x <= xl || x >= xr ? 0 : x < x0 ? (x - xl) / (x0 - xl) : (xr - x) / (xr - x0);
          if (hat > 0) for (let k = 0; k < K; k++) this.P[s][2 * k + 1] -= amt * hat;
        }
        if (gap > rockThr) { this.settle(); return { kind: 'press', amount: amt }; }
      } else if (gap > rockThr) {
        return { kind: 'rock', side: xl === null ? -1 : 1 };
      } else { // slightly lifted overhanging end: swings down about where it rests
        const xc = xl ?? xr, span = x0 - xc;
        if (Math.abs(span) > 1e-3) for (let s = 0; s < n; s++) { const f = (X[s] - xc) / span; if (f > 0) for (let k = 0; k < K; k++) this.P[s][2 * k + 1] -= gap * f; }
      }
      top = -1;
      for (let s = 0; s < n; s++) if (Math.abs(X[s] - x0) <= R) for (let k = 0; k < K; k++) if (Math.abs(this.P[s][2 * k] - zc) < R) top = Math.max(top, this.P[s][2 * k + 1]);
      if (top < 0) return { kind: 'miss' };
    }

    // ---- squeeze between the hammer face (round, at hp) and the anvil (flat, under everything)
    const dh = 0.0006 * v * v * plast;
    const delta = clamp(dh / Math.max(top, 0.003), 0, 0.35);
    const hp = top * (1 - delta);
    const drive = barLike ? 0.0015 : 0.004 + 0.002 * v * v * plast;
    const fx = halfW / (halfW + R);           // share of the displaced metal that goes along the bar
    const flen = new Float64Array(n).fill(1);
    for (let s = 0; s < n; s++) {
      const dx = Math.abs(X[s] - x0); if (dx > R * 1.25) continue;
      const wx = 1 - smooth(R * 0.85, R * 1.25, dx), chord = Math.sqrt(Math.max(R * R - dx * dx, (R * 0.3) ** 2));
      const P = this.P[s], A0 = area(P);
      let hS = 0; for (let k = 0; k < K; k++) hS = Math.max(hS, P[2 * k + 1]);
      const band = Math.max(0.002, hS * 0.3);
      for (let k = 0; k < K; k++) {
        const z = P[2 * k], y = P[2 * k + 1];
        const w = wx * (1 - smooth(chord * 0.85, chord * 1.2, Math.abs(z - zc)));
        let ny = y > hp ? lerp(y, hp, w) : y;                                      // top flattened by the hammer face
        if (ny < band) ny = Math.max(0, ny - drive * wx * (1 - ny / band));        // underside flattened by the anvil
        P[2 * k + 1] = ny;
      }
      const A1 = area(P);
      if (A1 < 1e-9 || A0 <= A1) continue;
      const q = A0 / A1;
      flen[s] = Math.pow(q, fx);
      const fw = Math.pow(q, 1 - fx), [cz] = centroid(P);
      let hN = 0; for (let k = 0; k < K; k++) hN = Math.max(hN, P[2 * k + 1]);
      for (let k = 0; k < K; k++) { // barrel: gripped top and bottom, the sides bulge most at mid-height
        const hb = 0.7 + 0.6 * Math.sin(Math.PI * clamp(P[2 * k + 1] / Math.max(hN, 1e-4), 0, 1));
        P[2 * k] = cz + (P[2 * k] - cz) * (1 + (fw - 1) * hb);
      }
      const A2 = area(P), fix = (A1 * fw) / Math.max(A2, 1e-12);
      for (let k = 0; k < K; k++) P[2 * k] = cz + (P[2 * k] - cz) * fix;
    }
    // lengthen: gaps between slices grow with the struck slices
    const gaps = []; for (let s = 0; s < n - 1; s++) gaps.push((X[s + 1] - X[s]) * Math.sqrt(flen[s] * flen[s + 1]));
    for (let s = 1; s < n; s++) X[s] = X[s - 1] + gaps[s - 1];
    // curl: the struck face stretches a little more than the face on the anvil
    if (barLike && o.curl !== 0) {
      const kap = (o.curl ?? 0.006) * delta;
      for (let s = 0; s < n; s++) { const lift = kap * Math.max(0, Math.abs(X[s] - x0) - R); if (lift) for (let k = 0; k < K; k++) this.P[s][2 * k + 1] += lift; }
    }
    this._relax(x0, o.smooth ?? 0.2);
    this._smoothAlong(0.06);
    this._resample();
    this.settle();
    return { kind: 'compress', delta };
  }

  // ------------------------------------------------------------------ a blow on the bar stood on end
  // Upsetting: the bar shortens near both ends (more at the struck top end), those sections grow
  // fuller and take on the body's shape, so tapered, rounded ends square up. End faces stay flat.
  upset(v, plast) {
    const n = this.n, X = this.x;
    const L = X[n - 1] - X[0];
    if (L < 0.02) return { kind: 'miss' };
    // driving against the whole length: much less shortening per blow than squashing a section
    const dh = Math.min(0.0002 * v * v * plast, L * 0.02);
    let sec = 0; for (const P of this.P) sec = Math.max(sec, Math.sqrt(area(P)));
    const lam = Math.max(0.012, sec * 1.1);
    const e = new Float64Array(n);
    for (let s = 0; s < n; s++) e[s] = Math.exp(-(((X[n - 1] - X[s]) / lam) ** 2)) + 0.6 * Math.exp(-(((X[s] - X[0]) / lam) ** 2));
    // local strain per gap so the total shortening is dh
    let sum = 0; const g = [];
    for (let s = 0; s < n - 1; s++) { g.push(X[s + 1] - X[s]); sum += g[s] * (e[s] + e[s + 1]) / 2; }
    const c = dh / Math.max(sum, 1e-9);
    const eps = new Float64Array(n);
    for (let s = 0; s < n; s++) eps[s] = clamp(c * e[s], 0, 0.3);
    for (let s = 0; s < n - 1; s++) g[s] *= 1 - (eps[s] + eps[s + 1]) / 2;
    for (let s = 1; s < n; s++) X[s] = X[s - 1] + g[s - 1];
    // body section shape (relative to its centre) from the middle of the bar
    const mid = this.P[n >> 1], [mz, my] = centroid(mid), mA = area(mid);
    for (let s = 0; s < n; s++) {
      if (eps[s] <= 0) continue;
      const P = this.P[s], [cz, cy] = centroid(P), grow = Math.sqrt(1 / (1 - eps[s]));
      scaleAbout(P, cz, cy, grow, grow);
      // the end fills out toward the body's section shape
      const A = area(P), sc = Math.sqrt(A / mA), t = clamp(eps[s] * 4, 0, 1);
      for (let k = 0; k < K; k++) {
        P[2 * k] = lerp(P[2 * k], cz + (mid[2 * k] - mz) * sc, t);
        P[2 * k + 1] = lerp(P[2 * k + 1], cy + (mid[2 * k + 1] - my) * sc, t);
      }
      const A2 = area(P), fix = Math.sqrt(A / Math.max(A2, 1e-12)); scaleAbout(P, cz, cy, fix, fix);
    }
    this._resample();
    this.settle();
    return { kind: 'upset', delta: dh / L };
  }

  // even out kinks along the length near the blow (sections and spacing), never across a section
  _relax(x0, amt) {
    const n = this.n; if (n < 3 || amt <= 0) return;
    const Q = this.P.map(P => P.slice());
    for (let s = 1; s < n - 1; s++) {
      const d = Math.abs(this.x[s] - x0), w = amt * smooth(R * 0.8, R * 1.3, d) * (1 - smooth(R * 2, R * 3, d));
      if (w <= 0) continue;
      const P = this.P[s], A = Q[s - 1], B = Q[s + 1];
      for (let i = 0; i < 2 * K; i++) P[i] = lerp(Q[s][i], (A[i] + B[i]) / 2, w);
    }
  }
  // light smoothing of every section toward its neighbours along the bar (never across a section,
  // so corners stay square): irons out slice-to-slice noise. End slices are left alone.
  _smoothAlong(a) {
    const n = this.n; if (n < 3) return;
    const Q = this.P.map(P => P.slice());
    for (let s = 1; s < n - 1; s++) { const P = this.P[s]; for (let i = 0; i < 2 * K; i++) P[i] = lerp(Q[s][i], (Q[s - 1][i] + Q[s + 1][i]) / 2, a); }
  }
  // keep slices 2.5-6 mm apart as the bar grows
  _resample() {
    for (let s = 0; s < this.n - 1 && this.n < 220; s++) {
      if (this.x[s + 1] - this.x[s] > 0.006) {
        const P = new Float32Array(2 * K), A = this.P[s], B = this.P[s + 1];
        for (let i = 0; i < 2 * K; i++) P[i] = (A[i] + B[i]) / 2;
        this.x.splice(s + 1, 0, (this.x[s] + this.x[s + 1]) / 2); this.P.splice(s + 1, 0, P);
      }
    }
  }
  // quarter turn about the long axis
  roll(dir) {
    let yc = 0, zc = 0, c = 0;
    for (const P of this.P) for (let k = 0; k < K; k++) { zc += P[2 * k]; yc += P[2 * k + 1]; c++; }
    yc /= c; zc /= c;
    for (const P of this.P) for (let k = 0; k < K; k++) {
      const z = P[2 * k] - zc, y = P[2 * k + 1] - yc;
      P[2 * k] = zc - y * dir; P[2 * k + 1] = yc + z * dir;
    }
    this.settle();
  }
  // end for end (a half turn about the vertical when stood up)
  flipEnds() {
    this.x.reverse(); this.P.reverse();
    for (let s = 0; s < this.n; s++) this.x[s] = -this.x[s];
    for (const P of this.P) for (let k = 0; k < K; k++) P[2 * k + 1] = -P[2 * k + 1];
    this.settle();
  }

  // ------------------------------------------------------------------ mesh
  // Vertex positions in the piece's local frame (upright applied), plus indices for Babylon.
  mesh() {
    const n = this.n, nv = n * K + 2 * K + 2;
    const pos = new Float32Array(nv * 3);
    const H = this.height(), xa = this.x[0];
    const put = (i, x, y, z) => {
      if (this.upright) { pos[i * 3] = -(y - H / 2); pos[i * 3 + 1] = x - xa; pos[i * 3 + 2] = z; }
      else { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; }
    };
    for (let s = 0; s < n; s++) for (let k = 0; k < K; k++) put(s * K + k, this.x[s], this.P[s][2 * k + 1], this.P[s][2 * k]);
    // end caps: own ring copies (crisp edges) + centres
    const c0 = n * K, c1 = c0 + K, m0 = c0 + 2 * K, m1 = m0 + 1;
    for (let k = 0; k < K; k++) { put(c0 + k, this.x[0], this.P[0][2 * k + 1], this.P[0][2 * k]); put(c1 + k, this.x[n - 1], this.P[n - 1][2 * k + 1], this.P[n - 1][2 * k]); }
    const [z0, y0] = centroid(this.P[0]), [z1, y1] = centroid(this.P[n - 1]);
    put(m0, this.x[0], y0, z0); put(m1, this.x[n - 1], y1, z1);
    const idx = [];
    for (let s = 0; s < n - 1; s++) for (let k = 0; k < K; k++) {
      const a = s * K + k, b = s * K + (k + 1) % K, c = (s + 1) * K + (k + 1) % K, d = (s + 1) * K + k;
      idx.push(a, b, c, a, c, d);
    }
    for (let k = 0; k < K; k++) { idx.push(m0, c0 + (k + 1) % K, c0 + k); idx.push(m1, c1 + k, c1 + (k + 1) % K); }
    // Babylon wants clockwise-from-outside; check the orientation with a signed volume
    let v = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    }
    const rh = Uint32Array.from(idx);       // right-handed winding
    if (v < 0) for (let t = 0; t < rh.length; t += 3) { const tmp = rh[t + 1]; rh[t + 1] = rh[t + 2]; rh[t + 2] = tmp; }
    const bab = new Uint32Array(rh.length);  // Babylon winding
    for (let t = 0; t < rh.length; t += 3) { bab[t] = rh[t]; bab[t + 1] = rh[t + 2]; bab[t + 2] = rh[t + 1]; }
    return { pos, rh, bab, nv };
  }
}
