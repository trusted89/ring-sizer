// Independent check of the printable sheets: rasterise the PDFs, measure the print-check
// line and the marker in pixels, then draw a ring of known size on the rasterised sheet
// and run it through the same measure() the browser uses.
// Usage: pdftoppm -r 600 -gray -png public/sheet/ring-sheet-a4.pdf OUT/a4-600   (and -r 300 colour as a4-300)
//        node scripts/dev/sheet-check.mjs OUT
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { measure } from '../../public/measure.js';

const require = createRequire(import.meta.url);
let cv = require('@techstark/opencv-js');
if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });

const dir = process.argv[2];
const PAGES = { a4: [210, 297], letter: [215.9, 279.4] };
for (const [name, [pw, ph]] of Object.entries(PAGES)) {
  // 1. geometry at 600 dpi
  const { data, info } = await sharp(path.join(dir, `${name}-600-1.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const pxmm = 600 / 25.4, W = info.width, H = info.height;
  const run = (yMm, x0Mm, x1Mm, thr = 128) => { // longest dark run on a row, in mm
    const y = Math.round(yMm * pxmm); let best = 0, cur = 0;
    for (let x = Math.round(x0Mm * pxmm); x < Math.round(x1Mm * pxmm); x++) { if (data[y * W + x] < thr) { cur++; best = Math.max(best, cur); } else cur = 0; }
    return best / pxmm;
  };
  const runV = (xMm, y0Mm, y1Mm) => {
    const x = Math.round(xMm * pxmm); let best = 0, cur = 0;
    for (let y = Math.round(y0Mm * pxmm); y < Math.round(y1Mm * pxmm); y++) { if (data[y * W + x] < 128) { cur++; best = Math.max(best, cur); } else cur = 0; }
    return best / pxmm;
  };
  const left = (pw - 100) / 2;
  console.log(`${name}: page ${(W / pxmm).toFixed(1)} x ${(H / pxmm).toFixed(1)} mm (expected ${pw} x ${ph})`);
  console.log(`  print-check line: ${run(135, left - 5, left + 105).toFixed(2)} mm (expected 100.00)`);
  console.log(`  marker outer: ${run(64, left, left + 40).toFixed(2)} wide x ${runV(left + 12, 55, 90).toFixed(2)} tall mm (expected 20.00 x 20.00)`);
  console.log(`  marker centre square: ${run(72, left + 16, left + 24).toFixed(2)} mm (expected 4.00)`);

  // 2. end to end: rings of known inner diameter drawn on the rasterised sheet
  const s = 300 / 25.4, cx = (left + 66) * s, cy = 72 * s;
  for (const d of [15.0, 18.0, 21.5]) {
    const band = 2.2, r = (d / 2 + band / 2) * s;
    const meta = await sharp(path.join(dir, `${name}-300-1.png`)).metadata();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#555" stroke-width="${band * s}"/></svg>`;
    const out = await sharp(path.join(dir, `${name}-300-1.png`)).composite([{ input: Buffer.from(svg) }]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const res = measure(cv, { data: new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length), width: out.info.width, height: out.info.height });
    console.log(`  ring drawn at ${d.toFixed(2)} mm -> ${res.status === 'ok' ? `${res.diameterMm.toFixed(2)} mm ± ${res.uncertaintyMm.toFixed(2)}` : res.status + ' ' + (res.reasons || []).map((x) => x.code).join(',')}`);
    // Same image read as a sheet that was printed 1.7% too large: the real ring is 1.7% larger too.
    const img = { data: new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length), width: out.info.width, height: out.info.height };
    const adj = measure(cv, img, { printScale: 1.017 });
    console.log(`    as a sheet printed at 101.7%: true ${(d * 1.017).toFixed(2)} mm -> ${adj.status === 'ok' ? adj.diameterMm.toFixed(2) + ' mm' : adj.status}`);
  }
}
