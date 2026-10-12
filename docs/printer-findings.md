# Printer findings: Putian POS 802 (advertises as "RPP02N")

Measured on the owner's unit on 2026-10-12 over BLE from macOS using the scripts in `tools/ble-probe/` (run with `uv run --with bleak --with pillow python <script>`). "Verified" means observed on this unit. "Reported" means taken from third-party repos or listings for other units and not confirmed here.

## Identity

The retail model is Putian POS 802 (PT Putian POS Teknologi, Indonesia). The Bluetooth name `RPP02N` is only an advertised name. The firmware replies to Epson-style `GS I` queries with:

| Query | Reply |
|---|---|
| `GS I 65` firmware | `802-NO-SPI-9020` |
| `GS I 66` manufacturer | `-GEZHI` |
| `GS I 67` model | `-PT2D-V1.0` |
| `GS I 68` type | `_17030800001` |
| `GS I 1/2/3` | `0x60`, `0x03`, `0x14` |

The leading `-` and `_` are as received and do not match the Epson reply format. Nothing public was found for GEZHI, PT2D or `802-NO-SPI`. The Rongta RPP02N is a different, 58 mm product, so Rongta/RPP02N settings found online (32 cpl, 384 dots) must not be assumed.

## BLE (verified)

Advertised services: `18f0`, `e7810a71-73ae-499d-8c15-faa9aef0c3f2`. Manufacturer data decodes to the classic MAC `86:67:7A:B9:A5:73` (inferred). MTU 240.

| Service | Characteristics |
|---|---|
| `0000ff00` | `ff01` notify, `ff02` write + write-without-response, `ff03` notify |
| `000018f0` | `2af0` notify, `2af1` write + write-without-response, `ff03` notify |
| `0000fee7` | `fec8` indicate, `fec7` write + write-without-response |
| `e7810a71-...` | `bef8d6c9-...` read/write/notify/indicate (reads `00`) |
| `49535343-fe7d-...` | `...1e4d` notify, `...8841` write, `...aca3` write + notify |

Commands written to `ff02` are executed and replies arrive as notifications on `ff01`. The other write characteristics were not tested.

Write path used successfully: `ff02`, 200-byte chunks, write-with-response, 30 ms between chunks (6.7 KB jobs). Larger jobs and flow control are untested.

Reported for other units: write-without-response followed by an immediate disconnect drops data, and the BLE radio sometimes does not advertise after a power cycle until a BLE printer app connects once.

## Status replies (verified)

`DLE EOT 1..4` returned `16 12 12 12` and `GS r 1` returned `00`, which read as online, cover closed, paper present, no errors. `1F 11 08` (battery query on some printers) got no reply, so battery level could not be read.

At least one of the 13 query commands sent in the first probe made the printer feed paper. Which one is unknown.

## Print geometry (verified)

The head is 576 dots wide (72 mm printable, 8 dots/mm). Raster output (`GS v 0`, 72 bytes per row) starts at the paper's left edge, reaches the right edge, and neither wraps nor clips. Boxes of 32, 48, 56, 64 and 72 bytes per row all printed.

Text mode behaves differently:

- The ruler wraps at 32 characters in font A and the same in font B (`ESC M 1` had no effect).
- `GS L 0 0` and `GS W 576` had no visible effect.
- Default text starts about 23 mm in (about 192 dots, equal to 576 minus 384), so the firmware places a 384-dot text area flush right.
- `ESC a 2` (right align) reaches the right edge. Left and centre alignment and the QR code are offset by the same amount.
- `ESC $ 0` starts at 0 mm and `ESC $ 192` at about 25 mm, so absolute positioning works.

The loaded roll is 78 mm wide (owner-reported), and the printable area is 72 mm, leaving a small margin on each side.

## Feature checks (verified)

QR (`GS ( k`), CODE128 with human-readable digits (`GS k 73`, `GS H 2`) and double size (`GS ! 0x11`) all printed, with the text-area offset above.

## Decision for the web app

Render everything (receipt text, shipping labels, QR, barcodes) to a 576-pixel-wide 1-bit canvas in the browser and send it as `GS v 0` raster. This sidesteps the text-mode quirks, gives full Unicode and layout control, and the origin is known to be the left edge. A 600-row label is about 43 KB.

## Open items

- Gap/black-mark detection for sticker rolls is untested; the vendor listing mentions label use but the firmware's behavior is unknown.
- Raster throughput, buffer limits and flow control for long jobs.
- Whether a cutter exists, print density and speed settings, and the effect of `ESC 3`/`ESC 2` line spacing.
- Battery level reading, and which command caused the paper feed.
- Web Bluetooth is not available in Safari; the app needs Chrome or Edge.
