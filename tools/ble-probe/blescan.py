import asyncio
from bleak import BleakScanner
async def main():
    seen = await BleakScanner.discover(timeout=12.0, return_adv=True)
    print(f"{len(seen)} BLE devices seen")
    for addr,(d,adv) in sorted(seen.items(), key=lambda kv: -(kv[1][1].rssi or -999)):
        name = adv.local_name or d.name or "?"
        flag = "  <<<<<<" if any(k in name.lower() for k in ("rpp","putian","pos","print","thermal")) else ""
        print(f"{name:28} rssi={adv.rssi} id={addr} svc={adv.service_uuids} mfr={ {k:v.hex() for k,v in adv.manufacturer_data.items()} }{flag}")
asyncio.run(main())
