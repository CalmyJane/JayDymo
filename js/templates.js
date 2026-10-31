'use strict';
// Built-in templates and the brand (sender + logo) used by them.

// Placeholder square logo. Replace it under "Brand" with the real Calmy Jane logo.
const DEFAULT_LOGO = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400">
<rect x="2" y="2" width="96" height="96" rx="14" fill="#000"/>
<path d="M60 22a26 26 0 1 0 22 36 21 21 0 1 1-22-36z" fill="#fff"/>
<text x="50" y="88" font-family="Georgia, serif" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle" letter-spacing="0.5">CALMY JANE</text>
</svg>`);

const DEFAULT_BRAND = {
  sender: 'Calmy Jane\nMusterstraße 1\n12345 Musterstadt\nGermany',
  logo: DEFAULT_LOGO,
};
const SAMPLE_RECEIVER = 'Max Mustermann\nBeispielweg 42\n54321 Beispielstadt\nGermany';

const Brand = {
  get() {
    try { return Object.assign({}, DEFAULT_BRAND, JSON.parse(localStorage.getItem('jaydymo.brand') || '{}')); }
    catch { return Object.assign({}, DEFAULT_BRAND); }
  },
  set(b) { try { localStorage.setItem('jaydymo.brand', JSON.stringify(b)); } catch (e) { alert('Could not store brand settings: ' + e.message); } },
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

// Sender block with logo top-left, divider, large receiver block.
function shipping(b, paperId) {
  const doc = newDoc(paperId, 'Landscape'), { w: W, h: H } = labelSize(doc), s = splitSender(b);
  const m = 4, logo = 15;
  doc.objects.push(
    makeObject('image', { name: 'Logo', x: m, y: m, w: logo, h: logo, src: b.logo }),
    makeObject('text', { name: 'Sender name', x: m + logo + 3, y: m, w: W - 2 * m - logo - 3, h: 5, text: s.name, size: 9, bold: true, valign: 'top' }),
    makeObject('text', { name: 'Sender address', x: m + logo + 3, y: m + 5, w: W - 2 * m - logo - 3, h: logo - 5, text: s.rest.join('\n'), size: 7, valign: 'top' }),
    makeObject('shape', { name: 'Divider', shape: 'line', x: m, y: m + logo + 2, w: W - 2 * m, h: 1, stroke: 0.3 }),
    makeObject('text', { name: 'To', x: m, y: m + logo + 6, w: 10, h: 5, text: 'TO:', size: 8, bold: true, valign: 'top' }),
    makeObject('text', { name: 'Receiver', x: m + 11, y: m + logo + 6, w: W - 2 * m - 11, h: H - (m + logo + 6) - m, text: SAMPLE_RECEIVER, size: 14, valign: 'top' }),
  );
  return doc;
}

// DIN-style: square logo on the left, one-line return address above the receiver.
function largeAddress(b, paperId) {
  const doc = newDoc(paperId, 'Landscape'), { w: W, h: H } = labelSize(doc), s = splitSender(b);
  const m = 3, logo = H - 2 * m, x = m + logo + 3;
  doc.objects.push(
    makeObject('image', { name: 'Logo', x: m, y: m, w: logo, h: logo, src: b.logo }),
    makeObject('text', { name: 'Return address', x, y: m, w: W - x - m, h: 3.5, text: [s.name, ...s.rest].join(' · '), size: 6, underline: true, valign: 'top' }),
    makeObject('text', { name: 'Receiver', x, y: m + 5, w: W - x - m, h: H - m - 5 - m, text: SAMPLE_RECEIVER, size: 11, valign: 'middle' }),
  );
  return doc;
}

// Return / sender address label with logo.
function senderLabel(b, paperId) {
  const doc = newDoc(paperId, 'Landscape'), { w: W, h: H } = labelSize(doc), s = splitSender(b);
  const m = 3, logo = H - 2 * m, x = m + logo + 3;
  doc.objects.push(
    makeObject('image', { name: 'Logo', x: m, y: m, w: logo, h: logo, src: b.logo }),
    makeObject('text', { name: 'Sender name', x, y: m, w: W - x - m, h: 6, text: s.name, size: 11, bold: true, valign: 'top' }),
    makeObject('text', { name: 'Sender address', x, y: m + 6.5, w: W - x - m, h: H - m - 6.5 - m, text: s.rest.join('\n'), size: 8, valign: 'top' }),
  );
  return doc;
}
