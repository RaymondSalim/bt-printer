import asyncio
from bleak import BleakScanner, BleakClient
async def main():
    dev = await BleakScanner.find_device_by_filter(lambda d,a: (a.local_name or d.name or "")=="RPP02N", timeout=15)
    if not dev: print("not found"); return
    print("found", dev.address)
    async with BleakClient(dev, timeout=20) as c:
        try: print("MTU (reported):", c.mtu_size)
        except Exception as e: print("mtu err", e)
        for s in c.services:
            print(f"\nSERVICE {s.uuid}  ({s.description})")
            for ch in s.characteristics:
                line = f"  CHAR {ch.uuid}  props={ch.properties}"
                if "read" in ch.properties:
                    try:
                        v = await c.read_gatt_char(ch)
                        try: txt = v.decode('utf-8')
                        except: txt = ''
                        line += f"  value={bytes(v).hex()} {repr(txt) if txt.isprintable() and txt else ''}"
                    except Exception as e:
                        line += f"  read-err={e}"
                print(line)
                for d in ch.descriptors:
                    print(f"      DESC {d.uuid}")
asyncio.run(main())
