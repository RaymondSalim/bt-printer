"""Writes a calibration PNG for checking the printer's dot aspect ratio.

At the nominal 8 dots per millimetre the square is 50 x 50 mm, the two horizontal bars
are 100 mm apart and the vertical bars are 72 mm apart. Print it with printpng.py and
measure the printout with a ruler: a smaller vertical than horizontal measurement means
the paper advances less than one dot pitch per row.

Run: uv run --with pillow python tools/ble-probe/calibration.py out.png
"""
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 576, 812
img = Image.new("L", (W, H), 255)
d = ImageDraw.Draw(img)
font = ImageFont.load_default(size=22)
small = ImageFont.load_default(size=18)

d.rectangle([0, 0, 3, H - 1], fill=0)  # left edge bar
d.rectangle([W - 4, 0, W - 1, H - 1], fill=0)  # right edge bar: 576 dots = 72 mm nominal
d.rectangle([0, 0, W - 1, 3], fill=0)  # top bar
d.rectangle([0, 800, W - 1, 803], fill=0)  # bottom bar: 800 rows = 100 mm nominal
d.rectangle([88, 200, 487, 599], outline=0, width=4)  # 400 x 400 dots = 50 x 50 mm nominal
d.line([88, 200, 487, 599], fill=0, width=2)
d.line([487, 200, 88, 599], fill=0, width=2)
d.text((110, 80), "CALIBRATION  8 dots/mm", fill=0, font=font)
d.text((100, 640), "square = 50 x 50 mm", fill=0, font=font)
d.text((100, 670), "bars = 100 mm apart", fill=0, font=font)
d.text((100, 700), "edges = 72 mm apart", fill=0, font=font)
for mm in range(0, 101, 10):  # a tick and label every 10 mm down the left side
    y = min(mm * 8, 800)
    d.line([4, y, 40 if mm % 20 == 0 else 24, y], fill=0, width=2)
    if mm % 20 == 0 and 0 < mm < 100:
        d.text((46, y - 11), f"{mm}", fill=0, font=small)
for mm in range(0, 73, 8):  # horizontal ticks every 8 mm below the top bar
    x = min(mm * 8, W - 5)
    d.line([x, 4, x, 24], fill=0, width=2)
img.save(sys.argv[1] if len(sys.argv) > 1 else "calibration.png")
print("wrote", sys.argv[1] if len(sys.argv) > 1 else "calibration.png", img.size)
