"""Developer aid: draw the detected overlay on a crop around the ring. Usage: crop.py photo out.png"""
import sys, json, cv2, numpy as np
im = cv2.imread(sys.argv[1]); ov = json.load(open('/tmp/dbg-overlay.json'))
polys = ([ov['inner']] if 'inner' in ov else []) + ov.get('candidates', [])
for p in polys:
    cv2.polylines(im, [np.round(np.array(p) * 16).astype(np.int32)], True, (0, 0, 255), 1, cv2.LINE_AA, 4)
if 'marker' in ov:
    cv2.polylines(im, [np.round(np.array(ov['marker']) * 16).astype(np.int32)], True, (0, 200, 0), 1, cv2.LINE_AA, 4)
for q in ov.get('edgePoints', []):
    cv2.circle(im, (int(round(q[0]*16)), int(round(q[1]*16))), 12, (255, 0, 0), -1, cv2.LINE_AA, 4)
if polys:
    a = np.array(polys[0]); c = a.mean(0).astype(int); r = int((a.max(0) - a.min(0)).max() * 0.8)
    im = im[max(0, c[1] - r):c[1] + r, max(0, c[0] - r):c[0] + r]
    im = cv2.resize(im, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
cv2.imwrite(sys.argv[2], im)
