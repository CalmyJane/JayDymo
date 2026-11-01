'use strict';
// DYMO Label Software 8 ".label" format (XML, units: twips = 1/1440 inch).
const DymoLabel = (() => {
  const t2m = (v) => round(parseFloat(v || 0) * MM_PER_TWIP, 3);
  const m2t = (v) => round(v * TWIP_PER_MM, 2);
  const color = (el) => {
    if (!el) return { hex: '#000000', a: 255 };
    const g = (k) => +(el.getAttribute(k) || 0);
    return { hex: '#' + X.hex2(g('Red')) + X.hex2(g('Green')) + X.hex2(g('Blue')), a: el.hasAttribute('Alpha') ? g('Alpha') : 255 };
  };
  const colorXml = (tag, hex, a = 255) => { const [r, g, b] = X.rgb(hex); return `<${tag} Alpha="${a}" Red="${r}" Green="${g}" Blue="${b}" />`; };

  function read(xml) {
    const d = X.parse(xml), root = d.documentElement;
    if (!/^(DieCutLabel|ContinuousLabel)$/.test(root.localName)) throw new Error('Not a DYMO .label file');
    const orientation = /landscape/i.test(X.txt(root, 'PaperOrientation')) ? 'Landscape' : 'Portrait';
    const paperName = X.txt(root, 'PaperName'), rr = X.at(root, 'DrawCommands/RoundRectangle');
    let w = rr ? t2m(rr.getAttribute('Width')) : 0, h = rr ? t2m(rr.getAttribute('Height')) : 0;
    let preset = findPaper(paperName) || (w && findPaperBySize(w, h));
    if (!w || !h) { w = preset ? preset.w : 54; h = preset ? preset.h : 101; }
    if (preset && (Math.abs(preset.w - w) > 1.5 || Math.abs(preset.h - h) > 1.5)) preset = null;
    const doc = { paper: preset ? { id: preset.id, name: preset.name, w: preset.w, h: preset.h } : { id: 'custom', name: paperName || 'Custom', w, h },
      orientation, objects: [], source: { format: 'label' } };
    for (const info of X.kids(root, 'ObjectInfo')) {
      const b = X.kid(info, 'Bounds'), el = X.kids(info).find(c => c.localName !== 'Bounds');
      if (!el || !b) continue;
      const base = { x: t2m(b.getAttribute('X')), y: t2m(b.getAttribute('Y')), w: t2m(b.getAttribute('Width')), h: t2m(b.getAttribute('Height')),
        rotation: X.rot(X.txt(el, 'Rotation')), name: X.txt(el, 'Name') };
      doc.objects.push(readObject(el, base) || makeObject('raw', Object.assign(base, { name: base.name || el.localName, xml: X.ser(el), rawFormat: 'label' })));
    }
    return doc;
  }

  function readObject(el, base) {
    const type = el.localName;
    if (type === 'TextObject' || type === 'AddressObject') {
      let text = '', font = null, fg = null;
      const st = X.kid(el, 'StyledText');
      if (st) {
        for (const e of X.kids(st, 'Element')) {
          text += X.txt(e, 'String');
          if (!font) { font = X.at(e, 'Attributes/Font'); fg = X.at(e, 'Attributes/ForeColor'); }
        }
      } else { text = X.txt(el, 'Text'); font = X.kid(el, 'Font'); }
      fg = fg || X.kid(el, 'ForeColor');
      const fit = X.txt(el, 'TextFitMode', 'ShrinkToFit');
      return makeObject('text', Object.assign(base, {
        text: text.replace(/\r\n?/g, '\n').replace(/\n$/, ''),
        font: font?.getAttribute('Family') || 'Arial', size: parseFloat(font?.getAttribute('Size') || 12),
        bold: X.bool(font?.getAttribute('Bold')), italic: X.bool(font?.getAttribute('Italic')), underline: X.bool(font?.getAttribute('Underline')),
        color: color(fg).hex, align: X.mapAlign(X.txt(el, 'HorizontalAlignment'), 'left'), valign: X.mapVAlign(X.txt(el, 'VerticalAlignment'), 'middle'),
        fit: fit === 'AlwaysFit' ? 'always' : fit === 'None' ? 'none' : 'shrink', name: base.name || 'Text' }));
    }
    if (type === 'ImageObject') {
      const b64 = X.txt(el, 'Image').replace(/\s+/g, '');
      const svg = X.readSvgComment(el);
      const sm = X.txt(el, 'ScaleMode', 'Uniform');
      return makeObject('image', Object.assign(base, { src: svg || (b64 ? `data:${X.imageMime(b64)};base64,${b64}` : ''),
        fit: sm === 'Fill' ? 'stretch' : 'contain', halign: X.mapAlign(X.txt(el, 'HorizontalAlignment'), 'center'),
        valign: X.mapVAlign(X.txt(el, 'VerticalAlignment'), 'middle'), name: base.name || 'Image' }));
    }
    if (type === 'ShapeObject') {
      const st = X.txt(el, 'ShapeType', 'Rectangle'), fill = color(X.kid(el, 'FillColor'));
      const props = { stroke: t2m(X.txt(el, 'LineWidth', '15')), color: color(X.kid(el, 'ForeColor')).hex, fill: fill.a > 0, name: base.name || 'Shape' };
      if (/HorizontalLine/i.test(st)) props.shape = 'line';
      else if (/VerticalLine/i.test(st)) { props.shape = 'line'; base.rotation = (base.rotation + 90) % 360; }
      else props.shape = /Ellipse/i.test(st) ? 'ellipse' : 'rect';
      return makeObject('shape', Object.assign(base, props));
    }
    if (type === 'BarcodeObject') {
      const bt = X.txt(el, 'Type');
      if (!/^(Code128|QRCode)/i.test(bt)) return null;
      const tf = X.kid(el, 'TextFont');
      return makeObject('barcode', Object.assign(base, { data: X.txt(el, 'Text'), symbology: /QR/i.test(bt) ? 'qr' : 'code128',
        showText: !/None/i.test(X.txt(el, 'TextPosition', 'Bottom')) && !/QR/i.test(bt), textSize: parseFloat(tf?.getAttribute('Size') || 8), name: base.name || 'Barcode' }));
    }
    return null;
  }

  const head = (o, tag) => `<${tag}>\n      <Name>${escXml(o.name || tag)}</Name>\n      ${colorXml('ForeColor', o.color || '#000000')}\n      ${colorXml('BackColor', '#ffffff', 0)}\n      <LinkedObjectName></LinkedObjectName>\n      <Rotation>Rotation${o.rotation || 0}</Rotation>\n      <IsMirrored>False</IsMirrored>\n      <IsVariable>False</IsVariable>`;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  async function objectXml(o) {
    let rot = o.rotation || 0, inner;
    if (o.type === 'text') {
      const els = o.text.split('\n').map((line, i, arr) => `\n        <Element>\n          <String>${escXml(line + (i < arr.length - 1 ? '\n' : ''))}</String>\n          <Attributes>\n            <Font Family="${escXml(o.font)}" Size="${o.size}" Bold="${X.B(o.bold)}" Italic="${X.B(o.italic)}" Underline="${X.B(o.underline)}" Strikeout="False" />\n            ${colorXml('ForeColor', o.color)}\n          </Attributes>\n        </Element>`).join('');
      inner = `${head(o, 'TextObject')}\n      <HorizontalAlignment>${cap(o.align)}</HorizontalAlignment>\n      <VerticalAlignment>${cap(o.valign)}</VerticalAlignment>\n      <TextFitMode>${{ none: 'None', shrink: 'ShrinkToFit', always: 'AlwaysFit' }[o.fit]}</TextFitMode>\n      <UseFullFontHeight>True</UseFullFontHeight>\n      <Verticalized>False</Verticalized>\n      <StyledText>${els}\n      </StyledText>\n    </TextObject>`;
    } else if (o.type === 'image') {
      let b64 = '';
      if (o.src && !isSvgUrl(o.src) && /^data:image\/(png|jpeg|gif|bmp)/.test(o.src)) b64 = o.src.split(',')[1];
      else if (o.src) b64 = await Render.objectPng(Object.assign({}, o, { rotation: 0 }));
      inner = `${head(o, 'ImageObject')}\n      ${X.svgComment(o)}<Image>${b64}</Image>\n      <ScaleMode>${o.fit === 'stretch' ? 'Fill' : 'Uniform'}</ScaleMode>\n      <BorderWidth>0</BorderWidth>\n      ${colorXml('BorderColor', '#000000')}\n      <HorizontalAlignment>${cap(o.halign)}</HorizontalAlignment>\n      <VerticalAlignment>${o.valign === 'middle' ? 'Center' : cap(o.valign)}</VerticalAlignment>\n    </ImageObject>`;
    } else if (o.type === 'shape') {
      let st = o.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
      if (o.shape === 'line') { st = (rot === 90 || rot === 270) ? 'VerticalLine' : 'HorizontalLine'; rot = 0; }
      inner = `${head(Object.assign({}, o, { rotation: rot }), 'ShapeObject')}\n      <ShapeType>${st}</ShapeType>\n      <LineWidth>${m2t(o.stroke)}</LineWidth>\n      <LineAlignment>Center</LineAlignment>\n      ${colorXml('FillColor', o.color, o.fill ? 255 : 0)}\n    </ShapeObject>`;
    } else if (o.type === 'barcode') {
      const qr = o.symbology === 'qr';
      inner = `${head(o, 'BarcodeObject')}\n      <Text>${escXml(o.data)}</Text>\n      <Type>${qr ? 'QRCode' : 'Code128Auto'}</Type>\n      <Size>Medium</Size>\n      <TextPosition>${o.showText && !qr ? 'Bottom' : 'None'}</TextPosition>\n      <TextFont Family="Arial" Size="${o.textSize || 8}" Bold="False" Italic="False" Underline="False" Strikeout="False" />\n      <CheckSumFont Family="Arial" Size="${o.textSize || 8}" Bold="False" Italic="False" Underline="False" Strikeout="False" />\n      <TextEmbedding>None</TextEmbedding>\n      <ECLevel>0</ECLevel>\n      <HorizontalAlignment>Center</HorizontalAlignment>\n      <QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0" />\n    </BarcodeObject>`;
    } else if (o.type === 'raw' && o.rawFormat === 'label') {
      inner = o.xml;
    } else return '';
    return `  <ObjectInfo>\n    ${inner}\n    <Bounds X="${m2t(o.x)}" Y="${m2t(o.y)}" Width="${m2t(o.w)}" Height="${m2t(o.h)}" />\n  </ObjectInfo>\n`;
  }

  async function write(doc) {
    const p = findPaper(doc.paper.id);
    const twW = p && !p.custom ? p.twW : m2t(doc.paper.w), twH = p && !p.custom ? p.twH : m2t(doc.paper.h);
    let objs = '';
    for (const o of doc.objects) objs += await objectXml(o);
    return `<?xml version="1.0" encoding="utf-8"?>\n<DieCutLabel Version="8.0" Units="twips">\n  <PaperOrientation>${doc.orientation}</PaperOrientation>\n  <Id>${p && !p.custom ? p.labelId : 'Custom'}</Id>\n  <PaperName>${escXml(p && !p.custom ? p.name : doc.paper.name)}</PaperName>\n  <DrawCommands>\n    <RoundRectangle X="0" Y="0" Width="${twW}" Height="${twH}" Rx="270" Ry="270" />\n  </DrawCommands>\n${objs}</DieCutLabel>\n`;
  }

  return { read, write };
})();
