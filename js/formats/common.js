'use strict';
// Helpers shared by the DYMO format readers/writers.
const X = {
  parse(xml) {
    const d = new DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'application/xml');
    if (d.querySelector('parsererror')) throw new Error('File is not valid XML');
    return d;
  },
  kids: (el, name) => el ? [...el.children].filter(c => !name || c.localName === name) : [],
  kid: (el, name) => el ? [...el.children].find(c => c.localName === name) || null : null,
  // first descendant by path "A/B/C" (each step a direct child)
  at(el, path) { for (const p of path.split('/')) { el = X.kid(el, p); if (!el) return null; } return el; },
  txt(el, path, def = '') { const e = path ? X.at(el, path) : el; return e ? e.textContent : def; },
  num(el, path, def = 0) { const v = parseFloat(X.txt(el, path, '')); return isNaN(v) ? def : v; },
  bool: (v) => /^true$/i.test(String(v).trim()),
  B: (v) => v ? 'True' : 'False',
  rot(v) { const m = /(\d+)/.exec(v || ''); return m ? (+m[1]) % 360 : 0; },
  hex2(n) { return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); },
  rgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000'); const v = parseInt(m ? m[1] : '000000', 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; },
  imageMime(b64) {
    if (b64.startsWith('iVBOR')) return 'image/png';
    if (b64.startsWith('/9j/')) return 'image/jpeg';
    if (b64.startsWith('R0lG')) return 'image/gif';
    if (b64.startsWith('Qk')) return 'image/bmp';
    if (b64.startsWith('PD94') || b64.startsWith('PHN2')) return 'image/svg+xml';
    return 'image/png';
  },
  // JayDymo keeps vector sources inside an XML comment that DYMO software ignores.
  svgComment(o) {
    if (!isSvgUrl(o.src)) return '';
    const b64 = o.src.includes(';base64,') ? o.src.split(',')[1] : btoa(unescape(encodeURIComponent(dataUrlToText(o.src))));
    return `<!--JayDymo-SVG:${b64}-->`;
  },
  readSvgComment(el) {
    for (const n of el.childNodes) if (n.nodeType === 8 && n.data.startsWith('JayDymo-SVG:')) return 'data:image/svg+xml;base64,' + n.data.slice(12).trim();
    return null;
  },
  ser: (el) => new XMLSerializer().serializeToString(el).replace(/ xmlns(:\w+)?="[^"]*"/g, ''),
  // vertical alignment: DYMO uses Top / Middle or Center / Bottom
  mapVAlign: (v, def) => ({ top: 'top', middle: 'middle', center: 'middle', centre: 'middle', bottom: 'bottom' })[String(v || '').toLowerCase()] || def,
  mapAlign: (v, def) => ({ left: 'left', center: 'center', centre: 'center', right: 'right', top: 'top', middle: 'middle', center_v: 'middle', bottom: 'bottom' })[String(v || '').toLowerCase()] || def,
};
