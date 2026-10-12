# Receipt and shipping label web app: design

Date: 2026-10-12. Status: awaiting spec review.

## Purpose and scope

A browser app, for the owner's own use, that prints receipts and shipping labels on a Putian POS 802 thermal printer over Bluetooth LE. Content comes from forms typed into the app and from PDF and CSV imports. Paper is a 78 mm roll with 72 mm printable (576 dots at 203 dpi), either plain continuous thermal paper or sticker rolls with gaps, switchable per job.

Out of scope: other printer models, a backend, accounts, order-system or marketplace API integrations, multi-user use, and distribution to others.

Hardware facts this design relies on are in `docs/printer-findings.md`. In short: BLE service `ff00`, write characteristic `ff02`, replies on `ff01`, MTU 240, raster (`GS v 0`, 72 bytes per row) starts at the paper's left edge and fills the full 576 dots, while the firmware's text mode is unreliable (32-character cap, 192-dot offset, ignored `GS L`, `GS W` and `ESC M`). Web Bluetooth works in Chrome and Edge only, and only on HTTPS or localhost.

## Decision: canvas raster for everything

Every document is drawn to a 576-pixel-wide canvas, converted to 1-bit, and sent as `GS v 0` raster. Rejected alternatives: HTML/CSS templates rasterized from the DOM (preview and print can differ, extra dependency) and native ESC/POS text for receipts (two rendering paths plus workarounds for firmware quirks). Raster is the only mode verified on this unit, the preview is the exact canvas that prints, and Unicode and fonts need no special handling. The cost is larger payloads (about 43 KB for a 600-row label) and a thresholding step to keep text crisp.

## Architecture

A static Vite + TypeScript single-page app with no backend and no UI framework (vanilla TS, revisited only if the forms become unwieldy). Tests use Vitest. Dependencies: `pdfjs-dist` (PDF rendering), a QR library, JsBarcode (CODE128), and Papa Parse (CSV). Package manager: npm.

Four units with narrow interfaces:

- `printer`: wraps Web Bluetooth. Connects to service `ff00`, writes to `ff02` in 200-byte chunks with write-with-response, and exposes `connect()`, `send(bytes, onProgress)`, `disconnect()` and status queries (`DLE EOT`, `GS I`). Defined behind an interface so tests use a fake.
- `encode`: pure function from a canvas to bytes. Converts to 1-bit by threshold or dither, packs 72 bytes per row, and emits `ESC @`, the raster in bands of about 128 rows per `GS v 0` command, then a feed. Sticker mode adds gap handling, which is a stub until tested with real stickers.
- `render`: draws a document model (text, rules, tables, QR, barcodes, page images) onto the 576-pixel canvas. Two templates: receipt and shipping label. Knows nothing about Bluetooth.
- `import`: renders a PDF page with pdf.js, then scales, crops and rotates it to 576 pixels. Parses a CSV into rows mapped onto template fields so one file can produce a batch.

The UI consists of forms, a live preview of the print canvas, an import dialog with scale, crop and rotate controls, a print button with progress, and printer status.

## Data flow

A form or import produces a document model with paper mode and options. `render` draws it, the preview shows the canvas, and Print runs `encode` then `printer.send`. A CSV batch runs the same pipeline once per row, one print at a time; the next job starts only after the previous one is fully sent and the status query shows the printer online with paper.

Imported PDF pages are rendered relative to the target physical size and scaled to 72 mm wide. The preview warns when the scale is below about 70 percent, since small barcodes may not scan. A printed label's scannability is verified manually before relying on it.

## Errors

Web Bluetooth failures are reported specifically: chooser cancelled, device not found, GATT disconnect mid-job, write error. A mid-job disconnect aborts and reports how many bands were sent, since resuming inside an image is not safe. Before printing, the app checks paper (`DLE EOT 4`) and cover (`DLE EOT 2`) and refuses to start if the printer is offline or out of paper. If the printer is not advertising, the connect error mentions the known workaround of connecting once from a BLE printer app, which brings the radio back after a power cycle on some units.

## Testing

Unit tests cover `encode` (known bitmaps give the exact `GS v 0` bytes, packing, banding, thresholding), CSV-to-field mapping and the scale and crop math. `printer` is tested against a fake GATT device for chunking, ordering and abort. Image snapshots check the receipt and label templates. Hardware verification is a manual checklist kept in the repo (ruler, box, QR scan, CODE128 scan, long image), because BLE cannot run in CI.

## Milestones

0. Spike: print a browser canvas from Chrome over Web Bluetooth, including a long image (600 rows and more) to measure throughput and find buffer-overrun limits. This sets band size and chunk delay.
1. `encode` and `printer` with tests and the fake device.
2. `render`, the receipt form and the preview.
3. Shipping label template with QR and CODE128, on continuous paper.
4. PDF import with scale, crop and rotate.
5. CSV batch printing.
6. Sticker (gapped) mode, only once real sticker rolls are available to test gap behavior.

## Risks and open items

- Large jobs may overrun the printer's buffer; write-with-response only paces the BLE link. Milestone 0 measures this.
- Chrome may require re-picking the printer each session; reconnect behavior is to be confirmed.
- Gap or mark detection on this firmware is untested.
- Scaled-down A6 labels may produce unscannable barcodes; the real PDFs the owner will use are not yet known.
- The printer sleeps on low battery and was observed disappearing from BLE at low charge.
