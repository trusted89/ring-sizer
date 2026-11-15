// Scale check against a solid disc of published diameter (for example a coin).
// This is NOT the product flow: the page measures the inner edge of a ring and correctly
// answers "no ring" for a coin. This script reuses the page's marker detection and
// homography, then measures the disc's OUTER edge, to test the scale chain on its own:
// marker localisation, rectification, and the print-scale correction.
// Usage: node scripts/dev/disc-check.mjs <photo> <sheet check line in mm, e.g. 84> [expected diameter mm]
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { measure, homographyFrom4, applyH } from '../../public/measure.js';

const require = createRequire(import.meta.url);
let cv = require('@techstark/opencv-js');
if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });

const [file, lineMm = '100', expected] = process.argv.slice(2);
const printScale = Number(lineMm) / 100;
const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const res = measure(cv, { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: W, height: H }, { printScale });
if (!res.overlay.marker) { console.log('marker not found'); process.exit(1); }
const Hp2i = homographyFrom4([[0, 0], [20, 0], [20, 20], [0, 20]], res.overlay.marker);
const gray = new Float32Array(W * H);
for (let i = 0, p = 0; i < W * H; i++, p += 4) gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) / 256;
const at = (x, y) => { // plane (nominal mm) -> grey level, bilinear
  const [u, v] = applyH(Hp2i, x, y);
  if (u < 0 || v < 0 || u > W - 2 || v > H - 2) return -1;
  const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = y0 * W + x0;
  return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + W] * (1 - fx) + gray[i + W + 1] * fx) * fy;
};

// 1. coarse: largest dark blob to the right of the marker, in a rectified patch
const S = 6, X0 = 26, Y0 = -28, NX = Math.round(64 * S), NY = Math.round(76 * S);
const patch = new Float32Array(NX * NY);
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) patch[j * NX + i] = at(X0 + i / S, Y0 + j / S);
const sorted = Float32Array.from(patch).filter((v) => v >= 0).sort();
const paper = sorted[Math.floor(sorted.length * 0.9)];
const dark = new Uint8Array(NX * NY);
for (let k = 0; k < NX * NY; k++) dark[k] = patch[k] >= 0 && patch[k] < 0.75 * paper ? 1 : 0;
let best = null;
const seen = new Uint8Array(NX * NY), stack = [];
for (let k0 = 0; k0 < NX * NY; k0++) {
  if (!dark[k0] || seen[k0]) continue;
  let n = 0, sx = 0, sy = 0; stack.push(k0); seen[k0] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % NX, j = (k / NX) | 0; n++; sx += i; sy += j;
    for (const q of [k - 1, k + 1, k - NX, k + NX]) {
      if (q < 0 || q >= NX * NY || seen[q] || !dark[q]) continue;
      if (Math.abs((q % NX) - i) > 1) continue;
      seen[q] = 1; stack.push(q);
    }
  }
  if (!best || n > best.n) best = { n, cx: X0 + sx / n / S, cy: Y0 + sy / n / S };
}
const r0 = Math.sqrt(best.n / Math.PI) / S;

// 2. fine: along 360 rays, the disc -> paper edge at half height, to a fraction of a pixel
const fitCircle = (pts) => {
  let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) { const u = p[0] - mx, v = p[1] - my; suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
  const det = suu * svv - suv * suv, a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  return { cx: uc + mx, cy: vc + my, r: Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length) };
};
let model = { cx: best.cx, cy: best.cy, r: r0 };
let inl = [], pts = [];
for (let pass = 0; pass < 3; pass++) {
  pts = [];
  const step = 0.02, win = pass === 0 ? 4 : 2.5;
  for (let k = 0; k < 360; k++) {
    const th = k * Math.PI / 180, ux = Math.cos(th), uy = Math.sin(th);
    const prof = [];
    for (let rho = model.r - win; rho <= model.r + win; rho += step) prof.push(at(model.cx + rho * ux, model.cy + rho * uy));
    if (prof.some((v) => v < 0)) continue;
    const m = prof.length, q = Math.floor(m / 5);
    const inner = prof.slice(0, q).sort((a, b) => a - b)[q >> 1], outer = prof.slice(m - q).sort((a, b) => a - b)[q >> 1];
    if (outer - inner < 20) continue;
    const level = (inner + outer) / 2;
    // outermost upward crossing: a shadow beside the disc can only push this outwards
    for (let j = m - 2; j >= 0; j--) {
      if (prof[j] < level && prof[j + 1] >= level) {
        const rho = model.r - win + (j + (level - prof[j]) / (prof[j + 1] - prof[j])) * step;
        pts.push([model.cx + rho * ux, model.cy + rho * uy]); break;
      }
    }
  }
  // consensus circle; a shadow only adds points OUTSIDE the true edge, so allow those and none inside
  const tol = 0.12; let bestC = null, bestN = 0, seed = 12345 + pass;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let it = 0; it < 600; it++) {
    const c = fitCircle([pts[(rnd() * pts.length) | 0], pts[(rnd() * pts.length) | 0], pts[(rnd() * pts.length) | 0], pts[(rnd() * pts.length) | 0]]);
    if (!Number.isFinite(c.r)) continue;
    let n = 0, inside = 0;
    for (const p of pts) { const d = Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r; if (Math.abs(d) <= tol) n++; else if (d < -2 * tol) inside++; }
    if (inside > 0.08 * pts.length) continue;
    if (n > bestN) { bestN = n; bestC = c; }
  }
  if (!bestC) { console.log('no consistent circle'); process.exit(1); }
  for (let it = 0; it < 3; it++) { inl = pts.filter((p) => Math.abs(Math.hypot(p[0] - bestC.cx, p[1] - bestC.cy) - bestC.r) <= tol); bestC = fitCircle(inl); }
  model = bestC;
}
const D = 2 * model.r * printScale, c = res.checks;
if (process.env.DISC_VIZ) { // optional close-up with the fitted circle and edge points, for inspection
  const P = (x, y) => applyH(Hp2i, x, y), [ccx, ccy] = P(model.cx, model.cy);
  const rpx = Math.hypot(P(model.cx + model.r, model.cy)[0] - ccx, P(model.cx + model.r, model.cy)[1] - ccy);
  const half = Math.round(rpx * 1.3), L = Math.round(ccx - half), T = Math.round(ccy - half);
  const ring = []; for (let i = 0; i <= 180; i++) { const t = i * Math.PI / 90, q = P(model.cx + model.r * Math.cos(t), model.cy + model.r * Math.sin(t)); ring.push(`${(q[0] - L).toFixed(1)},${(q[1] - T).toFixed(1)}`); }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * half}" height="${2 * half}"><polyline points="${ring.join(' ')}" fill="none" stroke="#e6007a" stroke-width="1.2"/>${pts.map((p) => { const q = P(p[0], p[1]); return `<circle cx="${(q[0] - L).toFixed(1)}" cy="${(q[1] - T).toFixed(1)}" r="1.4" fill="#00e5ff"/>`; }).join('')}</svg>`;
  const crop = await sharp(file).rotate().extract({ left: L, top: T, width: 2 * half, height: 2 * half }).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
  await sharp(crop).resize(900).toFile(process.env.DISC_VIZ);
}
const camH = c.cameraHeightMm;
console.log(`photo: ${file.split('/').pop()}  app outcome: ${res.status}${res.reasons?.length ? ' ' + res.reasons.map((r) => r.code).join(',') : ''}`);
console.log(`marker match ${(c.markerScore * 100).toFixed(1)} %, ${c.pxPerMm.toFixed(1)} px/mm, camera about ${(camH / 10).toFixed(0)} cm, tilt estimate ${c.tiltDeg.toFixed(1)} deg`);
console.log(`disc outer diameter: ${D.toFixed(2)} mm  (edge points agreeing: ${inl.length}/${pts.length}, sheet line ${lineMm} mm)`);
if (expected) {
  const e = Number(expected);
  console.log(`expected ${e.toFixed(2)} mm -> difference ${(D - e >= 0 ? '+' : '') + (D - e).toFixed(2)} mm (${((D / e - 1) * 100).toFixed(1)} %)`);
  const t = 1.7; // typical coin thickness: its top face is nearer the lens and so looks larger
  console.log(`  of which about +${(e * t / camH).toFixed(2)} mm is expected from a ${t} mm thick disc seen from ${(camH / 10).toFixed(0)} cm`);
}
