# JayDymo

A small, dependency‑free label editor for the **DYMO LabelWriter 450** (and other LabelWriters).
It opens and saves DYMO files, and it prints through the normal printer driver, so you don't need DYMO's software.

**Run it:** open `index.html` in Chrome, Edge or Firefox. There's no install and no build step, and it works offline.
For in‑place *Save* (instead of a download), use Chrome or Edge.

## Features

- **Editor:** text, images (PNG/JPG/SVG), built‑in vector icons, rectangles, ellipses, lines, Code 128 barcodes and QR codes.
- Move and resize with the mouse, snap to the label edges, centre and other objects, use arrow keys to nudge, and rotate in 90° steps.
- Align, change the stacking order, duplicate, copy/paste, undo/redo, and lock objects.
- Text: font, size, bold/italic/underline, alignment and line spacing. Three fit modes: *shrink to fit*, *always fit* and *fixed*. Text can be printed white on a black box.
- **B/W toggle:** shows how the thermal head will print the label.
- **DYMO compatible:**
  - Opens `.label` (DYMO Label Software 8) and `.dymo` (DYMO Connect) files, and saves to either format.
  - Unsupported DYMO objects (date/time, counters, other barcode types…) are kept unchanged when you save in the same format.
  - Vector images are embedded as 300 dpi PNGs, so DYMO software can read them. JayDymo also stores the original SVG in an XML comment, so the vector comes back when you reopen the file in JayDymo.
- **Label types:** 99010/30252 Address, 99012/30321 Large Address, 99014/30256/30323 Shipping, return address, multipurpose, name badge and file labels, plus a custom size.
- **Templates with your brand:** shipping labels (54×101 / 59×102), large address labels (36×89, DIN‑style return line) and sender labels (28×89). Each has the sender address, receiver address and a square logo.
  Click **Brand** to set your sender address and upload your logo (the Calmy Jane logo). It's stored in the browser and used by all templates.
  The logo that ships with the app is only a placeholder.
- **Printing:**
  - **System print dialog** (recommended): the page size matches the label exactly and is rotated to the printer's feed direction. In the dialog, pick the DYMO printer and the matching paper size, and set the margins to *none*.
    If a label comes out upside down, tick *Turn 180°*.
  - **DYMO Web Service:** if DYMO Connect or DYMO Label Software is running, JayDymo can send the label straight to it.
  - The print preview shows the 300 dpi black & white result.

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+O / Ctrl+S / Ctrl+Shift+S | Open / save / save as |
| Ctrl+P | Print |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+D | Copy / paste / cut / duplicate |
| Del | Delete |
| Arrows (Shift) | Nudge 0.5 mm (2 mm) |
| Shift+drag | Constrain move / keep aspect ratio |
| Alt+drag | Disable snapping |
| T | New text |
| Ctrl+wheel | Zoom |

You can also drop images or `.label`/`.dymo` files onto the canvas, or paste images from the clipboard.

## Files

```
index.html            UI
css/app.css           styles
js/labels.js          DYMO paper sizes
js/model.js           document model, undo history
js/render.js          SVG renderer (editor, print, export)
js/barcode.js         Code 128 + QR encoder
js/icons.js           built-in icons
js/formats/*.js       .label and .dymo read/write
js/templates.js       address templates + brand settings
js/print.js           printing (system dialog / DYMO Web Service)
js/editor.js          canvas interaction + properties panel
js/app.js             toolbar, files, dialogs
```
