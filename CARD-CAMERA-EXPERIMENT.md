# Card camera: opt-in experiment

The printed-marker flow remains the default. The experimental card camera appears inside No-printer measurement on compatible browsers and never acquires camera access automatically. Use HTTPS to test native rear camera permission. All processing stays in the device; no frame is sent to a server. On supported browsers the mode is explicitly opt-in and activates only after user confirms the standard-size reference. It asks for an environment-facing camera and ideal 3840×2160, allows a manual shutter once both objects are stable in three fresh frames, captures a native still when supported or the uncropped video frame otherwise, then independently re-detects both objects. No image requests are paid.

Use a matte verified ID‑1 card (85.60×53.98 mm) and a low-profile ring. Both should contrast clearly against a plain matte surface. Any card color may work when its edges differ in brightness from the surface: hue alone does not provide the needed evidence. On a dark surface, use a ring whose rim is brighter than the surface. Place them flat near each other in any orientation. The viewfinder draws a solid outline around verified edges. A dashed card outline only hints that a reference may be present: it cannot supply scale, confirm a ring, or enable capture. Leave room between them and keep all edges in view, use the main rear lens at 1× with soft light and hold directly overhead. A similarly shaped object may be a different size, and no optical test of shape can verify what the user supplied. Decline ambiguous, clipped, patterns that interfere with the card perimeter, poor contrast, blurry or distorted scenes. The algorithm cannot correct tall ring rim height or undetectable lens distortion; report only an experimental estimate (round to 0.1 mm, uncertainty never lower than 0.5 mm), not purchase-level accuracy. A low-resolution browser may be unable to produce an acceptable result even when the preview recognizes both objects; use on-screen/manual mode or a physical sizer in that case.

## Local checks

```
npm test
node scripts/dev/photo-flow-unit.mjs
node scripts/dev/screen-unit.mjs
npm run test:camera-card
```

The CV suite renders 31 synthetic projections, including ten accepted positives and 21 negative or ambiguous scenes. Also checks downscaled guidance cannot itself publish a diameter. These tests exercise geometry, not actual card wear, focus, exposure, tap stability or ring tolerances on a handset. Existing 21 printed-marker fixtures pass; current on-screen cache unchanged. The controller checks explicit confirmation/camera isolation and late cancellation; the adaptive tracker suite checks duplicate/stale frames, moving contours, partial detection, and manual shutter recovery. No physical test or accuracy claim. Native camera QA and blind caliper comparison across devices/cases remain required before promoting this to a standard or purchase-grade method.

## Local endpoint-bridge hypothesis

This candidate may bridge the **middle** of one edge when strict end spans independently fit the same line, near-corner brightness evidence exists at both ends, and the other three edges meet the existing checks. It does not invent a corner or bridge two edges. Endpoint perturbations are propagated to ring-scale uncertainty and must stay within a provisional 0.35 mm engineering gate. A low-resolution preview can still refuse capture; the native still refits independently. These gates and physical accuracy need handset validation before any rollout.
