# Delivery notes — Ring measurement from a photograph

## Links

- Browser demo: <https://ring-sizer.pages.dev>
- Repository: <https://github.com/trusted89/ring-sizer>
- Video walkthrough (2 min 57 s): <https://drive.google.com/file/d/10jJlqQ8lcBSExDmhz7iuj-H3GvyDMpP5/view?usp=sharing>

## What was built

A static, phone-friendly page. The user prints a marker sheet, photographs one ring beside the 20 mm marker, and uploads the photo, or uses the live check, which guides distance, level and centring in the camera preview and takes the photo by itself. The page returns the inner diameter with an uncertainty and an ISO 8653 size, shows the detected boundary and scale reference on the photo, and reports processing time and cost. It refuses to measure, with a specific retake instruction, when the marker is missing, the photo is blurry, too far, too steep, or the inner edge is not a clean circle. If two rings are visible it asks which one.

Design decision: classical computer vision on the device, no AI model at run time. A measurement has to be repeatable and explainable, a marker gives an exact scale, and running on the device makes the variable cost zero and keeps the photo private.

## Test set, expected and actual results

Ground truth is in `test-set/ground-truth.csv`, recorded before testing. The app never receives it.

### Real photographs

Ten photos from my phone of my own printed sheet, with six real objects. The sheet came out at 84 % of nominal size (check line 84 mm by ruler), so each photo's row in `ground-truth.csv` carries `sheet_line_mm = 84`, applied the same way the page applies it.

Measuring tool for the objects: a ruler with 1 mm marks, inner edge to inner edge, read before any photo of that object was uploaded. Its resolution (about ±0.5 mm) is coarser than the app's stated uncertainty, so these rows show agreement with a ruler, not accuracy to a tenth of a millimetre.

| Photo | Kind | Expected | Actual | True inner Ø (mm) | Estimated Ø (mm) | Absolute error (mm) | Stated uncertainty | Error within uncertainty | Size | Time (ms, Node) | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| real-01-sheet-only-no-ring.jpg | real-photo | retake: NO_RING | retake: NO_RING | - |  |  |  |  |  | 314 | pass |
| real-02-keyring-25mm.jpg | real-object | measure | ok | 25.0 | 25.05 | 0.05 | ±0.54 | yes | ISO 79 | 252 | pass |
| real-03-keyring-too-close-a.jpg | real-object | retake: TOO_CLOSE | retake: TOO_CLOSE | - |  |  |  |  |  | 174 | pass |
| real-04-keyring-too-close-b.jpg | real-object | retake: TOO_CLOSE | retake: TOO_CLOSE | - |  |  |  |  |  | 142 | pass |
| real-05-signet-ring-stone.jpg | real-ring | retake: NO_RING | retake: NO_RING | - |  |  |  |  |  | 298 | pass |
| real-06-hoop-12mm.jpg | real-object | measure | ok | 13.0 | 13.05 | 0.05 | ±0.39 | yes | ISO 41 | 507 | pass |
| real-07-hoop-off-centre.jpg | real-object | retake: NOT_ROUND | retake: NOT_ROUND | - |  |  |  |  |  | 276 | pass |
| real-08-band-22mm-unclear-edge.jpg | real-object | retake: NOT_ROUND | retake: NOT_ROUND | - |  |  |  |  |  | 288 | pass |
| real-09-coin-200-fcfa-solid.jpg | real-object | retake: NO_RING | retake: NO_RING | - |  |  |  |  |  | 281 | pass |
| real-10-key-hole-5mm.jpg | real-object | retake: NO_RING | retake: NO_RING | - |  |  |  |  |  | 321 | pass |

Objects:

- **Key ring** (`real-02` to `real-04`): steel split ring, 25 mm by ruler. From about 25 cm it reads 25.05 mm. It is larger than any ring size in the table, so the page shows the diameter and says no size applies. From about 10 cm it is rejected as too close; before that rule existed those two photos read about 26.3 mm.
- **Hoop** (`real-06`, `real-07`): black hinged hoop about 2.5 mm thick. **Its ground truth was corrected after testing, and that weakens this row.** Before testing I read it as "12 to 12.9 mm" on the ruler. The app then read 13.05 mm from about 16 cm. I measured again and read 13 mm, and I believe the first reading was wrong: the hoop is small, thick and rounded, and hard to read against a ruler. The table uses 13.0 mm, which gives an error of 0.05 mm. Against the first reading (taken as 12.5 mm) the error is 0.55 mm, outside the stated ±0.39 mm. Across five photos of this hoop the unrestricted readings ranged from 12.40 to 13.05 mm. In `real-07` the hoop sits off-centre in a whole-page photo, its near side hides part of the opening, and the page asks for a retake.
- **Signet ring with a stone** (`real-05`): 18 to 19 mm by ruler. It rests on its setting and the opening is in shadow, so no round opening showing paper is found and the page declines to measure. This is the only finger ring I had, and it is an unsupported kind.
- **Thin polished band** (`real-08`): 22 mm by ruler, recorded before testing. In ten photos it never gave a reading: six were too close, two were tilted past the limit, and in the rest too little of the edge agreed with one circle (17 % in `real-08`). With the checks switched off the readings were 23.2 to 24.1 mm, 1.2 to 2.1 mm above the ruler. I do not know whether the ruler reading or the app is off; the app declining to report is the right outcome either way.
- **200 CFA franc coin** (`real-09`): a solid disc, so the page declines with "no ring found", which is correct. I also used it as a check of the scale that does not depend on my ruler: its published diameter is 24.5 mm. `scripts/dev/disc-check.mjs` reuses the page's marker detection and the 84 mm sheet correction and measures the coin's outer edge: **24.07 mm, 0.43 mm (1.7 %) below the published value**, from about 28 cm with the phone tilted about 9 degrees. A coin's face is slightly smaller than its published diameter because the rim is bevelled, so this supports the scale being right to within about 2 %, not better.
- **Brass key** (`real-10`): its hole is 5 to 5.5 mm by ruler, below the smallest opening the page treats as a ring (about 7 mm on my sheet). The photo passes the distance and angle checks and the page declines with "no ring found". Correct, but the message does not say the opening is too small.
- `real-01` is the sheet alone on a red cloth.

What these show and do not show:

- Two measured objects give a reading (key ring, hoop). No plain finger ring was available, so there is no real-photo evidence for the main use case inside the sizing table except the hoop at its lowest size (ISO 41).
- Only `real-02` (the key ring) has ground truth recorded before testing and left unchanged. The hoop's was corrected after the result was seen, as described above. Expected outcomes of the retake rows were written after their first run.
- Detection thresholds were changed after seeing these photos (see "What failed"). They are tuned to this sample, not validated on an independent one.

### Synthetic renders (labelled synthetic, regression tests only)

| Photo | Kind | Expected | Actual | True inner Ø (mm) | Estimated Ø (mm) | Absolute error (mm) | Stated uncertainty | Error within uncertainty | Size | Time (ms, Node) | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic-01-flat-overhead.jpg | synthetic | measure | ok | 17.30 | 17.29 | 0.01 | ±0.32 | yes | ISO 54 | 189 | pass |
| synthetic-02-ring-h3-tilt4.jpg | synthetic | measure | ok | 18.90 | 18.80 | 0.10 | ±0.37 | yes | ISO 59 | 315 | pass |
| synthetic-03-wide-band-h6-offaxis.jpg | synthetic | measure | ok | 16.50 | 16.45 | 0.05 | ±0.32 | yes | ISO 52 | 191 | pass |
| synthetic-04-cutout-card-uneven-light.jpg | synthetic | measure | ok | 20.00 | 20.01 | 0.01 | ±0.37 | yes | ISO 63 | 206 | pass |
| synthetic-05-ring-glare-soft.jpg | synthetic | measure | ok | 15.70 | 15.52 | 0.18 | ±0.34 | yes | ISO 49 | 146 | pass |
| synthetic-06-two-rings.jpg | synthetic | choose | choose (2 rings) | 16.10 / 19.40 | 16.02 / 19.28 | 0.08 / 0.12 | ±0.31 / ±0.35 | yes / yes | ISO 50 / ISO 61 | 217 | pass |
| synthetic-07-steep-angle.jpg | synthetic | retake: PERSPECTIVE | retake: PERSPECTIVE | - |  |  |  |  |  | 71 | pass |
| synthetic-08-out-of-focus.jpg | synthetic | retake: BLURRY | retake: BLURRY | - |  |  |  |  |  | 67 | pass |
| synthetic-09-no-marker.jpg | synthetic | retake: NO_MARKER | retake: NO_MARKER | - |  |  |  |  |  | 56 | pass |
| synthetic-10-motion-blur.jpg | synthetic | retake: BLURRY | retake: BLURRY | - |  |  |  |  |  | 54 | pass |
| synthetic-11-too-far.jpg | synthetic | retake: LOW_RES | retake: LOW_RES | - |  |  |  |  |  | 87 | pass |

Observed on the synthetic set:

- Flat objects (printed-style ring, cut-out in card): error 0.01 mm in the set and at most 0.02 mm in sweeps from 0° to 10° of tilt.
- Rings with height: error 0.05–0.17 mm in the set. They read slightly low when the upper rim or a shadow hides part of the opening.
- Sweeps outside the set (scripts/dev/sweep.py): a bright inner wall makes a ring read high, +0.07 mm at 3 mm height and +0.29 mm at 8 mm height from 25 cm, which is the largest error seen and close to the stated uncertainty (about ±0.3 mm). A photo with 0.44 mm edge blur (inside the accepted range) read 0.15 mm low.

## What failed or is unfinished

- No real photographs were available while the code was written, so every threshold was first tuned on synthetic renders. The first three real photos were all rejected. Causes found and fixed:
  - The paper-brightness estimate used a maximum filter, so anything brighter than paper (highlights on polished metal, and the area outside the photo) made nearby paper look dark and hid the ring. It now removes narrow bright features first and ignores the area outside the photo.
  - Edge points had to sit within 0.05 mm of one circle. Real metal has bevels and reflections; the band is now 0.12 mm (at least one pixel).
  - At least half the edge had to agree with one circle. On the key ring 39 % agrees, spread all round. The rule now also accepts 30 % when no stretch over 120° lacks agreeing points, with a warning and a larger uncertainty.
  - Photos from about 10 cm read 1.3 mm high. They are now rejected as too close.
  - A dark hoop with a small opening and a soft shadow was not found: the shadow merged with the hoop and the opening was not enclosed. The search now retries counting only clearly dark pixels and bridging gaps up to about 2.5 mm.
- Real-photo evidence is three objects in one lighting condition, one phone. Thresholds changed on the strength of these photos; that is tuning to a sample, not validation.
- If the hoop's first ruler reading was right, the uncertainty model understated the error on it (0.55 mm error against ±0.39 mm stated). The ring-height term assumes a 4 mm band seen from straight above; a thick rounded tube seen from 16 cm and 16° off-axis behaves worse.
- Many photos I thought were overhead were rejected as tilted or read 8 to 14 degrees. I checked whether the angle estimate was wrong because my print was stretched: thin round objects come out round to within 1 % in the sheet's own coordinates across seven photos, so the print is not stretched and the photos probably were tilted about 10 degrees, which is easy to do when holding a phone by hand. I did not confirm this with the phone resting level on a support.
- Getting an accepted photo by hand took several attempts per object: the working window (about 15 to 30 cm, ring near the centre, phone level) is narrow, and an upload only says what was wrong afterwards. The live check was built in response; with it each object took one or two attempts in good light.
- **Live check, tested on my phone.** After the failures above I added a live camera check: it shows distance and tilt before the photo, a bubble level from the phone's own sensor, a green frame when the position is good, and it takes the photo by itself. First real use, on the 25 mm key ring: the photo was taken automatically at about 22 cm and read **25.38 mm ± 0.62** (0.38 mm above the ruler, inside the stated uncertainty). Second, on the hoop, at about 20 cm: **12.97 mm ± 0.40**, ISO 41 (ruler: first read as 12 to 12.9 mm, re-measured as 13 mm). Each took one attempt, against several attempts per object when photographing by hand. Two things it showed:
  - The phone's sensor read 2 degrees from level while the angle estimated from the marker read 12 degrees for the same photo (2 and 13 degrees on the second). So the marker-based angle reads about 10 degrees high on my set-up, which explains the many "too steep" rejections of photos I had taken level. I have not found the cause (a creased sheet on a soft surface is my first suspect). Photos from the live check use the sensor; uploaded photos still use the marker estimate and are rejected more often than they should be.
  - The live check needs good light and a centred ring. Later the same evening, under an indoor lamp, it took photos that were too dark and soft and the page declined them (edge blur 0.53 mm against a 0.65 mm limit, paper tinted orange). Its first version also turned green with the ring off-centre or too far away for the small photo; it now asks for the ring inside a target circle and judges "too far" by the pixels the ring will get. Photos taken with the phone's own camera in daylight and uploaded measure the same every time.
  - The live check's photo is only 1080 × 2336 px on my phone (6.8 px per sheet millimetre against about 11 for the phone's own camera), so its uncertainty is larger. The browser did not hand over a full-size still.
- **The sheet's own instructions sent me too close.** Step 4 said to fit the large corner marks in the frame. Doing that puts the phone at about 12 to 15 cm, and the page rejects anything under 15 cm. Most of my rejected photos failed for this reason. The sheet and page now say to step back until the full width of the page fits in the frame, and the retake message states the estimated distance.
- Tall rings and rings with stones are declined with "no ring found", which is correct but not specific. A message naming the cause would be better.
- First approach, an ellipse fit to all edge points, read 0.35–0.5 mm low on rings with height and shadow and was replaced by the circle-consensus method.
- A shadow as dark as the ring itself hides the edge on that side. The method then works from the visible part, and asks for a retake if less than half the circle is usable.
- The page cannot detect a sheet that the printer resized (for example an A4 file on US Letter paper with "fit to page"). Every result is then wrong by the same percentage. The ruler check on the sheet is the only guard, and the uncertainty allows 0.5 % for it.
- Not built: lens-distortion correction, estimating ring height to correct parallax, EXIF focal length, a second marker for a better perspective estimate.
- The engine download is 3.7 MB over the network (13.3 MB uncompressed, measured on the live site), which is still heavy for mobile data.

## Time and cost

- **Variable cost per operation: $0.00.** No recognition, reasoning, speech, retries or paid intermediaries at run time. A retake also costs nothing.
- **Time to a useful result (measured):**
  - Node on the build machine, 3200 × 2400 px: 160–280 ms per accepted photo, 50–100 ms per rejected photo (see results table).
  - Headless desktop Chrome, same photos: about 0.4–0.5 s including decoding. Engine start-up 0.8 s from a local server, one-off.
  - Phone, Samsung Galaxy A15 (SM-A155M), Chrome, as shown on the result screen: **1.17 s** and **1.12 s** for two 1080 × 2336 px photos taken by the live check (read photo about 0.1 s + measure about 1.0 s). I did not record a phone timing for a full-size uploaded photo or the first-load time on mobile data.
- **Hosting (separate from variable cost):** Cloudflare Pages, free plan. Pricing assumption: requests to static assets are free and unlimited on free and paid plans (Cloudflare docs, "Pages Functions — Pricing", checked 15 Nov 2026). Free-plan limits that apply: 500 deployments a month, 25 MiB per file. Domain: none needed.
- **Build-time AI cost** is not a per-operation cost: a Claude Max subscription, a flat monthly fee. Nothing is charged per image, per retry or per user.

## AI tools and models

- Claude (Anthropic) in the Claude app, model Claude Fable 5.2: wrote the code, synthetic renderer, tests and documentation under my direction.
- No other AI tool or model was used.
- No AI model runs inside the product.

Examples of checking AI output:

1. The generated marker PDF was rendered at 600 dpi and measured in pixels (`scripts/dev/sheet-check.mjs`): the marker came out 20.02 × 19.98 mm. The same check showed the 100 mm print-check line was 100.3 mm from outer edge to outer edge, because its end marks were 0.3 mm thick and centred on the ends. The sheet was corrected (now 99.99 mm, with the measuring edges and a 99.5–100.5 mm tolerance stated on it). Rings drawn on the rasterised sheet at 15.00, 18.00 and 21.50 mm then measured 14.98, 17.98 and 21.47 mm.
2. The first measurement code was run against renders with known diameters. It failed 5 of 11 cases, which exposed a wrong shadow model in the renderer and the ellipse-fit bias; both were fixed and the cases re-run.
3. My own checks. I measured the sheet's check line with a ruler: 84 mm, where the sheet said "exactly 100 mm". That exposed the scaled print and led to finding the flaw in the line's end marks (example 1). I measured each object with a ruler before testing and compared the app against it (table above). I photographed a coin of published diameter as a check that does not depend on my ruler, and I tried the live check on my own phone, which showed the marker-based angle reading about 10 degrees high.

## Time spent

About 4 to 6 focused hours, under the 8-hour guide. I did not keep a split between building, test photos and video. Most of the last session went on real photos: finding out why they were rejected and fixing the causes.

## Product judgment

- Printers resize pages silently, and the page cannot detect that from a photo. A reprint at 100 % is the intended fix. As a fallback the user can enter the ruler reading of the sheet's check line once; results are scaled by it and labelled as adjusted. It describes the sheet, not the ring or the photo, and is off by default. The test results in this document use no adjustment.
- Scope kept to one job: a trustworthy diameter or a clear retake. No shopping flow.
- The result shows a size *range* when the uncertainty crosses a size boundary, because ±0.3 mm is about one ISO size.
- The close-up with the detected edge lets the user verify the measurement by eye.
- The same method measures any round hole, not only rings: washers, grommets, key holes. I tested a key hole and it is outside the current range. Widening the range is a product direction, not something to tune in a prototype for ring sizes.
- Next: validate on 20–30 real rings against calipers and set the uncertainty from that data; make the live check deliver a full-size photo on every phone and add a sharpness check to it; find out why the marker-based angle reads high; ask one spoken or tapped question about band width to correct parallax; replace the 3.7 MB engine download with a small purpose-built module.
