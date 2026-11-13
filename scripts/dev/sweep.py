"""Developer experiments: tilt / distance / blur sweeps on synthetic rings (truth 17.30 mm). Writes to /tmp/sweep."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from synth import render, ZONE_C as Z
out = pathlib.Path('/tmp/sweep'); out.mkdir(exist_ok=True)
ring = dict(centre=Z, d_in=17.30, band=2.0, height=3.0, shadow_strength=0.2)
flat = dict(centre=Z, d_in=17.30, band=2.0, height=0, flat_grey=60, shadow_strength=0.2)
for t in (0, 4, 8, 10, 12, 16):
    render(f'tilt{t:02d}-ring', [ring], target=Z, tilt=t, tilt_axis=70, roll=15, out=out)
    render(f'tilt{t:02d}-flat', [flat], target=Z, tilt=t, tilt_axis=70, roll=15, out=out)
for d in (150, 200, 300, 400):
    render(f'dist{d}-ring', [ring], target=Z, dist=d, out=out)
for b in (1.5, 2.5, 3.5, 5.0):
    render(f'blur{b}-ring', [ring], target=Z, blur=b, out=out)
for h in (1.5, 3, 5, 8):
    render(f'height{h}-ring-wallbright', [dict(ring, height=h, wall=200)], target=Z, out=out)
    render(f'height{h}-ring-walldark', [dict(ring, height=h)], target=Z, out=out)
