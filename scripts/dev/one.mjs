// Developer aid: print the estimate for each photo given on the command line.
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { measure } from '../../public/measure.js';
const require = createRequire(import.meta.url);
let cv = require('@techstark/opencv-js'); if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise(r => { cv.onRuntimeInitialized = r; });
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = measure(cv, { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height });
  const c = r.checks;
  console.log(f.split('/').pop().padEnd(40), r.status, r.status === 'ok' ? `D=${r.diameterMm.toFixed(3)} ±${r.uncertaintyMm.toFixed(2)} inl=${c.inlierFrac.toFixed(2)} gap=${c.arcGapDeg.toFixed(0)} tilt=${c.tiltDeg.toFixed(1)} Z=${c.cameraHeightMm.toFixed(0)} blur=${c.blurMm.toFixed(2)}` : r.reasons.map(x => x.code).join('+') + ` tilt=${(c.tiltDeg ?? 0).toFixed(1)} blur=${(c.blurMm ?? 0).toFixed(2)}`);
}
