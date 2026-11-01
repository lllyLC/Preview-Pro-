import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs';

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };

let docs = [], cur = null, scale = 1.2, tool = 'select', nid = 1, pageNow = 0;
const pagesEl = $('#pages'), canvasEl = $('#canvas');

/* ---------- toast ---------- */
let tt;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2200);
}

/* ---------- opening documents ---------- */
async function addFiles(files) {
  for (const f of files) {
    const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    const d = { id: nid++, name: f.name, bytes, anns: [], hist: [], sizes: [], ol: [], results: null, q: '' };
    try {
      if (/\.pdf$/i.test(f.name)) {
        d.kind = 'pdf';
        d.pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        d.n = d.pdf.numPages;
        d.sizes = await Promise.all(Array.from({ length: d.n }, async (_, i) => {
          const v = (await d.pdf.getPage(i + 1)).getViewport({ scale: 1 });
          return [v.width, v.height];
        }));
        d.pdf.getOutline().then((o) => { d.ol = flatten(o || [], 0); if (cur === d) renderSide(); }).catch(() => {});
      } else {
        d.kind = 'img'; d.n = 1;
        d.url = URL.createObjectURL(new Blob([bytes]));
        const im = new Image(); im.src = d.url; await im.decode();
        d.sizes = [[im.naturalWidth * 0.75, im.naturalHeight * 0.75]];
      }
    } catch (e) { toast('Could not open ' + f.name); continue; }
    d.hist.push({ label: 'Opened (original)', time: new Date(), snap: '[]' });
    docs.push(d); activate(d);
  }
}
function flatten(items, lvl) {
  return items.flatMap((i) => [{ title: i.title, dest: i.dest, lvl }, ...(lvl < 1 ? flatten(i.items || [], lvl + 1) : [])]);
}
async function openDialog() { addFiles(await window.api.open()); }
function closeDoc(d) {
  const k = docs.indexOf(d); docs.splice(k, 1);
  if (d.url) URL.revokeObjectURL(d.url);
  if (d.pdf) d.pdf.destroy();
  if (cur === d) activate(docs[Math.min(k, docs.length - 1)] || null);
  else renderTabs();
}

/* ---------- tabs ---------- */
function renderTabs() {
  const t = $('#tabs'); t.innerHTML = '';
  docs.forEach((d) => {
    const e = el('div', 'tab' + (d === cur ? ' sel' : ''));
    e.innerHTML = `<span class="doc"></span><span class="name">${esc(d.name)}</span>${d.anns.length ? '<span class="dot">●</span>' : ''}<span class="x">✕</span>`;
    e.onclick = () => activate(d);
    e.querySelector('.x').onclick = (ev) => { ev.stopPropagation(); closeDoc(d); };
    t.append(e);
  });
  const p = el('div', 'tab plus'); p.textContent = '＋'; p.onclick = openDialog; t.append(p);
  $('#title').textContent = cur ? cur.name : 'Preview Pro';
}
function activate(d) { cur = d; pageNow = 0; renderTabs(); build(); renderSide(); }

/* ---------- page rendering ---------- */
const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && renderPage(e.target)), { root: canvasEl, rootMargin: '700px' });

function build() {
  io.disconnect(); pagesEl.innerHTML = ''; $('#empty').hidden = !!cur;
  if (!cur) return;
  cur.sizes.forEach(([w, h], i) => {
    const p = el('div', 'page'); p.dataset.i = i;
    p.style.width = w * scale + 'px'; p.style.height = h * scale + 'px';
    p.style.setProperty('--scale-factor', scale);
    p.style.setProperty('--total-scale-factor', scale);
    p.style.setProperty('--user-unit', 1);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none');
    p.append(el('canvas'), el('div', 'textLayer'), svg);
    pagesEl.append(p); io.observe(p);
  });
  canvasEl.scrollTop = 0;
}

async function renderPage(p) {
  if (p.dataset.r) return; p.dataset.r = 1;
  const d = cur, i = +p.dataset.i, cv = p.querySelector('canvas');
  try {
    if (d.kind === 'img') {
      const im = new Image(); im.src = d.url; im.draggable = false; cv.replaceWith(im);
    } else {
      const pg = await d.pdf.getPage(i + 1);
      if (!p.isConnected) return;
      const vp = pg.getViewport({ scale }), dpr = window.devicePixelRatio || 1;
      cv.width = vp.width * dpr; cv.height = vp.height * dpr;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      const tl = new pdfjs.TextLayer({ textContentSource: pg.streamTextContent(), container: p.querySelector('.textLayer'), viewport: vp });
      await tl.render();
    }
    drawAnn(i);
  } catch (e) { /* page was torn down during zoom/close */ }
}

/* ---------- annotations ---------- */
function annSvg(a) {
  if (a.t === 'hl' || a.t === 'rd') {
    const [x, y, w, h] = a.r;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${a.t === 'hl' ? 'fill="#ffd666" fill-opacity=".45"' : 'fill="#000"'}/>`;
  }
  const c = a.t === 'pen' ? ['#e07ba6', 2.5] : ['#4aa3ff', 2];
  return `<polyline points="${a.pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${c[0]}" stroke-width="${c[1]}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}
function drawAnn(i) {
  const p = pagesEl.children[i]; if (!p || !cur) return;
  p.querySelector('svg').innerHTML = cur.anns.filter((a) => a.p === i).map(annSvg).join('');
}
const drawAll = () => [...pagesEl.children].forEach((_, i) => drawAnn(i));

function commit(label) {
  cur.hist.push({ label, time: new Date(), snap: JSON.stringify(cur.anns) });
  renderTabs(); renderHist();
}
function undo() {
  if (!cur || cur.hist.length < 2) return;
  cur.hist.pop(); cur.anns = JSON.parse(cur.hist[cur.hist.length - 1].snap);
  drawAll(); renderTabs(); renderHist();
}
function restore(k) {
  const h = cur.hist[k]; cur.anns = JSON.parse(h.snap); drawAll(); commit('Restored: ' + h.label);
}

pagesEl.addEventListener('pointerdown', (e) => {
  if (!['pen', 'sign', 'redact'].includes(tool)) return;
  const p = e.target.closest('.page'); if (!p || !cur) return;
  e.preventDefault();
  const r = p.getBoundingClientRect(), i = +p.dataset.i;
  const pt = (ev) => [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
  const s = pt(e);
  const a = tool === 'redact' ? { p: i, t: 'rd', r: [s[0], s[1], 0, 0] } : { p: i, t: tool === 'pen' ? 'pen' : 'sign', pts: [s] };
  cur.anns.push(a);
  const move = (ev) => {
    const q = pt(ev);
    if (a.t === 'rd') a.r = [Math.min(s[0], q[0]), Math.min(s[1], q[1]), Math.abs(q[0] - s[0]), Math.abs(q[1] - s[1])];
    else a.pts.push(q);
    drawAnn(i);
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    if (a.t === 'rd' && (a.r[2] < 0.004 || a.r[3] < 0.004)) { cur.anns.pop(); drawAnn(i); return; }
    commit({ pen: 'Markup', sign: 'Signature', rd: 'Redaction' }[a.t]);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});

/* ---------- selection popover ---------- */
function selInfo() {
  const s = getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const rg = s.getRangeAt(0);
  const pEl = rg.startContainer.parentElement && rg.startContainer.parentElement.closest('.page');
  if (!pEl) return null;
  const pr = pEl.getBoundingClientRect();
  const rs = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1)
    .map((r) => [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height]);
  return { i: +pEl.dataset.i, rs, text: s.toString(), box: rg.getBoundingClientRect() };
}
function applySel(kind, info) {
  info.rs.forEach((r) => cur.anns.push({ p: info.i, t: kind, r }));
  drawAnn(info.i); commit(kind === 'hl' ? 'Highlight' : 'Redaction');
  getSelection().removeAllRanges(); $('#pop').hidden = true;
}
pagesEl.addEventListener('mouseup', () => setTimeout(() => {
  const info = ['select', 'hl'].includes(tool) ? selInfo() : null;
  if (!info) { $('#pop').hidden = true; return; }
  if (tool === 'hl') return applySel('hl', info);
  const pop = $('#pop'); pop.hidden = false; pop._info = info;
  pop.style.left = Math.max(8, info.box.left) + 'px'; pop.style.top = Math.max(8, info.box.top - 44) + 'px';
}, 0));
$('#pop').addEventListener('mousedown', (e) => e.preventDefault());
$('#pop').addEventListener('click', (e) => {
  const s = e.target.dataset.s, info = $('#pop')._info; if (!s || !info) return;
  if (s === 'copy') { navigator.clipboard.writeText(info.text); toast('Text copied'); $('#pop').hidden = true; }
  else applySel(s, info);
});
addEventListener('mousedown', (e) => { if (!e.target.closest('#pop') && !e.target.closest('#pages')) $('#pop').hidden = true; });

/* ---------- navigation ---------- */
const goto = (i) => { const p = pagesEl.children[Math.max(0, Math.min(i, (cur ? cur.n : 1) - 1))]; if (p) p.scrollIntoView({ block: 'start' }); };
let raf;
canvasEl.addEventListener('scroll', () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const top = canvasEl.getBoundingClientRect().top + 80;
    const k = [...pagesEl.children].findIndex((p) => p.getBoundingClientRect().bottom > top);
    if (k >= 0 && k !== pageNow) { pageNow = k; const inp = $('#pg'); if (inp) inp.value = k + 1; }
  });
});
function zoom(f) {
  if (!cur) return; const keep = pageNow;
  scale = Math.min(5, Math.max(0.3, scale * f)); build(); goto(keep);
}
function fit() {
  if (!cur) return; const keep = pageNow;
  scale = (canvasEl.clientWidth - 60) / cur.sizes[0][0]; build(); goto(keep);
}

/* ---------- sidebar ---------- */
function histHtml() {
  return cur.hist.map((h, k) => `<div class="v" data-k="${k}"><span>${esc(h.label)}</span><span>${h.time.toTimeString().slice(0, 5)}</span></div>`).reverse().join('');
}
function renderHist() { const h = $('#hist'); if (h) h.innerHTML = histHtml(); }
function renderSide() {
  const s = $('#side'), d = cur;
  if (!d) { s.innerHTML = ''; return; }
  const ol = d.ol.map((o, k) => `<div class="row sub" data-ol="${k}" style="padding-left:${22 + o.lvl * 12}px">${esc(o.title)}</div>`).join('');
  const res = d.results ? `<div><h4>Results for “${esc(d.q)}” (${d.results.length})</h4><div class="nav">${
    d.results.map((h) => `<div class="row hit" data-hit="${h.p}"><span class="p">p.${h.p + 1}</span><span>${esc(h.snip)}</span></div>`).join('') || '<div class="muted">No matches</div>'}</div></div>` : '';
  s.innerHTML = `
    <div id="sQA"><h4>Quick Actions</h4><div class="qa">
      <div class="row" data-a="text"><span class="g">T</span>Extract text (page)</div>
      <div class="row" data-a="img"><span class="g">▣</span>Copy page as image</div>
      <div class="row" data-a="fit"><span class="g">⤢</span>Fit width</div>
      <div class="row" data-a="export"><span class="g">⤓</span>Export as PDF…</div>
    </div></div>
    ${res}
    <div><h4>Document</h4><div class="nav">
      <div class="row">Page <input id="pg" value="${pageNow + 1}" /> of ${d.n}</div>${ol}
    </div></div>
    <div><h4>Version History</h4><div class="versions" id="hist">${histHtml()}</div></div>`;
}
$('#side').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-a],[data-ol],[data-hit],[data-k]'); if (!t || !cur) return;
  if (t.dataset.a) return quick(t.dataset.a);
  if (t.dataset.hit) return goto(+t.dataset.hit);
  if (t.dataset.k) return restore(+t.dataset.k);
  const o = cur.ol[+t.dataset.ol]; if (!o || !o.dest) return;
  try {
    const dest = typeof o.dest === 'string' ? await cur.pdf.getDestination(o.dest) : o.dest;
    goto(await cur.pdf.getPageIndex(dest[0]));
  } catch (_) {}
});
$('#side').addEventListener('keydown', (e) => { if (e.target.id === 'pg' && e.key === 'Enter') goto(+e.target.value - 1); });

/* ---------- quick actions, search, export ---------- */
async function pageText(i) {
  const tc = await cur.pdf.getPage(i + 1).then((p) => p.getTextContent());
  return tc.items.map((x) => x.str + (x.hasEOL ? '\n' : '')).join(' ');
}
async function quick(a) {
  if (!cur) return;
  if (a === 'fit') return fit();
  if (a === 'export') return exportPdf();
  if (cur.kind !== 'pdf') return toast('Not available for images (OCR is not bundled)');
  if (a === 'text') {
    const t = await pageText(pageNow);
    if (!t.trim()) return toast('No text layer on this page (scanned pages need OCR)');
    await navigator.clipboard.writeText(t); toast(`Page ${pageNow + 1} text copied`);
  }
  if (a === 'img') {
    const c = pagesEl.children[pageNow] && pagesEl.children[pageNow].querySelector('canvas');
    if (!c) return toast('Page not rendered yet');
    c.toBlob(async (b) => { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Page image copied'); });
  }
}
async function search(q) {
  if (!cur || !q.trim()) return;
  if (cur.kind !== 'pdf') return toast('Search needs a text layer (OCR is not bundled)');
  const d = cur, needle = q.toLowerCase(), hits = [];
  for (let i = 0; i < d.n && hits.length < 200; i++) {
    const t = (await pageText(i)).replace(/\s+/g, ' '), k = t.toLowerCase().indexOf(needle);
    if (k >= 0) hits.push({ p: i, snip: t.slice(Math.max(0, k - 24), k + needle.length + 40) });
  }
  d.q = q; d.results = hits; if (cur === d) renderSide();
  if (hits.length) goto(hits[0].p);
}
async function exportPdf() {
  const d = cur;
  if (!d || d.kind !== 'pdf') return toast('Export works for PDFs');
  try {
    const { PDFDocument, rgb } = PDFLib;
    const doc = await PDFDocument.load(d.bytes.slice());
    // Redactions: flatten the page to an image so the covered text is really gone.
    for (const i of new Set(d.anns.filter((a) => a.t === 'rd').map((a) => a.p))) {
      const pg = await d.pdf.getPage(i + 1), vp = pg.getViewport({ scale: 2 });
      const cv = el('canvas'); cv.width = vp.width; cv.height = vp.height;
      const cx = cv.getContext('2d');
      await pg.render({ canvasContext: cx, viewport: vp }).promise;
      cx.fillStyle = '#000';
      d.anns.filter((a) => a.p === i && a.t === 'rd').forEach((a) => cx.fillRect(a.r[0] * cv.width, a.r[1] * cv.height, a.r[2] * cv.width, a.r[3] * cv.height));
      const png = await new Promise((r) => cv.toBlob(r, 'image/png')).then((b) => b.arrayBuffer());
      const { width, height } = doc.getPage(i).getSize();
      doc.removePage(i);
      doc.insertPage(i, [width, height]).drawImage(await doc.embedPng(png), { x: 0, y: 0, width, height });
    }
    for (const a of d.anns) {
      if (a.t === 'rd') continue;
      const pg = doc.getPage(a.p), { width: w, height: h } = pg.getSize();
      if (a.t === 'hl') {
        pg.drawRectangle({ x: a.r[0] * w, y: h - (a.r[1] + a.r[3]) * h, width: a.r[2] * w, height: a.r[3] * h, color: rgb(1, 0.84, 0.4), opacity: 0.45 });
      } else {
        const col = a.t === 'pen' ? rgb(0.88, 0.48, 0.65) : rgb(0.29, 0.64, 1);
        for (let k = 1; k < a.pts.length; k++) {
          pg.drawLine({ start: { x: a.pts[k - 1][0] * w, y: h - a.pts[k - 1][1] * h }, end: { x: a.pts[k][0] * w, y: h - a.pts[k][1] * h }, thickness: a.t === 'pen' ? 2 : 1.6, color: col });
        }
      }
    }
    const out = await doc.save();
    const path = await window.api.save(d.name.replace(/\.pdf$/i, '') + ' (edited).pdf', out);
    if (path) toast('Saved');
  } catch (e) { toast('Export failed: ' + e.message); }
}

/* ---------- toolbar, menu, drag & drop ---------- */
function setTool(t) {
  tool = t; pagesEl.className = 't-' + t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
}
document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$('#bSide').onclick = () => $('#side').classList.toggle('hide');
$('#bQA').onclick = () => { $('#side').classList.remove('hide'); const q = $('#sQA'); if (q) q.scrollIntoView(); };
$('#bIn').onclick = () => zoom(1.2);
$('#bOut').onclick = () => zoom(1 / 1.2);
$('#bFit').onclick = fit;
$('#bOpen').onclick = openDialog;
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(e.target.value); });

window.api.on('files', addFiles);
window.api.on('menu', (c) => ({
  open: openDialog, export: exportPdf, close: () => cur && closeDoc(cur), undo,
  find: () => $('#q').focus(), zin: () => zoom(1.2), zout: () => zoom(1 / 1.2), fit,
  side: () => $('#side').classList.toggle('hide'),
}[c] || (() => {}))());

addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const fs = [...e.dataTransfer.files].filter((f) => /\.(pdf|png|jpe?g|webp|gif)$/i.test(f.name));
  addFiles(await Promise.all(fs.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
});

renderTabs();
