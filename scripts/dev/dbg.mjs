// Developer aid: dumps the rectified view and object mask for one photo to /tmp.
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { measure } from '../../public/measure.js';
const require = createRequire(import.meta.url);
let cv = require('@techstark/opencv-js'); if (cv instanceof Promise) cv = await cv; else if (!cv.Mat) await new Promise(r => { cv.onRuntimeInitialized = r; });
const f = process.argv[2];
const { data, info } = await sharp(f).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const jobs = [];
const debug = (name, m) => jobs.push(sharp(Buffer.from(m.data), { raw: { width: m.cols, height: m.rows, channels: m.channels() } }).png().toFile(`/tmp/dbg-${name}.png`));
const res = measure(cv, { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }, { debug, select: process.argv[3] ? +process.argv[3] : undefined });
await Promise.all(jobs);
console.log(res.status, res.reasons.map(r => r.code), JSON.stringify(res.checks));
import fs from 'node:fs';
fs.writeFileSync('/tmp/dbg-overlay.json', JSON.stringify(res.overlay));
