'use strict';
// Interactive label editor: selection, drag/resize, snapping, properties panel, layers.

const Editor = (() => {
  const $ = (s) => document.querySelector(s);
  const svg = $('#canvas'), labelLayer = $('#labelLayer'), objLayer = $('#objLayer'), overlay = $('#overlay');
  const NS = 'http://www.w3.org/2000/svg';

  const E = {
    doc: newDoc(), sel: new Set(), zoom: 4, mono: false, snap: true, history: new History(),
    clipboard: null, onCommit: () => {},
  };
  const cache = new Map(); // id -> { key, el }
  let guides = [], propsKey = '', commitTimer = null;

  const byId = (id) => E.doc.objects.find(o => o.id === id);
  const selected = () => E.doc.objects.filter(o => E.sel.has(o.id));
  const size = () => labelSize(E.doc);

  // ---------- document lifecycle ----------
  E.setDoc = (doc, resetHistory = true) => {
    E.doc = doc; E.sel.clear(); cache.clear(); objLayer.innerHTML = '';
    if (resetHistory) { E.history = new History(); E.history.push(doc); }
    E.fit(); render(true);
  };
  // Records the current state (debounced for continuous edits).
  E.commit = (immediate = true) => {
    clearTimeout(commitTimer);
    const run = () => { E.history.push(E.doc); E.onCommit(E.doc); };
    if (immediate) run(); else commitTimer = setTimeout(run, 400);
    render();
  };
  E.undo = () => { const d = E.history.undo(); if (d) restore(d); };
  E.redo = () => { const d = E.history.redo(); if (d) restore(d); };
  function restore(d) {
    E.doc = d; E.sel = new Set([...E.sel].filter(byId)); render(true); E.onCommit(E.doc);
  }

  // ---------- rendering ----------
  function render(forceProps = false) {
    const { w, h } = size(), z = E.zoom;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w * z); svg.setAttribute('height', h * z);
    $('#canvasDefs').innerHTML = Render.MONO_FILTER;
    const r = Math.min(3, w / 10, h / 10), a = printableArea(E.doc), d = designArea(E.doc);
    // label, hatched non-printable border, faded extra strip, dashed (symmetric) design area
    labelLayer.innerHTML = `<pattern id="noprint" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="1.2" fill="#eceef1"/><line x1="0" y1="0" x2="0" y2="1.2" stroke="#cfd4db" stroke-width="0.5"/></pattern>` +
      `<rect class="label" width="${w}" height="${h}" rx="${r}" fill="#fff"/>` +
      `<path d="M0 0H${w}V${h}H0Z M${a.x} ${a.y}V${a.y + a.h}H${a.x + a.w}V${a.y}Z" fill="url(#noprint)" fill-rule="evenodd" clip-path="inset(0 round ${r})" pointer-events="none"/>` +
      extraStrip(a, d) +
      `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="none" stroke="#8a94a3" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    objLayer.setAttribute('filter', E.mono ? 'url(#mono)' : '');
    // objects (cached by content; position applied via transform)
    const seen = new Set();
    E.doc.objects.forEach((o, i) => {
      seen.add(o.id);
      const key = JSON.stringify(Object.assign({}, o, { x: 0, y: 0, name: '', locked: 0 }));
      let c = cache.get(o.id);
      if (!c || c.key !== key) {
        const el = document.createElementNS(NS, 'g');
        el.dataset.id = o.id;
        el.innerHTML = `<rect width="${o.w}" height="${o.h}" fill="transparent"/>` + Render.objectSvg(Object.assign({}, o, { x: 0, y: 0 }));
        if (c) c.el.replaceWith(el);
        c = { key, el }; cache.set(o.id, c);
      }
      c.el.setAttribute('transform', `translate(${o.x} ${o.y})`);
      if (objLayer.children[i] !== c.el) objLayer.insertBefore(c.el, objLayer.children[i] || null);
    });
    for (const [id, c] of cache) if (!seen.has(id)) { c.el.remove(); cache.delete(id); }
    renderOverlay();
    renderLayers();
    renderProps(forceProps);
    $('#zoomLabel').textContent = Math.round(E.zoom / 3.78 * 100) + '%';
    status();
  }
  E.render = render;

  // Marks the printable strip outside the centred design area as optional "extra space".
  // The printable strip beyond the symmetric design area: shown faded (usable, but lay out on the dashed line).
  function extraStrip(a, d) {
    const land = E.doc.orientation === 'Landscape';
    const r = land ? { x: d.x + d.w, y: a.y, w: a.x + a.w - d.x - d.w, h: a.h } : { x: a.x, y: d.y + d.h, w: a.w, h: a.y + a.h - d.y - d.h };
    if (r.w <= 0 || r.h <= 0) return '';
    const edge = land ? `M${r.x + r.w} ${r.y}V${r.y + r.h}` : `M${r.x} ${r.y + r.h}H${r.x + r.w}`;
    return `<g pointer-events="none"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="url(#noprint)" opacity="0.4"/>` +
      `<path d="${edge}" stroke="#b6bcc6" stroke-width="1" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"/>` +
      '</g>';
  }


  function renderOverlay() {
    const z = E.zoom, hs = 8 / z;
    let s = '';
    for (const g of guides) s += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#e11d74" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    const sel = selected();
    for (const o of sel) s += `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="none" stroke="${o.locked ? '#f59e0b' : 'var(--sel)'}" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    if (sel.length === 1 && !sel[0].locked) {
      const o = sel[0];
      const pts = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
      for (const [k, [fx, fy]] of Object.entries(pts)) {
        if (o.type === 'shape' && o.shape === 'line' && /^[ns]$/.test(k) && !(o.rotation % 180)) continue;
        s += `<rect data-handle="${k}" x="${o.x + o.w * fx - hs / 2}" y="${o.y + o.h * fy - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="var(--sel)" stroke-width="1.5" vector-effect="non-scaling-stroke" style="cursor:${k}-resize"/>`;
      }
    }
    if (marquee) s += `<rect x="${Math.min(marquee.x0, marquee.x1)}" y="${Math.min(marquee.y0, marquee.y1)}" width="${Math.abs(marquee.x1 - marquee.x0)}" height="${Math.abs(marquee.y1 - marquee.y0)}" fill="rgba(37,99,235,.08)" stroke="var(--sel)" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>`;
    overlay.innerHTML = s;
  }

  function status(pt) {
    const { w, h } = size(), sel = selected();
    let s = `${paperTitle(findPaper(E.doc.paper.id) || E.doc.paper)} · ${round(w, 1)} × ${round(h, 1)} mm · ${E.doc.orientation}`;
    if (sel.length === 1) { const o = sel[0]; s += ` — ${o.name}: X ${round(o.x, 1)} Y ${round(o.y, 1)} W ${round(o.w, 1)} H ${round(o.h, 1)} mm`; }
    else if (sel.length > 1) s += ` — ${sel.length} objects selected`;
    if (pt) s += ` · cursor ${round(pt.x, 1)}, ${round(pt.y, 1)}`;
    s += ` · JayDymo ${APP_VERSION}`;
    $('#status').textContent = s;
  }

  // ---------- zoom ----------
  E.fit = () => {
    const st = $('#stage'), { w, h } = size();
    E.zoom = Math.max(1, Math.min((st.clientWidth - 100) / w, (st.clientHeight - 120) / h, 14));
    render();
  };
  E.zoomBy = (f) => { E.zoom = Math.max(1, Math.min(E.zoom * f, 40)); render(); };

  // ---------- geometry / snapping ----------
  function toMm(ev) {
    const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function bbox(objs) {
    const x = Math.min(...objs.map(o => o.x)), y = Math.min(...objs.map(o => o.y));
    return { x, y, w: Math.max(...objs.map(o => o.x + o.w)) - x, h: Math.max(...objs.map(o => o.y + o.h)) - y };
  }
  function snapTargets() {
    const { w, h } = size(), a = printableArea(E.doc), d = designArea(E.doc), xs = [0, w / 2, w, d.x, d.x + d.w, a.x + a.w], ys = [0, h / 2, h, d.y, d.y + d.h, a.y + a.h];
    for (const o of E.doc.objects) if (!E.sel.has(o.id)) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
    return { xs, ys };
  }
  // Returns the correction to apply so one of `vals` lands on a target (or grid).
  function snap1(vals, targets, axis, ev) {
    if (!E.snap || ev.altKey) return { d: 0 };
    const th = 6 / E.zoom; let best = null;
    for (const v of vals) for (const t of targets) { const d = t - v; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; }
    if (best) {
      const { w, h } = size();
      guides.push(axis === 'x' ? { x1: best.t, y1: -3, x2: best.t, y2: h + 3 } : { x1: -3, y1: best.t, x2: w + 3, y2: best.t });
      return best;
    }
    const g = 0.5; return { d: Math.round(vals[0] / g) * g - vals[0] };
  }

  // ---------- pointer interaction ----------
  let drag = null, marquee = null;
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const pt = toMm(ev), handle = ev.target.dataset?.handle;
    const g = ev.target.closest('[data-id]');
    svg.setPointerCapture(ev.pointerId);
    if (handle) {
      const o = selected()[0];
      drag = { mode: 'resize', handle, start: pt, o0: clone(o), id: o.id };
      return;
    }
    if (g) {
      const id = g.dataset.id;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { E.sel.has(id) ? E.sel.delete(id) : E.sel.add(id); }
      else if (!E.sel.has(id)) { E.sel.clear(); E.sel.add(id); }
      const objs = selected().filter(o => !o.locked);
      drag = { mode: 'move', start: pt, orig: objs.map(o => ({ o, x: o.x, y: o.y })), moved: false };
      render();
      return;
    }
    if (!ev.shiftKey) E.sel.clear();
    marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, base: new Set(E.sel) };
    render();
  });

  svg.addEventListener('pointermove', (ev) => {
    const pt = toMm(ev);
    status(pt);
    if (marquee) {
      marquee.x1 = pt.x; marquee.y1 = pt.y;
      const r = { x: Math.min(marquee.x0, pt.x), y: Math.min(marquee.y0, pt.y), x2: Math.max(marquee.x0, pt.x), y2: Math.max(marquee.y0, pt.y) };
      E.sel = new Set(marquee.base);
      for (const o of E.doc.objects) if (o.x < r.x2 && o.x + o.w > r.x && o.y < r.y2 && o.y + o.h > r.y) E.sel.add(o.id);
      render(); return;
    }
    if (!drag) return;
    guides = [];
    if (drag.mode === 'move') {
      if (!drag.orig.length) return;
      let dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * E.zoom < 3) return;
      drag.moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const b = bbox(drag.orig.map(r => ({ x: r.x + dx, y: r.y + dy, w: r.o.w, h: r.o.h })));
      const T = snapTargets();
      dx += snap1([b.x, b.x + b.w / 2, b.x + b.w], T.xs, 'x', ev).d;
      dy += snap1([b.y, b.y + b.h / 2, b.y + b.h], T.ys, 'y', ev).d;
      for (const r of drag.orig) { r.o.x = round(r.x + dx, 3); r.o.y = round(r.y + dy, 3); }
    } else {
      const o = byId(drag.id), o0 = drag.o0, hd = drag.handle, T = snapTargets();
      let x1 = o0.x, y1 = o0.y, x2 = o0.x + o0.w, y2 = o0.y + o0.h;
      if (hd.includes('w')) x1 = pt.x; if (hd.includes('e')) x2 = pt.x;
      if (hd.includes('n')) y1 = pt.y; if (hd.includes('s')) y2 = pt.y;
      if (hd.includes('w')) x1 += snap1([x1], T.xs, 'x', ev).d; if (hd.includes('e')) x2 += snap1([x2], T.xs, 'x', ev).d;
      if (hd.includes('n')) y1 += snap1([y1], T.ys, 'y', ev).d; if (hd.includes('s')) y2 += snap1([y2], T.ys, 'y', ev).d;
      const min = 0.8;
      if (x2 - x1 < min) hd.includes('w') ? x1 = x2 - min : x2 = x1 + min;
      if (y2 - y1 < min) hd.includes('n') ? y1 = y2 - min : y2 = y1 + min;
      if ((ev.shiftKey || (o.type === 'image' && o.fit === 'contain' && !ev.altKey) || (o.type === 'barcode' && o.symbology === 'qr')) && hd.length === 2) {
        const ar = o0.w / o0.h; let w = x2 - x1, h = y2 - y1;
        if (w / h > ar) h = w / ar; else w = h * ar;
        if (hd.includes('w')) x1 = x2 - w; else x2 = x1 + w;
        if (hd.includes('n')) y1 = y2 - h; else y2 = y1 + h;
        guides = [];
      }
      Object.assign(o, { x: round(x1, 3), y: round(y1, 3), w: round(x2 - x1, 3), h: round(y2 - y1, 3) });
    }
    render();
  });

  const endDrag = () => {
    const changed = drag && (drag.mode === 'resize' || drag.moved);
    drag = null; marquee = null; guides = [];
    if (changed) E.commit(); else render();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('dblclick', (ev) => {
    const g = ev.target.closest('[data-id]'); if (!g) return;
    const o = byId(g.dataset.id);
    const f = $('#props [data-key="' + (o.type === 'barcode' ? 'data' : 'text') + '"]');
    if (f) { f.focus(); f.select(); }
  });
  // clicking the grey stage around the label clears the selection
  $('#stage').addEventListener('pointerdown', (ev) => { if (!svg.contains(ev.target) && E.sel.size) { E.sel.clear(); render(); } });
  $('#stage').addEventListener('wheel', (ev) => { if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); E.zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });

  // ---------- object operations ----------
  E.add = (o, keepPos = false) => {
    const { w, h } = size();
    if (o.w > w - 2) { const f = (w - 4) / o.w; o.w *= f; o.h *= f; }
    if (o.h > h - 2) { const f = (h - 4) / o.h; o.w *= f; o.h *= f; }
    if (!keepPos) {
      o.x = round((w - o.w) / 2, 2); o.y = round((h - o.h) / 2, 2);
      while (E.doc.objects.some(p => Math.abs(p.x - o.x) < 0.5 && Math.abs(p.y - o.y) < 0.5) && o.x + o.w < w) { o.x += 3; o.y = Math.min(o.y + 3, h - o.h); }
    }
    E.doc.objects.push(o); E.sel = new Set([o.id]); E.commit(); render(true);
  };
  E.remove = () => { if (!E.sel.size) return; E.doc.objects = E.doc.objects.filter(o => !E.sel.has(o.id) || o.locked); E.sel.clear(); E.commit(); };
  E.copy = () => { const s = selected(); if (s.length) E.clipboard = clone(s); return s.length; };
  E.paste = (offset = 2) => {
    if (!E.clipboard) return;
    const objs = clone(E.clipboard).map(o => Object.assign(o, { id: newId(), x: o.x + offset, y: o.y + offset, locked: false }));
    E.doc.objects.push(...objs); E.sel = new Set(objs.map(o => o.id));
    E.clipboard = clone(objs); E.commit(); render(true);
  };
  E.duplicate = () => { const keep = E.clipboard; if (E.copy()) E.paste(); E.clipboard = keep; };
  E.selectAll = () => { E.sel = new Set(E.doc.objects.map(o => o.id)); render(true); };
  E.nudge = (dx, dy) => { const s = selected().filter(o => !o.locked); if (!s.length) return; s.forEach(o => { o.x = round(o.x + dx, 3); o.y = round(o.y + dy, 3); }); E.commit(false); };
  E.order = (dir) => {
    const a = E.doc.objects, ids = E.sel;
    if (dir === 'front') E.doc.objects = [...a.filter(o => !ids.has(o.id)), ...a.filter(o => ids.has(o.id))];
    else if (dir === 'back') E.doc.objects = [...a.filter(o => ids.has(o.id)), ...a.filter(o => !ids.has(o.id))];
    else {
      const step = dir === 'up' ? 1 : -1, idx = a.map((o, i) => ids.has(o.id) ? i : -1).filter(i => i >= 0);
      if (step > 0) idx.reverse();
      for (const i of idx) { const j = i + step; if (j < 0 || j >= a.length || ids.has(a[j].id)) continue; [a[i], a[j]] = [a[j], a[i]]; }
    }
    E.commit();
  };
  E.align = (how) => {
    const s = selected().filter(o => !o.locked); if (!s.length) return;
    const { w, h } = size(), ref = s.length > 1 ? bbox(s) : { x: 0, y: 0, w, h };
    for (const o of s) {
      if (how === 'left') o.x = ref.x; if (how === 'right') o.x = ref.x + ref.w - o.w; if (how === 'hcenter') o.x = ref.x + (ref.w - o.w) / 2;
      if (how === 'top') o.y = ref.y; if (how === 'bottom') o.y = ref.y + ref.h - o.h; if (how === 'vcenter') o.y = ref.y + (ref.h - o.h) / 2;
      o.x = round(o.x, 3); o.y = round(o.y, 3);
    }
    E.commit();
  };
  E.rotate = (deg) => {
    for (const o of selected()) {
      if (o.locked) continue;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const r = ((o.rotation || 0) + deg + 360) % 360;
      if ((r - o.rotation) % 180) { [o.w, o.h] = [o.h, o.w]; o.x = round(cx - o.w / 2, 3); o.y = round(cy - o.h / 2, 3); }
      o.rotation = r;
    }
    E.commit(); render(true);
  };
  // Moves (and if needed shrinks) objects so they lie inside the printable area.
  E.fitPrintable = () => {
    const a = printableArea(E.doc);
    for (const o of outsidePrintable(E.doc)) {
      if (o.w > a.w) { o.h *= a.w / o.w; o.w = a.w; }
      if (o.h > a.h) { o.w *= a.h / o.h; o.h = a.h; }
      o.x = round(Math.min(Math.max(o.x, a.x), a.x + a.w - o.w), 3); o.y = round(Math.min(Math.max(o.y, a.y), a.y + a.h - o.h), 3);
      o.w = round(o.w, 3); o.h = round(o.h, 3);
    }
    E.commit(); render(true);
  };
  E.setPaper = (id, orientation = E.doc.orientation) => {
    const old = size(), p = findPaper(id) || PAPERS[0];
    if (p.custom) E.doc.paper = { id: 'custom', name: 'Custom', w: E.doc.paper.w, h: E.doc.paper.h };
    else E.doc.paper = { id: p.id, name: p.name, w: p.w, h: p.h };
    E.doc.orientation = orientation;
    const nw = size();
    // keep objects inside: scale positions proportionally when size changes
    if (Math.abs(old.w - nw.w) > 0.5 || Math.abs(old.h - nw.h) > 0.5) {
      const f = Math.min(nw.w / old.w, nw.h / old.h, 1);
      for (const o of E.doc.objects) {
        o.x *= nw.w / old.w; o.y *= nw.h / old.h;
        if (f < 1) { o.w *= f; o.h *= f; }
        o.x = round(Math.max(0, Math.min(o.x, nw.w - o.w)), 3); o.y = round(Math.max(0, Math.min(o.y, nw.h - o.h)), 3);
        o.w = round(o.w, 3); o.h = round(o.h, 3);
      }
    }
    E.commit(); E.fit(); render(true);
  };

  // ---------- layers ----------
  function renderLayers() {
    const ul = $('#layers');
    const items = [...E.doc.objects].reverse().map(o => {
      const label = o.type === 'text' ? (o.text.split('\n')[0] || o.name) : o.type === 'barcode' ? o.data : o.name;
      return `<li data-id="${o.id}" class="${E.sel.has(o.id) ? 'sel' : ''}"><span class="t">${TYPE_NAMES[o.type]}</span><span class="n" title="${escXml(o.name)}">${escXml(label || o.name)}</span><button class="lk ${o.locked ? 'on' : ''}" data-lock="${o.id}" title="Lock">${o.locked ? '🔒' : '🔓'}</button></li>`;
    }).join('');
    if (ul.innerHTML !== items) ul.innerHTML = items || '<li class="hint">No objects yet — add some from the left.</li>';
  }
  $('#layers').addEventListener('click', (ev) => {
    const lock = ev.target.dataset.lock;
    if (lock) { const o = byId(lock); o.locked = !o.locked; E.commit(); render(true); return; }
    const li = ev.target.closest('li[data-id]'); if (!li) return;
    const id = li.dataset.id;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) E.sel.has(id) ? E.sel.delete(id) : E.sel.add(id); else E.sel = new Set([id]);
    render(true);
  });

  // ---------- properties panel ----------
  const ICON = {
    left: '<path d="M4 3v18M8 7h10v4H8zM8 14h6v4H8z"/>', hcenter: '<path d="M12 3v18M6 7h12v4H6zM8 14h8v4H8z"/>', right: '<path d="M20 3v18M6 7h10v4H6zM10 14h6v4h-6z"/>',
    top: '<path d="M3 4h18M7 8v10h4V8zM14 8v6h4V8z"/>', vcenter: '<path d="M3 12h18M7 6v12h4V6zM14 8v8h4V8z"/>', bottom: '<path d="M3 20h18M7 6v10h4V6zM14 10v6h4v-6z"/>',
  };
  const field = {
    num: (label, key, o, step = 0.5, min) => `<label>${label}<input type="number" data-key="${key}" step="${step}" ${min != null ? `min="${min}"` : ''} value="${round(o[key], 2)}"></label>`,
    text: (label, key, o, extra = '') => `<label>${label}<input data-key="${key}" value="${escXml(o[key] ?? '')}" ${extra}></label>`,
    area: (label, key, o) => `<label>${label}<textarea data-key="${key}" spellcheck="false">${escXml(o[key] ?? '')}</textarea></label>`,
    select: (label, key, o, opts) => `<label>${label}<select data-key="${key}">${opts.map(([v, t]) => `<option value="${v}" ${String(o[key]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`,
    check: (label, key, o) => `<label class="inline"><input type="checkbox" data-key="${key}" ${o[key] ? 'checked' : ''}>${label}</label>`,
    seg: (key, o, opts) => `<div class="seg">${opts.map(([v, t, title]) => `<button type="button" data-seg="${key}" data-val="${v}" class="${String(o[key]) === String(v) ? 'on' : ''}" title="${title || ''}">${t}</button>`).join('')}</div>`,
  };
  const row = (...c) => `<div class="row">${c.join('')}</div>`;

  function renderProps(force) {
    const sel = selected();
    const key = sel.map(o => o.id + o.type + (o.type === 'shape' ? o.shape : '') + (o.type === 'barcode' ? o.symbology : '')).join() + '|' + E.doc.paper.id + E.doc.orientation;
    const box = $('#props');
    if (!force && key === propsKey) { syncProps(); return; }
    propsKey = key;
    if (!sel.length) { box.innerHTML = labelProps(); return; }
    const o = sel[0];
    let h = '';
    if (sel.length === 1) {
      h += `<h3>${TYPE_NAMES[o.type]}</h3>` + row(field.text('Name', 'name', o));
      h += typeProps(o);
      h += '<h3>Position (mm)</h3>' + row(field.num('X', 'x', o), field.num('Y', 'y', o)) + row(field.num('Width', 'w', o, 0.5, 0.5), field.num('Height', 'h', o, 0.5, 0.5));
      h += row(`<label>Rotation${field.seg('rotation', o, [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']])}</label>`);
      h += row(field.check('Locked', 'locked', o));
    } else h += `<h3>${sel.length} objects</h3>`;
    h += '<h3>Arrange</h3><div class="btnGrid">' + ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map(k => `<button type="button" data-align="${k}" title="Align ${k}${sel.length > 1 ? ' (selection)' : ' (label)'}"><svg viewBox="0 0 24 24">${ICON[k]}</svg></button>`).join('') + '</div>';
    h += row(`<div class="seg" style="flex:1"><button type="button" data-order="front" title="Bring to front">Front</button><button type="button" data-order="up" title="Bring forward">↑</button><button type="button" data-order="down" title="Send backward">↓</button><button type="button" data-order="back" title="Send to back">Back</button></div>`);
    h += row(`<button type="button" data-act="rotL" title="Rotate left 90°">⟲</button><button type="button" data-act="rotR" title="Rotate right 90°">⟳</button><button type="button" data-act="dup" title="Duplicate (Ctrl+D)">Duplicate</button><button type="button" data-act="del" title="Delete (Del)" style="color:var(--danger)">Delete</button>`);
    box.innerHTML = h;
  }

  function typeProps(o) {
    const ink = (k = 'color') => `<label>Ink${field.seg(k, o, [['#000000', 'Black'], ['#ffffff', 'White', 'For use on black boxes']])}</label>`;
    switch (o.type) {
      case 'text':
        return row(field.area('Text', 'text', o)) +
          row(`<label style="flex:2">Font<input data-key="font" list="fonts" value="${escXml(o.font)}"></label>`, field.num('Size (pt)', 'size', o, 0.5, 1)) +
          row(`<div class="seg"><button type="button" data-tog="bold" class="${o.bold ? 'on' : ''}" title="Bold"><b>B</b></button><button type="button" data-tog="italic" class="${o.italic ? 'on' : ''}" title="Italic"><i>I</i></button><button type="button" data-tog="underline" class="${o.underline ? 'on' : ''}" title="Underline"><u>U</u></button></div>`,
            field.seg('align', o, [['left', '⇤', 'Left'], ['center', '↔', 'Center'], ['right', '⇥', 'Right']]),
            field.seg('valign', o, [['top', '⤒', 'Top'], ['middle', '↕', 'Middle'], ['bottom', '⤓', 'Bottom']])) +
          row(field.select('Fit', 'fit', o, [['shrink', 'Shrink to fit'], ['always', 'Always fit (grow & shrink)'], ['none', 'Fixed size']]), field.num('Line spacing', 'lineSpacing', o, 0.05, 0.5)) +
          row(ink());
      case 'image':
        return (o.src ? `<img class="thumb" src="${o.src}" alt="">` : '') +
          row(`<button type="button" data-act="replaceImg">Replace image…</button>`, `<button type="button" data-act="ratio" title="Restore the image's aspect ratio">Original ratio</button>`) +
          row(field.select('Scaling', 'fit', o, [['contain', 'Fit (keep ratio)'], ['cover', 'Fill & crop'], ['stretch', 'Stretch']])) +
          row(field.seg('halign', o, [['left', '⇤'], ['center', '↔'], ['right', '⇥']]), field.seg('valign', o, [['top', '⤒'], ['middle', '↕'], ['bottom', '⤓']]));
      case 'shape':
        return row(field.select('Shape', 'shape', o, [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line']]), field.num('Line (mm)', 'stroke', o, 0.1, 0)) +
          (o.shape === 'line' ? '' : row(field.check('Filled', 'fill', o), o.shape === 'rect' ? field.num('Corner radius', 'radius', o, 0.5, 0) : '')) + row(ink());
      case 'barcode':
        return row(field.select('Type', 'symbology', o, [['code128', 'Code 128'], ['qr', 'QR code']])) +
          row(o.symbology === 'qr' ? field.area('Content (text / URL)', 'data', o) : field.text('Data', 'data', o)) +
          (o.symbology === 'qr' ? row(field.select('Error correction', 'ecc', o, [['L', 'L – 7%'], ['M', 'M – 15%'], ['Q', 'Q – 25%'], ['H', 'H – 30%']]))
            : row(field.check('Show text', 'showText', o), field.num('Text (pt)', 'textSize', o, 0.5, 4)));
      default:
        return `<p class="hint">This DYMO object type (${escXml(o.name)}) is not editable here. It is kept unchanged when you save in its original format and can still be moved and resized.</p>`;
    }
  }

  function labelProps() {
    const d = E.doc, { w, h } = size();
    let s = '<h3>Label</h3>' + row(field.select('Label type', 'paper', { paper: d.paper.id }, PAPERS.map(p => [p.id, paperTitle(p)])));
    s += row(`<label>Orientation${field.seg('orientation', d, [['Landscape', 'Landscape'], ['Portrait', 'Portrait']])}</label>`);
    if (d.paper.id === 'custom') s += row(field.num('Width across roll (mm)', 'pw', { pw: d.paper.w }, 1, 10), field.num('Length (mm)', 'ph', { ph: d.paper.h }, 1, 10));
    s += `<p class="hint">${round(w, 1)} × ${round(h, 1)} mm. The hatched border can't be printed by the LabelWriter (about 5.8 mm at the start of the label, 1.5 mm elsewhere). The dashed line is the centred design area — lay out against it. The faded strip beyond it still prints, if you need a little extra room.</p>`;
    s += `<h3>Shortcuts</h3><p class="hint">Click to select, Shift+click for more, drag on empty space to box-select. Arrows nudge (Shift = 2 mm). Ctrl+C / V / D / Z / Y, Del. Alt while dragging disables snapping. Double-click text to edit. Drop images or .label/.dymo files on the canvas; paste images with Ctrl+V.</p>`;
    return s;
  }

  // Update values of a still-valid panel without rebuilding it (keeps focus).
  function syncProps() {
    const o = selected()[0]; if (!o || E.sel.size !== 1) return;
    for (const el of document.querySelectorAll('#props [data-key]')) {
      if (el === document.activeElement) continue;
      const k = el.dataset.key, v = o[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'number') el.value = round(v, 2);
      else if (v != null && el.value !== String(v)) el.value = v;
    }
    for (const b of document.querySelectorAll('#props [data-seg]')) b.classList.toggle('on', String(o[b.dataset.seg]) === b.dataset.val);
    for (const b of document.querySelectorAll('#props [data-tog]')) b.classList.toggle('on', !!o[b.dataset.tog]);
  }

  function applyProp(key, raw, el) {
    const sel = selected();
    if (!sel.length) {
      if (key === 'paper') return E.setPaper(raw);
      if (key === 'orientation') return E.setPaper(E.doc.paper.id, raw);
      if (key === 'pw' || key === 'ph') { const v = Math.max(10, +raw || 10); E.doc.paper[key === 'pw' ? 'w' : 'h'] = v; E.commit(); E.fit(); return; }
      return;
    }
    const o = sel[0];
    let v = raw;
    if (el && el.type === 'number') { v = parseFloat(raw); if (isNaN(v)) return; }
    if (key === 'rotation') { E.rotate(+raw - o.rotation); return; }
    if (['bold', 'italic', 'underline'].includes(key)) v = !o[key];
    if (el && el.type === 'checkbox') v = el.checked;
    o[key] = v;
    if (key === 'symbology' && v === 'qr') { const s = Math.min(o.w, o.h, 25); o.w = o.h = Math.max(s, 12); }
    const continuous = el && (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'number' || !el.type);
    E.commit(!continuous);
    if (['symbology', 'shape', 'locked', 'type'].includes(key)) render(true);
  }

  const props = $('#props');
  props.addEventListener('input', (ev) => { const k = ev.target.dataset.key; if (k && ev.target.tagName !== 'SELECT' && ev.target.type !== 'checkbox') applyProp(k, ev.target.value, ev.target); });
  props.addEventListener('change', (ev) => {
    const k = ev.target.dataset.key; if (!k) return;
    if (ev.target.tagName === 'SELECT' || ev.target.type === 'checkbox') applyProp(k, ev.target.value, ev.target);
    else E.commit(); // flush debounced edit
  });
  props.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.seg) applyProp(b.dataset.seg, b.dataset.val);
    else if (b.dataset.tog) applyProp(b.dataset.tog);
    else if (b.dataset.align) E.align(b.dataset.align);
    else if (b.dataset.order) E.order(b.dataset.order);
    else if (b.dataset.act) ({
      rotL: () => E.rotate(-90), rotR: () => E.rotate(90), dup: E.duplicate, del: E.remove,
      replaceImg: () => E.onReplaceImage && E.onReplaceImage(selected()[0]),
      ratio: () => {
        const o = selected()[0], img = new Image();
        img.onload = () => { const vertical = o.rotation % 180; const ar = vertical ? img.height / img.width : img.width / img.height; o.h = round(o.w / ar, 3); E.commit(); };
        img.src = o.src;
      },
    })[b.dataset.act]();
  });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (ev) => {
    const t = ev.target, typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || document.querySelector('dialog[open]');
    const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
    if (mod && k === 'z' && !typing) { ev.preventDefault(); ev.shiftKey ? E.redo() : E.undo(); return; }
    if (mod && k === 'y' && !typing) { ev.preventDefault(); E.redo(); return; }
    if (typing) return;
    if (mod && k === 'a') { ev.preventDefault(); E.selectAll(); }
    else if (mod && k === 'd') { ev.preventDefault(); E.duplicate(); }
    else if (mod && k === 'c') { E.copy(); }
    else if (mod && k === 'x') { if (E.copy()) E.remove(); }
    else if (k === 'delete' || k === 'backspace') { ev.preventDefault(); E.remove(); }
    else if (k === 'escape') { E.sel.clear(); render(true); }
    else if (k.startsWith('arrow')) {
      ev.preventDefault(); const s = ev.shiftKey ? 2 : 0.5;
      E.nudge(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0);
    } else if (!mod && k === 't') { ev.preventDefault(); E.onTool && E.onTool('text'); }
  });

  return E;
})();
