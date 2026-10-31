'use strict';
// Printing: system print dialog (browser -> printer driver) or DYMO Web Service.

const Printing = (() => {
  // 300 dpi black/white simulation of the thermal print head (Floyd–Steinberg dithering).
  async function previewPng(doc) { return (await renderMono(doc)).toDataURL('image/png'); }

  // The label exactly as designed, as 300 dpi black/white canvas (what the print head prints).
  async function renderMono(doc, flip = false) {
    const { w, h } = labelSize(doc);
    const pw = Math.round(w / DOT), ph = Math.round(h / DOT);
    const c = await Render.rasterize(Render.labelSvg(doc), pw, ph);
    const g = c.getContext('2d'), img = g.getImageData(0, 0, pw, ph), d = img.data;
    const lum = new Float32Array(pw * ph);
    for (let i = 0; i < pw * ph; i++) lum[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y * pw + x, o = lum[i], n = o < 128 ? 0 : 255, e = o - n; lum[i] = n;
      if (x + 1 < pw) lum[i + 1] += e * 7 / 16;
      if (y + 1 < ph) { if (x) lum[i + pw - 1] += e * 3 / 16; lum[i + pw] += e * 5 / 16; if (x + 1 < pw) lum[i + pw + 1] += e / 16; }
    }
    for (let i = 0; i < pw * ph; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = lum[i]; d[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    if (!flip) return c;
    const r = document.createElement('canvas'); r.width = pw; r.height = ph;
    const rg = r.getContext('2d'); rg.translate(pw, ph); rg.rotate(Math.PI); rg.drawImage(c, 0, 0);
    return r;
  }

  // Desktop app (JayDymo.exe): sends the rendered label straight to a Windows printer, no dialog.
  const Direct = {
    token: new URLSearchParams(location.search).get('desktop'),
    async printers() {
      const r = await fetch('/api/printers', { headers: { 'X-JayDymo': this.token } });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    async print(doc, printer, copies, flip) {
      const png = (await renderMono(doc, flip)).toDataURL('image/png').split(',')[1];
      const job = { printer, copies, landscape: doc.orientation === 'Landscape', paperW: doc.paper.w, paperH: doc.paper.h, paperId: doc.paper.id, png };
      const r = await fetch('/api/print', { method: 'POST', headers: { 'X-JayDymo': this.token, 'Content-Type': 'application/json' }, body: JSON.stringify(job) });
      if (!r.ok) throw new Error(await r.text());
    },
  };

  // Prints through the OS print dialog using an exact @page size.
  function systemPrint(doc, { copies = 1, rotate = true, flip = false } = {}) {
    const { w, h } = labelSize(doc);
    const turn = rotate && w > h;              // feed direction: narrow edge first
    const pw = turn ? h : w, ph = turn ? w : h;
    let t = '';
    if (turn) t = flip ? `translate(0 ${ph}) rotate(-90)` : `translate(${pw} 0) rotate(90)`;
    else if (flip) t = `translate(${pw} ${ph}) rotate(180)`;
    const inner = Render.labelSvg(doc, { background: false }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const page = `<div class="p"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pw} ${ph}" width="${pw}mm" height="${ph}mm"><g transform="${t}">${inner}</g></svg></div>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Label</title><style>
      @page { size: ${pw}mm ${ph}mm; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .p { width: ${pw}mm; height: ${ph}mm; overflow: hidden; page-break-after: always; break-after: page; }
      .p:last-child { page-break-after: auto; break-after: auto; }
      svg { display: block; }
      </style></head><body>${page.repeat(Math.max(1, copies))}</body></html>`;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    f.onload = () => setTimeout(() => {
      f.contentWindow.focus(); f.contentWindow.print();
      setTimeout(() => f.remove(), 2000);
    }, 300);
    f.srcdoc = html;
  }

  // DYMO Connect / DYMO Label Software local web service.
  const Service = {
    base: null,
    async find() {
      if (this.base) return this.base;
      for (let port = 41951; port <= 41953; port++) {
        for (const host of ['127.0.0.1']) {
          const url = `https://${host}:${port}/DYMO/DLS/Printing`;
          try {
            const r = await fetch(url + '/StatusConnected', { signal: AbortSignal.timeout(1200) });
            if (r.ok && /true/i.test(await r.text())) return (this.base = url);
          } catch { /* try next */ }
        }
      }
      return null;
    },
    async printers() {
      const base = await this.find(); if (!base) return [];
      const xml = await (await fetch(base + '/GetPrinters')).text();
      const d = new DOMParser().parseFromString(xml, 'application/xml');
      return [...d.getElementsByTagName('Name')].map(n => n.textContent).filter(Boolean);
    },
    async print(doc, printer, copies) {
      const base = await this.find(); if (!base) throw new Error('DYMO Web Service not found');
      const labelXml = await DymoLabel.write(doc);
      const params = `<LabelWriterPrintParams><Copies>${copies}</Copies><PrintQuality>BarcodeAndGraphics</PrintQuality></LabelWriterPrintParams>`;
      const body = new URLSearchParams({ printerName: printer, printParamsXml: params, labelXml, labelSetXml: '' });
      const r = await fetch(base + '/PrintLabel', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const txt = await r.text();
      if (!r.ok || /false|error/i.test(txt)) throw new Error('Printer said: ' + txt.slice(0, 200));
    },
  };

  return { previewPng, renderMono, systemPrint, Service, Direct };
})();
