"""Render SYNTHETIC test photos with known ground truth (labelled as synthetic everywhere).

A pinhole camera looks at the capture sheet. Rings are rendered with real height:
the upper rim is projected from the camera centre, so parallax and self-occlusion
of the opening are present, as in a real photo.

Usage: python3 scripts/synth.py     -> test-set/synthetic/*.jpg
Ground truth lives in test-set/ground-truth.csv (written by hand, not by this script).
"""
from pathlib import Path
import numpy as np
import cv2
from make_sheet import MARKER_X, MARKER_Y, ZONE_X, ZONE_Y, ZONE

OUT = Path(__file__).resolve().parent.parent / "test-set" / "synthetic"
T = 24                      # texture px per mm
X0, Y0, TW, TH = -40, -40, 180, 144   # sheet patch in frame coordinates (mm)
W, H = 3200, 2400           # output photo
F = 0.72 * W                # focal length in px (phone main camera, roughly)
ZONE_C = (ZONE_X + ZONE / 2, ZONE_Y + ZONE / 2)
MARKER_C = (MARKER_X + 10, MARKER_Y + 10)
SH = 4                      # sub-pixel bits for cv2 drawing


def tx(p):
    return (int(round((p[0] - X0) * T * (1 << SH))), int(round((p[1] - Y0) * T * (1 << SH))))


def disc(shape, c, r):
    m = np.zeros(shape, np.uint8)
    cv2.circle(m, tx(c), int(round(r * T * (1 << SH))), 255, -1, cv2.LINE_AA, SH)
    return m.astype(np.float32) / 255


def camera(target, dist, tilt_deg, tilt_axis_deg, roll_deg):
    """Return (H plane->image, camera centre in plane coords [x, y, z<0])."""
    a, th, ro = np.radians(tilt_axis_deg), np.radians(tilt_deg), np.radians(roll_deg)
    k = np.array([np.cos(a), np.sin(a), 0.0])
    Kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    Rt = np.eye(3) + np.sin(th) * Kx + (1 - np.cos(th)) * Kx @ Kx
    Rz = np.array([[np.cos(ro), -np.sin(ro), 0], [np.sin(ro), np.cos(ro), 0], [0, 0, 1]])
    R = Rz @ Rt
    t = np.array([0, 0, dist]) - R @ np.array([target[0], target[1], 0.0])
    K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1]])
    Hm = K @ np.column_stack([R[:, 0], R[:, 1], t])
    return Hm, -R.T @ t


def draw_ring(tex, shadow, C, centre, d_in, band, height, wall=85, top=165, outer=115, flat_grey=None, glare=False, shadow_strength=0.45):
    shape = tex.shape[:2]
    r_in, r_out = d_in / 2, d_in / 2 + band
    if height > 0:
        s = C[2] / (C[2] + height)
        ct = (C[0] + s * (centre[0] - C[0]), C[1] + s * (centre[1] - C[1]))
    else:
        s, ct = 1.0, centre
    inB, outB = disc(shape, centre, r_in), disc(shape, centre, r_out)
    inT, outT = disc(shape, ct, r_in * s), disc(shape, ct, r_out * s)
    hole = inB * inT                                  # paper visible through the ring
    body = np.clip(np.maximum(outB, outT) - hole, 0, 1)
    col = np.full(shape, float(outer), np.float32)    # outer wall
    topface = np.clip(outT - inT, 0, 1)
    col = col * (1 - topface) + (flat_grey if flat_grey is not None else top) * topface
    inner_wall = np.clip(inT - inB, 0, 1) * (1 - topface)
    col = col * (1 - inner_wall) + wall * inner_wall
    if glare:  # specular streak across the top face
        yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
        ang = np.arctan2(yy / T + Y0 - ct[1], xx / T + X0 - ct[0])
        col = col + 70 * np.exp(-((ang - 0.6) / 0.25) ** 2) * topface
    for ch in range(3):
        tint = (1.0, 0.97, 0.9)[ch] if flat_grey is None else 1.0
        tex[:, :, ch] = tex[:, :, ch] * (1 - body) + np.clip(col * tint, 0, 255) * body
    sh = cv2.GaussianBlur(np.roll(np.roll(body, int(1.0 * T), 1), int(0.7 * T), 0), (0, 0), 0.6 * T)
    shadow *= 1 - shadow_strength * sh * (1 - body)   # soft cast shadow, also falls inside the opening


def render(name, rings, target=None, dist=250, tilt=0, tilt_axis=30, roll=0, blur=0.9, motion=0,
           noise=2.0, marker=True, light=0.12, card=None, out=OUT):
    tex = np.empty((TH * T, TW * T, 3), np.float32)
    tex[:] = (236, 238, 240)  # paper, BGR
    shadow = np.ones(tex.shape[:2], np.float32)
    target = target or ((ZONE_C[0] + MARKER_C[0]) / 2, ZONE_C[1])
    Hm, C = camera(target, dist, tilt, tilt_axis, roll)
    if marker:
        for off, side, v in ((0, 20, 18), (4, 12, 236), (8, 4, 18)):
            p0, p1 = (MARKER_X + off, MARKER_Y + off), (MARKER_X + off + side, MARKER_Y + off + side)
            cv2.rectangle(tex, tx(p0), tx(p1), (v, v, v), -1, cv2.LINE_AA, SH)
    if card:  # dark card with a circular cut-out (flat, labelled as cut-out)
        cx, cy, side, d = card
        m = np.zeros(tex.shape[:2], np.uint8)
        cv2.rectangle(m, tx((cx - side / 2, cy - side / 2)), tx((cx + side / 2, cy + side / 2)), 255, -1, cv2.LINE_AA, SH)
        m = m.astype(np.float32) / 255 * (1 - disc(tex.shape[:2], (cx, cy), d / 2))
        for ch in range(3):
            tex[:, :, ch] = tex[:, :, ch] * (1 - m) + 40 * m
    for r in rings:
        draw_ring(tex, shadow, C, **r)
    tex *= shadow[:, :, None]
    tex = cv2.GaussianBlur(tex, (0, 0), 0.7)
    M = Hm @ np.array([[1 / T, 0, X0], [0, 1 / T, Y0], [0, 0, 1]])
    img = cv2.warpPerspective(tex, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(60, 80, 105))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img *= (1 - light * (0.6 * xx / W + 0.4 * yy / H))[:, :, None]
    if blur > 0:
        img = cv2.GaussianBlur(img, (0, 0), blur)
    if motion > 0:
        k = np.zeros((1, int(motion)), np.float32) + 1 / int(motion)
        img = cv2.filter2D(img, -1, k)
    rng = np.random.default_rng(abs(hash(name)) % (2 ** 32))
    img += rng.normal(0, noise, img.shape).astype(np.float32)
    cv2.imwrite(str(out / f"{name}.jpg"), np.clip(img, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print("wrote", name)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    Z = ZONE_C
    # Supported conditions
    render("synthetic-01-flat-overhead", [dict(centre=Z, d_in=17.30, band=2.0, height=0, flat_grey=60)])
    render("synthetic-02-ring-h3-tilt4", [dict(centre=(Z[0] + 2, Z[1] - 3), d_in=18.90, band=1.8, height=3.0)],
           tilt=4, roll=20, dist=240)
    render("synthetic-03-wide-band-h6-offaxis", [dict(centre=Z, d_in=16.50, band=2.4, height=6.0)],
           target=MARKER_C, tilt=6, tilt_axis=110, roll=-35, dist=260)
    render("synthetic-04-cutout-card-uneven-light", [], card=(Z[0], Z[1], 40, 20.00), light=0.35, roll=8, tilt=3)
    render("synthetic-05-ring-glare-soft", [dict(centre=Z, d_in=15.70, band=2.2, height=2.5, glare=True, shadow_strength=0.2)],
           blur=1.6, tilt=2, roll=170, dist=300, noise=3.5)
    # Ambiguity: two rings
    render("synthetic-06-two-rings", [dict(centre=(Z[0], Z[1] - 12), d_in=16.10, band=1.8, height=2.0),
                                      dict(centre=(Z[0] + 4, Z[1] + 13), d_in=19.40, band=2.0, height=2.0)], roll=5)
    # Unsupported: the app must ask for a retake
    render("synthetic-07-steep-angle", [dict(centre=Z, d_in=17.30, band=2.0, height=2.0)], tilt=28, dist=280)
    render("synthetic-08-out-of-focus", [dict(centre=Z, d_in=17.30, band=2.0, height=2.0)], blur=7.0)
    render("synthetic-09-no-marker", [dict(centre=Z, d_in=17.30, band=2.0, height=2.0)], marker=False)
    render("synthetic-10-motion-blur", [dict(centre=Z, d_in=17.30, band=2.0, height=2.0)], motion=31)
    render("synthetic-11-too-far", [dict(centre=Z, d_in=17.30, band=2.0, height=2.0)], dist=1100)
