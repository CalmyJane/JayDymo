'use strict';
// Built-in templates and the brand (sender + logo) used by them.

// Calmy Jane logo (smiley without wordmark), from assets/CalmyJaneLogoSingle.svg. Aspect 150 : 126.
const DEFAULT_LOGO = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="28.346172 67.346711 150.00021 126.00006" width="600" height="504">
<path fill="#000" fill-rule="evenodd" d="m 46.648479,131.26477 -0.003,31.33556 H 159.91391 V 144.77816 H 64.562629 V 131.26477 Z M 126.77385,99.98706 h 18.61959 v 18.63263 h -18.61959 z m -62.580031,0 h 18.61959 v 18.63263 H 64.193819 Z M 28.346749,67.346711 V 193.34677 h 0.0486 149.900931 V 67.346711 Z m 5.49992,5.49992 H 172.79633 V 187.84685 H 33.846669 Z"/>
</svg>`);
const LOGO_RATIO = 150 / 126;
const LOGO_VERSION = 3;
// Bump when the templates change: the app then starts with the new default label once.
const TEMPLATE_VERSION = 4;

const DEFAULT_BRAND = {
  sender: 'Calmy Jane\nMusterstraße 1\n12345 Musterstadt\nGermany',
  caption: 'CALMY JANE',
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
function frame(doc, pad = 1) {
  const a = designArea(doc);
  return { L: a.x + pad, T: a.y + pad, R: a.x + a.w - pad, B: a.y + a.h - pad };
}
const FONT = 'Segoe UI';
const txt = (props) => makeObject('text', Object.assign({ font: FONT, valign: 'top', fit: 'shrink' }, props));

// Logo with the black caption bar ("CALMY JANE") below it, bottom edge at y = bottom.
function logoWithCaption(b, x, bottom, w) {
  const lh = w / LOGO_RATIO, bar = w * 0.2, gap = w * 0.03;
  const top = bottom - bar - gap - lh;
  return {
    top,
    objects: [
      makeObject('image', { name: 'Logo', x, y: top, w, h: lh, src: b.logo }),
      makeObject('shape', { name: 'Caption bar', shape: 'rect', fill: true, stroke: 0, color: '#000000', x, y: bottom - bar, w, h: bar }),
      txt({ name: 'Caption', x: x + w * 0.06, y: bottom - bar, w: w * 0.88, h: bar, text: b.caption || '', font: 'Arial', bold: true, size: 30, fit: 'shrink', align: 'center', valign: 'middle', color: '#ffffff' }),
    ],
  };
}
const returnLine = (b) => b.sender.split('\n').map(s => s.trim()).filter(Boolean).join(', ');

// Address layout: return address on one line at the top, logo bottom-left,
// receiver right-aligned next to it. Sizes scale with the label.
function addressLayout(b, paperId, { logo, retH, recvSize }) {
  const doc = newDoc(paperId, 'Landscape');
  const { L, T, R, B } = frame(doc), lg = logoWithCaption(b, L, B, logo), x = L + logo + 3;
  doc.objects.push(
    txt({ name: 'Return address', x: L, y: T, w: R - L, h: retH, text: returnLine(b), size: 30, fit: 'always', align: 'center', valign: 'middle' }),
    ...lg.objects,
    txt({ name: 'Receiver', x, y: lg.top, w: R - x, h: B - lg.top, text: SAMPLE_RECEIVER, size: recvSize, align: 'right', valign: 'bottom' }),
  );
  return doc;
}
const shipping = (b, paperId) => addressLayout(b, paperId, { logo: 30, retH: 4.6, recvSize: 18 });
const largeAddress = (b, paperId) => addressLayout(b, paperId, { logo: 21, retH: 3.6, recvSize: 13 });

// Sender label: logo with caption on the left, sender right-aligned.
function senderLabel(b, paperId) {
  const doc = newDoc(paperId, 'Landscape');
  const { L, T, R, B } = frame(doc), lg = logoWithCaption(b, L, B, (B - T) * LOGO_RATIO / 1.25), x = L + (B - T) * LOGO_RATIO / 1.25 + 3;
  doc.objects.push(
    ...lg.objects,
    txt({ name: 'Sender', x, y: T, w: R - x, h: B - T, text: b.sender, size: 11, align: 'right', valign: 'bottom' }),
  );
  return doc;
}
