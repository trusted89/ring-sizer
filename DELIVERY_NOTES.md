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

**[LAMINE: at least two independently measured objects plus one unsupported photo. Add rows to ground-truth.csv, run `npm test`, paste the rows from test-set/results.md here. State the measuring tool and its resolution.]**

### Synthetic renders (labelled synthetic, regression tests only)

| Photo | Kind | Expected | Actual | True inner Ø (mm) | Estimated Ø (mm) | Absolute error (mm) | Stated uncertainty | Error within uncertainty | Size | Time (ms, Node) | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic-01-flat-overhead.jpg | synthetic | measure | ok | 17.30 | 17.29 | 0.01 | ±0.31 | yes | ISO 54 | 246 | pass |
| synthetic-02-ring-h3-tilt4.jpg | synthetic | measure | ok | 18.90 | 18.80 | 0.10 | ±0.35 | yes | ISO 59 | 209 | pass |
| synthetic-03-wide-band-h6-offaxis.jpg | synthetic | measure | ok | 16.50 | 16.45 | 0.05 | ±0.31 | yes | ISO 52 | 164 | pass |
| synthetic-04-cutout-card-uneven-light.jpg | synthetic | measure | ok | 20.00 | 20.01 | 0.01 | ±0.35 | yes | ISO 63 | 213 | pass |
| synthetic-05-ring-glare-soft.jpg | synthetic | measure | ok | 15.70 | 15.53 | 0.17 | ±0.32 | yes | ISO 49 | 150 | pass |
| synthetic-06-two-rings.jpg | synthetic | choose | choose (2 rings) | 16.10 / 19.40 | 16.03 / 19.28 | 0.07 / 0.12 | ±0.29 / ±0.34 | yes / yes | ISO 50 / ISO 61 | 232 | pass |
| synthetic-07-steep-angle.jpg | synthetic | retake: PERSPECTIVE | retake: PERSPECTIVE | - |  |  |  |  |  | 61 | pass |
| synthetic-08-out-of-focus.jpg | synthetic | retake: BLURRY | retake: BLURRY | - |  |  |  |  |  | 62 | pass |
| synthetic-09-no-marker.jpg | synthetic | retake: NO_MARKER | retake: NO_MARKER | - |  |  |  |  |  | 59 | pass |
| synthetic-10-motion-blur.jpg | synthetic | retake: BLURRY | retake: BLURRY | - |  |  |  |  |  | 53 | pass |
| synthetic-11-too-far.jpg | synthetic | retake: LOW_RES | retake: LOW_RES | - |  |  |  |  |  | 101 | pass |

Observed on the synthetic set:

- Flat objects (printed-style ring, cut-out in card): error 0.01 mm in the set and at most 0.02 mm in sweeps from 0° to 10° of tilt.
- Rings with height: error 0.05–0.17 mm in the set. They read slightly low when the upper rim or a shadow hides part of the opening.
- Sweeps outside the set (scripts/dev/sweep.py): a bright inner wall makes a ring read high, +0.07 mm at 3 mm height and +0.29 mm at 8 mm height from 25 cm, which is the largest error seen and close to the stated ±0.32 mm. A photo with 0.44 mm edge blur (inside the accepted range) read 0.15 mm low.

## What failed or is unfinished

- No real photographs were available while the code was written, so every threshold is tuned on synthetic renders only. Real metal (reflections, bevels, comfort-fit inner profiles) may behave differently. **[LAMINE: update after real photos.]**
- First approach, an ellipse fit to all edge points, read 0.35–0.5 mm low on rings with height and shadow and was replaced by the circle-consensus method.
- A shadow as dark as the ring itself hides the edge on that side. The method then works from the visible part, and asks for a retake if less than half the circle is usable.
- Not built: lens-distortion correction, estimating ring height to correct parallax, EXIF focal length, live camera guidance, a second marker for a better perspective estimate.
- The 13 MB engine download is heavy for mobile data.

## Time and cost

- **Variable cost per operation: $0.00.** No recognition, reasoning, speech, retries or paid intermediaries at run time. A retake also costs nothing.
- **Time to a useful result (measured):**
  - Node on the build machine, 3200 × 2400 px: 160–280 ms per accepted photo, 50–100 ms per rejected photo (see results table).
  - Headless desktop Chrome, same photos: about 0.4–0.5 s including decoding. Engine start-up 0.8 s from a local server, one-off.
  - Phone: **[LAMINE: read the "Processing time" box on my phone for 3 photos; note phone model and first-load time on Wi-Fi/4G.]**
- **Hosting (separate from variable cost):** Cloudflare static assets. Pricing assumption: requests to static assets are free and unlimited on the free plan (Cloudflare docs, "Static Assets — Billing and limitations", checked 13 Nov 2026). Domain: none needed.
- **Build-time AI cost** is not a per-operation cost: **[LAMINE: subscription used.]**

## AI tools and models

- Claude (Anthropic) in the Claude app, model Claude Fable 5.2: wrote the code, synthetic renderer, tests and documentation under my direction.
- **[LAMINE: list anything else actually used, with exact model names, e.g. a second reviewer.]**
- No AI model runs inside the product.

Examples of checking AI output:

1. The generated marker PDF was rendered at 600 dpi and measured: the marker came out 20.02 × 19.98 mm and the check line 100 mm.
2. The first measurement code was run against renders with known diameters. It failed 5 of 11 cases, which exposed a wrong shadow model in the renderer and the ellipse-fit bias; both were fixed and the cases re-run.
3. **[LAMINE: my own check, e.g. ruler on the printed marker, caliper against the app on a real ring.]**

## Time spent

**[LAMINE: actual focused hours, split build / test photos / video.]**

## Product judgment

- Scope kept to one job: a trustworthy diameter or a clear retake. No shopping flow.
- The result shows a size *range* when the uncertainty crosses a size boundary, because ±0.3 mm is about one ISO size.
- The close-up with the detected edge lets the user verify the measurement by eye.
- Next: validate on 20–30 real rings against calipers and set the uncertainty from that data; add live camera guidance (angle, distance, sharpness) before capture; ask one spoken or tapped question about band width to correct parallax; replace the 13 MB engine with a small purpose-built module.
