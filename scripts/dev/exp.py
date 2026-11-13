"""Developer experiments: isolate error sources on synthetic rings. Writes to /tmp/exp."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from synth import render, ZONE_C as Z
out = pathlib.Path('/tmp/exp')
base = dict(centre=Z, d_in=16.10, band=1.8)
render('A-h2-noshadow', [dict(base, height=2.0, shadow_strength=0)], out=out)
render('B-h2-shadow-wall165', [dict(base, height=2.0, wall=165)], out=out)
render('C-h0-topcolours', [dict(base, height=0)], out=out)
render('D-h2-noshadow-wall165', [dict(base, height=2.0, wall=165, shadow_strength=0)], out=out)
render('E-h0-noshadow', [dict(base, height=0, shadow_strength=0)], out=out)
