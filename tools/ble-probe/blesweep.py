"""Link-limit sweep: reads the status replies, then prints a labelled pattern under several
chunk-size / delay / write-mode settings and reports throughput.

Run: uv run --with bleak --with pillow python tools/ble-probe/blesweep.py
"""
import argparse
import asyncio
import time

from bleak import BleakClient, BleakScanner
from PIL import Image, ImageDraw, ImageFont

WRITE = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb"
W = 576
ROW_BYTES = W // 8
BAND_ROWS = 128
ROWS = 400

parser = argparse.ArgumentParser()
parser.add_argument("--only", default="", help="comma-separated config names, for example D,F")
parser.add_argument("--rows", type=int, default=ROWS)
parser.add_argument("--tail-feed", type=int, default=0, help="send ESC d n as a separate write after each run")
args = parser.parse_args()

# (name, chunk bytes, delay ms, write with response)
CONFIGS = [
    ("A", 200, 30, True),
    ("B", 200, 10, True),
    ("C", 200, 0, True),
    ("D", 237, 10, True),
    ("E", 237, 0, True),
    ("F", 237, 10, False),
]


def pattern(title: str, rows: int) -> bytes:
    img = Image.new("L", (W, rows), 255)
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=20)
    d.rectangle([0, 0, W - 1, rows - 1], outline=0, width=3)
    d.text((12, 8), title, fill=0, font=font)
    for y in range(50, rows - 20, 50):
        d.text((12, y), f"row {y:05d}", fill=0, font=font)
        d.rectangle([W - 80, y, W - 20, y + 3], fill=0)
    d.line([3, 3, W - 3, rows - 3], fill=0, width=2)
    bw = img.point(lambda p: 255 if p >= 128 else 0)
    px = bw.load()
    raw = bytearray()
    for y in range(rows):
        for xb in range(ROW_BYTES):
            v = 0
            for bit in range(8):
                if px[xb * 8 + bit, y] == 0:
                    v |= 0x80 >> bit
            raw.append(v)
    return bytes(raw)


def build_job(raw: bytes, rows: int) -> list[bytes]:
    parts = [b"\x1b\x40"]
    for top in range(0, rows, BAND_ROWS):
        n = min(BAND_ROWS, rows - top)
        header = bytes([0x1D, 0x76, 0x30, 0x00, ROW_BYTES & 0xFF, ROW_BYTES >> 8, n & 0xFF, n >> 8])
        parts.append(header + raw[top * ROW_BYTES:(top + n) * ROW_BYTES])
    parts.append(b"\x1b\x64\x04")
    return parts


async def send(client, parts, chunk, delay_ms, response):
    chunks = [p[i:i + chunk] for p in parts for i in range(0, len(p), chunk)]
    sent = 0
    for i, c in enumerate(chunks):
        await client.write_gatt_char(WRITE, c, response=response)
        sent += len(c)
        if i < len(chunks) - 1:
            await asyncio.sleep(delay_ms / 1000)
    return sent


async def main():
    dev = await BleakScanner.find_device_by_filter(
        lambda d, a: (a.local_name or d.name or "") == "RPP02N", timeout=15
    )
    if not dev:
        print("printer not found")
        return
    replies: list[bytes] = []
    async with BleakClient(dev, timeout=20) as c:
        await c.start_notify(NOTIFY, lambda _, data: replies.append(bytes(data)))
        status = []
        for n in (1, 2, 3, 4):
            replies.clear()
            await c.write_gatt_char(WRITE, bytes([0x10, 0x04, n]), response=True)
            await asyncio.sleep(0.8)
            status.append(replies[0].hex() if replies else "none")
        print("status replies (expect 16 12 12 12):", status, flush=True)

        wanted = [n for n in args.only.split(",") if n]
        for name, chunk, delay, resp in [c for c in CONFIGS if not wanted or c[0] in wanted]:
            title = f"{name}: {chunk}B {delay}ms {'resp' if resp else 'noresp'} {args.rows}r"
            parts = build_job(pattern(title, args.rows), args.rows)
            total = sum(len(p) for p in parts)
            t0 = time.perf_counter()
            try:
                sent = await send(c, parts, chunk, delay, resp)
            except Exception as e:  # noqa: BLE001
                print(f"{title}: FAILED after {time.perf_counter() - t0:.1f}s: {type(e).__name__}: {e}", flush=True)
                break
            secs = time.perf_counter() - t0
            print(f"{title}: sent {sent}/{total} B in {secs:.1f}s = {total / 1024 / secs:.1f} KiB/s", flush=True)
            if args.tail_feed:
                await asyncio.sleep(4)
                await c.write_gatt_char(WRITE, bytes([0x1B, 0x64, args.tail_feed]), response=True)
                print(f"{name}: sent tail feed ESC d {args.tail_feed}", flush=True)
            await asyncio.sleep(6)


asyncio.run(main())
