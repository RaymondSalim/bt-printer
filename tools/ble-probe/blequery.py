import asyncio
from bleak import BleakScanner, BleakClient
NOTIFY = ["0000ff01-0000-1000-8000-00805f9b34fb","0000ff03-0000-1000-8000-00805f9b34fb",
          "00002af0-0000-1000-8000-00805f9b34fb","0000fec8-0000-1000-8000-00805f9b34fb",
          "49535343-1e4d-4bd9-ba61-23c647249616","49535343-aca3-481c-91ec-d85e28a60318",
          "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f"]
WRITE = "0000ff02-0000-1000-8000-00805f9b34fb"
QUERIES = [
 ("GS I 1  model id",      b"\x1d\x49\x01"),
 ("GS I 2  type info",     b"\x1d\x49\x02"),
 ("GS I 3  ROM version",   b"\x1d\x49\x03"),
 ("GS I 65 firmware ver",  b"\x1d\x49\x41"),
 ("GS I 66 manufacturer",  b"\x1d\x49\x42"),
 ("GS I 67 model name",    b"\x1d\x49\x43"),
 ("GS I 68 type",          b"\x1d\x49\x44"),
 ("DLE EOT 1 printer",     b"\x10\x04\x01"),
 ("DLE EOT 2 offline",     b"\x10\x04\x02"),
 ("DLE EOT 3 error",       b"\x10\x04\x03"),
 ("DLE EOT 4 paper",       b"\x10\x04\x04"),
 ("GS r 1  paper sensor",  b"\x1d\x72\x01"),
 ("GS r 2  drawer",        b"\x1d\x72\x02"),
]
async def main():
    dev = await BleakScanner.find_device_by_filter(lambda d,a:(a.local_name or d.name or "")=="RPP02N", timeout=15)
    if not dev: print("not found"); return
    cur = {"label": "(idle)"}
    def mk(u):
        def cb(_, data): print(f"   <- notify {u[:8]}  {bytes(data).hex()}  {bytes(data)!r}")
        return cb
    async with BleakClient(dev, timeout=20) as c:
        for u in NOTIFY:
            try: await c.start_notify(u, mk(u))
            except Exception as e: print("notify fail", u[:8], e)
        await asyncio.sleep(1.0)
        for label, cmd in QUERIES:
            print(f"-> {label}: {cmd.hex()}")
            await c.write_gatt_char(WRITE, cmd, response=False)
            await asyncio.sleep(0.8)
        await asyncio.sleep(1.5)
asyncio.run(main())
