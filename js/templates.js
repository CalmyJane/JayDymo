'use strict';
// Built-in templates and the brand (sender + logo) used by them.

// Calmy Jane pixel smiley (logo without the wordmark).
const DEFAULT_LOGO = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34" width="408" height="408" shape-rendering="crispEdges">
<path fill="#000" fill-rule="evenodd" d="M0 0h34v34H0zM2 2v30h30V2z"/>
<path fill="#000" d="M9 10h4v4H9zM22 10h4v4h-4zM5 18h4v3H5zM5 21h25v3.5H5z"/>
</svg>`);
const LOGO_VERSION = 2;

// Small pixel-art heart matching the logo style.
const pixelHeart = (color = '#000') => svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 6" width="140" height="120" shape-rendering="crispEdges">
<path fill="${color}" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/></svg>`);

const DEFAULT_BRAND = {
  sender: 'Calmy Jane\nMusterstraße 1\n12345 Musterstadt\nGermany',
  web: 'calmyjane.com',
  logo: DEFAULT_LOGO,
  logoVersion: LOGO_VERSION,
};
const SAMPLE_RECEIVER = 'Max Mustermann\nBeispielweg 42\n54321 Beispielstadt\nGermany';

const Brand = {
  get() {
    let b = {};
    try { b = JSON.parse(localStorage.getItem('jaydymo.brand') || '{}'); } catch { }
    // Earlier versions used the logo with the wordmark; switch to the plain smiley once.
    if ((b.logoVersion || 1) < LOGO_VERSION) { delete b.logo; b.logoVersion = LOGO_VERSION; }
    return Object.assign({}, DEFAULT_BRAND, b);
  },
  set(b) { try { localStorage.setItem('jaydymo.brand', JSON.stringify(Object.assign({}, b, { logoVersion: LOGO_VERSION }))); } catch (e) { alert('Could not store brand settings: ' + e.message); } },
};

const TEMPLATES = [
  { id: 'blank',     name: 'Blank label',                       build: () => newDoc('99014') },
  { id: 'ship99014', name: 'Shipping label S0722430 / 99014 (54×101 mm)',  build: (b) => shipping(b, '99014') },
  { id: 'ship30256', name: 'Shipping label 30256 (59×102 mm)',  build: (b) => shipping(b, '30256') },
  { id: 'addr99012', name: 'Large address 99012 (36×89 mm)',    build: (b) => largeAddress(b, '99012') },
  { id: 'addr30321', name: 'Large address 30321 (36×89 mm)',    build: (b) => largeAddress(b, '30321') },
  { id: 'send99010', name: 'Sender label 99010 (28×89 mm)',     build: (b) => senderLabel(b, '99010') },
];

function splitSender(b) {
  const lines = b.sender.split('\n').map(s => s.trim()).filter(Boolean);
  return { name: lines[0] || '', rest: lines.slice(1) };
}

// Shared pieces --------------------------------------------------------------
// Design area: centred on the label (the printer's unprintable lead strip is mirrored on the other side).
function frame(doc, pad = 1.5) {
  const a = designArea(doc);
  return { L: a.x + pad, T: a.y + pad, R: a.x + a.w - pad, B: a.y + a.h - pad };
}
const box = (props) => makeObject('shape', Object.assign({ shape: 'rect', fill: true, stroke: 0, color: '#000000' }, props));
const txt = (props) => makeObject('text', Object.assign({ font: 'Arial', valign: 'top', fit: 'shrink' }, props));
// Black block with the logo on a white tile.
function logoBlock(b, x, y, w, h, tile) {
  const pad = (w - tile) / 2;
  return [
    box({ name: 'Sidebar', x, y, w, h, radius: 1.8 }),
    box({ name: 'Logo tile', x: x + pad, y: y + pad, w: tile, h: tile, radius: 1, color: '#ffffff' }),
    makeObject('image', { name: 'Logo', x: x + pad + 1, y: y + pad + 1, w: tile - 2, h: tile - 2, src: b.logo }),
  ];
}

// Shipping label: black sidebar with logo + sender, big receiver block on the right.
function shipping(b, paperId) {
  const doc = newDoc(paperId, 'Landscape'), s = splitSender(b);
  const { L, T, R, B } = frame(doc), side = 24, x = L + side + 5, w = R - x;
  doc.objects.push(
    ...logoBlock(b, L, T, side, B - T, 19),
    txt({ name: 'From', x: L + 2.5, y: T + 24, w: side - 5, h: 3.5, text: 'FROM', size: 6, bold: true, color: '#ffffff' }),
    txt({ name: 'Sender', x: L + 2.5, y: T + 28, w: side - 5, h: B - T - 30.5, text: [s.name, ...s.rest].join('\n'), size: 6, color: '#ffffff' }),
    txt({ name: 'Ship to', x, y: T + 0.5, w: 30, h: 4.5, text: 'SHIP TO', size: 8, bold: true }),
    box({ name: 'Accent', x, y: T + 6, w: 10, h: 1.1 }),
    txt({ name: 'Receiver', x, y: T + 10, w, h: B - T - 18, text: SAMPLE_RECEIVER, size: 14 }),
    makeObject('shape', { name: 'Footer line', shape: 'line', x, y: B - 7.5, w, h: 1, stroke: 0.25 }),
    txt({ name: 'Website', x, y: B - 5, w: w - 8, h: 5, text: b.web || '', size: 7, bold: true, valign: 'bottom' }),
    makeObject('image', { name: 'Heart', x: R - 5.6, y: B - 4.8, w: 5.6, h: 4.8, src: pixelHeart() }),
  );
  return doc;
}

// Large address label: logo block, DIN-style return line, receiver.
function largeAddress(b, paperId) {
  const doc = newDoc(paperId, 'Landscape'), s = splitSender(b);
  const { L, T, R, B } = frame(doc, 1), side = 24, x = L + side + 4, w = R - x;
  doc.objects.push(
    ...logoBlock(b, L, T, side, B - T, 19),
    makeObject('image', { name: 'Heart', x: L + side / 2 - 2.3, y: T + 23.5, w: 4.6, h: 4, src: pixelHeart('#ffffff') }),
    txt({ name: 'Return address', x, y: T, w, h: 3.2, text: [s.name, ...s.rest].join(' · '), size: 5.5, underline: true }),
    txt({ name: 'Receiver', x, y: T + 5, w, h: B - T - 5, text: SAMPLE_RECEIVER, size: 11, valign: 'middle' }),
  );
  return doc;
}

// Return / sender address label with logo block.
function senderLabel(b, paperId) {
  const doc = newDoc(paperId, 'Landscape'), s = splitSender(b);
  const { L, T, R, B } = frame(doc, 1), side = B - T, x = L + side + 4, w = R - x;
  doc.objects.push(
    ...logoBlock(b, L, T, side, side, side - 4),
    txt({ name: 'Sender name', x, y: T, w, h: 6, text: s.name, size: 11, bold: true }),
    box({ name: 'Accent', x, y: T + 6.5, w: 8, h: 0.9 }),
    txt({ name: 'Sender address', x, y: T + 8.5, w, h: B - T - 8.5, text: s.rest.join('\n'), size: 8 }),
  );
  return doc;
}
