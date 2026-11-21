// Shared helpers: math, noise, procedural textures, materials, tweens, glow colours.
export const B = window.BABYLON;
export const V3 = (x = 0, y = 0, z = 0) => new B.Vector3(x, y, z);
export const C3 = (r, g, b) => new B.Color3(r, g, b);

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
export function dampV(cur, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt);
  cur.x += (target.x - cur.x) * t; cur.y += (target.y - cur.y) * t; cur.z += (target.z - cur.z) * t;
  return cur;
}
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return table[table.length - 1][1];
}
export function seeded(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- value noise ----------
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash3 = (x, y, z) => hash2(x + Math.imul(z | 0, 1013), y ^ Math.imul(z | 0, 40503));
const mod = (a, p) => ((a % p) + p) % p;
export function vnoise(x, y, p = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = p ? mod(xi, p) : xi, X1 = p ? mod(xi + 1, p) : xi + 1, Y0 = p ? mod(yi, p) : yi, Y1 = p ? mod(yi + 1, p) : yi + 1;
  return lerp(lerp(hash2(X0, Y0), hash2(X1, Y0), u), lerp(hash2(X0, Y1), hash2(X1, Y1), u), v);
}
export function fbm(x, y, oct = 4, p = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, p ? p * f : 0); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
export function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// ---------- procedural textures ----------
// Tileable fbm texture between two colours (0-255 rgb). scale and sx/sy must be integers to tile.
export function noiseTex(scene, name, o = {}) {
  const size = o.size || 256, scale = o.scale || 8, oct = o.oct || 4;
  const sx = o.sx || 1, sy = o.sy || 1;
  const c1 = o.c1 || [0, 0, 0], c2 = o.c2 || [255, 255, 255];
  const dt = new B.DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = dt.getContext();
  const img = ctx.createImageData(size, size), d = img.data;
  const px = scale * sx, py = scale * sy;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // anisotropic tiling: different periods per axis
    let n = fbmXY(x / size * px, y / size * py, oct, px, py);
    n = clamp((n - 0.5) * (o.contrast || 1) + 0.5 + (o.bias || 0));
    let r = lerp(c1[0], c2[0], n), g = lerp(c1[1], c2[1], n), b = lerp(c1[2], c2[2], n);
    if (o.speck && hash2(x * 7 + 3, y * 13 + 1) < o.speck) { const sc = o.speckColor || [0, 0, 0]; r = sc[0]; g = sc[1]; b = sc[2]; }
    const i = (y * size + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  dt.update();
  dt.wrapU = dt.wrapV = B.Texture.WRAP_ADDRESSMODE;
  return dt;
}
function vnoiseXY(x, y, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = mod(xi, px), X1 = mod(xi + 1, px), Y0 = mod(yi, py), Y1 = mod(yi + 1, py);
  return lerp(lerp(hash2(X0, Y0), hash2(X1, Y0), u), lerp(hash2(X0, Y1), hash2(X1, Y1), u), v);
}
function fbmXY(x, y, oct, px, py) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoiseXY(x * f, y * f, px * f, py * f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

let _flare = null;
export function flareTex(scene) {
  if (_flare) return _flare;
  const t = new B.DynamicTexture('flare', { width: 64, height: 64 }, scene, false);
  const ctx = t.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); t.update(); t.hasAlpha = true;
  _flare = t;
  return t;
}

// ---------- materials ----------
export function mat(scene, name, color, o = {}) {
  const m = new B.StandardMaterial(name, scene);
  m.diffuseColor = color instanceof B.Color3 ? color : new B.Color3(color[0], color[1], color[2]);
  const sp = o.spec ?? 0.04;
  m.specularColor = new B.Color3(sp, sp, sp);
  m.specularPower = o.specPow ?? 24;
  if (o.tex) m.diffuseTexture = o.tex;
  if (o.emissive) m.emissiveColor = new B.Color3(o.emissive[0], o.emissive[1], o.emissive[2]);
  if (o.alpha !== undefined) m.alpha = o.alpha;
  if (o.back === false) m.backFaceCulling = false;
  return m;
}

// Lumpy smooth blob (clay clumps, stones, charcoal, bloom base)
export function lump(scene, name, r, rough = 0.3, seed = 0, subdiv = 2) {
  const m = B.MeshBuilder.CreateIcoSphere(name, { radius: r, subdivisions: subdiv, flat: false, updatable: true }, scene);
  const pos = m.getVerticesData(B.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] / r, y = pos[i + 1] / r, z = pos[i + 2] / r;
    const n = fbm3(x * 1.4 + seed * 7.1, y * 1.4 + seed * 3.3, z * 1.4, 3);
    const s = 1 + (n - 0.5) * 2 * rough;
    pos[i] *= s; pos[i + 1] *= s; pos[i + 2] *= s;
  }
  m.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  const nrm = [];
  B.VertexData.ComputeNormals(pos, m.getIndices(), nrm);
  m.updateVerticesData(B.VertexBuffer.NormalKind, nrm);
  return m;
}

// ---------- glow colour of hot material (°C -> emissive) ----------
const GLOW = [[450, 0, 0, 0], [600, 0.16, 0.01, 0], [750, 0.42, 0.05, 0], [900, 0.78, 0.15, 0.02], [1050, 1, 0.33, 0.06],
  [1200, 1, 0.52, 0.15], [1350, 1, 0.72, 0.33], [1500, 1, 0.9, 0.62], [1650, 1, 1, 0.95]];
export function tempColor(T, out = new B.Color3()) {
  if (T <= GLOW[0][0]) { out.set(0, 0, 0); return out; }
  for (let i = 1; i < GLOW.length; i++) {
    if (T <= GLOW[i][0]) {
      const a = GLOW[i - 1], b = GLOW[i], t = (T - a[0]) / (b[0] - a[0]);
      out.set(lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t));
      return out;
    }
  }
  const l = GLOW[GLOW.length - 1]; out.set(l[1], l[2], l[3]); return out;
}

// ---------- tweens ----------
export const ease = {
  out: k => 1 - (1 - k) ** 3,
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  in: k => k * k,
};
export class Tweens {
  constructor() { this.list = []; }
  add(dur, fn, done) { const t = { t: 0, dur, fn, done }; this.list.push(t); fn(0); return t; }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      if (!tw) continue;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.list.splice(this.list.indexOf(tw), 1); tw.done && tw.done(); }
    }
  }
}
export function arcPos(from, to, h, k, out = V3()) {
  out.x = lerp(from.x, to.x, k); out.z = lerp(from.z, to.z, k);
  out.y = lerp(from.y, to.y, k) + Math.sin(Math.PI * k) * h;
  return out;
}
