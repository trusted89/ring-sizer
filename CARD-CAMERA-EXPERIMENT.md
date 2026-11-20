# Card camera: opt-in experiment

The printed-marker flow remains the default. The experimental card camera appears inside No-printer measurement on compatible browsers and never acquires camera access automatically. Use HTTPS to test native rear camera permission. All processing stays in the device; no frame is sent to a server. On supported browsers the mode is explicitly opt-in and activates only after user confirms the standard-size reference. It asks for an environment-facing camera and ideal 3840×2160, captures a native still when supported or the uncropped video frame otherwise, then independently re-detects both objects. No image requests are paid.

Use a dark, uniformly matte blank-backed verified ID‑1 card (85.60×53.98 mm) and one low-profile ring on a plain light matte surface. Place them flat side by side with room between, keep all edges in view, use the main rear lens at 1× with soft light and hold directly overhead. A similarly shaped object may be a different size, and no optical test of shape can verify what the user supplied. Decline ambiguous, clipped, patterned, poor contrast, blurry or distorted scenes. The algorithm cannot correct tall ring rim height or undetectable lens distortion; report only an experimental estimate (round to 0.1 mm, uncertainty never lower than 0.5 mm), not purchase-level accuracy. A low-resolution browser may be unable to produce an acceptable result even when the preview recognizes both objects; use on-screen/manual mode or a physical sizer in that case.

## Local checks

```
npm test
node scripts/dev/photo-flow-unit.mjs
node scripts/dev/screen-unit.mjs
npm run test:camera-card
```

The CV suite renders 17 synthetic projections, including three accepted positives and 14 negative or ambiguous scenes. Also checks downscaled guidance cannot itself publish a diameter. These tests exercise geometry, not actual card wear, focus, exposure, tap stability or ring tolerances on a handset. Existing 21 printed-marker fixtures pass; current on-screen cache unchanged. Browser controller checks explicit confirmation/camera isolation and late cancellation. No physical test or accuracy claim. Native camera QA and blind caliper comparison across devices/cases remain required before promoting this to a standard or purchase-grade method.
