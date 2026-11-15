# Ring Sizer

A phone-friendly web page that estimates a ring's **inner diameter** from one photograph. The ring lies flat beside a printed 20 mm square marker. The user uploads the photo and never types a diameter or calibrates by hand. The page shows the detected inner boundary, the scale reference, the diameter in millimetres with an uncertainty, and the ring size, or it asks for a retake and says why.

Live demo: <https://ring-sizer.pages.dev>

## Run it

```bash
npm install          # OpenCV.js, sharp (tests only)
npm run vendor       # copies OpenCV.js into public/vendor (already committed)
npx serve public     # or: npm run dev  (Cloudflare Pages, via wrangler)
npm test             # runs the measurement code over test-set/ and writes test-set/results.md
```

There is no build step and no backend. `public/` is the whole site.

Optional, only to regenerate assets (Python 3 with `reportlab`, `numpy`, `opencv-python`):

```bash
npm run sheet        # printable marker sheet PDFs
npm run synth        # synthetic test photos
```

## How it measures

1. **Scale marker.** Contours in a downscaled copy are tested against the marker's pattern (20 mm black square, 12 mm white square, 4 mm black centre). The four outer edges are then located on the full-resolution image to sub-pixel precision, and a homography maps photo pixels to millimetres on the paper.
2. **Checks before measuring.** Resolution (at least 5 px/mm), edge blur on the marker (10–90 % rise width, worst of the four sides so motion blur in one direction is caught), and camera angle (from the homography) must pass.
3. **Ring candidates.** The photo is flattened to a straight-down view. Anything darker or more coloured than the paper becomes a mask; enclosed, roughly circular openings of 8–40 mm are ring candidates. Two or more candidates trigger a "which ring?" confirmation instead of a guess.
4. **Inner boundary.** 240 rays from the centre of the opening find the sharp paper-to-ring edge on the full-resolution image. The largest set of edge points that agree on **one circle** is the inner boundary (RANSAC with a one-sided rule: shadows and the ring's upper rim can only make the opening look smaller, so a valid circle may have edge points inside it but almost none outside).
5. **Result.** Diameter = that circle's diameter in millimetres, plus an uncertainty and the size from the table below.

### Supported conditions and retake rules

| Check | Limit | Outcome when not met |
|---|---|---|
| Sheet printed at 100 % (check line 99.5–100.5 mm) | checked by the user with a ruler | Not detectable from the photo: a resized sheet shifts every result by the same percentage. Reprint, or enter the ruler reading of the check line once (see "Resized sheets") |
| Marker found (pattern match ≥ 72 %) | required | Retake: no scale marker |
| Photo scale | ≥ 5 px/mm | Retake: marker too small |
| Edge blur on marker | ≤ 0.65 mm (warn above 0.40) | Retake: too blurry |
| Camera angle from overhead | ≤ 10° (warn above 6°) | Retake: too steep |
| Camera distance (estimated from the marker) | ≥ 15 cm (warn below 20) | Retake: too close |
| A ring-like opening near the marker | within 75 mm | Retake: no ring / too far |
| Edge agreeing with one circle | ≥ 50 % of circumference, or ≥ 30 % when no stretch over 120° lacks agreeing points; never a hidden stretch over 200° | Retake: not a clean circle |
| Scatter of the agreeing edge | ≤ 0.12 mm RMS | Retake: edge not clear |
| More than one candidate | — | Ask which ring |

All limits live in `CONFIG` at the top of `public/measure.js`.

### Resized sheets

Printers often resize a page without saying so. The sheet therefore carries a 100 mm check line. If it does not measure 99.5–100.5 mm, the best fix is a reprint at 100 %. When that is not possible, the page accepts the ruler reading of the check line (70–130 mm), stores it in the browser, and multiplies every result by reading ÷ 100. The result then says that it was adjusted.

This is a property of the printed sheet, entered once. It is not a ring diameter and not a calibration of the photo: scale in the image still comes only from the detected marker. It is optional and off by default. `scripts/dev/sheet-check.mjs` checks the sheet geometry and this adjustment.

### Uncertainty

The ± value is a model, combined in quadrature and never reported below ±0.20 mm:

- half a pixel at the photo's scale
- 0.4 × marker edge blur
- 2 × scatter of the inner edge (more when part of the circle is hidden)
- marker edge localisation
- print scale of the sheet: 0.5 % of diameter (what a ruler check of the 100 mm line can confirm)
- residual perspective: 0.1 % of diameter per degree of tilt
- marker-to-ring distance: 0.15 % of diameter per 40 mm
- **ring height**: diameter × 4 mm ÷ camera height. The ring's upper rim is closer to the lens than the paper, so it appears larger and can hide part of the opening. 4 mm is an assumed band height. Camera height is estimated assuming a typical phone main-camera lens (focal length ≈ 0.72 × the long image side).

The coefficients were set from synthetic sweeps, not from a calibration study. See "Limitations".

### Sizing table

- **Table:** ISO 8653:2016, *Jewellery — Ring-sizes — Definition, measurement and designation*. Ring size = inner circumference in millimetres. <https://www.iso.org/standard/62783.html>
- **Rounding rule:** size = π × inner diameter, rounded to the nearest whole millimetre, halves up (the standard designates the circumference "rounded to the nearest millimetre"). If the uncertainty spans several sizes, the range is shown.
- **US/Canada (secondary):** diameter = 11.63 mm + 0.8128 mm × size, nearest half size. Source: <https://en.wikipedia.org/wiki/Ring_size>.
- Covered range: ISO 41–76. Outside it only the diameter is shown. Code: `public/sizing.js`.

## Test set

- `test-set/ground-truth.csv` holds the expected outcome and true diameter of every test photo. It is written before testing and read only by `scripts/run-tests.mjs`, after measuring, to compute the error. Nothing in the app accepts a diameter.
- `test-set/synthetic/` are **synthetic renders** (pinhole camera, rings with real height, cast shadow, blur, noise, JPEG), generated by `scripts/synth.py`. They are regression tests, not evidence of real-world accuracy.
- `test-set/photos/` holds nine real phone photographs: four objects measured with a ruler (a 25 mm key ring, a 13 mm hoop, a 22 mm thin band, a signet ring with a stone), a coin of published diameter, and the sheet alone. Two give a reading; seven are retakes (too close, off-centre, unclear edge, unsupported ring, solid coin, no ring).
- `scripts/dev/disc-check.mjs` checks the scale on its own against a solid disc of known diameter, such as a coin. It is not the product flow. See `DELIVERY_NOTES.md`.
- If a test photo was taken on a resized sheet, the ruler reading of that sheet's check line goes in the optional `sheet_line_mm` column, and the test passes it to the measurement exactly as the page does.
- `test-set/results.md` is generated by `npm test` and reports the absolute diameter error for every photo.

## Time and cost per image

- **Variable cost per image: $0.** Everything runs in the browser. There is no recognition API, model inference, speech, retry or paid intermediary.
- **Processing time** is measured and shown with every result (decode + measurement). Reference numbers are in `DELIVERY_NOTES.md`.
- **Hosting (separate):** static files on Cloudflare Pages. Pricing assumption: on both free and paid plans, requests to static assets are free and unlimited (<https://developers.cloudflare.com/pages/functions/pricing/>, checked 15 Nov 2026). The one-off engine download is 3.7 MB over the network (Brotli; 13.3 MB uncompressed), measured on the live site.

## Reused components and own work

| Reused | Use |
|---|---|
| OpenCV.js 5.0.0 via `@techstark/opencv-js` (Apache-2.0) | resize, threshold, contours, polygon approximation, perspective warp, morphology, ellipse fit for candidate screening |
| `sharp` (tests only) | decode test photos in Node |
| `reportlab`, `numpy`, `opencv-python` (asset scripts only) | marker sheet PDF, synthetic photos |

Own work: marker design and detection logic, sub-pixel edge refinement, blur and angle checks, ring candidate search, radial edge search, one-sided circle consensus, uncertainty model, sizing module, interface, capture sheet, synthetic renderer, test harness.

## Limitations

- Accuracy is only known for the photos in `test-set/results.md`.
- One real object (a 2.5 mm thick hoop) has ground truth that was corrected after testing, from about 12.5 mm to 13.0 mm. The app read 13.05 mm. Against the first reading the error would be 0.55 mm, outside the ±0.39 mm stated.
- A ring is a 3-D object measured from a 2-D photo. Wide bands (over about 5 mm), shot from close up, can read high by more than the stated uncertainty when the inner wall is bright, because the upper rim is detected instead of the edge on the paper.
- Hard shadows or glare that hide more than half of the inner edge cause a retake.
- Rings with stones or settings that stop them lying flat, bent rings, and coloured or patterned backgrounds are not supported.
- The page trusts the printed marker to be 20 mm. A sheet resized by the printer (for example an A4 file on US Letter paper with "fit to page") gives results that are wrong by the same percentage, with no warning. The ruler check on the sheet is the only guard.
- Lens distortion is not corrected. Ultra-wide lenses are not supported.
- The camera-angle and camera-height estimates assume a typical phone main camera.
- The engine is a 3.7 MB download on first use (13.3 MB uncompressed), then cached by the browser.

## Layout

```
public/            the site: index.html, app.js (interface), measure.js (pipeline), sizing.js, sheet/, samples/, vendor/
scripts/           make_sheet.py, synth.py, run-tests.mjs, dev/ (debugging aids)
test-set/          ground-truth.csv, synthetic/, photos/, results.md
wrangler.jsonc     Cloudflare Pages config (deploy steps: DEPLOY.md)
```
