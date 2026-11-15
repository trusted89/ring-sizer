// Ring inner-diameter measurement pipeline.
// Runs unchanged in the browser (public/app.js) and in Node (scripts/run-tests.mjs).
// Own work; OpenCV.js is the only reused component (thresholding, contours,
// polygon approximation, perspective warp, morphology, ellipse fit).

export const CONFIG = {
  markerSideMm: 20,          // outer side of the printed marker
  coarseMaxSide: 1600,       // detection runs on a downscaled copy
  markerMinScore: 0.72,      // template correlation needed to accept a marker
  minPxPerMm: 5,             // below this the photo is too far / too small
  blurRejectMm: 0.65,        // 10-90% edge width on the marker, in mm
  blurWarnMm: 0.40,
  tiltRejectDeg: 10,         // supported: near-overhead
  tiltWarnDeg: 6,
  searchRadiusMm: 80,        // ring is searched within this distance of the marker
  ringFarMm: 75,             // ring centre must be this close to the marker centre
  holeMinMm: 8,              // plausible inner-diameter range for detection
  holeMaxMm: 40,
  foreshorteningRejectDeg: 25, // lens-independent backstop for the angle check
  minInlierFrac: 0.50,       // share of the circumference that must agree with one circle
  maxArcGapDeg: 200,         // largest stretch of circumference with no agreeing edge
  maxFitRmsMm: 0.12,
  assumedRingHeightMm: 4,    // typical band height, used only in the uncertainty model
  minCameraHeightWarnMm: 180,
  viewAngleWarnDeg: 12,
  uncertaintyFloorMm: 0.20,  // never state better than this (see README)
  printScaleTolerance: 0.005, // sheet print scale as confirmed by a ruler: 100 mm line within 0.5 mm
};

const REASONS = {
  NO_MARKER: {
    title: 'No scale marker found',
    fix: 'The printed 20 mm marker must be fully visible, flat and unobstructed, with white paper all around it. Retake with the marker and the ring both in frame.',
  },
  LOW_RES: {
    title: 'Marker is too small in the photo',
    fix: 'Move the phone closer so the marker and ring fill most of the frame, and do not use digital zoom.',
  },
  BLURRY: {
    title: 'Photo is too blurry to measure',
    fix: 'Hold the phone steady, tap the marker to focus, and use more light. Then retake.',
  },
  PERSPECTIVE: {
    title: 'Photo was taken at too steep an angle',
    fix: 'Hold the phone flat and directly above the sheet so the marker looks square, then retake.',
  },
  NO_RING: {
    title: 'No ring found next to the marker',
    fix: 'Lay one ring flat on the white paper beside the marker. Avoid hard shadows and glare; the paper must be visible through the ring.',
  },
  RING_FAR: {
    title: 'Ring is too far from the marker',
    fix: 'Place the ring in the marked area right next to the marker and retake.',
  },
  POOR_BOUNDARY: {
    title: 'Inner edge of the ring is not clear enough',
    fix: 'Glare or shadow is hiding part of the inner edge. Use soft, even light (no flash), keep your shadow off the ring, and retake.',
  },
  NOT_ROUND: {
    title: 'Inner edge does not form a clean circle',
    fix: 'The ring may be leaning on a stone or setting, out of round, or partly hidden by shadow. Lay it flat, use soft even light, keep the camera directly above it and retake.',
  },
};

// ---------- small numeric helpers ----------

function solveLinear(A, b) {
  // Gaussian elimination with partial pivoting; A is n x n (array of rows).
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Homography mapping src[i] -> dst[i] for four point pairs. Returns 9 numbers, row-major.
export function homographyFrom4(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
}

function mul3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

function median(arr) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function bilinear(gray, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return -1;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
}

// Total-least-squares line through points; returns point on line + unit direction + rms.
function fitLine(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const d = [Math.cos(ang), Math.sin(ang)];
  let ss = 0;
  const res = pts.map(p => { const r = -(p[0] - mx) * d[1] + (p[1] - my) * d[0]; ss += r * r; return r; });
  return { p: [mx, my], d, rms: Math.sqrt(ss / pts.length), res };
}

function intersect(l1, l2) {
  const [x1, y1] = l1.p, [dx1, dy1] = l1.d, [x2, y2] = l2.p, [dx2, dy2] = l2.d;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
  return [x1 + t * dx1, y1 + t * dy1];
}

// ---------- marker ----------

// Expected marker reflectance at plane point (x, y) in mm: 1 = white, 0 = black.
// 20 mm black square, 12 mm white square inside it, 4 mm black square at the centre.
function markerTemplate(x, y) {
  const d = Math.max(Math.abs(x - 10), Math.abs(y - 10)); // Chebyshev distance from centre
  if (d > 10) return 1;
  if (d > 6) return 0;
  if (d > 2) return 1;
  return 0;
}

function scoreMarker(gray, w, h, Hp2i) {
  // Pearson correlation between sampled image and template over a 28 x 28 mm window.
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = -3.5; y < 24; y += 1) for (let x = -3.5; x < 24; x += 1) {
    const [u, v] = applyH(Hp2i, x, y);
    const a = bilinear(gray, w, h, u, v);
    if (a < 0) return -1;
    const b = markerTemplate(x, y);
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  const cov = sab - sa * sb / n, va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return va > 1e-6 ? cov / Math.sqrt(va * vb) : -1;
}

function orderClockwise(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  return [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

const PLANE_CORNERS = [[0, 0], [20, 0], [20, 20], [0, 20]];

function findMarkerCoarse(cv, grayMat, gray, w, h) {
  let best = null;
  const tryBinary = (bin) => {
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const minArea = 20 * 20;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area >= minArea && area < 0.6 * w * h) {
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.03 * cv.arcLength(c, true), true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const d = approx.data32S;
          const quad = orderClockwise([[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]]);
          const H = homographyFrom4(PLANE_CORNERS, quad);
          if (H) {
            const score = scoreMarker(gray, w, h, H);
            if (!best || score > best.score) best = { quad, score };
          }
        }
        approx.delete();
      }
      c.delete();
    }
    contours.delete(); hier.delete();
  };
  const bin = new cv.Mat();
  const block = Math.max(31, (Math.round(Math.min(w, h) / 8) | 1));
  cv.adaptiveThreshold(grayMat, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, 12);
  tryBinary(bin);
  if (!best || best.score < CONFIG.markerMinScore) {
    cv.threshold(grayMat, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    tryBinary(bin);
  }
  bin.delete();
  return best;
}

// Sub-pixel refinement of the marker's four outer edges on the full-resolution image.
// Also measures edge blur (10-90% rise width) per side.
function refineMarker(gray, w, h, quadIn) {
  let quad = quadIn.map(p => [...p]);
  let sides = null;
  for (let iter = 0; iter < 3; iter++) {
    const cx = quad.reduce((s, p) => s + p[0], 0) / 4, cy = quad.reduce((s, p) => s + p[1], 0) / 4;
    sides = [];
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; } // outward normal
      const half = Math.max(4, Math.min(40, 0.12 * len));
      const step = 0.5, m = Math.round(2 * half / step) + 1;
      const pts = [], widths = [], contrasts = [];
      const N = Math.max(12, Math.min(48, Math.round(len / 6)));
      for (let j = 0; j < N; j++) {
        const t = 0.14 + 0.72 * j / (N - 1);
        const qx = a[0] + t * (b[0] - a[0]), qy = a[1] + t * (b[1] - a[1]);
        const prof = new Float64Array(m);
        let ok = true;
        for (let k = 0; k < m; k++) {
          const s = -half + k * step;
          const v = bilinear(gray, w, h, qx + s * nx, qy + s * ny);
          if (v < 0) { ok = false; break; }
          prof[k] = v;
        }
        if (!ok) continue;
        const q = Math.max(2, Math.floor(m / 4));
        const lo = median(prof.subarray(0, q)), hi = median(prof.subarray(m - q));
        const c = hi - lo;
        if (c < 25) continue;
        const cross = (level) => {
          // crossing closest to the profile centre
          let bestK = null, bestD = 1e9;
          for (let k = 0; k < m - 1; k++) {
            if ((prof[k] - level) * (prof[k + 1] - level) <= 0 && prof[k + 1] !== prof[k]) {
              const f = (level - prof[k]) / (prof[k + 1] - prof[k]);
              const s = -half + (k + f) * step;
              if (Math.abs(s) < bestD) { bestD = Math.abs(s); bestK = s; }
            }
          }
          return bestK;
        };
        const s50 = cross(lo + 0.5 * c);
        if (s50 === null) continue;
        // 10% and 90% crossings: walk outwards from the 50% point
        const idx50 = (s50 + half) / step;
        let s10 = null, s90 = null;
        for (let k = Math.floor(idx50); k >= 1; k--) {
          if (prof[k - 1] <= lo + 0.1 * c) { const f = (lo + 0.1 * c - prof[k - 1]) / (prof[k] - prof[k - 1] || 1); s10 = -half + (k - 1 + f) * step; break; }
        }
        for (let k = Math.ceil(idx50); k < m - 1; k++) {
          if (prof[k + 1] >= lo + 0.9 * c) { const f = (lo + 0.9 * c - prof[k]) / (prof[k + 1] - prof[k] || 1); s90 = -half + (k + f) * step; break; }
        }
        pts.push([qx + s50 * nx, qy + s50 * ny]);
        contrasts.push(c);
        if (s10 !== null && s90 !== null) widths.push(s90 - s10);
      }
      if (pts.length < 6) return null;
      let line = fitLine(pts);
      const mad = median(line.res.map(Math.abs)) * 1.4826 + 0.05;
      const kept = pts.filter((_, k) => Math.abs(line.res[k]) <= 2.5 * mad);
      if (kept.length >= 6) line = fitLine(kept);
      sides.push({ line, blurPx: median(widths), contrast: median(contrasts), len });
    }
    const corners = [];
    for (let i = 0; i < 4; i++) {
      const p = intersect(sides[(i + 3) % 4].line, sides[i].line);
      if (!p) return null;
      corners.push(p);
    }
    quad = corners;
  }
  return {
    quad,
    blurPx: Math.max(...sides.map(s => s.blurPx || 0)),   // worst side: catches directional motion blur
    lineRmsPx: Math.sqrt(sides.reduce((s, x) => s + x.line.rms ** 2, 0) / 4),
    contrast: Math.min(...sides.map(s => s.contrast)),
  };
}

// Local scale and tilt from the plane->image homography at plane point (x, y).
function localGeometry(Hp2i, x, y) {
  const e = 0.5;
  const px = applyH(Hp2i, x + e, y), mx = applyH(Hp2i, x - e, y);
  const py = applyH(Hp2i, x, y + e), my = applyH(Hp2i, x, y - e);
  const a = (px[0] - mx[0]) / (2 * e), c = (px[1] - mx[1]) / (2 * e);
  const b = (py[0] - my[0]) / (2 * e), d = (py[1] - my[1]) / (2 * e);
  const S = a * a + b * b + c * c + d * d, det = a * d - b * c;
  const disc = Math.sqrt(Math.max(0, S * S - 4 * det * det));
  const s1 = Math.sqrt((S + disc) / 2), s2 = Math.sqrt(Math.max(0, (S - disc) / 2));
  return { pxPerMm: Math.sqrt(s1 * s2), tiltDeg: Math.acos(Math.min(1, s2 / s1)) * 180 / Math.PI };
}

// ---------- ring ----------

function findHoleCandidates(cv, coarseRgba, Hi2pCoarse, coarsePxPerMm, paperRef, debug) {
  const R = CONFIG.searchRadiusMm;
  const S = Math.max(2.5, Math.min(coarsePxPerMm, 6)); // rectified px per mm
  const N = Math.round(2 * R * S);
  // plane (mm) -> rectified px: u = (x - (10 - R)) * S
  const T = [S, 0, -(10 - R) * S, 0, S, -(10 - R) * S, 0, 0, 1];
  const M = mul3(T, Hi2pCoarse);
  const Mmat = cv.matFromArray(3, 3, cv.CV_64F, M);
  const rect = new cv.Mat(), valid = new cv.Mat();
  const size = new cv.Size(N, N);
  cv.warpPerspective(coarseRgba, rect, Mmat, size, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
  const ones = new cv.Mat(coarseRgba.rows, coarseRgba.cols, cv.CV_8UC1, new cv.Scalar(255));
  cv.warpPerspective(ones, valid, Mmat, size, cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
  ones.delete(); Mmat.delete();

  // Paper brightness map: large max-filter then blur (removes ring, marker, text).
  const g = new cv.Mat();
  cv.cvtColor(rect, g, cv.COLOR_RGBA2GRAY);
  const bg = new cv.Mat();
  const k = (Math.round(40 * S) | 1);
  const kernel = cv.Mat.ones(k, k, cv.CV_8U);
  cv.dilate(g, bg, kernel);
  cv.blur(bg, bg, new cv.Size(k, k));
  kernel.delete();

  const mask = new cv.Mat(N, N, cv.CV_8UC1);
  const rd = rect.data, gd = g.data, bd = bg.data, vd = valid.data, md = mask.data;
  const refChroma = paperRef.chroma;
  for (let i = 0, p = 0; i < N * N; i++, p += 4) {
    if (!vd[i]) { md[i] = 0; continue; }
    const b = Math.max(bd[i], 1);
    const r_ = rd[p], g_ = rd[p + 1], b_ = rd[p + 2];
    const chroma = (Math.max(r_, g_, b_) - Math.min(r_, g_, b_)) / b;
    md[i] = (gd[i] / b < 0.78 || chroma - refChroma > 0.16) ? 255 : 0;
  }
  // erase marker (with margin) so it is never a ring candidate
  const m0 = Math.round((R - 10 - 3) * S), m1 = Math.round((R + 10 + 3) * S);
  cv.rectangle(mask, new cv.Point(m0, m0), new cv.Point(m1, m1), new cv.Scalar(0), -1);
  const ck = Math.max(3, Math.round(0.5 * S) | 1);
  const ckernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ck, ck));
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, ckernel);
  ckernel.delete();

  if (debug) { debug('rect', rect); debug('mask', mask); }
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(mask, contours, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
  const cands = [];
  for (let i = 0; i < contours.size(); i++) {
    if (hier.data32S[i * 4 + 3] < 0) continue; // only holes (contours with a parent)
    const c = contours.get(i);
    const area = cv.contourArea(c), per = cv.arcLength(c, true);
    const dEq = 2 * Math.sqrt(area / Math.PI) / S;
    if (dEq >= CONFIG.holeMinMm && dEq <= CONFIG.holeMaxMm && c.rows >= 12) {
      const circ = 4 * Math.PI * area / (per * per);
      const e = cv.fitEllipse(c);
      const ratio = Math.min(e.size.width, e.size.height) / Math.max(e.size.width, e.size.height);
      if (circ > 0.72 && ratio > 0.8) {
        cands.push({
          cx: e.center.x / S + (10 - R), cy: e.center.y / S + (10 - R),
          r: (e.size.width + e.size.height) / 4 / S, circ, ratio,
        });
      }
    }
    c.delete();
  }
  contours.delete(); hier.delete(); rect.delete(); valid.delete(); g.delete(); bg.delete(); mask.delete();
  cands.sort((a, b) => Math.hypot(a.cx - 10, a.cy - 10) - Math.hypot(b.cx - 10, b.cy - 10));
  return cands;
}

// Deterministic PRNG so the same photo always gives the same result.
function lcg(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

function circleFrom3(p, q, r) {
  const ax = p[0], ay = p[1], bx = q[0], by = q[1], cx = r[0], cy = r[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { cx: ux, cy: uy, r: Math.hypot(ax - ux, ay - uy) };
}

// Geometric least-squares circle (Gauss-Newton started from the algebraic fit).
function fitCircle(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= pts.length; my /= pts.length;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const sol = solveLinear([[suu, suv], [suv, svv]], [(suuu + suvv) / 2, (svvv + svuu) / 2]);
  if (!sol) return null;
  let cx = sol[0] + mx, cy = sol[1] + my;
  let r = Math.sqrt(sol[0] * sol[0] + sol[1] * sol[1] + (suu + svv) / pts.length);
  for (let it = 0; it < 12; it++) {
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0;
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1e-9;
      const jx = -dx / d, jy = -dy / d, res = d - r;
      a11 += jx * jx; a12 += jx * jy; a13 += -jx; a22 += jy * jy; a23 += -jy; a33 += 1;
      b1 += -jx * res; b2 += -jy * res; b3 += res;
    }
    const dlt = solveLinear([[a11, a12, a13], [a12, a22, a23], [a13, a23, a33]], [b1, b2, b3]);
    if (!dlt) break;
    cx += dlt[0]; cy += dlt[1]; r += dlt[2];
    if (Math.abs(dlt[0]) + Math.abs(dlt[1]) + Math.abs(dlt[2]) < 1e-7) break;
  }
  return { cx, cy, r };
}

// Largest circle-consensus among edge points. On the rectified paper plane the ring's
// inner edge is a circle; shadows and the ring's own upper rim only pull edge points
// away from it on part of the circumference, so the consensus arc is the measurement.
function ransacCircle(pts, tol, seed) {
  const rnd = lcg(seed), n = pts.length;
  let best = null, bestCount = 0;
  for (let it = 0; it < 400; it++) {
    const i = (rnd() * n) | 0, j = (rnd() * n) | 0, k = (rnd() * n) | 0;
    if (i === j || j === k || i === k) continue;
    const c = circleFrom3(pts[i], pts[j], pts[k]);
    if (!c) continue;
    // Shadows and the ring's upper rim can only make the opening look smaller, so a
    // valid hypothesis may leave edge points inside it but (almost) none outside it.
    let count = 0, outside = 0;
    for (const p of pts) {
      const d = Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r;
      if (Math.abs(d) <= tol) count++; else if (d > 2 * tol) outside++;
    }
    if (outside > 0.08 * n) continue;
    if (count > bestCount) { bestCount = count; best = c; }
  }
  if (!best) return null;
  let c = best, inl = [];
  for (let it = 0; it < 3; it++) {
    inl = pts.filter(p => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) <= tol);
    if (inl.length < 12) return null;
    const f = fitCircle(inl);
    if (!f) return null;
    c = f;
  }
  const gapOf = (list) => {
    const ang = list.map(p => Math.atan2(p[1] - c.cy, p[0] - c.cx)).sort((x, y) => x - y);
    let gap = 0, start = 0;
    for (let i = 0; i < ang.length; i++) {
      const d = i + 1 < ang.length ? ang[i + 1] - ang[i] : ang[0] + 2 * Math.PI - ang[i];
      if (d > gap) { gap = d; start = ang[i]; }
    }
    return { gap, start };
  };
  inl = pts.filter(p => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) <= tol);
  let g = gapOf(inl);
  if (g.gap > 40 * Math.PI / 180) {
    // Edge points next to a hidden stretch are the least trustworthy (the shadow or rim
    // is just starting to pull them inwards): fit without the 20 degrees at each end.
    const trim = 20 * Math.PI / 180;
    const core = inl.filter(p => {
      let a = Math.atan2(p[1] - c.cy, p[0] - c.cx) - g.start;
      a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); // 0 at gap start, gap ends at g.gap
      return a > g.gap + trim && a < 2 * Math.PI - trim;
    });
    if (core.length >= 24) {
      const f = fitCircle(core);
      if (f) {
        c = f;
        inl = pts.filter(p => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) <= tol);
        g = gapOf(inl);
      }
    }
  }
  const res = inl.map(p => Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r);
  const gap = g.gap;
  return { ...c, inliers: inl, rmsMm: Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length), gapDeg: gap * 180 / Math.PI };
}

// Radial edge search on the full-resolution image, sampled through the homography.
function refineInnerBoundary(gray, w, h, Hp2i, cand, pxPerMm) {
  let model = { cx: cand.cx, cy: cand.cy, r: cand.r };
  let out = null;
  const nRays = 240;
  const step = 0.5 / pxPerMm; // half a pixel, in mm
  const tol = Math.max(0.05, 0.6 / pxPerMm);
  for (let pass = 0; pass < 3; pass++) {
    const win = pass === 0 ? Math.min(2.5, 0.35 * cand.r) : 1.5;
    const m = Math.round(2 * win / step) + 1;
    const pts = [];
    for (let k = 0; k < nRays; k++) {
      const th = 2 * Math.PI * k / nRays, ux = Math.cos(th), uy = Math.sin(th);
      const prof = new Float64Array(m);
      let ok = true;
      for (let j = 0; j < m; j++) {
        const rho = model.r - win + j * step;
        const [u, v] = applyH(Hp2i, model.cx + rho * ux, model.cy + rho * uy);
        const val = bilinear(gray, w, h, u, v);
        if (val < 0) { ok = false; break; }
        prof[j] = val;
      }
      if (!ok) continue;
      // smooth twice with [1 2 1] / 4
      for (let s = 0; s < 2; s++) {
        let prev = prof[0];
        for (let j = 1; j < m - 1; j++) { const cur = prof[j]; prof[j] = (prev + 2 * cur + prof[j + 1]) / 4; prev = cur; }
      }
      // gradient going outwards; the inner edge is paper (bright) -> ring (dark): negative
      let gmin = 0;
      const grad = new Float64Array(m);
      for (let j = 1; j < m - 1; j++) { grad[j] = (prof[j + 1] - prof[j - 1]) / 2; if (grad[j] < gmin) gmin = grad[j]; }
      if (gmin > -1.0) continue; // no usable edge on this ray
      // first local minimum (from the inside) that reaches 60% of the sharpest drop:
      // soft shadow edges are skipped in favour of the sharp ring edge
      let jb = -1;
      for (let j = 2; j < m - 2; j++) {
        if (grad[j] <= 0.6 * gmin && grad[j] <= grad[j - 1] && grad[j] <= grad[j + 1]) { jb = j; break; }
      }
      if (jb < 0) continue;
      const den = grad[jb - 1] - 2 * grad[jb] + grad[jb + 1];
      const off = Math.abs(den) > 1e-9 ? 0.5 * (grad[jb - 1] - grad[jb + 1]) / den : 0;
      const rho = model.r - win + (jb + Math.max(-1, Math.min(1, off))) * step;
      pts.push([model.cx + rho * ux, model.cy + rho * uy]);
    }
    if (pts.length < 0.3 * nRays) return { ok: false, inlierFrac: pts.length / nRays };
    const c = ransacCircle(pts, tol, 12345 + pass);
    if (!c) return { ok: false, inlierFrac: 0 };
    model = { cx: c.cx, cy: c.cy, r: c.r };
    out = { ok: true, circle: model, inlierFrac: c.inliers.length / nRays, rmsMm: c.rmsMm, gapDeg: c.gapDeg, edgePoints: pts };
  }
  return out;
}

// Approximate camera pose from the homography, ASSUMING a typical phone main-camera
// focal length (about 0.72 x the long image side, i.e. 24-26 mm equivalent).
// Used only for guidance and the uncertainty estimate, never for the scale itself.
function approxPose(Hp2i, W, H) {
  const f = 0.72 * Math.max(W, H), cx = W / 2, cy = H / 2;
  const col = (i) => [(Hp2i[i] - cx * Hp2i[6 + i]) / f, (Hp2i[3 + i] - cy * Hp2i[6 + i]) / f, Hp2i[6 + i]];
  const a1 = col(0), a2 = col(1), a3 = col(2);
  const n1 = Math.hypot(...a1), n2 = Math.hypot(...a2);
  let lam = 2 / (n1 + n2);
  if (a3[2] * lam < 0) lam = -lam;
  const r1 = a1.map(v => v * lam), r2 = a2.map(v => v * lam), t = a3.map(v => v * lam);
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const n3 = Math.hypot(...r3) || 1;
  const tiltDeg = Math.acos(Math.min(1, Math.abs(r3[2]) / n3)) * 180 / Math.PI;
  // camera centre in plane coordinates: C = -R^T t
  const C = [-(r1[0] * t[0] + r1[1] * t[1] + r1[2] * t[2]), -(r2[0] * t[0] + r2[1] * t[1] + r2[2] * t[2]), -(r3[0] * t[0] + r3[1] * t[1] + r3[2] * t[2]) / n3];
  return { tiltDeg, camXY: [C[0], C[1]], heightMm: Math.abs(C[2]) };
}

// ---------- main entry ----------

/**
 * @param cv   OpenCV.js module (initialised)
 * @param img  { data: Uint8ClampedArray RGBA, width, height }
 * @param opts { select?: number } index of the ring to measure when several were found
 *             { printScale?: number } true size of the printed sheet relative to nominal
 *             (ruler reading of the 100 mm check line / 100). Default 1.
 */
export function measure(cv, img, opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const { data, width: W, height: H } = img;
  const result = { status: 'retake', reasons: [], warnings: [], checks: {}, overlay: {}, timingMs: {} };
  const fail = (code, extra) => {
    result.reasons.push({ code, ...REASONS[code], ...(extra || {}) });
    result.timingMs.total = now() - t0;
    return result;
  };

  // full-resolution grey image for sub-pixel work
  const gray = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;

  // downscaled copy for detection
  const k = Math.min(1, CONFIG.coarseMaxSide / Math.max(W, H));
  const full = new cv.Mat(H, W, cv.CV_8UC4);
  full.data.set(data);
  let coarse = full;
  if (k < 1) {
    coarse = new cv.Mat();
    cv.resize(full, coarse, new cv.Size(Math.round(W * k), Math.round(H * k)), 0, 0, cv.INTER_AREA);
    full.delete();
  }
  const cw = coarse.cols, ch = coarse.rows;
  const kx = cw / W, ky = ch / H;
  const coarseGrayMat = new cv.Mat();
  cv.cvtColor(coarse, coarseGrayMat, cv.COLOR_RGBA2GRAY);
  const coarseGray = new Uint8Array(coarseGrayMat.data); // copy
  result.timingMs.prepare = now() - t0;

  try {
    // 1. scale marker
    const t1 = now();
    const found = findMarkerCoarse(cv, coarseGrayMat, coarseGray, cw, ch);
    if (!found || found.score < CONFIG.markerMinScore) return fail('NO_MARKER');
    const refined = refineMarker(gray, W, H, found.quad.map(p => [p[0] / kx, p[1] / ky]));
    if (!refined) return fail('NO_MARKER');
    const Hp2i = homographyFrom4(PLANE_CORNERS, refined.quad);
    if (!Hp2i || scoreMarker(gray, W, H, Hp2i) < CONFIG.markerMinScore) return fail('NO_MARKER');
    const Hi2p = invert3(Hp2i);
    const geo = localGeometry(Hp2i, 10, 10);
    const pose = approxPose(Hp2i, W, H);
    const blurMm = refined.blurPx / geo.pxPerMm;
    result.overlay.marker = refined.quad;
    result.checks = {
      pxPerMm: geo.pxPerMm, tiltDeg: pose.tiltDeg, foreshorteningDeg: geo.tiltDeg, cameraHeightMm: pose.heightMm,
      blurPx: refined.blurPx, blurMm, markerScore: found.score, markerContrast: refined.contrast,
    };
    result.timingMs.marker = now() - t1;

    if (geo.pxPerMm < CONFIG.minPxPerMm) return fail('LOW_RES');
    if (pose.tiltDeg > CONFIG.tiltRejectDeg || geo.tiltDeg > CONFIG.foreshorteningRejectDeg) return fail('PERSPECTIVE');
    if (blurMm > CONFIG.blurRejectMm) return fail('BLURRY');

    // 2. ring candidates in a rectified, low-resolution view
    const t2 = now();
    // paper reference colour from the white band inside the marker
    let cr = 0, cg = 0, cb = 0, cn = 0;
    for (let a = 0; a < 16; a++) {
      const th = a * Math.PI / 8, [u, v] = applyH(Hp2i, 10 + 4 * Math.cos(th) * 1.05, 10 + 4 * Math.sin(th) * 1.05);
      const x = Math.round(u), y = Math.round(v);
      if (x >= 0 && y >= 0 && x < W && y < H) { const p = (y * W + x) * 4; cr += data[p]; cg += data[p + 1]; cb += data[p + 2]; cn++; }
    }
    const paperRef = { chroma: cn ? (Math.max(cr, cg, cb) - Math.min(cr, cg, cb)) / Math.max(cr, cg, cb, 1) : 0 };
    const Hi2pCoarse = mul3(Hi2p, [1 / kx, 0, 0, 0, 1 / ky, 0, 0, 0, 1]);
    const cands = findHoleCandidates(cv, coarse, Hi2pCoarse, geo.pxPerMm * Math.sqrt(kx * ky), paperRef, opts.debug);
    result.timingMs.detect = now() - t2;
    if (!cands.length) return fail('NO_RING');

    // 3. sub-pixel inner boundary for each candidate
    const t3 = now();
    const measured = cands.map(c => ({ cand: c, fit: refineInnerBoundary(gray, W, H, Hp2i, c, geo.pxPerMm) }));
    result.timingMs.refine = now() - t3;
    const outline = (c) => {
      const pts = [];
      for (let i = 0; i < 120; i++) {
        const t = 2 * Math.PI * i / 120;
        pts.push(applyH(Hp2i, c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t)));
      }
      return pts;
    };

    let chosen = measured[0];
    if (measured.length > 1) {
      if (Number.isInteger(opts.select) && measured[opts.select]) chosen = measured[opts.select];
      else {
        result.status = 'choose';
        result.overlay.candidates = measured.map(m => outline(m.fit && m.fit.ok ? m.fit.circle : m.cand));
        result.message = `${measured.length} rings found. Tap the one to measure, or retake with a single ring.`;
        result.timingMs.total = now() - t0;
        return result;
      }
    }
    const { cand, fit } = chosen;
    if (!fit || !fit.ok) { result.overlay.candidates = [outline(cand)]; return fail('POOR_BOUNDARY'); }
    const c = fit.circle;
    result.overlay.inner = outline(c);
    if (opts.debug) result.overlay.edgePoints = fit.edgePoints.map(p => applyH(Hp2i, p[0], p[1]));
    // diameter line drawn along the direction pointing away from the marker
    const dir = Math.atan2(c.cy - 10, c.cx - 10) + Math.PI / 2;
    result.overlay.diameterLine = [
      applyH(Hp2i, c.cx - c.r * Math.cos(dir), c.cy - c.r * Math.sin(dir)),
      applyH(Hp2i, c.cx + c.r * Math.cos(dir), c.cy + c.r * Math.sin(dir)),
    ];
    const distMm = Math.hypot(c.cx - 10, c.cy - 10);
    const viewAngleDeg = Math.atan2(Math.hypot(pose.camXY[0] - c.cx, pose.camXY[1] - c.cy), pose.heightMm) * 180 / Math.PI;
    Object.assign(result.checks, {
      inlierFrac: fit.inlierFrac, fitRmsMm: fit.rmsMm, arcGapDeg: fit.gapDeg, ringToMarkerMm: distMm, viewAngleDeg,
    });
    if (distMm > CONFIG.ringFarMm) return fail('RING_FAR');
    if (fit.inlierFrac < CONFIG.minInlierFrac || fit.gapDeg > CONFIG.maxArcGapDeg) return fail('NOT_ROUND');
    if (fit.rmsMm > CONFIG.maxFitRmsMm) return fail('POOR_BOUNDARY');

    // 4. estimate + uncertainty model (see README: this is a model, not a guarantee)
    // Plane coordinates assume a 20 mm marker. If the sheet was resized in printing, the
    // ruler reading of its check line gives the true size of everything on it.
    const printScale = Number.isFinite(opts.printScale) && opts.printScale > 0 ? opts.printScale : 1;
    const D = 2 * c.r * printScale;
    result.printScale = printScale;
    const u = {
      resolution: 0.5 / geo.pxPerMm,                         // half a pixel at the photo's scale
      blur: 0.4 * blurMm,                                    // edge softness
      fit: 2 * fit.rmsMm * (1 + (fit.gapDeg / 180) ** 2),    // scatter of the edge, worse if only part of the circle agrees
      scale: D * 2 * refined.lineRmsPx / (CONFIG.markerSideMm * geo.pxPerMm), // marker edge localisation
      printScale: D * CONFIG.printScaleTolerance,            // the photo cannot show whether the sheet was resized in printing
      perspective: D * 0.001 * pose.tiltDeg,                 // residual after rectification
      extrapolation: D * 0.0015 * (distMm / 40),             // scale carried from marker to ring
      ringHeight: D * CONFIG.assumedRingHeightMm / Math.max(pose.heightMm, 50), // upper rim is closer to the lens
    };
    const combined = Math.sqrt(Object.values(u).reduce((s, v) => s + v * v, 0));
    result.diameterMm = D;
    result.uncertaintyMm = Math.max(CONFIG.uncertaintyFloorMm, combined);
    result.uncertaintyTerms = u;
    result.status = 'ok';
    if (pose.tiltDeg > CONFIG.tiltWarnDeg) result.warnings.push('Camera was noticeably tilted. Hold it flat above the sheet for a tighter result.');
    if (blurMm > CONFIG.blurWarnMm) result.warnings.push('Photo is slightly soft. A sharper photo will reduce the uncertainty.');
    if (pose.heightMm < CONFIG.minCameraHeightWarnMm) result.warnings.push('Phone was very close to the ring. From about 30 cm the ring\'s height distorts the result less.');
    if (viewAngleDeg > CONFIG.viewAngleWarnDeg) result.warnings.push('Ring was not directly under the camera. Centre it in the photo to reduce parallax.');
    if (fit.inlierFrac < 0.85) result.warnings.push('Part of the inner edge was hidden by shadow, glare or the ring\'s own rim. The visible part was used.');
    result.timingMs.total = now() - t0;
    return result;
  } finally {
    coarse.delete(); coarseGrayMat.delete();
  }
}
