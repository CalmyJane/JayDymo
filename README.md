# JayDymo

A small, dependency‑free label editor for the **DYMO LabelWriter 450** (and other LabelWriters).
It opens and saves DYMO files, and it prints through the normal printer driver, so you don't need DYMO's software.

## Run it

**Windows:** run `JayDymo.exe`. It's a single file of about 6 MB, needs no installation and works offline.
It uses the Edge WebView2 runtime that ships with Windows 10/11.
- The exe isn't code‑signed, so on first start Windows may say *"Windows protected your PC"*. Click **More info → Run anyway**.
- To open DYMO files by double‑click: right‑click a `.label` or `.dymo` file, choose **Open with → Choose another app**, pick `JayDymo.exe` and tick *Always*.
  **Save** then writes straight back to that file.
- Settings (brand, last label) are stored in `%LOCALAPPDATA%\JayDymo`.

**Without the exe:** open `index.html` in Chrome or Edge. This works on any OS.

### Build the exe

Install Go 1.22 or newer, then run `./build.sh`. The result is `dist/JayDymo.exe`.
It cross‑compiles from Windows, macOS or Linux, with no C compiler or other tools needed.
Every push also builds it with GitHub Actions; download it from the run's *Artifacts*.

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
  - **Windows app:** prints directly, with no system print dialog. Press **Print** (or Ctrl+P), check the preview, pick the printer and copies, and press Enter.
    The label is sent exactly as designed (300 dpi black & white), and JayDymo picks the matching DYMO paper size in the driver automatically.
    If labels come out upside down, tick *Turn 180°* (it's remembered).
  - **Browser version:** uses the system print dialog. There, pick the DYMO printer and the matching paper size, and set the margins to *none*.
  - **DYMO Web Service** (browser version): if DYMO Connect or DYMO Label Software is running, JayDymo can send the label straight to it.

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
main_windows.go       Windows exe: native window (WebView2) around the app
server.go             embedded files + local file API for open/save
build.sh              builds dist/JayDymo.exe
build/winres/         app icon + manifest generator
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
