# Delivery notes — Ring measurement from a photograph

> Items marked **[LAMINE]** must be completed by me from my own measurements and records before submitting.

## Links

- Browser demo: <https://ring-sizer.pages.dev>
- Repository: <https://github.com/trusted89/ring-sizer> (private) **[LAMINE: private access granted to …]**
- Video walkthrough (≤ 3 min): **[LAMINE: URL]**

## What was built

A static, phone-friendly page. The user prints a marker sheet, photographs one ring beside the 20 mm marker, and uploads the photo. The page returns the inner diameter with an uncertainty and an ISO 8653 size, shows the detected boundary and scale reference on the photo, and reports processing time and cost. It refuses to measure, with a specific retake instruction, when the marker is missing, the photo is blurry, too far, too steep, or the inner edge is not a clean circle. If two rings are visible it asks which one.

Design decision: classical computer vision on the device, no AI model at run time. A measurement has to be repeatable and explainable, a marker gives an exact scale, and running on the device makes the variable cost zero and keeps the photo private.

## Test set, expected and actual results

Ground truth is in `test-set/ground-truth.csv`, recorded before testing. The app never receives it.

### Real photographs

The printed sheet used for these photos came out at 84 % of nominal size (check line 84 mm by ruler). The sheet reading is recorded per photo in `ground-truth.csv` (`sheet_line_mm`) and applied the same way the page applies it.

| Photo | Kind | Expected | Actual | True inner Ø (mm) | Estimated Ø (mm) | Absolute error (mm) | Stated uncertainty | Error within uncertainty | Size | Time (ms, Node) | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| real-01-sheet-only-no-ring.jpg | real-photo | retake: NO_RING | retake: NO_RING | - |  |  |  |  |  | 241 | pass |

`real-01` is a phone photo of the sheet alone, on a red cloth, with nothing to measure. Its expected outcome was written down after the first run, not before; it is included because it is the first real photograph the marker detection was run on (pattern match 99.5 %, 11.5 px/mm, edge blur 0.26 mm).

**[LAMINE: ring photos — at least two measured objects. Add rows to ground-truth.csv, run `npm test`, paste the rows here. State the measuring tool and its resolution.]**

### Synthetic renders (labelled synthetic, regression tests only)

| Photo | Kind | Expected | Actual | True inner Ø (mm) | Estimated Ø (mm) | Absolute error (mm) | Stated uncertainty | Error within uncertainty | Size | Time (ms, Node) | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic-01-flat-overhead.jpg | synthetic | measure | ok | 17.30 | 17.29 | 0.01 | ±0.32 | yes | ISO 54 | 162 | pass |
| synthetic-02-ring-h3-tilt4.jpg | synthetic | measure | ok | 18.90 | 18.80 | 0.10 | ±0.37 | yes | ISO 59 | 200 | pass |
| synthetic-03-wide-band-h6-offaxis.jpg | synthetic | measure | ok | 16.50 | 16.45 | 0.05 | ±0.32 | yes | ISO 52 | 151 | pass |
| synthetic-04-cutout-card-uneven-light.jpg | synthetic | measure | ok | 20.00 | 20.01 | 0.01 | ±0.37 | yes | ISO 63 | 166 | pass |
| synthetic-05-ring-glare-soft.jpg | synthetic | measure | ok | 15.70 | 15.53 | 0.17 | ±0.33 | yes | ISO 49 | 122 | pass |
| synthetic-06-two-rings.jpg | synthetic | choose | choose (2 rings) | 16.10 / 19.40 | 16.03 / 19.28 | 0.07 / 0.12 | ±0.31 / ±0.35 | yes / yes | ISO 50 / ISO 61 | 225 | pass |
| synthetic-07-steep-angle.jpg | synthetic | retake: PERSPECTIVE | retake: PERSPECTIVE | - |  |  |  |  |  | 51 | pass |
| synthetic-08-out-of-focus.jpg | synthetic | retake: BLURRY | retake: BLURRY | - |  |  |  |  |  | 53 | pass |
| synthetic-09-no-marker.jpg | synthetic | retake: NO_MARKER | retake: NO_MARKER | - |  |  |  |  |  | 55 | pass |
| synthetic-10-motion-blur.jpg | synthetic | retake: BLURRY | retake: BLURRY | - |  |  |  |  |  | 52 | pass |
| synthetic-11-too-far.jpg | synthetic | retake: LOW_RES | retake: LOW_RES | - |  |  |  |  |  | 84 | pass |

Observed on the synthetic set:

- Flat objects (printed-style ring, cut-out in card): error 0.01 mm in the set and at most 0.02 mm in sweeps from 0° to 10° of tilt.
- Rings with height: error 0.05–0.17 mm in the set. They read slightly low when the upper rim or a shadow hides part of the opening.
- Sweeps outside the set (scripts/dev/sweep.py): a bright inner wall makes a ring read high, +0.07 mm at 3 mm height and +0.29 mm at 8 mm height from 25 cm, which is the largest error seen and close to the stated uncertainty (about ±0.3 mm). A photo with 0.44 mm edge blur (inside the accepted range) read 0.15 mm low.

## What failed or is unfinished

- No real photographs were available while the code was written, so every threshold is tuned on synthetic renders only. Real metal (reflections, bevels, comfort-fit inner profiles) may behave differently. **[LAMINE: update after real photos.]**
- First approach, an ellipse fit to all edge points, read 0.35–0.5 mm low on rings with height and shadow and was replaced by the circle-consensus method.
- A shadow as dark as the ring itself hides the edge on that side. The method then works from the visible part, and asks for a retake if less than half the circle is usable.
- The page cannot detect a sheet that the printer resized (for example an A4 file on US Letter paper with "fit to page"). Every result is then wrong by the same percentage. The ruler check on the sheet is the only guard, and the uncertainty allows 0.5 % for it.
- Not built: lens-distortion correction, estimating ring height to correct parallax, EXIF focal length, live camera guidance, a second marker for a better perspective estimate.
- The engine download is 3.7 MB over the network (13.3 MB uncompressed, measured on the live site), which is still heavy for mobile data.

## Time and cost

- **Variable cost per operation: $0.00.** No recognition, reasoning, speech, retries or paid intermediaries at run time. A retake also costs nothing.
- **Time to a useful result (measured):**
  - Node on the build machine, 3200 × 2400 px: 160–280 ms per accepted photo, 50–100 ms per rejected photo (see results table).
  - Headless desktop Chrome, same photos: about 0.4–0.5 s including decoding. Engine start-up 0.8 s from a local server, one-off.
  - Phone: **[LAMINE: read the "Processing time" box on my phone for 3 photos; note phone model and first-load time on Wi-Fi/4G.]**
- **Hosting (separate from variable cost):** Cloudflare Pages, free plan. Pricing assumption: requests to static assets are free and unlimited on free and paid plans (Cloudflare docs, "Pages Functions — Pricing", checked 15 Nov 2026). Free-plan limits that apply: 500 deployments a month, 25 MiB per file. Domain: none needed.
- **Build-time AI cost** is not a per-operation cost: **[LAMINE: subscription used.]**

## AI tools and models

- Claude (Anthropic) in the Claude app, model Claude Fable 5.2: wrote the code, synthetic renderer, tests and documentation under my direction.
- **[LAMINE: list anything else actually used, with exact model names, e.g. a second reviewer.]**
- No AI model runs inside the product.

Examples of checking AI output:

1. The generated marker PDF was rendered at 600 dpi and measured in pixels (`scripts/dev/sheet-check.mjs`): the marker came out 20.02 × 19.98 mm. The same check showed the 100 mm print-check line was 100.3 mm from outer edge to outer edge, because its end marks were 0.3 mm thick and centred on the ends. The sheet was corrected (now 99.99 mm, with the measuring edges and a 99.5–100.5 mm tolerance stated on it). Rings drawn on the rasterised sheet at 15.00, 18.00 and 21.50 mm then measured 14.98, 17.98 and 21.47 mm.
2. The first measurement code was run against renders with known diameters. It failed 5 of 11 cases, which exposed a wrong shadow model in the renderer and the ellipse-fit bias; both were fixed and the cases re-run.
3. **[LAMINE: my own check, e.g. ruler on the printed marker, caliper against the app on a real ring.]**

## Time spent

**[LAMINE: actual focused hours, split build / test photos / video.]**

## Product judgment

- Printers resize pages silently, and the page cannot detect that from a photo. A reprint at 100 % is the intended fix. As a fallback the user can enter the ruler reading of the sheet's check line once; results are scaled by it and labelled as adjusted. It describes the sheet, not the ring or the photo, and is off by default. The test results in this document use no adjustment.
- Scope kept to one job: a trustworthy diameter or a clear retake. No shopping flow.
- The result shows a size *range* when the uncertainty crosses a size boundary, because ±0.3 mm is about one ISO size.
- The close-up with the detected edge lets the user verify the measurement by eye.
- Next: validate on 20–30 real rings against calipers and set the uncertainty from that data; add live camera guidance (angle, distance, sharpness) before capture; ask one spoken or tapped question about band width to correct parallax; replace the 3.7 MB engine download with a small purpose-built module.
