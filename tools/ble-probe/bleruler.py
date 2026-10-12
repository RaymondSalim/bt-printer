import asyncio
from PIL import Image, ImageDraw, ImageFont
from bleak import BleakScanner, BleakClient
WRITE = "0000ff02-0000-1000-8000-00805f9b34fb"
W, H = 576, 64
img = Image.new("1", (W, H), 1)
d = ImageDraw.Draw(img)
try: font = ImageFont.load_default(size=14)
except TypeError: font = ImageFont.load_default()
d.rectangle([0, 0, 2, H-1], fill=0)          # left edge bar, dots 0-2
d.rectangle([W-3, 0, W-1, H-1], fill=0)      # right edge bar, dots 573-575
for x in range(0, W+1, 32):                  # tick every 4 mm
    xx = min(x, W-1)
    d.line([xx, H-1, xx, H-1-(26 if x % 64 == 0 else 12)], fill=0)
for x in range(0, W+1, 64):                  # label every 8 mm
    xx = min(x, W-1)
    t = str(x // 8)
    tw = d.textlength(t, font=font)
    d.text((min(max(xx - tw/2, 4), W - tw - 4), 2), t, font=font, fill=0)
d.line([383, 0, 383, 30], fill=0, width=2)   # end of a 384-dot area
d.text((388, 34), "<384", font=font, fill=0)
bits = img.point(lambda p: 0 if p else 1).convert("1")  # 1 = black
rowbytes = W // 8
raw = bytearray()
for y in range(H):
    for xb in range(rowbytes):
        v = 0
        for b in range(8):
            if bits.getpixel((xb*8+b, y)): v |= 0x80 >> b
        raw.append(v)
job = bytearray(b"\x1b\x40")
job += b"RULER mm, 576 dots\n"
job += b"\x1d\x76\x30\x00" + bytes([rowbytes, 0, H & 0xFF, H >> 8]) + bytes(raw)
job += b"\n|text default\n"
job += b"\x1b\x24\x00\x00|ESC $ 0\n"
job += b"\x1b\x24\xc0\x00|ESC $ 192 dots\n"
job += b"\x1b\x64\x04"

async def main():
    dev = await BleakScanner.find_device_by_filter(lambda d,a:(a.local_name or d.name or "")=="RPP02N", timeout=15)
    if not dev: print("not found"); return
    async with BleakClient(dev, timeout=20) as c:
        print(f"job {len(job)} bytes")
        for i in range(0, len(job), 200):
            await c.write_gatt_char(WRITE, bytes(job[i:i+200]), response=True)
            await asyncio.sleep(0.03)
        await asyncio.sleep(3)
    print("done")
asyncio.run(main())
