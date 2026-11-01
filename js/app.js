'use strict';
// Application shell: toolbar, files, dialogs, autosave.

(() => {
  const $ = (s) => document.querySelector(s);
  const E = Editor;
  const file = { name: 'label', format: 'label', handle: null, diskPath: null };
  // Set when running inside the JayDymo.exe desktop wrapper (token for its local file API).
  const params = new URLSearchParams(location.search);
  const DESKTOP = params.get('desktop');
  if (DESKTOP) document.body.classList.add('desktop');
  const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Futura', 'Gill Sans', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Consolas', 'Impact', 'Arial Narrow', 'Roboto', 'Open Sans', 'DejaVu Sans', 'Liberation Sans'];
  $('#fonts').innerHTML = FONTS.map(f => `<option value="${f}">`).join('');
  $('#paperSelect').innerHTML = PAPERS.map(p => `<option value="${p.id}">${paperTitle(p)}</option>`).join('');

  // ---------- autosave ----------
  E.onCommit = (doc) => {
    syncTop();
    try { localStorage.setItem('jaydymo.doc', JSON.stringify({ doc, tv: TEMPLATE_VERSION, file: { name: file.name, format: file.format } })); } catch { /* quota: ignore */ }
  };
  function syncTop() {
    $('#paperSelect').value = E.doc.paper.id;
    $('#orientBtn').textContent = E.doc.orientation;
    document.title = `${file.name} – JayDymo ${APP_VERSION}`;
  }

  // ---------- files ----------
  function readDoc(text, name) {
    const isConnect = /<DesktopLabel|<DYMOLabel/.test(text.slice(0, 2000));
    const doc = isConnect ? DymoConnect.read(text) : DymoLabel.read(text);
    file.name = name.replace(/\.(label|dymo|xml)$/i, '');
    file.format = isConnect ? 'dymo' : 'label';
    return doc;
  }
  async function openFile(f, handle = null, diskPath = null) {
    try {
      const doc = readDoc(await f.text(), f.name);
      file.handle = handle; file.diskPath = diskPath;
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
    if (file.diskPath && DESKTOP) {
      try {
        const r = await fetch('/api/file?path=' + encodeURIComponent(file.diskPath), { method: 'POST', headers: { 'X-JayDymo': DESKTOP }, body: await serialize(file.format) });
        if (!r.ok) throw new Error(await r.text());
        return toast('Saved ' + file.diskPath);
      } catch (e) { return alert('Save failed: ' + e.message); }
    }
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
          file.handle = h; file.diskPath = null; file.name = h.name.replace(/\.\w+$/, ''); syncTop(); toast('Saved ' + h.name); return;
        } catch (e) { if (e.name === 'AbortError') return; }
      }
      download(`${name}.${fmt}`, xml); file.handle = null; file.diskPath = null; syncTop();
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
      const d = t.build(b);
      return `<button value="${t.id}"><img src="${svgDataUrl(Render.labelSvg(d))}" alt=""><span>${t.name}</span></button>`;
    }).join('');
    $('#dlgNew').returnValue = ''; $('#dlgNew').showModal();
  }
  $('#dlgNew').addEventListener('close', () => {
    const t = TEMPLATES.find(t => t.id === $('#dlgNew').returnValue); if (!t) return;
    E.setDoc(t.build(Brand.get()));
    Object.assign(file, { name: t.id === 'blank' ? 'label' : t.id, format: 'label', handle: null });
    syncTop(); E.onCommit(E.doc);
  });

  // ---------- brand ----------
  let brandDraft = null;
  function cmdBrand() {
    brandDraft = Brand.get();
    $('#brandSender').value = brandDraft.sender; $('#brandWeb').value = brandDraft.web || ''; $('#brandLogo').src = brandDraft.logo;
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
    brandDraft.sender = $('#brandSender').value.trim(); brandDraft.web = $('#brandWeb').value.trim();
    Brand.set(brandDraft);
    // update logos on the current label that still use the previous brand logo
    let n = 0;
    for (const o of E.doc.objects) if (o.type === 'image' && o.src === old.logo && old.logo !== brandDraft.logo) { o.src = brandDraft.logo; n++; }
    if (n) { E.commit(); E.render(true); }
    toast('Brand saved. Templates under “New” now use it.');
  });

  // ---------- print ----------
  async function updatePrintPreview() {
    $('#printPreview').src = await Printing.previewPng(E.doc);
    const out = outsidePrintable(E.doc);
    $('#printWarn').hidden = !out.length;
    $('#printWarn span').textContent = out.length ? `${out.map(o => o.name).join(', ')} ${out.length > 1 ? 'reach' : 'reaches'} into the border the printer can't print (hatched in the editor) and will be cut off.` : '';
  }
  $('#printFix').onclick = async () => { E.fitPrintable(); await updatePrintPreview(); };
  async function cmdPrint() {
    const d = $('#dlgPrint'), { w, h } = labelSize(E.doc);
    $('#printInfo').textContent = `${paperTitle(findPaper(E.doc.paper.id) || E.doc.paper)} · ${round(w, 1)} × ${round(h, 1)} mm. Preview shows the 300 dpi black & white result.`;
    await updatePrintPreview();
    d.returnValue = '';
    if (DESKTOP) {
      // Windows app: list installed printers, preselect the last used / a DYMO LabelWriter.
      const sel = $('#winPrinter'), last = localStorage.getItem('jaydymo.printer');
      try {
        const { printers, default: def } = await Printing.Direct.printers();
        const pick = printers.includes(last) ? last : printers.find(n => /dymo|labelwriter/i.test(n)) || def;
        sel.innerHTML = printers.map(n => `<option ${n === pick ? 'selected' : ''}>${escXml(n)}</option>`).join('') || '<option value="">No printers installed</option>';
      } catch (e) { sel.innerHTML = `<option value="">${escXml(e.message)}</option>`; }
      d.showModal(); $('#printGo').focus();
      return;
    }
    $('#dymoStatus').textContent = '(checking…)';
    d.showModal();
    Printing.Service.printers().then(list => {
      $('#dymoPrinter').innerHTML = list.map(n => `<option ${/450/.test(n) ? 'selected' : ''}>${escXml(n)}</option>`).join('');
      $('#dymoStatus').textContent = list.length ? `(${list.length} printer${list.length > 1 ? 's' : ''} found)` : '(not running)';
      if (list.length && localStorage.getItem('jaydymo.via') === 'dymo') d.querySelector('input[name=via][value=dymo]').checked = true;
    }).catch(() => { $('#dymoStatus').textContent = '(not available)'; });
  }
  $('#dlgPrint').addEventListener('close', async () => {
    const d = $('#dlgPrint'); if (d.returnValue !== 'ok') return;
    const via = d.querySelector('input[name=via]:checked').value, copies = Math.max(1, +$('#printCopies').value || 1);
    if (DESKTOP) {
      const printer = $('#winPrinter').value;
      if (!printer) return alert('No printer selected.');
      try { localStorage.setItem('jaydymo.printer', printer); localStorage.setItem('jaydymo.print', JSON.stringify({ flip: $('#printFlip').checked })); } catch { }
      toast('Printing…');
      try { await Printing.Direct.print(E.doc, printer, copies, $('#printFlip').checked); toast(`Sent ${copies} label${copies > 1 ? 's' : ''} to ${printer}`); }
      catch (e) { alert('Printing failed: ' + e.message); }
      return;
    }
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
  if (start && start.doc && Array.isArray(start.doc.objects) && start.tv === TEMPLATE_VERSION) { Object.assign(file, start.file || {}); E.setDoc(start.doc); }
  else {
    // first start, or the templates were updated: begin with the current default design
    E.setDoc(TEMPLATES[1].build(Brand.get())); file.name = 'shipping'; E.onCommit(E.doc);
    if (start) setTimeout(() => toast(`JayDymo ${APP_VERSION}: started with the updated label design.`), 300);
  }
  syncTop();
  requestAnimationFrame(() => E.fit());
  // Desktop: a .label/.dymo file passed on the command line ("Open with" / double-click).
  const openPath = params.get('open');
  if (DESKTOP && openPath) {
    fetch('/api/file?path=' + encodeURIComponent(openPath), { headers: { 'X-JayDymo': DESKTOP } })
      .then(r => r.ok ? r.text() : Promise.reject(new Error(r.statusText)))
      .then(text => openFile({ name: openPath.split(/[\\/]/).pop(), text: async () => text }, null, openPath))
      .catch(e => alert('Could not open ' + openPath + ':\n' + e.message));
  }
})();
