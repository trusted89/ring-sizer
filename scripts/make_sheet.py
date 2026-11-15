"""Generate the printable capture sheet (A4 and US Letter) with the 20 mm marker.

Usage: python3 scripts/make_sheet.py
Writes public/sheet/ring-sheet-a4.pdf and public/sheet/ring-sheet-letter.pdf
"""
from pathlib import Path
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "public" / "sheet"

# Layout of the capture frame, in mm, origin at the frame's top-left corner.
FRAME_W, FRAME_H = 100.0, 64.0
MARKER_X, MARKER_Y, MARKER = 10.0, 22.0, 20.0      # top-left of the marker, side
ZONE_X, ZONE_Y, ZONE = 44.0, 10.0, 44.0            # ring placement zone


def draw_marker(c, x, y_top, page_h):
    """20 mm black square, 12 mm white square, 4 mm black centre. y measured from page top."""
    def rect(off, side, grey):
        c.setFillGray(grey)
        c.rect((x + off) * mm, (page_h - (y_top + off + side)) * mm, side * mm, side * mm, stroke=0, fill=1)
    rect(0, 20, 0)
    rect(4, 12, 1)
    rect(8, 4, 0)


def ticks(c, x, y_top, w, h, page_h, length=5, grey=0.72, lw=0.25):
    c.setStrokeGray(grey)
    c.setLineWidth(lw * mm)
    for cx, sx in ((x, 1), (x + w, -1)):
        for cy, sy in ((y_top, 1), (y_top + h, -1)):
            c.line(cx * mm, (page_h - cy) * mm, (cx + sx * length) * mm, (page_h - cy) * mm)
            c.line(cx * mm, (page_h - cy) * mm, cx * mm, (page_h - cy - sy * length) * mm)


def build(path, pagesize, label):
    pw, ph = pagesize[0] / mm, pagesize[1] / mm
    c = canvas.Canvas(str(path), pagesize=pagesize)
    c.setTitle("Ring measurement sheet (20 mm marker)")
    c.setAuthor("Ring Sizer prototype")

    def text(x, y_top, s, size=10, grey=0.1, font="Helvetica"):
        c.setFillGray(grey)
        c.setFont(font, size)
        c.drawString(x * mm, (ph - y_top) * mm, s)

    left = (pw - FRAME_W) / 2
    text(left, 22, "Ring measurement sheet", 16, 0.05, "Helvetica-Bold")
    text(left, 29, f"Print at 100% / \"Actual size\" on {label}. Do not use \"Fit to page\".", 9.5, 0.25)

    fy = 40.0  # frame top
    ticks(c, left, fy, FRAME_W, FRAME_H, ph, length=7, grey=0.6, lw=0.3)
    draw_marker(c, left + MARKER_X, fy + MARKER_Y, ph)
    ticks(c, left + ZONE_X, fy + ZONE_Y, ZONE, ZONE, ph)
    text(left + ZONE_X + 6, fy + ZONE_Y + ZONE + 5.5, "Lay the ring flat inside these corners", 7.5, 0.55)
    text(left + MARKER_X - 2, fy + MARKER_Y + MARKER + 9.5, "20 mm scale marker", 7.5, 0.55)

    # print-scale check
    y = fy + FRAME_H + 22
    text(left, y, "Print check", 11, 0.05, "Helvetica-Bold")
    c.setStrokeGray(0)
    tick = 0.2  # mm; end marks sit inside the line so their OUTER edges are exactly 100 mm apart
    c.setLineWidth(tick * mm)
    ly = y + 9
    c.line(left * mm, (ph - ly) * mm, (left + 100) * mm, (ph - ly) * mm)
    for x in (tick / 2, 50, 100 - tick / 2):
        c.line((left + x) * mm, (ph - ly + 2.5) * mm, (left + x) * mm, (ph - ly - 2.5) * mm)
    text(left, ly + 8, "Measure with a ruler from the outer edge of the left end mark to the outer edge of the", 9, 0.25)
    text(left, ly + 12.5, "right end mark (middle mark = 50 mm). 99.5 to 100.5 mm is correct. Anything else means", 9, 0.25)
    text(left, ly + 17, "the page was resized: reprint at 100% / \"Actual size\" before taking any photo.", 9, 0.25)

    # capture instructions
    y = ly + 31
    text(left, y, "How to take the photo", 11, 0.05, "Helvetica-Bold")
    steps = [
        "1.  Put this sheet on a flat table in soft, even light. No flash, no hard shadows.",
        "2.  Lay one ring flat inside the corner marks, so white paper shows through it.",
        "3.  Hold the phone level, directly above the ring, about 25 cm away. No zoom.",
        "4.  Step back until the full width of this page fits in the frame. Do not move in closer.",
        "5.  Tap the marker to focus, hold still, take the photo, then upload it.",
    ]
    for i, s in enumerate(steps):
        text(left, y + 7 + i * 5.5, s, 9.5, 0.2)

    y = y + 7 + len(steps) * 5.5 + 8
    text(left, y, "Supported: one ring, near-overhead photo (up to about 10 degrees of tilt), sharp focus,", 8, 0.45)
    text(left, y + 4, "plain white paper. The app asks for a retake rather than guess when these are not met.", 8, 0.45)
    c.showPage()
    c.save()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build(OUT / "ring-sheet-a4.pdf", A4, "A4 paper")
    build(OUT / "ring-sheet-letter.pdf", letter, "US Letter paper")
    print("wrote", sorted(p.name for p in OUT.glob("*.pdf")))
