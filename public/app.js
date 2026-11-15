// Interface for the ring measurement prototype. All measurement logic lives in measure.js.
import { measure, CONFIG } from './measure.js';
import { sizeFor, tableRows, TABLE } from './sizing.js';

const MAX_SIDE = 4096; // photos larger than this are downscaled before measuring
const $ = (s) => document.querySelector(s);
const out = $('#result'), engineMsg = $('#engine'), fileInput = $('#file'), pick = $('#pick');
const fmt = (v, d = 1) => v.toFixed(d);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- engine ----------
const engineT0 = performance.now();
const cvReady = new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'vendor/opencv.js';
  s.async = true;
  s.onload = async () => {
    try {
      let cv = window.cv;
      if (cv && typeof cv.then === 'function') cv = await cv;
      if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
      resolve(cv);
    } catch (e) { reject(e); }
  };
  s.onerror = () => reject(new Error('Could not load the measurement engine.'));
  document.head.appendChild(s);
});
cvReady.then(
  () => { engineMsg.textContent = `Measurement engine ready (loaded in ${fmt((performance.now() - engineT0) / 1000)} s, one-off).`; },
  (e) => { engineMsg.textContent = `${e.message} Check your connection and reload the page.`; engineMsg.classList.add('fail'); },
);

// ---------- paper size ----------
// Put the sheet for the visitor's likely paper size first. Both stay available.
try {
  const region = new Intl.Locale(navigator.language).maximize().region;
  if (['US', 'CA', 'MX', 'PH'].includes(region)) {
    const row = $('#sheets');
    row.prepend(row.querySelector('[data-paper="letter"]'), ' ');
  }
} catch { /* keep the default order */ }

// ---------- print scale of the sheet ----------
// Optional, one-off: the ruler reading of the sheet's 100 mm check line. It describes the
// printed sheet, not the photo or the ring, and is only needed when the sheet was resized.
const lineInput = $('#lineMm'), lineMsg = $('#lineMsg');
let printScale = 1;
function setLine(v, save) {
  const n = parseFloat(v);
  if (v === '' || !Number.isFinite(n)) { printScale = 1; lineMsg.textContent = ''; lineMsg.className = 'fine'; }
  else if (n < 90 || n > 110) { printScale = 1; lineMsg.textContent = 'Enter a length between 90 and 110 mm. Outside that the sheet must be reprinted.'; lineMsg.className = 'fine fail'; }
  else {
    printScale = n / 100;
    const pct = Math.abs(n - 100);
    lineMsg.textContent = pct < 0.05 ? 'Sheet is at 100%. No adjustment.' : `Sheet is ${fmt(pct)}% too ${n > 100 ? 'large' : 'small'}. Results are adjusted for it.`;
    lineMsg.className = pct < 0.05 ? 'fine' : 'fine adjusted';
  }
  if (save) { try { printScale === 1 ? localStorage.removeItem('ringSizer.lineMm') : localStorage.setItem('ringSizer.lineMm', String(n)); } catch { /* storage unavailable */ } }
}
lineInput.addEventListener('input', () => setLine(lineInput.value.trim(), true));
try {
  const saved = localStorage.getItem('ringSizer.lineMm');
  if (saved) { lineInput.value = saved; setLine(saved, false); if (printScale !== 1) $('#printFix').open = true; }
} catch { /* storage unavailable */ }

// ---------- sizing table ----------
const tbody = $('#sizeTable tbody');
tbody.innerHTML = tableRows().map((r) =>
  `<tr data-iso="${r.iso}"><td>${r.iso}</td><td>${fmt(r.diameterMm, 2)}</td><td>${fmt(r.lowMm, 2)} – ${fmt(r.highMm, 2)}</td><td>${r.us}</td></tr>`).join('');

// ---------- input ----------
let current = null; // { canvas, imageData, decodeMs, name }

fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f) handleBlob(f, f.name); fileInput.value = ''; });
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', async () => {
  showBusy('Fetching sample photo…');
  try {
    const res = await fetch(b.dataset.sample);
    if (!res.ok) throw new Error('Sample photo could not be loaded.');
    handleBlob(await res.blob(), `${b.textContent.trim()} (synthetic sample)`);
  } catch (e) { showError(e.message); }
}));

async function decode(blob) {
  let src;
  try { src = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('This file is not a photo the browser can read. Use a JPEG or PNG.'));
      img.src = URL.createObjectURL(blob);
    });
  }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  return { canvas, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

async function handleBlob(blob, name) {
  showBusy('Measuring…');
  try {
    const t0 = performance.now();
    const { canvas, imageData } = await decode(blob);
    current = { canvas, imageData, decodeMs: performance.now() - t0, name };
    await run();
  } catch (e) { showError(e.message || String(e)); }
}

async function run(select) {
  const cv = await cvReady;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let the spinner paint
  const t0 = performance.now();
  const res = measure(cv, current.imageData, { select, printScale });
  current.measureMs = performance.now() - t0;
  render(res);
}

// ---------- output ----------
// The result takes the place of the instructions, so it is visible without scrolling.
const BAR = `<div class="res-bar"><label class="btn primary" for="file">Measure another</label><button class="btn ghost" type="button" data-back>Instructions &amp; samples</button></div>`;
function showResult(html) {
  out.innerHTML = html;
  out.hidden = false;
  document.body.classList.add('has-result');
  window.scrollTo(0, 0);
}
function showStart() {
  document.body.classList.remove('has-result');
  out.hidden = true;
  out.innerHTML = '';
  window.scrollTo(0, 0);
}
out.addEventListener('click', (ev) => { if (ev.target.closest('[data-back]')) showStart(); });
function showBusy(msg) {
  showResult(`<div class="busy"><div class="spin"></div><p style="margin:0">${esc(msg)}</p></div>`);
}
function showError(msg) {
  showResult(`${BAR}<div class="verdict retake"><div class="ico">!</div><div><h3>Something went wrong</h3><p>${esc(msg)}</p></div></div>`);
}

function drawOverlay(canvas, res, view) {
  // view: {x, y, w, h} region of the source photo shown on this canvas
  const src = current.canvas, ctx = canvas.getContext('2d');
  const s = canvas.width / view.w;
  ctx.drawImage(src, view.x, view.y, view.w, view.h, 0, 0, canvas.width, canvas.height);
  const P = (p) => [(p[0] - view.x) * s, (p[1] - view.y) * s];
  const path = (pts, close = true) => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (close) ctx.closePath(); };
  const lw = Math.max(2, canvas.width / 320);
  const label = (text, p, color) => {
    const [x, y] = P(p);
    ctx.font = `600 ${Math.max(13, canvas.width / 42)}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 10, h = Math.max(13, canvas.width / 42) + 8;
    const bx = Math.min(Math.max(2, x - w / 2), canvas.width - w - 2), by = Math.min(Math.max(2, y), canvas.height - h - 2);
    ctx.fillStyle = color; ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 5, by + h / 2 + 1);
  };
  const o = res.overlay;
  if (o.marker) {
    path(o.marker); ctx.lineWidth = lw; ctx.strokeStyle = '#00b386'; ctx.stroke();
    if (!view.close) { const low = o.marker.reduce((a, b) => (b[1] > a[1] ? b : a)); const cx = o.marker.reduce((s2, p) => s2 + p[0], 0) / 4; label('20 mm scale', [cx, low[1] + 6 / s], '#007a5c'); }
  }
  if (o.inner) {
    path(o.inner); ctx.lineWidth = view.close ? Math.max(1.5, lw * 0.6) : lw; ctx.strokeStyle = '#e6007a'; ctx.stroke();
    if (o.diameterLine) {
      path(o.diameterLine, false); ctx.setLineDash([lw * 3, lw * 2]); ctx.lineWidth = Math.max(1.5, lw * 0.6); ctx.stroke(); ctx.setLineDash([]);
      if (!view.close) { const top = o.inner.reduce((a, b) => (b[1] < a[1] ? b : a)); label(`${fmt(res.diameterMm, 2)} mm`, [top[0], top[1] - (Math.max(13, canvas.width / 42) + 14) / s], '#b3005f'); }
    }
  }
  (o.candidates || []).forEach((c, i) => {
    path(c); ctx.lineWidth = lw; ctx.strokeStyle = '#e08a00'; ctx.stroke();
    const cx = c.reduce((a, p) => a + p[0], 0) / c.length, cy = c.reduce((a, p) => a + p[1], 0) / c.length;
    if (res.status === 'choose') label(`Ring ${i + 1}`, [cx, cy - 10 / s], '#8a5a00');
  });
}

function viewsHtml(res) {
  const hasInner = !!res.overlay.inner;
  return `<div class="views">
    <figure><canvas id="ovMain"></canvas><figcaption>Your photo with what was detected</figcaption></figure>
    ${hasInner ? '<figure><canvas id="ovClose"></canvas><figcaption>Close-up: the pink line should sit on the ring\'s inner edge</figcaption></figure>' : ''}
  </div>
  <p class="legend"><span><i style="background:#00b386"></i>scale reference (20 mm marker)</span>${hasInner ? '<span><i style="background:#e6007a"></i>detected inner boundary and diameter</span>' : ''}${res.overlay.candidates ? '<span><i style="background:#e08a00"></i>ring candidates</span>' : ''}</p>`;
}

function paintViews(res) {
  const W = current.canvas.width, H = current.canvas.height;
  const main = $('#ovMain');
  if (main) {
    main.width = Math.min(1400, W); main.height = Math.round(main.width * H / W);
    drawOverlay(main, res, { x: 0, y: 0, w: W, h: H });
    if (res.status === 'choose') {
      main.style.cursor = 'pointer';
      main.addEventListener('click', (ev) => {
        const r = main.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width * W, y = (ev.clientY - r.top) / r.height * H;
        let best = 0, bd = Infinity;
        res.overlay.candidates.forEach((c, i) => {
          const cx = c.reduce((a, p) => a + p[0], 0) / c.length, cy = c.reduce((a, p) => a + p[1], 0) / c.length;
          const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = i; }
        });
        choose(best);
      });
    }
  }
  const close = $('#ovClose');
  if (close && res.overlay.inner) {
    const xs = res.overlay.inner.map((p) => p[0]), ys = res.overlay.inner.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const side = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.7;
    close.width = close.height = 720;
    drawOverlay(close, res, { x: cx - side / 2, y: cy - side / 2, w: side, h: side, close: true });
  }
}

function choose(i) { showBusy(`Measuring ring ${i + 1}…`); run(i); }

function checksHtml(res) {
  const c = res.checks, rows = [];
  const row = (name, value, state) => rows.push(`<tr><td>${name}</td><td>${value}</td><td class="${state}">${state === 'pass' ? 'OK' : state === 'warn' ? 'Marginal' : 'Failed'}</td></tr>`);
  if (c.markerScore === undefined) { row('Scale marker (20 mm)', 'not found', 'fail'); }
  else {
    row('Scale marker (20 mm)', `match ${fmt(c.markerScore * 100, 0)}%`, 'pass');
    row(`Photo scale (min ${CONFIG.minPxPerMm} px/mm)`, `${fmt(c.pxPerMm)} px/mm`, c.pxPerMm >= CONFIG.minPxPerMm ? 'pass' : 'fail');
    row(`Sharpness: edge blur (max ${CONFIG.blurRejectMm} mm)`, `${fmt(c.blurMm, 2)} mm`, c.blurMm > CONFIG.blurRejectMm ? 'fail' : c.blurMm > CONFIG.blurWarnMm ? 'warn' : 'pass');
    const steep = c.tiltDeg > CONFIG.tiltRejectDeg || c.foreshorteningDeg > CONFIG.foreshorteningRejectDeg;
    row(`Camera angle from overhead (max ${CONFIG.tiltRejectDeg}°)`, `≈ ${fmt(Math.max(c.tiltDeg, steep ? c.foreshorteningDeg : 0), 0)}°`, steep ? 'fail' : c.tiltDeg > CONFIG.tiltWarnDeg ? 'warn' : 'pass');
  }
  if (c.inlierFrac !== undefined) {
    const bad = c.inlierFrac < CONFIG.minInlierFrac || c.arcGapDeg > CONFIG.maxArcGapDeg;
    row(`Inner edge agreeing with one circle (min ${CONFIG.minInlierFrac * 100}%)`, `${fmt(c.inlierFrac * 100, 0)}%`, bad ? 'fail' : c.inlierFrac < 0.85 ? 'warn' : 'pass');
    row(`Ring to marker distance (max ${CONFIG.ringFarMm} mm)`, `${fmt(c.ringToMarkerMm, 0)} mm`, c.ringToMarkerMm > CONFIG.ringFarMm ? 'fail' : 'pass');
  }
  const flagged = rows.filter((r) => !r.includes('class="pass"')).length;
  const summary = flagged ? `Photo checks: ${flagged} of ${rows.length} need attention` : `Photo checks: all ${rows.length} passed`;
  return `<details class="checks-d"${flagged ? ' open' : ''}><summary>${summary}</summary><table class="checks"><tbody>${rows.join('')}</tbody></table></details>`;
}

function meterHtml() {
  const total = current.decodeMs + current.measureMs;
  return `<div class="meter">
    <div><div class="k">Processing time</div><div class="v">${fmt(total / 1000, 2)} s</div><div class="d">read photo ${fmt(current.decodeMs, 0)} ms + measure ${fmt(current.measureMs, 0)} ms, on this device</div></div>
    <div><div class="k">Cost for this image</div><div class="v">$0.00</div><div class="d">variable cost: runs on your device, no paid API or upload. Hosting is separate.</div></div>
  </div>`;
}

function render(res) {
  document.querySelectorAll('#sizeTable tr.hit').forEach((r) => r.classList.remove('hit'));
  let html = BAR;
  if (res.status === 'ok') {
    const u = res.uncertaintyMm;
    const sz = sizeFor(res.diameterMm, res.uncertaintyMm);
    const isoRange = sz.iso.low === sz.iso.high ? 'uncertainty stays within this size' : `likely range ${sz.iso.low}–${sz.iso.high}`;
    const usRange = sz.us.low === sz.us.high ? 'uncertainty stays within this size' : `likely range ${sz.us.low}–${sz.us.high}`;
    html += `<div class="verdict ok"><div class="ico">✓</div><div><h3>Inner diameter</h3>
      <p class="big">${fmt(res.diameterMm, 2)} mm <small>± ${fmt(u, 2)} mm</small></p>
      <p class="fine${res.printScale !== 1 ? ' adjusted' : ''}">${res.printScale !== 1 ? `Adjusted for your sheet: check line ${fmt(res.printScale * 100)} mm instead of 100.` : 'Estimated uncertainty. Assumes the check line on the sheet measured 100 mm.'}</p></div></div>`;
    html += sz.inRange
      ? `<div class="sizes"><div class="size"><div class="k">ISO 8653 size</div><div class="v">${sz.iso.label}</div><div class="r">${isoRange}</div></div>
         <div class="size"><div class="k">US / Canada ≈</div><div class="v">${sz.us.label}</div><div class="r">${usRange}</div></div></div>`
      : `<p class="notes" style="padding-left:12px">This diameter is outside the sizing table (${TABLE.name}, sizes ${TABLE.isoMin}–${TABLE.isoMax}), so no ring size is given.</p>`;
    html += viewsHtml(res);
    if (res.warnings.length) html += `<ul class="notes">${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
    const row = document.querySelector(`#sizeTable tr[data-iso="${sz.iso.size}"]`);
    if (row && sz.inRange) row.classList.add('hit');
  } else if (res.status === 'choose') {
    html += `<div class="verdict choose"><div class="ico">?</div><div><h3>Which ring should be measured?</h3><p>${esc(res.message)}</p></div></div>`;
    html += viewsHtml(res);
    html += `<p class="btn-row" style="margin-bottom:14px">${res.overlay.candidates.map((_, i) => `<button class="btn ghost small" data-choose="${i}">Measure ring ${i + 1}</button>`).join('')}</p>`;
  } else {
    const r = res.reasons[0];
    html += `<div class="verdict retake"><div class="ico">↻</div><div><h3>Retake needed: ${esc(r.title)}</h3><p>${esc(r.fix)}</p></div></div>`;
    html += `<p class="fine">No diameter is shown because the photo does not meet the conditions needed for a trustworthy measurement.</p>`;
    if (res.overlay.marker || res.overlay.candidates) html += viewsHtml(res);
  }
  html += checksHtml(res) + meterHtml();
  html += `<p class="fine" style="margin-top:10px">Photo: ${esc(current.name)} · ${current.canvas.width} × ${current.canvas.height} px</p>`;
  showResult(html);
  paintViews(res);
  out.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', () => choose(+b.dataset.choose)));
  out.focus({ preventScroll: true });
  window.__lastResult = res; // for debugging and automated checks
}
