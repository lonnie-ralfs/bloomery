// Spongy iron bloom mesh: a squashed lump with pits and a slag crust.
// Kept updatable and fairly dense so the consolidation phase can deform it per hammer blow.
import { B, V3, fbm3, smooth, noiseTex, mat } from './util.js';

export function bloomRadius(mass) { return 0.075 * Math.cbrt(Math.max(0.12, mass) / 2); }

export function makeBloom(scene, mass) {
  const r = bloomRadius(mass);
  const m = B.MeshBuilder.CreateIcoSphere('bloom', { radius: r, subdivisions: 5, flat: false, updatable: true }, scene);
  const pos = m.getVerticesData(B.VertexBuffer.PositionKind);
  const col = new Float32Array(pos.length / 3 * 4);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 4) {
    const x = pos[i] / r, y = pos[i + 1] / r, z = pos[i + 2] / r;
    const n = fbm3(x * 1.8 + 3.1, y * 1.8, z * 1.8 + 1.7, 3);
    const p = fbm3(x * 5 + 9, y * 5 + 2, z * 5, 2);
    let s = 1 + (n - 0.5) * 0.6 - smooth(0.55, 0.78, p) * 0.14;
    let px = x * s, py = y * s * 0.78, pz = z * s;
    if (py < -0.45) py = -0.45 - (py + 0.45) * 0.25; // flattened where it sat on the hearth
    pos[i] = px * r; pos[i + 1] = py * r; pos[i + 2] = pz * r;
    const crust = smooth(0.45, 0.7, n) * 0.6 + smooth(0.55, 0.8, p) * 0.4;
    const c = 1 - crust * 0.55;
    col[j] = c; col[j + 1] = c * 0.96; col[j + 2] = c * 0.94; col[j + 3] = 1;
  }
  m.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  const nrm = [];
  B.VertexData.ComputeNormals(pos, m.getIndices(), nrm);
  m.updateVerticesData(B.VertexBuffer.NormalKind, nrm);
  m.setVerticesData(B.VertexBuffer.ColorKind, col);
  const glowTex = noiseTex(scene, 'bloomGlow', { size: 128, scale: 8, c1: [10, 4, 2], c2: [255, 230, 200], contrast: 2.6, bias: -0.05 });
  const bm = mat(scene, 'bloomMat', [0.3, 0.27, 0.25], { spec: 0.25, specPow: 30 });
  bm.emissiveTexture = glowTex;
  m.material = bm;
  m.metadata = Object.assign(m.metadata || {}, { radius: r });
  return m;
}
