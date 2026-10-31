'use strict';
// Renders a label document to SVG (shared by editor, print and export).
// All coordinates are millimetres.

const DOT = 25.4 / 300; // LabelWriter 450 dot pitch (300 dpi)
const Render = (() => {
  const ctx = document.createElement('canvas').getContext('2d');

  function fontCss(o, px) {
    return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${px}px "${o.font}", sans-serif`;
  }

  // Lays out a text object's lines inside its content box.
  function layoutText(o, cw, ch) {
    const lines = String(o.text ?? '').split('\n');
    ctx.font = fontCss(o, 100);
    const m = ctx.measureText('ÄgjpqyHÉ');
    const asc = (m.fontBoundingBoxAscent || 92) / 100, desc = (m.fontBoundingBoxDescent || 24) / 100;
    const lh = (asc + desc) * (o.lineSpacing || 1);
    const widest = Math.max(0.001, ...lines.map(l => ctx.measureText(l).width / 100));
    const natural = o.size * PT_TO_MM;
    const maxFit = Math.min(cw / widest, ch / (lines.length * lh - (lh - asc - desc)));
    let size = natural;
    if (o.fit === 'always') size = maxFit;
    else if (o.fit === 'shrink') size = Math.min(natural, maxFit);
    size = Math.max(size, 0.3);
    const blockH = (lines.length - 1) * lh * size + (asc + desc) * size;
    let top = 0;
    if (o.valign === 'middle') top = (ch - blockH) / 2;
    else if (o.valign === 'bottom') top = ch - blockH;
    const x = o.align === 'center' ? cw / 2 : o.align === 'right' ? cw : 0;
    const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
    return { size, anchor, lines: lines.map((t, i) => ({ t, x, y: top + asc * size + i * lh * size })) };
  }

  function contentBox(o) {
    const r = ((o.rotation || 0) % 360 + 360) % 360;
    return (r === 90 || r === 270) ? { cw: o.h, ch: o.w, r } : { cw: o.w, ch: o.h, r };
  }

  function inner(o, cw, ch) {
    switch (o.type) {
      case 'text': {
        const L = layoutText(o, cw, ch);
        const deco = o.underline ? ' text-decoration="underline"' : '';
        const tspans = L.lines.map(l => `<text x="${l.x}" y="${l.y}">${escXml(l.t) || ' '}</text>`).join('');
        return `<g font-family="${escXml(o.font)}, sans-serif" font-size="${L.size}" font-weight="${o.bold ? 700 : 400}" font-style="${o.italic ? 'italic' : 'normal'}" fill="${o.color}" text-anchor="${L.anchor}"${deco} xml:space="preserve">${tspans}</g>`;
      }
      case 'image': {
        if (!o.src) return `<rect width="${cw}" height="${ch}" fill="#eee" stroke="#999" stroke-width="0.2" stroke-dasharray="1 1"/>`;
        const ax = { left: 'xMin', center: 'xMid', right: 'xMax' }[o.halign] || 'xMid';
        const ay = { top: 'YMin', middle: 'YMid', bottom: 'YMax' }[o.valign] || 'YMid';
        const par = o.fit === 'stretch' ? 'none' : ax + ay + (o.fit === 'cover' ? ' slice' : ' meet');
        return `<image href="${o.src}" width="${cw}" height="${ch}" preserveAspectRatio="${par}"/>`;
      }
      case 'shape': {
        const sw = Math.max(o.stroke, 0), fill = o.fill ? o.color : 'none';
        if (o.shape === 'line') return `<line x1="0" y1="${ch / 2}" x2="${cw}" y2="${ch / 2}" stroke="${o.color}" stroke-width="${sw || 0.2}"/>`;
        if (o.shape === 'ellipse') return `<ellipse cx="${cw / 2}" cy="${ch / 2}" rx="${Math.max(cw / 2 - sw / 2, 0)}" ry="${Math.max(ch / 2 - sw / 2, 0)}" fill="${fill}" stroke="${sw ? o.color : 'none'}" stroke-width="${sw}"/>`;
        return `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(cw - sw, 0)}" height="${Math.max(ch - sw, 0)}" rx="${o.radius || 0}" fill="${fill}" stroke="${sw ? o.color : 'none'}" stroke-width="${sw}"/>`;
      }
      case 'barcode': return barcodeSvg(o, cw, ch);
      default:
        return `<rect width="${cw}" height="${ch}" fill="none" stroke="#c00" stroke-width="0.3" stroke-dasharray="1 0.7"/>` +
          `<text x="${cw / 2}" y="${ch / 2}" font-size="${Math.min(3, ch / 2)}" text-anchor="middle" dominant-baseline="middle" fill="#c00" font-family="sans-serif">${escXml(o.name || 'Object')}</text>`;
    }
  }

  function barcodeSvg(o, cw, ch) {
    const data = String(o.data || '');
    if (!data) return `<rect width="${cw}" height="${ch}" fill="none" stroke="#999" stroke-width="0.2"/>`;
    try {
      if (o.symbology === 'qr') {
        const m = Barcode.qr(data, o.ecc || 'M'), n = m.length;
        const mod = Math.max(DOT, Math.floor(Math.min(cw, ch) / n / DOT) * DOT);
        const ox = (cw - mod * n) / 2, oy = (ch - mod * n) / 2;
        let d = '';
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${round(ox + x * mod, 4)} ${round(oy + y * mod, 4)}h${round(mod, 4)}v${round(mod, 4)}h-${round(mod, 4)}z`;
        return `<path d="${d}" fill="#000" shape-rendering="crispEdges"/>`;
      }
      const w = Barcode.code128(data), total = w.reduce((a, b) => a + b, 0);
      const mod = Math.max(DOT, Math.floor(cw / total / DOT) * DOT);
      const ts = o.showText ? (o.textSize || 8) * PT_TO_MM : 0;
      const barH = Math.max(ch - (ts ? ts * 1.25 : 0), 1);
      let x = (cw - mod * total) / 2, d = '';
      w.forEach((m, i) => { if (i % 2 === 0) d += `M${round(x, 4)} 0h${round(m * mod, 4)}v${round(barH, 4)}h-${round(m * mod, 4)}z`; x += m * mod; });
      const txt = ts ? `<text x="${cw / 2}" y="${ch - ts * 0.15}" font-size="${ts}" text-anchor="middle" font-family="Arial, sans-serif">${escXml(data)}</text>` : '';
      return `<path d="${d}" fill="#000" shape-rendering="crispEdges"/>${txt}`;
    } catch (e) {
      return `<text x="0" y="${ch / 2}" font-size="2.5" fill="#c00" font-family="sans-serif">${escXml(e.message)}</text>`;
    }
  }

  function objectSvg(o) {
    const { cw, ch, r } = contentBox(o);
    const t = `translate(${o.x + o.w / 2} ${o.y + o.h / 2}) rotate(${r}) translate(${-cw / 2} ${-ch / 2})`;
    return `<g transform="${t}"><svg width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}" overflow="hidden">${inner(o, cw, ch)}</svg></g>`;
  }

  const MONO_FILTER = '<filter id="mono" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.3 0.59 0.11 0 0 0.3 0.59 0.11 0 0 0.3 0.59 0.11 0 0 0 0 0 1 0"/>' +
    '<feComponentTransfer><feFuncR type="discrete" tableValues="0 1"/><feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer></filter>';

  // Full label as standalone SVG string.
  function labelSvg(doc, { mono = false, background = true, widthAttr, heightAttr } = {}) {
    const { w, h } = labelSize(doc);
    const body = doc.objects.map(objectSvg).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${widthAttr || w + 'mm'}" height="${heightAttr || h + 'mm'}">` +
      (mono ? `<defs>${MONO_FILTER}</defs>` : '') +
      (background ? `<rect width="${w}" height="${h}" fill="#fff"/>` : '') +
      `<g${mono ? ' filter="url(#mono)"' : ''}>${body}</g></svg>`;
  }

  // Rasterises an SVG string to a canvas at the given pixel size.
  function rasterize(svg, pxW, pxH) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, pxW, pxH);
        g.drawImage(img, 0, 0, pxW, pxH); resolve(c);
      };
      img.onerror = () => reject(new Error('Could not render image'));
      img.src = svgDataUrl(svg);
    });
  }

  // Renders a single object as PNG (base64, no prefix) at 300 dpi — used for DYMO export of vectors.
  async function objectPng(o, transparent = true) {
    const { cw, ch } = contentBox(o);
    const pxW = Math.max(1, Math.round(cw / DOT)), pxH = Math.max(1, Math.round(ch / DOT));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" width="${pxW}" height="${pxH}">${inner(o, cw, ch)}</svg>`;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = svgDataUrl(svg); });
    const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
    const g = c.getContext('2d');
    if (!transparent) { g.fillStyle = '#fff'; g.fillRect(0, 0, pxW, pxH); }
    g.drawImage(img, 0, 0, pxW, pxH);
    return c.toDataURL('image/png').split(',')[1];
  }

  return { objectSvg, labelSvg, rasterize, objectPng, contentBox, layoutText, MONO_FILTER };
})();
