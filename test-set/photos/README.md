# Real photos go here

1. Measure each object's inner diameter yourself (calipers, or a ruler for cut-outs) BEFORE running the app, and write it in `../ground-truth.csv`.
2. Photograph each object on the printed sheet, following the on-sheet instructions.
3. Add at least one unsupported photo (for example: marker covered, taken at a steep angle, or out of focus).
4. Save the photos in this folder and add one row per photo to `../ground-truth.csv`:

```
photos/ring-silver-band.jpg,real-ring,measure,,17.35,digital caliper (0.01 mm) mean of 3 readings,plain silver band 3 mm wide
photos/washer-m10.jpg,real-object,measure,,10.50,digital caliper,steel washer (not a ring)
photos/cutout-18mm.jpg,cutout,measure,,18.0,ruler (0.5 mm),hole cut in black card - labelled cut-out
photos/ring-steep-angle.jpg,real-ring,retake,PERSPECTIVE,17.35,digital caliper,about 30 degrees from overhead (unsupported)
```

5. Run `npm test`. It writes `../results.md` with the absolute error for every photo.

The ground-truth file is only read by the test script after measuring, to compute the error. Nothing in the app accepts a diameter as input.
