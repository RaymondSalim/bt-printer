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

## Browser spike results (partial, 2026-10-12)

Measured from Chrome on macOS over Web Bluetooth using the spike page, defaults of 200-byte chunks, 30 ms delay, 0 ms band pause, 128-row bands, write-with-response. Chrome version was not recorded.

| Rows | Bytes | Parts | Time | Rate | Result |
|---|---|---|---|---|---|
| 64 (ruler) | 4,621 | 3 | 1.5 s | 3.0 KiB/s | printed solid |
| 300 | 21,629 | 5 | 6.9 s | 3.1 KiB/s | printed solid |
| 600 | 43,245 | 7 | 34.2 s | 1.2 KiB/s | printed solid, but 2.5x slower than expected; cause unknown |
| 1200 | 86,485 | 12 | 26.9 s | 3.1 KiB/s | printed solid |
| 2400 | 172,957 | 21 | failed after 16,426 bytes | | printer ran out of battery; Chrome reported `NotSupportedError: GATT operation failed for unknown reason` |

What this establishes: the browser path works end to end, and jobs up to 1200 rows (86 KB) print with no dropped or reordered data at 30 ms between 200-byte chunks. The link rate of about 3.1 KiB/s is roughly 63 ms per chunk (30 ms delay plus about 33 ms acknowledgement). The print engine (60 to 70 mm/s listed) can consume far more than that, so no buffer overrun was seen and the link is the bottleneck.

Not established: whether 2400 rows (or any larger single job) prints, since the failure coincided with the battery dying; the smallest safe chunk delay; whether 237-byte chunks work; the cause of the slow 600-row run; whether Chrome asks to re-pair after a reload; and the status reply (the Status button was not recorded). A repeat on a charged battery, trying delay 10 and 0 and 237-byte chunks at 1200 rows, then 2400 rows twice, would settle these. If 2400 rows fails at about 16 KB again on a full charge, the failure is not battery related.

## Link sweep over BLE (2026-10-25)

Measured with `tools/ble-probe/blesweep.py` (Python/bleak on macOS, same job format as the app: `ESC @`, 128-row `GS v 0` bands, `ESC d 4`). Each run printed a 400-row labelled pattern (about 28.8 KB). Status replies were `16 12 12 12`, which confirms the all-clear decoding in `src/printer/status.ts`.

| Run | Chunk | Delay | Write mode | Time | Rate | Slip (owner photo) |
|---|---|---|---|---|---|---|
| A | 200 B | 30 ms | response | 9.0 s | 3.1 KiB/s | wobbly diagonal, wavering left border, stray text near the title |
| B | 200 B | 10 ms | response | 4.8 s | 5.9 KiB/s | clean |
| C | 200 B | 0 ms | response | 4.6 s | 6.1 KiB/s | clean |
| D | 237 B | 10 ms | response | 3.8 s | 7.5 KiB/s | clean |
| E | 237 B | 0 ms | response | 3.8 s | 7.5 KiB/s | clean |
| F | 237 B | 10 ms | no response | 1.4 s | 19.8 KiB/s | cut off near row 250, no right edge or bottom border |

Findings:

- At 30 ms the data arrives slower than the head consumes it, so the head stalls and the diagonal prints wobbly. Faster transfer gives better print quality as well as speed.
- Going from 10 ms to 0 ms barely changes the rate, because each write waits for its acknowledgement. Raising the chunk size from 200 to 237 bytes adds about 25 percent.
- F (write without response) is unresolved. The slip was truncated, which could mean dropped data or only that the final feed had not pushed the last 12 to 20 mm out from under the head before the paper was torn. A rerun with an extra feed sent afterwards (`--only F --tail-feed 10`) settles it. Until then, writes stay with response.
- Run D alone proved not to be safe for dense content; see the pacing section below, which supersedes this table for choosing defaults.

The printer stopped advertising BLE after sitting idle and had to be switched on again before further tests; the app should treat "not found" as a prompt to wake the printer.


## Input buffer, pacing and tear distance (2026-10-25)

The printer has a small input buffer and drops bytes when it is outrun; write-with-response only acknowledges the BLE link, not the print engine. Dense content prints slower than sparse content, so the safe send rate depends on what is printed.

| Run | Content | Settings | Result |
|---|---|---|---|
| F, twice | sparse, 400 rows | 237 B, 10 ms, no response, 19.8 KiB/s | output ends near row 250 both times (about 18 KB sent); the second run also began with leftover fragments from the first |
| D dense | 40-row black bands alternating with white, 800 rows | 237 B, 10 ms, response, 128-row bands, no pause, 7.2 KiB/s | first 720 rows correct, then the label is shifted and wrapped across the paper and junk follows; reproduced without any resync or extra feed, so it is data loss |
| D dense, ping | same, 800 rows | 32-row bands, `GS I 1` wait after each band, 5.4 KiB/s effective | complete and clean |
| D solid | near-solid black, 400 rows | 32-row bands, 90 ms pause after each band, 5.4 KiB/s | complete and clean |
| D solid long | near-solid black, 1200 rows plus 96 blank rows | same pacing, 5.6 KiB/s | complete and clean to the end marker |

Conclusions:

- Defaults are now 237-byte chunks, 10 ms between chunks, 32-row bands and a 90 ms pause after each band (about 5.5 KiB/s). Write without response is rejected. Faster pacing was not explored beyond this; a density-aware pause could recover speed on light content.
- Corruption from a lost byte is a sideways shift of everything after it (text wraps across the paper edge), followed by junk, because the raster parser loses its place mid-band.
- `GS I 1` is answered about 0.09 s after it is sent regardless of how much data is still queued, so it cannot be used as a "buffer drained" flow-control marker.
- A resync that sends a band's worth of zero bytes followed by `ESC @` clears a printer stuck mid-band (`resync()` in `tools/ble-probe/blesweep.py`); NUL bytes outside a command are ignored.
- `ESC d 4` feeds almost nothing on this unit. The tear bar sits about 70 rows (about 9 mm) beyond the head: without trailing blank rows the last 60 rows of a print were torn off, and 80 blank rows left about 10 rows of margin. The encoder now appends 96 blank rows to every job.
- Status replies `16 12 12 12` were confirmed again, and the printer powers itself off after sitting idle.

Still open: whether Chrome asks to re-pair after a page reload (needs the browser), and a 2400-row job at the new pacing in the browser.

## Shopee shipping label PDFs (2026-10-26)

Three sample files from the Shopee seller centre (one JNE Reguler, two SPX Standard), created by Chromium and post-processed with pdfcpu. Each is a single landscape A4 page (842 x 595 pt). The label sits in the left half with a dashed cut line down the middle; the right half was empty with one order per file. The label plus its product table is about 139 to 145 mm wide and about 130 mm tall. Barcodes and the QR code are embedded raster images, not vector. The JNE label has a Code 128 barcode of the tracking number and a smaller Code 128 of the order number. The SPX labels add a QR code of the tracking number and tiny rotated tracking text along the edges.

Fitting the label to 552 dots (69 mm, inside the 12-dot margins) means scaling to about 48 to 50 percent of native size, which makes the main barcode bars roughly 2.3 dots wide.

Scan test with the zxing-wasm decoder in strict mode (no try-harder, rotate, invert or downscale), rendering the label directly at the target size with `pdftoppm`, then thresholding to 1 bit:

- The main Code 128 tracking barcode and the QR code decode on all three labels at 540, 552 and 564 px wide and at small sub-pixel shifts. They keep decoding when the 1-bit threshold is moved anywhere from 80 to 200, which emulates a fraction of a dot of ink spread.
- A full one-dot growth or shrink of every edge breaks the Code 128 barcodes on all three labels. The QR code survives it. The JNE label has no QR, so its only tracking barcode is the fragile one.
- The small order-number barcode decodes at 300 dpi but not at the target size.

This is software decoding of a clean raster. Whether a courier's handheld scanner reads the printed slip is untested. If it does not, the fallback is to read the tracking number from the PDF text layer and redraw the barcode with the app's own Code 128 encoder at an integer module width.
