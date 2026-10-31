'use strict';
// Application shell: toolbar, files, dialogs, autosave.

(() => {
  const $ = (s) => document.querySelector(s);
  const E = Editor;
  const file = { name: 'label', format: 'label', handle: null };
  const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Futura', 'Gill Sans', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Consolas', 'Impact', 'Arial Narrow', 'Roboto', 'Open Sans', 'DejaVu Sans', 'Liberation Sans'];
  $('#fonts').innerHTML = FONTS.map(f => `<option value="${f}">`).join('');
  $('#paperSelect').innerHTML = PAPERS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  // ---------- autosave ----------
  E.onCommit = (doc) => {
    syncTop();
    try { localStorage.setItem('jaydymo.doc', JSON.stringify({ doc, file: { name: file.name, format: file.format } })); } catch { /* quota: ignore */ }
  };
  function syncTop() {
    $('#paperSelect').value = E.doc.paper.id;
    $('#orientBtn').textContent = E.doc.orientation;
    document.title = `${file.name} – JayDymo`;
  }

  // ---------- files ----------
  function readDoc(text, name) {
    const isConnect = /<DesktopLabel|<DYMOLabel/.test(text.slice(0, 2000));
    const doc = isConnect ? DymoConnect.read(text) : DymoLabel.read(text);
    file.name = name.replace(/\.(label|dymo|xml)$/i, '');
    file.format = isConnect ? 'dymo' : 'label';
    return doc;
  }
  async function openFile(f, handle = null) {
    try {
      const doc = readDoc(await f.text(), f.name);
      file.handle = handle;
      E.setDoc(doc); syncTop(); E.onCommit(E.doc);
      const raw = doc.objects.filter(o => o.type === 'raw').length;
      if (raw) toast(`${raw} object(s) of an unsupported type are shown as placeholders and kept when saving.`);
    } catch (e) { alert('Could not open ' + f.name + ':\n' + e.message); }
  }
  async function cmdOpen() {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await showOpenFilePicker({ types: [{ description: 'DYMO labels', accept: { 'application/xml': ['.label', '.dymo'] } }] });
        return openFile(await h.getFile(), h);
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    $('#fileOpen').click();
  }
  $('#fileOpen').onchange = (ev) => { const f = ev.target.files[0]; if (f) openFile(f); ev.target.value = ''; };

  async function serialize(fmt) { return fmt === 'dymo' ? DymoConnect.write(E.doc) : DymoLabel.write(E.doc); }
  async function cmdSave() {
    if (!file.handle) return cmdSaveAs();
    try {
      const w = await file.handle.createWritable(); await w.write(await serialize(file.format)); await w.close();
      toast('Saved ' + file.handle.name);
    } catch (e) { alert('Save failed: ' + e.message); }
  }
  function cmdSaveAs() {
    const d = $('#dlgSaveAs');
    $('#saveName').value = file.name;
    d.querySelector(`input[name=fmt][value=${file.format}]`).checked = true;
    d.returnValue = ''; d.showModal();
    d.onclose = async () => {
      if (d.returnValue !== 'ok') return;
      const fmt = d.querySelector('input[name=fmt]:checked').value, name = ($('#saveName').value.trim() || 'label').replace(/\.(label|dymo)$/i, '');
      const xml = await serialize(fmt);
      file.name = name; file.format = fmt;
      if (window.showSaveFilePicker) {
        try {
          const h = await showSaveFilePicker({ suggestedName: `${name}.${fmt}`, types: [{ description: fmt === 'dymo' ? 'DYMO Connect label' : 'DYMO label', accept: { 'application/xml': ['.' + fmt] } }] });
          const w = await h.createWritable(); await w.write(xml); await w.close();
          file.handle = h; file.name = h.name.replace(/\.\w+$/, ''); syncTop(); toast('Saved ' + h.name); return;
        } catch (e) { if (e.name === 'AbortError') return; }
      }
      download(`${name}.${fmt}`, xml); file.handle = null; syncTop();
    };
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- images ----------
  // Reads an image file as a data URL; large bitmaps are scaled to printer resolution.
  async function imageFromFile(f) {
    if (/svg/.test(f.type) || /\.svg$/i.test(f.name)) return svgDataUrl(await f.text());
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const img = await loadImg(url), max = 1400;
    if (img.width <= max && img.height <= max && /png|jpeg/.test(f.type)) return url;
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Unsupported image')); i.src = src; });
  async function addImage(src, name = 'Image') {
    const img = await loadImg(src), { w, h } = labelSize(E.doc);
    const ar = (img.width || 1) / (img.height || 1), box = Math.min(25, h * 0.8, w * 0.8);
    E.add(makeObject('image', { name, src, w: ar >= 1 ? box : box * ar, h: ar >= 1 ? box / ar : box }));
  }
  let replaceTarget = null;
  E.onReplaceImage = (o) => { replaceTarget = o; $('#fileImage').click(); };
  $('#fileImage').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const src = await imageFromFile(f);
      if (replaceTarget) { replaceTarget.src = src; replaceTarget = null; E.commit(); E.render(true); }
      else addImage(src, f.name.replace(/\.\w+$/, ''));
    } catch (e) { alert(e.message); }
  };

  // ---------- add tools ----------
  const tools = {
    text: () => E.add(makeObject('text', { text: 'Text', w: 40, h: 9 })),
    image: () => { replaceTarget = null; $('#fileImage').click(); },
    icon: () => $('#dlgIcon').showModal(),
    rect: () => E.add(makeObject('shape', { shape: 'rect', w: 20, h: 12 })),
    ellipse: () => E.add(makeObject('shape', { shape: 'ellipse', w: 14, h: 14 })),
    line: () => E.add(makeObject('shape', { shape: 'line', w: 40, h: 1, stroke: 0.4, name: 'Line' })),
    code128: () => E.add(makeObject('barcode', { symbology: 'code128', w: 45, h: 14 })),
    qr: () => E.add(makeObject('barcode', { symbology: 'qr', data: 'https://', w: 18, h: 18, name: 'QR code' })),
  };
  E.onTool = (t) => tools[t]();
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => tools[b.dataset.add]());
  $('#iconGrid').innerHTML = Object.keys(ICONS).map(k => `<button value="${k}" title="${k}"><img src="${svgDataUrl(iconSvg(k))}" alt="${k}"></button>`).join('');
  $('#dlgIcon').addEventListener('close', () => {
    const k = $('#dlgIcon').returnValue;
    if (ICONS[k]) E.add(makeObject('image', { name: 'Icon ' + k, src: svgDataUrl(iconSvg(k)), w: 10, h: 10 }));
    $('#dlgIcon').returnValue = '';
  });

  // ---------- templates ----------
  function cmdNew() {
    const b = Brand.get();
    $('#tplList').innerHTML = TEMPLATES.map(t => {
      const d = t.build(b, E.doc.paper.id);
      return `<button value="${t.id}"><img src="${svgDataUrl(Render.labelSvg(d))}" alt=""><span>${t.name}</span></button>`;
    }).join('');
    $('#dlgNew').returnValue = ''; $('#dlgNew').showModal();
  }
  $('#dlgNew').addEventListener('close', () => {
    const t = TEMPLATES.find(t => t.id === $('#dlgNew').returnValue); if (!t) return;
    E.setDoc(t.build(Brand.get(), E.doc.paper.id));
    Object.assign(file, { name: t.id === 'blank' ? 'label' : t.id, format: 'label', handle: null });
    syncTop(); E.onCommit(E.doc);
  });

  // ---------- brand ----------
  let brandDraft = null;
  function cmdBrand() {
    brandDraft = Brand.get();
    $('#brandSender').value = brandDraft.sender; $('#brandLogo').src = brandDraft.logo;
    $('#dlgBrand').returnValue = ''; $('#dlgBrand').showModal();
  }
  $('#brandLogoPick').onclick = () => $('#fileLogo').click();
  $('#brandLogoReset').onclick = () => { brandDraft.logo = DEFAULT_LOGO; $('#brandLogo').src = DEFAULT_LOGO; };
  $('#fileLogo').onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    brandDraft.logo = await imageFromFile(f); $('#brandLogo').src = brandDraft.logo;
  };
  $('#dlgBrand').addEventListener('close', () => {
    if ($('#dlgBrand').returnValue !== 'ok') return;
    const old = Brand.get();
    brandDraft.sender = $('#brandSender').value.trim();
    Brand.set(brandDraft);
    // update logos on the current label that still use the previous brand logo
    let n = 0;
    for (const o of E.doc.objects) if (o.type === 'image' && o.src === old.logo && old.logo !== brandDraft.logo) { o.src = brandDraft.logo; n++; }
    if (n) { E.commit(); E.render(true); }
    toast('Brand saved. Templates under “New” now use it.');
  });

  // ---------- print ----------
  async function cmdPrint() {
    const d = $('#dlgPrint'), { w, h } = labelSize(E.doc);
    $('#printInfo').textContent = `${E.doc.paper.name} · ${round(w, 1)} × ${round(h, 1)} mm. Preview shows the 300 dpi black & white result.`;
    $('#printPreview').src = await Printing.previewPng(E.doc);
    $('#dymoStatus').textContent = '(checking…)';
    d.returnValue = ''; d.showModal();
    Printing.Service.printers().then(list => {
      $('#dymoPrinter').innerHTML = list.map(n => `<option ${/450/.test(n) ? 'selected' : ''}>${escXml(n)}</option>`).join('');
      $('#dymoStatus').textContent = list.length ? `(${list.length} printer${list.length > 1 ? 's' : ''} found)` : '(not running)';
      if (list.length && localStorage.getItem('jaydymo.via') === 'dymo') d.querySelector('input[name=via][value=dymo]').checked = true;
    }).catch(() => { $('#dymoStatus').textContent = '(not available)'; });
  }
  $('#dlgPrint').addEventListener('close', async () => {
    const d = $('#dlgPrint'); if (d.returnValue !== 'ok') return;
    const via = d.querySelector('input[name=via]:checked').value, copies = Math.max(1, +$('#printCopies').value || 1);
    try { localStorage.setItem('jaydymo.via', via); localStorage.setItem('jaydymo.print', JSON.stringify({ rotate: $('#printRotate').checked, flip: $('#printFlip').checked })); } catch { }
    if (via === 'dymo') {
      const p = $('#dymoPrinter').value;
      if (!p) return alert('No DYMO printer found via the DYMO Web Service. Use the system print dialog instead.');
      try { await Printing.Service.print(E.doc, p, copies); toast('Sent to ' + p); } catch (e) { alert('DYMO print failed: ' + e.message); }
    } else Printing.systemPrint(E.doc, { copies, rotate: $('#printRotate').checked, flip: $('#printFlip').checked });
  });
  try { const p = JSON.parse(localStorage.getItem('jaydymo.print') || '{}'); if (p.rotate === false) $('#printRotate').checked = false; if (p.flip) $('#printFlip').checked = true; } catch { }

  // ---------- toolbar ----------
  const cmds = {
    new: cmdNew, open: cmdOpen, save: cmdSave, saveAs: cmdSaveAs, undo: E.undo, redo: E.redo, print: cmdPrint, brand: cmdBrand,
    orientation: () => E.setPaper(E.doc.paper.id, E.doc.orientation === 'Landscape' ? 'Portrait' : 'Landscape'),
    zoomIn: () => E.zoomBy(1.2), zoomOut: () => E.zoomBy(1 / 1.2), zoomFit: E.fit,
  };
  document.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => cmds[b.dataset.cmd]());
  $('#paperSelect').onchange = (ev) => E.setPaper(ev.target.value);
  $('#monoToggle').onchange = (ev) => { E.mono = ev.target.checked; E.render(); };
  $('#snapToggle').onchange = (ev) => { E.snap = ev.target.checked; };
  document.addEventListener('keydown', (ev) => {
    const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
    if (!mod || document.querySelector('dialog[open]')) return;
    if (k === 's') { ev.preventDefault(); ev.shiftKey ? cmdSaveAs() : cmdSave(); }
    else if (k === 'o') { ev.preventDefault(); cmdOpen(); }
    else if (k === 'p') { ev.preventDefault(); cmdPrint(); }
  });
  window.addEventListener('resize', () => E.render());

  // ---------- drag & drop / paste ----------
  const stage = $('#stage');
  stage.addEventListener('dragover', (ev) => { ev.preventDefault(); });
  stage.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    for (const f of ev.dataTransfer.files) {
      if (/\.(label|dymo)$/i.test(f.name)) { await openFile(f); break; }
      if (/^image\//.test(f.type) || /\.svg$/i.test(f.name)) { try { await addImage(await imageFromFile(f), f.name.replace(/\.\w+$/, '')); } catch (e) { alert(e.message); } }
    }
  });
  document.addEventListener('paste', async (ev) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
    const f = [...(ev.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
    if (f) { ev.preventDefault(); return addImage(await imageFromFile(f)); }
    const text = ev.clipboardData?.getData('text/plain');
    if (E.clipboard && (!text || text === E._lastCopiedText)) { ev.preventDefault(); return E.paste(); }
    if (text) { ev.preventDefault(); E.add(makeObject('text', { text: text.trim(), w: 50, h: 15 })); }
  });
  document.addEventListener('copy', (ev) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || !E.sel.size) return;
    // Put the text content on the system clipboard too, so it can be pasted elsewhere.
    const txt = E.doc.objects.filter(o => E.sel.has(o.id)).map(o => o.text || o.data || '').filter(Boolean).join('\n');
    E._lastCopiedText = txt;
    if (txt) { ev.clipboardData.setData('text/plain', txt); ev.preventDefault(); }
  });

  // ---------- toast ----------
  let toastEl = null, toastT = null;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1d2026;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;z-index:99;max-width:90vw;box-shadow:0 4px 20px rgba(0,0,0,.3);transition:opacity .3s'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.style.opacity = 1;
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.style.opacity = 0, 3500);
  }

  // ---------- start ----------
  let start = null;
  try { start = JSON.parse(localStorage.getItem('jaydymo.doc') || 'null'); } catch { }
  if (start && start.doc && Array.isArray(start.doc.objects)) { Object.assign(file, start.file || {}); E.setDoc(start.doc); }
  else { E.setDoc(TEMPLATES[1].build(Brand.get())); file.name = 'shipping'; }
  syncTop();
  requestAnimationFrame(() => E.fit());
})();
