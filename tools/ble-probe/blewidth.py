import asyncio
from bleak import BleakScanner, BleakClient
WRITE = "0000ff02-0000-1000-8000-00805f9b34fb"
NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb"

def box(width_bytes, rows=24):
    # Hollow box: full top/bottom rows, 2-dot edge marks on the left and right edges.
    out = bytearray(b"\x1d\x76\x30\x00" + bytes([width_bytes & 0xFF, width_bytes >> 8, rows & 0xFF, rows >> 8]))
    for r in range(rows):
        if r in (0, rows - 1):
            out += b"\xff" * width_bytes
        else:
            out += b"\xc0" + b"\x00" * (width_bytes - 2) + b"\x03"
    return bytes(out)

payload = bytearray(b"\x1b\x40\x1b\x61\x00")
payload += b"WIDTH TEST\n"
payload += (b"1234567890" * 6) + b"\n"
payload += b"^ count chars per line above\n\n"
for wb in (32, 48, 56, 64, 72):
    payload += f"{wb} bytes = {wb*8} dots\n".encode()
    payload += box(wb)
    payload += b"\n"
payload += b"END\n\x1b\x64\x04"

async def main():
    dev = await BleakScanner.find_device_by_filter(lambda d,a:(a.local_name or d.name or "")=="RPP02N", timeout=15)
    if not dev: print("not found"); return
    async with BleakClient(dev, timeout=20) as c:
        await c.start_notify(NOTIFY, lambda _,d: print("notify", bytes(d).hex()))
        CH = 200
        print(f"sending {len(payload)} bytes in {-(-len(payload)//CH)} chunks")
        for i in range(0, len(payload), CH):
            await c.write_gatt_char(WRITE, bytes(payload[i:i+CH]), response=True)
            await asyncio.sleep(0.03)
        await asyncio.sleep(3)
    print("done")
asyncio.run(main())
