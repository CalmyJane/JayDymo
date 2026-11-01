'use strict';
const APP_VERSION = '1.6';
// Document model, defaults and small helpers.

let _idSeq = 1;
const newId = () => 'o' + (_idSeq++) + Math.random().toString(36).slice(2, 6);

const DEFAULTS = {
  text:    { w: 40, h: 10, text: 'Text', font: 'Arial', size: 12, bold: false, italic: false, underline: false,
             align: 'left', valign: 'middle', fit: 'shrink', color: '#000000', lineSpacing: 1 },
  image:   { w: 20, h: 20, src: '', fit: 'contain', halign: 'center', valign: 'middle' },
  shape:   { w: 20, h: 10, shape: 'rect', stroke: 0.4, fill: false, radius: 0, color: '#000000' },
  barcode: { w: 40, h: 12, data: '123456789', symbology: 'code128', showText: true, ecc: 'M', textSize: 8 },
  raw:     { w: 20, h: 10 },
};
const TYPE_NAMES = { text: 'Text', image: 'Image', shape: 'Shape', barcode: 'Barcode', raw: 'Unsupported' };

function makeObject(type, props = {}) {
  const o = Object.assign({ id: newId(), type, name: '', x: 5, y: 5, rotation: 0, locked: false },
    JSON.parse(JSON.stringify(DEFAULTS[type])), props);
  if (!o.name) o.name = TYPE_NAMES[type];
  return o;
}

function newDoc(paperId = '99014', orientation = 'Landscape') {
  const p = findPaper(paperId) || PAPERS[0];
  return { paper: { id: p.id, name: p.name, w: p.w, h: p.h }, orientation, objects: [] };
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const escXml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const svgDataUrl = (svg) => 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
const isSvgUrl = (u) => /^data:image\/svg\+xml/.test(u || '');
function dataUrlToText(u) {
  const [head, body] = u.split(',');
  return head.includes(';base64') ? decodeURIComponent(escape(atob(body))) : decodeURIComponent(body);
}

// Undo/redo snapshot history.
class History {
  constructor(limit = 80) { this.stack = []; this.pos = -1; this.limit = limit; }
  push(doc) {
    const s = JSON.stringify(doc);
    if (this.stack[this.pos] === s) return;
    this.stack.length = this.pos + 1;
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.shift();
    this.pos = this.stack.length - 1;
  }
  undo() { return this.pos > 0 ? JSON.parse(this.stack[--this.pos]) : null; }
  redo() { return this.pos < this.stack.length - 1 ? JSON.parse(this.stack[++this.pos]) : null; }
}
