import asyncio
from bleak import BleakScanner, BleakClient
WRITE = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb"
R = b"1234567890" * 6 + b"\n"

def qr(data, size=5):
    n = len(data) + 3
    return (b"\x1d\x28\x6b\x04\x00\x31\x41\x32\x00" + b"\x1d\x28\x6b\x03\x00\x31\x43" + bytes([size]) +
            b"\x1d\x28\x6b\x03\x00\x31\x45\x31" + b"\x1d\x28\x6b" + bytes([n & 0xFF, n >> 8]) + b"\x31\x50\x30" + data +
            b"\x1d\x28\x6b\x03\x00\x31\x51\x30")

job = bytearray(b"\x1b\x40")
job += b"B: GS L=0 GS W=576\n" + b"\x1d\x4c\x00\x00" + b"\x1d\x57\x40\x02" + R
job += b"C: font B\n" + b"\x1b\x4d\x01" + R + b"\x1b\x4d\x00"
job += b"D: align\n" + b"\x1b\x61\x01CENTER\n" + b"\x1b\x61\x02RIGHT\n" + b"\x1b\x61\x00LEFT\n"
job += b"E: QR (centered)\n" + b"\x1b\x61\x01" + qr(b"https://example.com/track/123") + b"\n" + b"\x1b\x61\x00"
job += b"F: CODE128\n" + b"\x1b\x61\x01\x1d\x48\x02\x1d\x68\x50\x1d\x77\x02" + b"\x1d\x6b\x49\x0a{BTEST12345" + b"\n\x1b\x61\x00"
job += b"G: 2x size\n" + b"\x1d\x21\x11BIG\n\x1d\x21\x00"
job += b"\x1b\x64\x04"

async def main():
    dev = await BleakScanner.find_device_by_filter(lambda d,a:(a.local_name or d.name or "")=="RPP02N", timeout=15)
    if not dev: print("not found"); return
    async with BleakClient(dev, timeout=20) as c:
        await c.start_notify(NOTIFY, lambda _,d: print("   <- notify", bytes(d).hex(), bytes(d)))
        for label, cmd in [("battery? 1F 11 08", b"\x1f\x11\x08"), ("ESC v paper", b"\x1b\x76")]:
            print("->", label)
            await c.write_gatt_char(WRITE, cmd, response=True)
            await asyncio.sleep(1.0)
        print(f"-> job {len(job)} bytes")
        for i in range(0, len(job), 200):
            await c.write_gatt_char(WRITE, bytes(job[i:i+200]), response=True)
            await asyncio.sleep(0.03)
        await asyncio.sleep(3)
    print("done")
asyncio.run(main())
