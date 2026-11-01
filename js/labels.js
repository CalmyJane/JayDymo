'use strict';
// DYMO LabelWriter paper presets.
// w = width across the roll, h = length along the feed direction (both mm),
// exactly as the DYMO driver defines the paper (portrait).
// twW/twH are the original twip sizes used in DYMO .label files.
const PAPERS = [
  { id: '99014', name: '99014 Shipping', title: 'Shipping / Name Badge 54×101 (S0722430 / 99014)', alias: 's0722430', w: 54, h: 101,  twW: 3060, twH: 5726, labelId: 'Shipping',      connect: 'Shipping99014' },
  { id: '30256', name: '30256 Shipping',              w: 59,   h: 102,  twW: 3331, twH: 5715, labelId: 'LargeShipping', connect: 'Shipping30256' },
  { id: '30323', name: '30323 Shipping',              w: 54,   h: 102,  twW: 3060, twH: 5760, labelId: 'Shipping',      connect: 'Shipping30323' },
  { id: '99012', name: '99012 Large Address',         w: 36,   h: 89,   twW: 2041, twH: 5040, labelId: 'LargeAddress',  connect: 'LargeAddress99012' },
  { id: '30321', name: '30321 Large Address',         w: 36,   h: 89,   twW: 2025, twH: 5020, labelId: 'LargeAddress',  connect: 'LargeAddress30321' },
  { id: '99010', name: '99010 Standard Address',      w: 28,   h: 89,   twW: 1587, twH: 5040, labelId: 'Address',       connect: 'Address99010' },
  { id: '30252', name: '30252 Address',               w: 28,   h: 89,   twW: 1581, twH: 5040, labelId: 'Address',       connect: 'Address30252' },
  { id: '11352', name: '11352 Return Address',        w: 25,   h: 54,   twW: 1440, twH: 3060, labelId: 'ReturnAddressInt', connect: 'ReturnAddressInt11352' },
  { id: '30330', name: '30330 Return Address',        w: 19,   h: 51,   twW: 1080, twH: 2880, labelId: 'ReturnAddress', connect: 'ReturnAddress30330' },
  { id: '11354', name: '11354 Multi-Purpose 57x32',   w: 57,   h: 32,   twW: 3232, twH: 1814, labelId: 'Multipurpose',  connect: 'Multipurpose11354' },
  { id: '30334', name: '30334 Medium 57x32',          w: 57,   h: 32,   twW: 3240, twH: 1800, labelId: 'MediumMultipurpose', connect: 'MediumMultipurpose30334' },
  { id: '30332', name: '30332 Square 25x25',          w: 25,   h: 25,   twW: 1440, twH: 1440, labelId: 'Square',        connect: 'Square30332' },
  { id: '30336', name: '30336 Small Multi-Purpose',   w: 25,   h: 54,   twW: 1440, twH: 3060, labelId: 'SmallMultipurpose', connect: 'SmallMultipurpose30336' },
  { id: '99017', name: '99017 Suspension File',       w: 12,   h: 50,   twW: 680,  twH: 2835, labelId: 'SuspensionFile', connect: 'SuspensionFile99017' },
  { id: '30327', name: '30327 File Folder',           w: 14,   h: 87,   twW: 815,  twH: 4950, labelId: 'FileFolder',    connect: 'FileFolder30327' },
  { id: '30857', name: '30857 Name Badge',            w: 57,   h: 102,  twW: 3240, twH: 5760, labelId: 'NameBadge',     connect: 'NameBadge30857' },
  { id: 'custom', name: 'Custom size',                w: 54,   h: 101,  custom: true },
];

const MM_PER_TWIP = 25.4 / 1440;
const TWIP_PER_MM = 1440 / 25.4;
const MM_PER_IN = 25.4;
const PT_TO_MM = 25.4 / 72;

function findPaper(idOrName) {
  if (!idOrName) return null;
  const s = String(idOrName).toLowerCase();
  return PAPERS.find(p => p.id === s) ||
         PAPERS.find(p => s.includes(p.id) || (p.alias && s.includes(p.alias))) ||
         PAPERS.find(p => p.name.toLowerCase() === s) || null;
}

// Find a preset by its physical size (mm, either orientation), tolerance 1.5mm.
function findPaperBySize(w, h) {
  const a = Math.min(w, h), b = Math.max(w, h);
  return PAPERS.find(p => !p.custom &&
    Math.abs(Math.min(p.w, p.h) - a) < 1.5 && Math.abs(Math.max(p.w, p.h) - b) < 1.5) || null;
}

// Name shown in the UI (the .label file keeps the DYMO driver name).
const paperTitle = (p) => p.title || p.name;

// Displayed size of a label (what the user sees in the editor).
function labelSize(doc) {
  const p = doc.paper;
  return doc.orientation === 'Landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

// The LabelWriter cannot print the first ~5.8 mm (0.23") at the start of each label,
// nor ~1.5 mm along the other edges. DYMO's own software uses the same printable area.
const LEAD_MARGIN = 5.85, EDGE_MARGIN = 1.5;
function printableArea(doc) {
  const { w, h } = labelSize(doc);
  return doc.orientation === 'Landscape'
    ? { x: LEAD_MARGIN, y: EDGE_MARGIN, w: w - LEAD_MARGIN - EDGE_MARGIN, h: h - 2 * EDGE_MARGIN }
    : { x: EDGE_MARGIN, y: LEAD_MARGIN, w: w - 2 * EDGE_MARGIN, h: h - LEAD_MARGIN - EDGE_MARGIN };
}
// Objects that reach into the area the printer cannot print.
function outsidePrintable(doc) {
  const a = printableArea(doc), t = 0.2;
  return doc.objects.filter(o => o.x < a.x - t || o.y < a.y - t || o.x + o.w > a.x + a.w + t || o.y + o.h > a.y + a.h + t);
}
// Centred design area: the unprintable lead strip mirrored on the opposite edge.
// The strip between this area and the printable area can still be used ("extra space").
function designArea(doc) {
  const { w, h } = labelSize(doc);
  return doc.orientation === 'Landscape'
    ? { x: LEAD_MARGIN, y: EDGE_MARGIN, w: w - 2 * LEAD_MARGIN, h: h - 2 * EDGE_MARGIN }
    : { x: EDGE_MARGIN, y: LEAD_MARGIN, w: w - 2 * EDGE_MARGIN, h: h - 2 * LEAD_MARGIN };
}
