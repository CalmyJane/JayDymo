'use strict';
// DYMO Connect ".dymo" format (XML, units: inches).
const DymoConnect = (() => {
  const i2m = (v) => round(v * MM_PER_IN, 3);
  const m2i = (v) => round(v / MM_PER_IN, 5);
  const brushColor = (el) => {
    const c = el && (el.localName === 'Color' ? el : el.getElementsByTagName('Color')[0]);
    if (!c) return { hex: '#000000', a: 1 };
    const g = (k) => parseFloat(c.getAttribute(k) || 0);
    const big = ['R', 'G', 'B'].some(k => g(k) > 1);
    const f = big ? 1 : 255;
    return { hex: '#' + X.hex2(g('R') * f) + X.hex2(g('G') * f) + X.hex2(g('B') * f), a: big ? g('A') / 255 : g('A') };
  };
  const brush = (hex, a = 1) => { const [r, g, b] = X.rgb(hex); return `<SolidColorBrush><Color A="${a}" R="${round(r / 255, 4)}" G="${round(g / 255, 4)}" B="${round(b / 255, 4)}"></Color></SolidColorBrush>`; };

  function read(xml) {
    const d = X.parse(xml), root = d.documentElement;
    const lab = root.localName === 'DYMOLabel' ? root : X.kid(root, 'DYMOLabel');
    if (!lab) throw new Error('Not a DYMO Connect .dymo file');
    const orientation = /landscape/i.test(X.txt(lab, 'Orientation')) ? 'Landscape' : 'Portrait';
    const labelName = X.txt(lab, 'LabelName');
    let preset = findPaper((/(\d{5})/.exec(labelName) || [])[1]);
    if (!preset) {
      const r = X.kid(lab, 'DYMORect');
      const w = i2m(X.num(r, 'Size/Width') + 2 * X.num(r, 'DYMOPoint/X')), h = i2m(X.num(r, 'Size/Height') + 2 * X.num(r, 'DYMOPoint/Y'));
      preset = findPaperBySize(w, h);
      if (!preset && w && h) {
        const pw = orientation === 'Landscape' ? h : w, ph = orientation === 'Landscape' ? w : h;
        preset = { id: 'custom', name: labelName || 'Custom', w: round(pw, 1), h: round(ph, 1) };
      }
    }
    preset = preset || PAPERS[0];
    const doc = { paper: { id: preset.id, name: preset.name, w: preset.w, h: preset.h }, orientation, objects: [], source: { format: 'dymo' } };
    const objs = X.at(lab, 'DynamicLayoutManager/LabelObjects') || X.kid(lab, 'LabelObjects');
    for (const el of X.kids(objs)) {
      const L = X.kid(el, 'ObjectLayout');
      const base = { x: i2m(X.num(L, 'DYMOPoint/X')), y: i2m(X.num(L, 'DYMOPoint/Y')), w: i2m(X.num(L, 'Size/Width')), h: i2m(X.num(L, 'Size/Height')),
        rotation: X.rot(X.txt(el, 'Rotation')), name: X.txt(el, 'Name') };
      doc.objects.push(readObject(el, base) || makeObject('raw', Object.assign(base, { name: base.name || el.localName, xml: X.ser(el), rawFormat: 'dymo' })));
    }
    return doc;
  }

  function readObject(el, base) {
    const type = el.localName;
    if (type === 'TextObject' || type === 'AddressObject') {
      const ft = X.kid(el, 'FormattedText');
      const lines = [];
      let fi = null;
      for (const lts of X.kids(ft, 'LineTextSpan')) {
        let line = '';
        for (const ts of X.kids(lts, 'TextSpan')) { line += X.txt(ts, 'Text'); fi = fi || X.kid(ts, 'FontInfo'); }
        lines.push(line.replace(/\r\n?/g, '\n').replace(/\n$/, ''));
      }
      const fit = X.txt(el, 'FitMode', X.txt(ft, 'FitMode', 'None'));
      return makeObject('text', Object.assign(base, {
        text: lines.join('\n'), font: X.txt(fi, 'FontName', 'Arial'), size: X.num(fi, 'FontSize', 12),
        bold: X.bool(X.txt(fi, 'IsBold')), italic: X.bool(X.txt(fi, 'IsItalic')), underline: X.bool(X.txt(fi, 'IsUnderline')),
        color: brushColor(X.kid(fi, 'FontBrush')).hex,
        align: X.mapAlign(X.txt(el, 'HorizontalAlignment'), 'left'), valign: X.mapAlign(X.txt(el, 'VerticalAlignment'), 'middle'),
        fit: /AlwaysFit/i.test(fit) ? 'always' : /Shrink/i.test(fit) ? 'shrink' : 'none', name: base.name || 'Text' }));
    }
    if (type === 'ImageObject') {
      const b64 = X.txt(el, 'Data').replace(/\s+/g, ''), svg = X.readSvgComment(el), sm = X.txt(el, 'ScaleMode', 'Uniform');
      return makeObject('image', Object.assign(base, { src: svg || (b64 ? `data:${X.imageMime(b64)};base64,${b64}` : ''),
        fit: /Fill/i.test(sm) ? 'stretch' : 'contain', halign: X.mapAlign(X.txt(el, 'HorizontalAlignment'), 'center'),
        valign: X.mapAlign(X.txt(el, 'VerticalAlignment'), 'middle'), name: base.name || 'Image' }));
    }
    if (type === 'ShapeObject') {
      const st = X.txt(el, 'ShapeType', 'Rectangle');
      const thick = X.num(el, 'LineWidth', X.num(el, 'OutlineThickness', 1)); // DYMO Connect: points
      const fill = brushColor(X.at(el, 'Brushes/FillBrush'));
      const props = { stroke: round(thick * PT_TO_MM, 3), color: brushColor(X.at(el, 'Brushes/StrokeBrush') || X.at(el, 'Brushes/BorderBrush')).hex,
        fill: fill.a > 0, name: base.name || 'Shape' };
      if (/Vertical/i.test(st)) { props.shape = 'line'; base.rotation = (base.rotation + 90) % 360; }
      else props.shape = /Line/i.test(st) ? 'line' : /Ellipse/i.test(st) ? 'ellipse' : 'rect';
      if (props.fill) props.color = fill.hex;
      return makeObject('shape', Object.assign(base, props));
    }
    if (type === 'BarcodeObject' || type === 'QRCodeObject') {
      const fmt = X.txt(el, 'BarcodeFormat', X.txt(el, 'Type', type === 'QRCodeObject' ? 'QRCode' : 'Code128Auto'));
      if (!/Code128|QR/i.test(fmt)) return null;
      const data = el.getElementsByTagName('DataString')[0]?.textContent ?? X.txt(el, 'Data') ?? X.txt(el, 'Text');
      const qr = /QR/i.test(fmt);
      return makeObject('barcode', Object.assign(base, { data, symbology: qr ? 'qr' : 'code128',
        showText: !qr && !/None/i.test(X.txt(el, 'TextPosition', 'Bottom')), name: base.name || 'Barcode' }));
    }
    return null;
  }

  const common = (o, rot) => `
          <Name>${escXml(o.name || 'Object')}</Name>
          <Brushes>
            <BackgroundBrush>${brush('#ffffff', 0)}</BackgroundBrush>
            <BorderBrush>${brush('#000000')}</BorderBrush>
            <StrokeBrush>${brush(o.color || '#000000')}</StrokeBrush>
            <FillBrush>${brush(o.color || '#000000', o.type === 'shape' && o.fill ? 1 : 0)}</FillBrush>
          </Brushes>
          <Rotation>Rotation${rot}</Rotation>
          <OutlineThickness>1</OutlineThickness>
          <IsOutlined>False</IsOutlined>
          <BorderStyle>SolidLine</BorderStyle>
          <Margin>
            <DYMOThickness Left="0" Top="0" Right="0" Bottom="0" />
          </Margin>`;
  const layout = (o) => `
          <ObjectLayout>
            <DYMOPoint>
              <X>${m2i(o.x)}</X>
              <Y>${m2i(o.y)}</Y>
            </DYMOPoint>
            <Size>
              <Width>${m2i(o.w)}</Width>
              <Height>${m2i(o.h)}</Height>
            </Size>
          </ObjectLayout>`;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  async function objectXml(o) {
    let rot = o.rotation || 0;
    if (o.type === 'text') {
      const fit = { none: 'None', shrink: 'ShrinkToFit', always: 'AlwaysFit' }[o.fit];
      const lines = o.text.split('\n').map((l, i, a) => `
              <LineTextSpan>
                <TextSpan>
                  <Text>${escXml(l + (i < a.length - 1 ? '\n' : ''))}</Text>
                  <FontInfo>
                    <FontName>${escXml(o.font)}</FontName>
                    <FontSize>${o.size}</FontSize>
                    <IsBold>${X.B(o.bold)}</IsBold>
                    <IsItalic>${X.B(o.italic)}</IsItalic>
                    <IsUnderline>${X.B(o.underline)}</IsUnderline>
                    <FontBrush>${brush(o.color)}</FontBrush>
                  </FontInfo>
                </TextSpan>
              </LineTextSpan>`).join('');
      return `
        <TextObject>${common(o, rot)}
          <HorizontalAlignment>${cap(o.align)}</HorizontalAlignment>
          <VerticalAlignment>${cap(o.valign)}</VerticalAlignment>
          <FitMode>${fit}</FitMode>
          <IsVertical>False</IsVertical>
          <FormattedText>
            <FitMode>${fit}</FitMode>
            <HorizontalAlignment>${cap(o.align)}</HorizontalAlignment>
            <VerticalAlignment>${cap(o.valign)}</VerticalAlignment>
            <IsVertical>False</IsVertical>${lines}
          </FormattedText>${layout(o)}
        </TextObject>`;
    }
    if (o.type === 'image') {
      let b64 = '';
      if (o.src && /^data:image\/(png|jpeg|gif|bmp)/.test(o.src)) b64 = o.src.split(',')[1];
      else if (o.src) b64 = await Render.objectPng(Object.assign({}, o, { rotation: 0 }));
      return `
        <ImageObject>${common(o, rot)}
          ${X.svgComment(o)}<Data>${b64}</Data>
          <ScaleMode>${o.fit === 'stretch' ? 'Fill' : 'Uniform'}</ScaleMode>
          <HorizontalAlignment>${cap(o.halign)}</HorizontalAlignment>
          <VerticalAlignment>${cap(o.valign)}</VerticalAlignment>${layout(o)}
        </ImageObject>`;
    }
    if (o.type === 'shape') {
      let st = o.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
      if (o.shape === 'line') { st = (rot === 90 || rot === 270) ? 'VerticalLine' : 'HorizontalLine'; rot = 0; }
      return `
        <ShapeObject>${common(o, rot)}
          <ShapeType>${st}</ShapeType>
          <LineWidth>${round(o.stroke / PT_TO_MM, 3)}</LineWidth>
          <LineStyle>Solid</LineStyle>${layout(o)}
        </ShapeObject>`;
    }
    if (o.type === 'barcode') {
      const qr = o.symbology === 'qr';
      if (qr) return `
        <QRCodeObject>${common(o, rot)}
          <BarcodeFormat>QRCode</BarcodeFormat>
          <Data>
            <DataString>${escXml(o.data)}</DataString>
          </Data>
          <HorizontalAlignment>Center</HorizontalAlignment>
          <VerticalAlignment>Middle</VerticalAlignment>
          <Size>AutoFit</Size>
          <EQRCodeType>QRCodeText</EQRCodeType>
          <TextDataHolder>
            <Value>${escXml(o.data)}</Value>
          </TextDataHolder>${layout(o)}
        </QRCodeObject>`;
      return `
        <BarcodeObject>${common(o, rot)}
          <BarcodeFormat>Code128Auto</BarcodeFormat>
          <Data>
            <MultiDataString>
              <DataString>${escXml(o.data)}</DataString>
            </MultiDataString>
          </Data>
          <HorizontalAlignment>Center</HorizontalAlignment>
          <VerticalAlignment>Middle</VerticalAlignment>
          <ShowBarcodeFor9DigitZipOnly>False</ShowBarcodeFor9DigitZipOnly>
          <BarcodeEncoding>BarcodeEncodingDefault</BarcodeEncoding>
          <Size>Medium</Size>
          <TextPosition>${o.showText ? 'Bottom' : 'None'}</TextPosition>
          <FontInfo>
            <FontName>Arial</FontName>
            <FontSize>${o.textSize || 8}</FontSize>
            <IsBold>False</IsBold>
            <IsItalic>False</IsItalic>
            <IsUnderline>False</IsUnderline>
            <FontBrush>${brush('#000000')}</FontBrush>
          </FontInfo>${layout(o)}
        </BarcodeObject>`;
    }
    if (o.type === 'raw' && o.rawFormat === 'dymo') {
      // keep the original element, but update its position
      const d = X.parse(o.xml), el = d.documentElement, L = X.kid(el, 'ObjectLayout');
      if (L) {
        const set = (p, v) => { const e = X.at(L, p); if (e) e.textContent = v; };
        set('DYMOPoint/X', m2i(o.x)); set('DYMOPoint/Y', m2i(o.y)); set('Size/Width', m2i(o.w)); set('Size/Height', m2i(o.h));
      }
      return '\n        ' + X.ser(el);
    }
    return '';
  }

  async function write(doc) {
    const p = findPaper(doc.paper.id);
    const { w, h } = labelSize(doc);
    const name = p && !p.custom ? p.connect : 'Custom';
    let objs = '';
    for (const o of doc.objects) objs += await objectXml(o);
    return `<?xml version="1.0" encoding="utf-8"?>
<DesktopLabel Version="1">
  <DYMOLabel Version="3">
    <Description>DYMO Label</Description>
    <Orientation>${doc.orientation}</Orientation>
    <LabelName>${escXml(name)}</LabelName>
    <InitialLength>0</InitialLength>
    <BorderStyle>SolidLine</BorderStyle>
    <DYMORect>
      <DYMOPoint>
        <X>0</X>
        <Y>0</Y>
      </DYMOPoint>
      <Size>
        <Width>${m2i(w)}</Width>
        <Height>${m2i(h)}</Height>
      </Size>
    </DYMORect>
    <BorderColor>${brush('#000000')}</BorderColor>
    <BorderThickness>1</BorderThickness>
    <Show_Border>False</Show_Border>
    <HasFixedLength>False</HasFixedLength>
    <FixedLengthValue>0</FixedLengthValue>
    <DynamicLayoutManager>
      <RotationBehavior>ClearObjects</RotationBehavior>
      <LabelObjects>${objs}
      </LabelObjects>
    </DynamicLayoutManager>
  </DYMOLabel>
  <LabelApplication>Blank</LabelApplication>
  <DataTable>
    <Columns></Columns>
    <Rows></Rows>
  </DataTable>
</DesktopLabel>
`;
  }

  return { read, write };
})();
