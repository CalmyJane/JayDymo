'use strict';
// Built-in templates and the brand (sender + logo) used by them.

// Calmy Jane logo (smiley without wordmark), from assets/CalmyJaneLogoSingle.svg. Aspect 150 : 126.
const DEFAULT_LOGO = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="28.346172 67.346711 150.00021 126.00006" width="600" height="504">
<path fill="#000" fill-rule="evenodd" d="m 46.648479,131.26477 -0.003,31.33556 H 159.91391 V 144.77816 H 64.562629 V 131.26477 Z M 126.77385,99.98706 h 18.61959 v 18.63263 h -18.61959 z m -62.580031,0 h 18.61959 v 18.63263 H 64.193819 Z M 28.346749,67.346711 V 193.34677 h 0.0486 149.900931 V 67.346711 Z m 5.49992,5.49992 H 172.79633 V 187.84685 H 33.846669 Z"/>
</svg>`);
const LOGO_RATIO = 150 / 126;
const LOGO_VERSION = 3;
// Bump when the templates change: the app then starts with the new default label once.
const TEMPLATE_VERSION = 5;

const DEFAULT_BRAND = {
  sender: 'Calmy Jane\nMusterstraße 1\n12345 Musterstadt\nGermany',
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
  { id: 'blank',     name: 'Blank label',                                 build: () => newDoc('99014') },
  { id: 'ship99014', name: 'Address label S0722430 / 99014 (54×101 mm)', build: (b) => LAYOUTS.address(b, '99014') },
  { id: 'ship30256', name: 'Address label 30256 (59×102 mm)',            build: (b) => LAYOUTS.address(b, '30256') },
  { id: 'addr99012', name: 'Address label 99012 (36×89 mm)',             build: (b) => LAYOUTS.address(b, '99012') },
  { id: 'addr30321', name: 'Address label 30321 (36×89 mm)',             build: (b) => LAYOUTS.address(b, '30321') },
  { id: 'send99010', name: 'Sender label 99010 (28×89 mm)',              build: (b) => LAYOUTS.sender(b, '99010') },
];

function splitSender(b) {
  const lines = b.sender.split('\n').map(s => s.trim()).filter(Boolean);
  return { name: lines[0] || '', rest: lines.slice(1) };
}

// Layouts -------------------------------------------------------------------
// Every layout works for any label size and both orientations. Objects carry a
// `role`, so a label can be re-laid out (other paper / orientation) keeping its content.
const FONT = 'Segoe UI';
const txt = (props) => makeObject('text', Object.assign({ font: FONT, valign: 'top', fit: 'shrink' }, props));
const hline = (props) => makeObject('shape', Object.assign({ shape: 'line', h: 1, stroke: 0.2 }, props));
const returnLine = (b) => b.sender.split('\n').map(s => s.trim()).filter(Boolean).join('  ·  ');

// Content box inside the centred design area.
function frame(doc) {
  const a = designArea(doc), { w } = labelSize(doc), pad = Math.max(1, Math.min(2.5, w * 0.025));
  return { L: a.x + pad, T: a.y + pad, R: a.x + a.w - pad, B: a.y + a.h - pad };
}

const LAYOUTS = {
  // Small return address with a hairline on top, big logo, big receiver address.
  address(b, paperId, orientation = 'Landscape') {
    const doc = newDoc(paperId, orientation); doc.template = 'address';
    const { L, T, R, B } = frame(doc), W = R - L, H = B - T, k = Math.min(W, H) / 47;
    const retH = Math.max(3, 4 * k), ruleY = T + retH + 1.2, C = ruleY + Math.max(3, 4 * k);
    doc.objects.push(
      txt({ role: 'return', name: 'Return address', x: L, y: T, w: W, h: retH, text: returnLine(b), size: Math.max(5.5, 7 * k), valign: 'middle' }),
      hline({ role: 'rule', name: 'Rule', x: L, y: ruleY - 0.5, w: W }),
    );
    if (W >= H) { // landscape: logo left, address right
      const lh = Math.min((B - C) * 0.8, W * 0.36 / LOGO_RATIO), lw = lh * LOGO_RATIO, gap = Math.max(4, W * 0.06), x = L + lw + gap;
      doc.objects.push(
        makeObject('image', { role: 'logo', name: 'Logo', x: L, y: C + (B - C - lh) / 2, w: lw, h: lh, src: b.logo }),
        txt({ role: 'receiver', name: 'Receiver', x, y: C, w: R - x, h: B - C, text: SAMPLE_RECEIVER, size: Math.round(15 * k * 2) / 2, valign: 'middle' }),
      );
    } else { // portrait: logo on top, address below
      const lw = W * 0.62, lh = lw / LOGO_RATIO, gap = Math.max(5, H * 0.05), rh = Math.min(B - C - lh - gap, W * 0.6);
      const ly = C + (B - C - lh - gap - rh) / 2, ry = ly + lh + gap;
      doc.objects.push(
        makeObject('image', { role: 'logo', name: 'Logo', x: L + (W - lw) / 2, y: ly, w: lw, h: lh, src: b.logo }),
        txt({ role: 'receiver', name: 'Receiver', x: L, y: ry, w: W, h: rh, text: SAMPLE_RECEIVER, size: Math.round(15 * k * 2) / 2 }),
      );
    }
    return doc;
  },

  // Sender label: big logo, name and address.
  sender(b, paperId, orientation = 'Landscape') {
    const doc = newDoc(paperId, orientation); doc.template = 'sender';
    const { L, T, R, B } = frame(doc), W = R - L, H = B - T;
    const lines = b.sender.split('\n').map(s => s.trim()).filter(Boolean);
    if (W >= H) {
      const lh = H, lw = lh * LOGO_RATIO, x = L + lw + Math.max(3, W * 0.05);
      doc.objects.push(
        makeObject('image', { role: 'logo', name: 'Logo', x: L, y: T, w: lw, h: lh, src: b.logo }),
        txt({ role: 'senderName', name: 'Sender name', x, y: T, w: R - x, h: H * 0.32, text: lines[0] || '', size: 11, bold: true, valign: 'bottom' }),
        txt({ role: 'senderAddress', name: 'Sender address', x, y: T + H * 0.38, w: R - x, h: H * 0.62, text: lines.slice(1).join('\n'), size: 8.5 }),
      );
    } else {
      const lw = W * 0.7, lh = lw / LOGO_RATIO, ah = Math.min(16, H - lh - 11), y0 = T + (H - (lh + 11 + ah)) / 2, y = y0 + lh + 4;
      doc.objects.push(
        makeObject('image', { role: 'logo', name: 'Logo', x: L + (W - lw) / 2, y: y0, w: lw, h: lh, src: b.logo }),
        txt({ role: 'senderName', name: 'Sender name', x: L, y, w: W, h: 6, text: lines[0] || '', size: 11, bold: true, align: 'center' }),
        txt({ role: 'senderAddress', name: 'Sender address', x: L, y: y + 7, w: W, h: ah, text: lines.slice(1).join('\n'), size: 8.5, align: 'center' }),
      );
    }
    return doc;
  },
};

// Re-lays out a template-based label for another paper/orientation, keeping its content.
// Returns null when the label is not (or no longer) a template layout.
function relayout(doc, paperId, orientation) {
  const make = LAYOUTS[doc.template];
  if (!make) return null;
  const roles = new Map(doc.objects.filter(o => o.role).map(o => [o.role, o]));
  if (!roles.size) return null;
  const fresh = make(Brand.get(), paperId, orientation);
  for (const o of fresh.objects) {
    const old = roles.get(o.role); if (!old) continue;
    for (const k of ['text', 'src', 'font', 'bold', 'italic', 'underline', 'color', 'name']) if (k in old) o[k] = old[k];
  }
  // keep objects the user added on top of the template, roughly in place
  const extra = doc.objects.filter(o => !o.role).map(clone);
  fresh.objects = fresh.objects.filter(o => roles.has(o.role)).concat(extra);
  return fresh;
}
