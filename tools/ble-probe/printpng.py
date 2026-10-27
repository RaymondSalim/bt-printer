"""Print one or more PNG images on the printer with the app's job format and pacing.

Each image is centred on the 576-dot line, thresholded at 128 (black below), sent in
32-row bands with a 90 ms pause after each, followed by 96 blank rows.

Run: uv run --with bleak --with pillow python tools/ble-probe/printpng.py a.png b.png
"""
import asyncio
import sys
import time

from bleak import BleakClient, BleakScanner
from PIL import Image

WRITE = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb"
W, ROW_BYTES, BAND_ROWS, TAIL_ROWS = 576, 72, 32, 96
CHUNK, DELAY, BAND_PAUSE = 237, 0.010, 0.090


def to_raw(path: str) -> tuple[bytes, int]:
    img = Image.open(path).convert("L")
    if img.width > W:
        raise SystemExit(f"{path}: {img.width}px is wider than {W}")
    canvas = Image.new("L", (W, img.height + TAIL_ROWS), 255)
    canvas.paste(img, ((W - img.width) // 2, 0))
    px = canvas.load()
    raw = bytearray()
    for y in range(canvas.height):
        for xb in range(ROW_BYTES):
            v = 0
            for bit in range(8):
                if px[xb * 8 + bit, y] < 128:
                    v |= 0x80 >> bit
            raw.append(v)
    return bytes(raw), canvas.height


def job(raw: bytes, rows: int) -> list[bytes]:
    parts = [b"\x1b\x40"]
    for top in range(0, rows, BAND_ROWS):
        n = min(BAND_ROWS, rows - top)
        header = bytes([0x1D, 0x76, 0x30, 0x00, ROW_BYTES, 0x00, n & 0xFF, n >> 8])
        parts.append(header + raw[top * ROW_BYTES:(top + n) * ROW_BYTES])
    return parts


async def send(client, parts):
    chunks = [(p[i:i + CHUNK], i + CHUNK >= len(p)) for p in parts for i in range(0, len(p), CHUNK)]
    for i, (c, ends_part) in enumerate(chunks):
        await client.write_gatt_char(WRITE, c, response=True)
        if i < len(chunks) - 1:
            await asyncio.sleep(DELAY + (BAND_PAUSE if ends_part else 0))


async def main(paths):
    dev = await BleakScanner.find_device_by_filter(
        lambda d, a: (a.local_name or d.name or "") == "RPP02N", timeout=15
    )
    if not dev:
        print("printer not found (is it switched on?)")
        return
    replies = []
    async with BleakClient(dev, timeout=20) as c:
        await c.start_notify(NOTIFY, lambda _, d: replies.append(bytes(d)))
        status = []
        for n in (1, 2, 3, 4):
            replies.clear()
            await c.write_gatt_char(WRITE, bytes([0x10, 0x04, n]), response=True)
            await asyncio.sleep(0.6)
            status.append(replies[0].hex() if replies else "none")
        print("status:", status, flush=True)
        for path in paths:
            raw, rows = to_raw(path)
            parts = job(raw, rows)
            t0 = time.perf_counter()
            await send(c, parts)
            print(f"{path}: {rows} rows, {sum(map(len, parts))} B in {time.perf_counter() - t0:.1f}s", flush=True)
            await asyncio.sleep(8)


asyncio.run(main(sys.argv[1:]))
