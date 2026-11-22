'use strict';
/* Wohnungsplaner – komplette App-Logik. Maße intern immer in cm. */

// ---------- Hilfsfunktionen ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const rnd = (v, s = 1) => Math.round(v / s) * s;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtCm = v => v >= 100 ? (v / 100).toFixed(2).replace('.', ',') + ' m' : Math.round(v) + ' cm';
const ptsStr = p => p.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
const deepCopy = o => JSON.parse(JSON.stringify(o));

// ---------- Speicher ----------
const KEY = 'wohnungsplaner-v1';
function defaults() { return { apartments: [], templates: [], snap: true, dims: true, lastWallT: 20 }; }
function loadState() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    if (j && Array.isArray(j.apartments)) return Object.assign(defaults(), j);
  } catch (e) { /* leer */ }
  return defaults();
}
let S = loadState();
let saveTimer = 0;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 150); }
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Speichern fehlgeschlagen – Speicher voll?'); }
}
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* egal */ }

// ---------- UI-Helfer: Toast & Dialoge ----------
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}
function modal(html, cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet ${cls}">${html}</div>`;
  m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeModal(); };
  return m.firstElementChild;
}
function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }
function askText(title, value, okLabel, cb) {
  const s = modal(`<h3>${esc(title)}</h3><input type="text" id="askin" value="${esc(value)}" maxlength="60">
    <div class="row end"><button class="btn" data-x="no">Abbrechen</button><button class="btn primary" data-x="ok">${esc(okLabel)}</button></div>`);
  const inp = $('#askin', s);
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
  const go = () => { const v = inp.value.trim(); closeModal(); if (v) cb(v); };
  s.onclick = e => { const x = e.target.dataset.x; if (x === 'no') closeModal(); if (x === 'ok') go(); };
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };
}
function confirmBox(msg, okLabel, cb) {
  const s = modal(`<h3>${esc(msg)}</h3><div class="row end"><button class="btn" data-x="no">Abbrechen</button><button class="btn danger" data-x="ok">${esc(okLabel)}</button></div>`);
  s.onclick = e => { const x = e.target.dataset.x; if (x === 'no') closeModal(); if (x === 'ok') { closeModal(); cb(); } };
}
function actionSheet(title, items) {
  const s = modal(`<h3>${esc(title)}</h3><div class="list">${items.map((it, i) =>
    `<button class="btn wide ${it.cls || ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}</div>
    <div class="row end"><button class="btn" data-x="no">Schließen</button></div>`);
  s.onclick = e => {
    if (e.target.dataset.x === 'no') return closeModal();
    const i = e.target.dataset.i;
    if (i != null) { closeModal(); items[+i].fn(); }
  };
}

// ---------- Wohnungen: Datenmodell ----------
function newApt(name, rect) {
  const a = { id: uid(), name, created: Date.now(), walls: [], openings: [], rooms: [], variants: [{ id: uid(), name: 'Variante A', furniture: [] }] };
  a.activeVariant = a.variants[0].id;
  if (rect) {
    const t = 20, h = t / 2;
    const x0 = -h, y0 = -h, x1 = rect.w + h, y1 = rect.d + h;
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4];
      a.walls.push({ id: uid(), x1: p[0], y1: p[1], x2: q[0], y2: q[1], t });
    }
    a.rooms.push({ id: uid(), name: 'Raum', x: rect.w / 2, y: rect.d / 2 });
  }
  return a;
}
function sanitizeApt(a) {
  const o = { id: uid(), name: String(a.name || 'Wohnung'), created: a.created || Date.now(), walls: [], openings: [], rooms: [], variants: [] };
  const idMap = {};
  for (const w of (a.walls || [])) {
    const nid = uid(); idMap[w.id] = nid;
    o.walls.push({ id: nid, x1: +w.x1 || 0, y1: +w.y1 || 0, x2: +w.x2 || 0, y2: +w.y2 || 0, t: +w.t || 20 });
  }
  for (const p of (a.openings || [])) if (idMap[p.wallId]) o.openings.push({
    id: uid(), wallId: idMap[p.wallId], type: p.type === 'window' ? 'window' : 'door',
    c: +p.c || 0, w: +p.w || 90, side: p.side === -1 ? -1 : 1, hinge: p.hinge ? 1 : 0
  });
  for (const r of (a.rooms || [])) o.rooms.push({ id: uid(), name: String(r.name || 'Raum'), x: +r.x || 0, y: +r.y || 0 });
  let active = null;
  for (const v of (a.variants || [])) {
    const nv = { id: uid(), name: String(v.name || 'Variante'), furniture: [] };
    if (v.id === a.activeVariant) active = nv.id;
    for (const f of (v.furniture || [])) nv.furniture.push({
      id: uid(), name: String(f.name || ''), shape: ['round', 'L'].includes(f.shape) ? f.shape : 'rect',
      w: Math.max(10, +f.w || 50), d: Math.max(10, +f.d || 50), t: +f.t || 50,
      x: +f.x || 0, y: +f.y || 0, rot: +f.rot || 0, flip: !!f.flip, color: String(f.color || '#5b8def'), ghost: !!f.ghost
    });
    o.variants.push(nv);
  }
  if (!o.variants.length) o.variants.push({ id: uid(), name: 'Variante A', furniture: [] });
  o.activeVariant = active || o.variants[0].id;
  return o;
}
function bboxOf(a, v) {
  const polys = [];
  for (const w of a.walls) { const h = w.t / 2; polys.push([[w.x1 - h, w.y1 - h], [w.x2 + h, w.y2 + h], [w.x1 + h, w.y1 + h], [w.x2 - h, w.y2 - h]]); }
  if (v) for (const f of v.furniture) polys.push(...G.pieces(f));
  for (const r of a.rooms) polys.push([[r.x - 40, r.y - 15], [r.x + 40, r.y + 15]]);
  if (!polys.length) return null;
  return G.bounds(polys);
}
const wallOf = (a, id) => a.walls.find(w => w.id === id);

// ---------- Szene als SVG (Editor + Vorschau) ----------
function furnShape(f) {
  const w = f.w, d = f.d;
  if (f.shape === 'round') return `<ellipse rx="${w / 2}" ry="${d / 2}"`;
  if (f.shape === 'L') {
    const t = G.clampT(f);
    return `<polygon points="${ptsStr([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + t], [-w / 2 + t, -d / 2 + t], [-w / 2 + t, d / 2], [-w / 2, d / 2]])}"`;
  }
  return `<rect x="${-w / 2}" y="${-d / 2}" width="${w}" height="${d}" rx="2"`;
}
function furnSVG(f, o) {
  const bad = o.conf && o.conf.ids.has(f.id);
  const attrs = o.edit ? ` data-k="f" data-id="${f.id}"` : '';
  const inner = `${furnShape(f)} class="furn${bad ? ' bad' : ''}${f.ghost ? ' ghost' : ''}" fill="${f.color}"${attrs}/>`;
  return `<g transform="translate(${f.x} ${f.y}) rotate(${f.rot || 0})"><g${f.flip ? ' transform="scale(-1 1)"' : ''}>${inner}</g></g>`;
}
function furnLabel(f) {
  let ay = 0;
  if (f.shape === 'L') ay = -f.d / 2 + G.clampT(f) / 2;
  const [rx, ry] = G.rotPt(0, ay, f.rot || 0);
  const cx = f.x + rx, cy = f.y + ry;
  const bb = G.bounds(G.pieces(f));
  const name = f.name || '';
  const dims = f.shape === 'round' && f.w === f.d ? `Ø ${rnd(f.w)}` : `${rnd(f.w)} × ${rnd(f.d)}`;
  const availW = bb.x1 - bb.x0, availH = bb.y1 - bb.y0;
  const longest = Math.max(name.length * 0.58, dims.length * 0.5, 1);
  const fs = clamp(Math.min(16, availW * 0.92 / longest, availH / 3), 5, 16);
  const stroke = `stroke-width="${(fs * 0.28).toFixed(2)}"`;
  return `<g class="lbl">` +
    (name ? `<text x="${cx.toFixed(1)}" y="${(cy - fs * 0.12).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" ${stroke}>${esc(name)}</text>` : '') +
    `<text x="${cx.toFixed(1)}" y="${(cy + fs * (name ? 0.95 : 0.35)).toFixed(1)}" font-size="${(fs * 0.8).toFixed(1)}" ${stroke}>${dims}</text></g>`;
}
function dimLabel(w, px, len) {
  const g = G.wallGeo(w);
  const mx = (w.x1 + w.x2) / 2 + g.nx * (w.t / 2 + 12 * px), my = (w.y1 + w.y2) / 2 + g.ny * (w.t / 2 + 12 * px);
  let ang = Math.atan2(g.uy, g.ux) * 180 / Math.PI;
  if (ang > 90 || ang < -90) ang += 180;
  return `<text class="dimtxt" x="${mx.toFixed(1)}" y="${my.toFixed(1)}" font-size="${(12 * px).toFixed(2)}" stroke-width="${(3 * px).toFixed(2)}" transform="rotate(${ang.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})">${fmtCm(len == null ? g.L : len)}</text>`;
}

function sceneSVG(a, v, o) {
  const px = o.px || 1;
  const selId = o.sel ? o.sel.id : null, selK = o.sel ? o.sel.k : null;
  let s = '';
  for (const f of v.furniture) if (f.ghost) s += furnSVG(f, o);
  // Wände
  for (const w of a.walls) {
    for (const q of G.wallQuads(a, w)) s += `<polygon class="wall" points="${ptsStr(q)}"${o.edit ? ` data-k="w" data-id="${w.id}"` : ''}/>`;
    if (o.edit) s += `<line class="hit" x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke-width="${Math.max(w.t, 26 * px)}" data-k="w" data-id="${w.id}"/>`;
  }
  // Öffnungen
  for (const op of a.openings) {
    const w = wallOf(a, op.wallId); if (!w) continue;
    const g = G.wallGeo(w), h = w.t / 2, A = op.c - op.w / 2, B = op.c + op.w / 2;
    const P = (t, k) => [w.x1 + g.ux * t + g.nx * h * k, w.y1 + g.uy * t + g.ny * h * k];
    const gap = [P(A, 1), P(B, 1), P(B, -1), P(A, -1)];
    const dk = o.edit ? ` data-k="op" data-id="${op.id}"` : '';
    const sel = selK === 'op' && selId === op.id;
    if (op.type === 'window') {
      const m1 = P(A, 0), m2 = P(B, 0);
      s += `<polygon class="win${sel ? ' sel' : ''}" points="${ptsStr(gap)}"${dk}/><line class="winl" x1="${m1[0]}" y1="${m1[1]}" x2="${m2[0]}" y2="${m2[1]}"/>`;
    } else {
      const sp = G.swingPoly(w, op);
      const T = [sp.hx + sp.g.nx * sp.s * op.w, sp.hy + sp.g.ny * sp.s * op.w];
      const E = [sp.hx + sp.g.ux * sp.dc * op.w, sp.hy + sp.g.uy * sp.dc * op.w];
      const sweep = (-sp.s * sp.dc) > 0 ? 1 : 0;
      s += `<polygon class="gap${sel ? ' sel' : ''}" points="${ptsStr(gap)}"${dk}/>` +
        `<path class="swing" d="M${sp.hx.toFixed(1)} ${sp.hy.toFixed(1)} L${T[0].toFixed(1)} ${T[1].toFixed(1)} A${op.w} ${op.w} 0 0 ${sweep} ${E[0].toFixed(1)} ${E[1].toFixed(1)} Z"/>` +
        `<line class="leaf" x1="${sp.hx.toFixed(1)}" y1="${sp.hy.toFixed(1)}" x2="${T[0].toFixed(1)}" y2="${T[1].toFixed(1)}"/>`;
    }
  }
  if (o.edit) for (const op of a.openings) {
    const w = wallOf(a, op.wallId); if (!w) continue;
    const g = G.wallGeo(w), A = op.c - op.w / 2, B = op.c + op.w / 2;
    s += `<line class="hit" x1="${(w.x1 + g.ux * A).toFixed(1)}" y1="${(w.y1 + g.uy * A).toFixed(1)}" x2="${(w.x1 + g.ux * B).toFixed(1)}" y2="${(w.y1 + g.uy * B).toFixed(1)}" stroke-width="${Math.max(w.t, 26 * px)}" data-k="op" data-id="${op.id}"/>`;
  }
  // Möbel
  for (const f of v.furniture) if (!f.ghost) s += furnSVG(f, o);
  for (const f of v.furniture) s += furnLabel(f);
  // Räume
  for (const r of a.rooms) {
    const sel = selK === 'room' && selId === r.id;
    s += `<text class="room${sel ? ' sel' : ''}" x="${r.x}" y="${r.y}" font-size="26"${o.edit ? ` data-k="room" data-id="${r.id}"` : ''}>${esc(r.name)}</text>`;
  }
  return s;
}

function overlaySVG(a, v, o) {
  const px = o.px;
  let s = '';
  const dimsAll = o.dims;
  for (const w of a.walls) {
    const sel = o.sel && o.sel.k === 'w' && o.sel.id === w.id;
    if (dimsAll || sel) s += dimLabel(w, px);
    if (sel) {
      for (const q of G.wallQuads(a, w)) s += `<polygon class="selout" points="${ptsStr(q)}"/>`;
      for (const e of [1, 2]) {
        const x = e === 1 ? w.x1 : w.x2, y = e === 1 ? w.y1 : w.y2;
        s += `<circle class="hdlhit" cx="${x}" cy="${y}" r="${20 * px}" data-k="whandle" data-id="${w.id}" data-end="${e}"/><circle class="hdl" cx="${x}" cy="${y}" r="${10 * px}"/>`;
      }
    }
  }
  if (o.sel && o.sel.k === 'f') {
    const f = v.furniture.find(x => x.id === o.sel.id);
    if (f) {
      const r = 11 * px, hr = 20 * px;
      const hs = [['e', f.w / 2, 0], ['s', 0, f.d / 2], ['se', f.w / 2, f.d / 2], ['rot', 0, -f.d / 2 - 34 * px]];
      s += `<g transform="translate(${f.x} ${f.y}) rotate(${f.rot || 0})"><g${f.flip ? ' transform="scale(-1 1)"' : ''}>${furnShape(f)} class="selout"/></g>` +
        `<line class="selout" x1="0" y1="${-f.d / 2}" x2="0" y2="${-f.d / 2 - 34 * px}"/>` +
        hs.map(h => `<circle class="hdlhit" cx="${h[1]}" cy="${h[2]}" r="${hr}" data-k="handle" data-h="${h[0]}"/><circle class="hdl${h[0] === 'rot' ? ' rot' : ''}" cx="${h[1]}" cy="${h[2]}" r="${r}"/>`).join('') + `</g>`;
    }
  }
  if (o.sel && o.sel.k === 'op') {
    const op = a.openings.find(x => x.id === o.sel.id);
    const w = op && wallOf(a, op.wallId);
    if (w) {
      const g = G.wallGeo(w);
      s += dimLabelAt(w, g, op.c, op.w, px);
    }
  }
  if (o.ghost) {
    const gw = { x1: o.ghost.x1, y1: o.ghost.y1, x2: o.ghost.x2, y2: o.ghost.y2, t: S.lastWallT };
    const g = G.wallGeo(gw), h = gw.t / 2;
    s += `<polygon class="wall ghostwall" points="${ptsStr([[gw.x1 + g.nx * h, gw.y1 + g.ny * h], [gw.x2 + g.nx * h, gw.y2 + g.ny * h], [gw.x2 - g.nx * h, gw.y2 - g.ny * h], [gw.x1 - g.nx * h, gw.y1 - g.ny * h]])}"/>`;
    if (g.L > 1) s += dimLabel(gw, px);
  }
  if (o.pending) s += `<circle class="pend" cx="${o.pending.x}" cy="${o.pending.y}" r="${8 * px}"/>`;
  for (const gd of (o.guides || [])) {
    const b = o.vb;
    s += gd.axis === 'x' ? `<line class="guide" x1="${gd.v}" y1="${b.y0}" x2="${gd.v}" y2="${b.y1}"/>` : `<line class="guide" x1="${b.x0}" y1="${gd.v}" x2="${b.x1}" y2="${gd.v}"/>`;
  }
  return s;
}
function dimLabelAt(w, g, c, ow, px) {
  const mx = w.x1 + g.ux * c + g.nx * (w.t / 2 + 14 * px), my = w.y1 + g.uy * c + g.ny * (w.t / 2 + 14 * px);
  return `<text class="dimtxt" x="${mx.toFixed(1)}" y="${my.toFixed(1)}" font-size="${(12 * px).toFixed(2)}" stroke-width="${(3 * px).toFixed(2)}">${fmtCm(ow)}</text>`;
}

function staticSVG(a, v, w, h) {
  const bb = bboxOf(a, v);
  if (!bb) return `<svg viewBox="0 0 ${w} ${h}" class="thumb"></svg>`;
  const m = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.06 + 10;
  const vx = bb.x0 - m, vy = bb.y0 - m, vw = bb.x1 - bb.x0 + 2 * m, vh = bb.y1 - bb.y0 + 2 * m;
  const conf = G.conflicts(a, v);
  return `<svg viewBox="${vx} ${vy} ${vw} ${vh}" class="thumb" preserveAspectRatio="xMidYMid meet">${sceneSVG(a, v, { conf, px: Math.max(vw / w, vh / h) })}</svg>`;
}

// ---------- Startseite ----------
const app = $('#app');
let screen = 'home';
let cur = null, svg = null, cvs = null;

function renderHome() {
  screen = 'home'; cur = null; svg = null; cvs = null;
  const cards = S.apartments.map(a => {
    const v = a.variants.find(x => x.id === a.activeVariant) || a.variants[0];
    const nF = a.variants.reduce((n, x) => n + x.furniture.length, 0);
    return `<div class="card" data-open="${a.id}">
      <div class="thumbbox">${staticSVG(a, v, 120, 90)}</div>
      <div class="cinfo"><b>${esc(a.name)}</b>
        <span>${a.walls.length} Wände · ${a.variants.length} Variante${a.variants.length === 1 ? '' : 'n'} · ${nF} Möbel</span></div>
      <button class="icon" data-menu="${a.id}" aria-label="Menü">⋯</button></div>`;
  }).join('');
  app.innerHTML = `<header class="hhead"><h1>🏠 Wohnungsplaner</h1></header>
    <main class="home">${cards || `<div class="empty"><div class="big">🛋️</div><p>Noch keine Wohnung.<br>Lege deine erste Wohnung an und plane, wo alles hinkommt.</p></div>`}</main>
    <div class="homebar"><button class="btn primary big" id="newApt">＋ Neue Wohnung</button>
      <button class="btn" id="impBtn">Import</button><button class="btn" id="expAll"${S.apartments.length ? '' : ' disabled'}>Alles sichern</button></div>`;
  app.onclick = e => {
    const mb = e.target.closest('[data-menu]');
    if (mb) return aptMenu(mb.dataset.menu);
    const c = e.target.closest('[data-open]');
    if (c) return openApt(c.dataset.open);
    if (e.target.id === 'newApt') return newAptDialog();
    if (e.target.id === 'impBtn') return $('#file').click();
    if (e.target.id === 'expAll') return saveFile('wohnungsplaner-backup.json', { app: 'wohnungsplaner', version: 1, apartments: S.apartments, templates: S.templates });
  };
}
function aptMenu(id) {
  const a = S.apartments.find(x => x.id === id);
  actionSheet(a.name, [
    { label: 'Umbenennen', fn: () => askText('Name der Wohnung', a.name, 'Speichern', n => { a.name = n; save(); renderHome(); }) },
    { label: 'Duplizieren', fn: () => { const c = sanitizeApt(a); c.name = a.name + ' (Kopie)'; S.apartments.push(c); save(); renderHome(); toast('Dupliziert'); } },
    { label: 'Als Datei exportieren', fn: () => saveFile(a.name.replace(/[^\w\-äöüÄÖÜß ]+/g, '_') + '.json', { app: 'wohnungsplaner', version: 1, apartments: [a], templates: [] }) },
    { label: 'Löschen', cls: 'danger', fn: () => confirmBox(`„${a.name}“ wirklich löschen?`, 'Löschen', () => { S.apartments = S.apartments.filter(x => x.id !== id); delete hist[id]; save(); renderHome(); }) }
  ]);
}
function newAptDialog() {
  const s = modal(`<h3>Neue Wohnung</h3>
    <label class="fld"><span>Name</span><input type="text" id="na-name" value="Meine Wohnung" maxlength="60"></label>
    <div class="seg" id="na-mode"><button data-m="rect" class="on">Ein Raum (Rechteck)</button><button data-m="empty">Leer starten</button></div>
    <div class="row" id="na-dims"><label class="fld"><span>Innenbreite (cm)</span><input type="number" inputmode="decimal" id="na-w" value="500"></label>
    <label class="fld"><span>Innenlänge (cm)</span><input type="number" inputmode="decimal" id="na-d" value="400"></label></div>
    <p class="muted">Du kannst danach jederzeit Wände verschieben, löschen und neue zeichnen.</p>
    <div class="row end"><button class="btn" data-x="no">Abbrechen</button><button class="btn primary" data-x="ok">Anlegen</button></div>`);
  let mode = 'rect';
  s.onclick = e => {
    const m = e.target.dataset.m;
    if (m) { mode = m; s.querySelectorAll('#na-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); $('#na-dims', s).style.display = m === 'rect' ? '' : 'none'; }
    if (e.target.dataset.x === 'no') closeModal();
    if (e.target.dataset.x === 'ok') {
      const name = $('#na-name', s).value.trim() || 'Wohnung';
      const w = clamp(+$('#na-w', s).value || 500, 100, 5000), d = clamp(+$('#na-d', s).value || 400, 100, 5000);
      const a = newApt(name, mode === 'rect' ? { w, d } : null);
      S.apartments.push(a); save(); closeModal(); openApt(a.id);
    }
  };
}

// ---------- Editor: Grundgerüst ----------
const hist = {};   // Undo/Redo je Wohnung (nur im Arbeitsspeicher)
const apt = () => S.apartments.find(a => a.id === cur.aptId);
const variant = () => { const a = apt(); return a.variants.find(v => v.id === a.activeVariant) || a.variants[0]; };
const getF = id => variant().furniture.find(f => f.id === id);

function openApt(id) {
  const a = S.apartments.find(x => x.id === id);
  if (!a) return renderHome();
  if (!a.variants.find(v => v.id === a.activeVariant)) a.activeVariant = a.variants[0].id;
  cur = { aptId: id, tool: 'select', sel: null, view: { x: 0, y: 0, s: 0.5 }, pending: null, ghost: null, guides: [], conf: { list: [], ids: new Set() } };
  hist[id] = hist[id] || { undo: [], redo: [] };
  screen = 'editor';
  app.innerHTML = `<div class="ed">
    <header class="top">
      <button class="icon" id="bBack" aria-label="Zurück">‹</button>
      <button class="title" id="bTitle"></button>
      <button class="icon" id="bUndo" aria-label="Rückgängig">↶</button>
      <button class="icon" id="bRedo" aria-label="Wiederholen">↷</button>
      <button class="badge hidden" id="bConf"></button>
      <button class="icon" id="bMenu" aria-label="Menü">⋯</button>
    </header>
    <div class="vars" id="vars"></div>
    <div class="canvas" id="cvs"><svg id="svg"></svg>
      <div class="hint" id="hint"></div>
      <div class="zoom"><button id="zIn">＋</button><button id="zOut">－</button><button id="zFit">⤢</button></div></div>
    <section class="panel" id="panel"></section>
    <nav class="tools" id="tools">
      <button data-tool="select"><i>👆</i><span>Auswahl</span></button>
      <button data-tool="wall"><i>🧱</i><span>Wand</span></button>
      <button data-tool="door"><i>🚪</i><span>Tür</span></button>
      <button data-tool="window"><i>🪟</i><span>Fenster</span></button>
      <button data-tool="room"><i>🏷️</i><span>Raum</span></button>
      <button data-add="1" class="addf"><i>🛋️</i><span>Möbel</span></button>
    </nav></div>`;
  svg = $('#svg'); cvs = $('#cvs');
  wireEditor();
  requestAnimationFrame(() => { fitView(); renderVars(); renderPanel(); updateTools(); render(); });
}

function leaveEditor() { saveNow(); renderHome(); }

function wireEditor() {
  $('#bBack').onclick = leaveEditor;
  $('#bTitle').onclick = () => askText('Name der Wohnung', apt().name, 'Speichern', n => { apt().name = n; save(); updateTop(); });
  $('#bUndo').onclick = undo;
  $('#bRedo').onclick = redo;
  $('#bConf').onclick = conflictDialog;
  $('#bMenu').onclick = editorMenu;
  $('#zIn').onclick = () => zoomBy(1.3);
  $('#zOut').onclick = () => zoomBy(1 / 1.3);
  $('#zFit').onclick = () => { fitView(); render(); };
  $('#tools').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) return furnitureSheet();
    setTool(b.dataset.tool);
  };
  $('#vars').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) return addVariantDialog();
    const id = b.dataset.v;
    if (id === apt().activeVariant) return variantMenu(id);
    apt().activeVariant = id; cur.sel = null; save(); renderVars(); renderPanel(); render();
  };
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onCancel);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', e => e.preventDefault());
  new ResizeObserver(() => { if (cur) sched(); }).observe(cvs);
  wirePanel();
}

function setTool(t) {
  cur.tool = t; cur.pending = null; cur.ghost = null;
  if (t !== 'select') cur.sel = null;
  updateTools(); renderPanel(); render();
}
function updateTools() {
  document.querySelectorAll('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === cur.tool));
  const hints = {
    select: 'Tippe etwas an – ziehen verschiebt, zwei Finger zoomen',
    wall: cur.pending ? 'Tippe den nächsten Punkt (Auswahl beendet)' : 'Ziehe eine Wand – oder tippe Start- und Endpunkt',
    door: 'Tippe auf eine Wand, um eine Tür zu setzen',
    window: 'Tippe auf eine Wand, um ein Fenster zu setzen',
    room: 'Tippe in einen Raum, um ihn zu beschriften'
  };
  $('#hint').textContent = hints[cur.tool];
}
function updateTop() {
  if (!cur) return;
  $('#bTitle').textContent = apt().name;
  const h = hist[cur.aptId];
  $('#bUndo').disabled = !h.undo.length;
  $('#bRedo').disabled = !h.redo.length;
  const n = cur.conf.ids.size, b = $('#bConf');
  b.classList.toggle('hidden', !n);
  b.textContent = `⚠ ${n}`;
}
function renderVars() {
  const a = apt();
  $('#vars').innerHTML = a.variants.map(v =>
    `<button data-v="${v.id}" class="${v.id === a.activeVariant ? 'on' : ''}">${esc(v.name)}</button>`).join('') +
    `<button data-add="1" class="plus">＋</button>`;
}
function addVariantDialog() {
  actionSheet('Neue Variante', [
    { label: 'Kopie der aktuellen Möblierung', fn: () => mutate((a, v) => { const nv = deepCopy(v); nv.id = uid(); nv.name = nextVariantName(a); nv.furniture.forEach(f => f.id = uid()); a.variants.push(nv); a.activeVariant = nv.id; cur.sel = null; }, true) },
    { label: 'Leere Variante (nur Grundriss)', fn: () => mutate(a => { const nv = { id: uid(), name: nextVariantName(a), furniture: [] }; a.variants.push(nv); a.activeVariant = nv.id; cur.sel = null; }, true) }
  ]);
}
function nextVariantName(a) {
  for (let i = 0; i < 26; i++) { const n = 'Variante ' + String.fromCharCode(65 + i); if (!a.variants.some(v => v.name === n)) return n; }
  return 'Variante ' + (a.variants.length + 1);
}
function variantMenu(id) {
  const a = apt(), v = a.variants.find(x => x.id === id);
  const items = [
    { label: 'Umbenennen', fn: () => askText('Name der Variante', v.name, 'Speichern', n => mutate(() => { v.name = n; }, true)) },
    { label: 'Duplizieren', fn: () => mutate(() => { const nv = deepCopy(v); nv.id = uid(); nv.name = nextVariantName(a); nv.furniture.forEach(f => f.id = uid()); a.variants.push(nv); a.activeVariant = nv.id; cur.sel = null; }, true) }
  ];
  if (a.variants.length > 1) items.push({ label: 'Löschen', cls: 'danger', fn: () => confirmBox(`„${v.name}“ löschen?`, 'Löschen', () => mutate(() => { a.variants = a.variants.filter(x => x.id !== id); a.activeVariant = a.variants[0].id; cur.sel = null; }, true)) });
  actionSheet(v.name, items);
}
function editorMenu() {
  const a = apt();
  actionSheet(a.name, [
    { label: `Einrasten & Raster: ${S.snap ? 'an' : 'aus'}`, fn: () => { S.snap = !S.snap; save(); toast('Einrasten ' + (S.snap ? 'an' : 'aus')); } },
    { label: `Wandmaße anzeigen: ${S.dims ? 'an' : 'aus'}`, fn: () => { S.dims = !S.dims; save(); render(); } },
    { label: 'Ansicht einpassen', fn: () => { fitView(); render(); } },
    { label: 'Varianten vergleichen', fn: compareDialog },
    { label: 'Wohnung umbenennen', fn: () => $('#bTitle').click() },
    { label: 'Als Datei exportieren', fn: () => saveFile(a.name.replace(/[^\w\-äöüÄÖÜß ]+/g, '_') + '.json', { app: 'wohnungsplaner', version: 1, apartments: [a], templates: [] }) }
  ]);
}
function compareDialog() {
  const a = apt();
  const s = modal(`<h3>Varianten vergleichen</h3><div class="cmp">${a.variants.map(v => {
    const n = G.conflicts(a, v).ids.size;
    return `<div class="cmpc ${v.id === a.activeVariant ? 'on' : ''}" data-v="${v.id}"><div class="thumbbox big">${staticSVG(a, v, 200, 150)}</div>
      <b>${esc(v.name)}</b><span>${v.furniture.length} Möbel${n ? ` · <em>⚠ ${n}</em>` : ''}</span></div>`;
  }).join('')}</div><div class="row end"><button class="btn" data-x="no">Schließen</button></div>`, 'wide');
  s.onclick = e => {
    if (e.target.dataset.x === 'no') return closeModal();
    const c = e.target.closest('[data-v]');
    if (c) { a.activeVariant = c.dataset.v; cur.sel = null; save(); closeModal(); renderVars(); renderPanel(); render(); }
  };
}
function conflictDialog() {
  const list = cur.conf.list;
  const s = modal(`<h3>Kollisionen</h3><div class="list">${list.map((c, i) =>
    `<button class="btn wide" data-i="${i}">⚠ ${esc(c.a || 'Möbel')} ↔ ${esc(c.b || 'Möbel')}</button>`).join('')}</div>
    <div class="row end"><button class="btn" data-x="no">Schließen</button></div>`);
  s.onclick = e => {
    if (e.target.dataset.x === 'no') return closeModal();
    const i = e.target.dataset.i;
    if (i != null) { closeModal(); select({ k: 'f', id: list[+i].ids[0] }); }
  };
}

// ---------- Möbel hinzufügen ----------
function allTemplates() {
  return TEMPLATES.concat(S.templates.map((t, i) => Object.assign({ custom: i }, t)));
}
function miniShape(t) {
  const col = t.col || CATS[t.c].col, w = t.w, d = t.d, m = Math.max(w, d);
  const f = { shape: t.s, w, d, t: t.t || 50, rot: 0, flip: false, x: 0, y: 0 };
  return `<svg viewBox="${-m / 2 - 4} ${-m / 2 - 4} ${m + 8} ${m + 8}" class="mini"><g>${furnShape(f)} fill="${col}" stroke="rgba(40,30,70,.4)" stroke-width="${m / 40}"/></g></svg>`;
}
let sheetCat = 'schlafen';
function furnitureSheet() {
  const cats = Object.keys(CATS).filter(c => c !== 'eigene' || S.templates.length);
  if (!cats.includes(sheetCat)) sheetCat = cats[0];
  const items = allTemplates().filter(t => t.c === sheetCat);
  const s = modal(`<h3>Möbel hinzufügen</h3>
    <div class="catbar">${cats.map(c => `<button data-c="${c}" class="${c === sheetCat ? 'on' : ''}" style="--cc:${CATS[c].col}">${CATS[c].name}</button>`).join('')}</div>
    <div class="tgrid">${items.map(t => `<div class="tcard" data-t="${allTemplates().indexOf(t)}">${t.custom != null ? `<span class="tdel" data-del="${t.custom}">✕</span>` : ''}${miniShape(t)}<b>${esc(t.n)}</b><span>${t.s === 'round' && t.w === t.d ? 'Ø ' + t.w : t.w + ' × ' + t.d}</span></div>`).join('')}</div>
    <div class="row end"><button class="btn" data-x="no">Schließen</button></div>`, 'tall');
  s.onclick = e => {
    if (e.target.dataset.x === 'no') return closeModal();
    if (e.target.dataset.c) { sheetCat = e.target.dataset.c; return furnitureSheet(); }
    if (e.target.dataset.del != null) { S.templates.splice(+e.target.dataset.del, 1); save(); return furnitureSheet(); }
    const c = e.target.closest('[data-t]');
    if (c) { closeModal(); addFurniture(allTemplates()[+c.dataset.t]); }
  };
}
function addFurniture(t) {
  const W = cvs.clientWidth, H = cvs.clientHeight, vw = cur.view;
  let x = (W / 2 - vw.x) / vw.s, y = (H / 2 - vw.y) / vw.s;
  const v = variant();
  while (v.furniture.some(f => Math.abs(f.x - x) < 8 && Math.abs(f.y - y) < 8)) { x += 25; y += 25; }
  const f = { id: uid(), name: t.n, shape: t.s, w: t.w, d: t.d, t: t.t || 50, x: rnd(x, 5), y: rnd(y, 5), rot: 0, flip: false, color: t.col || CATS[t.c].col, ghost: !!t.ghost };
  mutate((a, vv) => { vv.furniture.push(f); });
  setTool('select');
  select({ k: 'f', id: f.id });
}

// ---------- Verlauf (Rückgängig/Wiederholen) ----------
function commit(before) {
  const a = apt();
  const now = JSON.stringify(a);
  if (before === now) return;
  const h = hist[cur.aptId];
  h.undo.push(before); if (h.undo.length > 100) h.undo.shift();
  h.redo.length = 0;
  save(); updateTop();
}
function mutate(fn, refreshAll) {
  const before = JSON.stringify(apt());
  fn(apt(), variant());
  commit(before);
  if (refreshAll) renderVars();
  renderPanel(); render();
}
function restore(json) {
  const i = S.apartments.findIndex(a => a.id === cur.aptId);
  S.apartments[i] = JSON.parse(json);
  const a = apt();
  if (!a.variants.find(v => v.id === a.activeVariant)) a.activeVariant = a.variants[0].id;
  if (cur.sel && !selExists()) cur.sel = null;
  save(); renderVars(); renderPanel(); render();
}
function undo() {
  const h = hist[cur.aptId]; if (!h.undo.length) return;
  h.redo.push(JSON.stringify(apt())); restore(h.undo.pop());
}
function redo() {
  const h = hist[cur.aptId]; if (!h.redo.length) return;
  h.undo.push(JSON.stringify(apt())); restore(h.redo.pop());
}

// ---------- Auswahl & Panel ----------
function selExists() {
  const a = apt(), s = cur.sel; if (!s) return false;
  if (s.k === 'w') return !!wallOf(a, s.id);
  if (s.k === 'op') return a.openings.some(o => o.id === s.id);
  if (s.k === 'room') return a.rooms.some(r => r.id === s.id);
  if (s.k === 'f') return !!getF(s.id);
  return false;
}
function select(sel) {
  const same = cur.sel && sel && cur.sel.k === sel.k && cur.sel.id === sel.id;
  cur.sel = sel;
  if (!same) renderPanel();
  render();
}
const PCOLORS = COLORS;
function numField(label, key, val, step) {
  return `<label class="fld"><span>${label}</span><input type="number" inputmode="decimal" step="${step || 1}" data-fld="${key}" value="${Math.round(val * 10) / 10}"></label>`;
}
function renderPanel() {
  const p = $('#panel'); if (!p || !cur) return;
  const a = apt(), s = cur.sel;
  let h = '';
  if (s && s.k === 'f' && getF(s.id)) {
    const f = getF(s.id);
    h = `<div class="prow"><label class="fld grow"><span>Name</span><input type="text" data-fld="name" value="${esc(f.name)}" maxlength="40"></label></div>
      <div class="prow">${numField('Breite cm', 'w', f.w)}${numField('Tiefe cm', 'd', f.d)}${f.shape === 'L' ? numField('Schenkel cm', 't', G.clampT(f)) : ''}${numField('Drehung °', 'rot', f.rot || 0)}</div>
      <div class="prow seg">${[['rect', 'Rechteck'], ['round', 'Rund'], ['L', 'L-Form']].map(([k, n]) => `<button data-act="shape" data-v="${k}" class="${f.shape === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="prow colors">${PCOLORS.map(c => `<button data-act="color" data-v="${c}" class="${f.color === c ? 'on' : ''}" style="background:${c}" aria-label="Farbe"></button>`).join('')}</div>
      <div class="prow acts"><button data-act="rot90">↻ 90°</button>${f.shape === 'L' ? '<button data-act="flip">⇋ Spiegeln</button>' : ''}<button data-act="dup">⧉ Kopie</button><button data-act="tpl">★ Vorlage</button><button data-act="ghost" class="${f.ghost ? 'on' : ''}">Ohne Kollision</button><button data-act="del" class="del">🗑</button></div>`;
  } else if (s && s.k === 'w' && wallOf(a, s.id)) {
    const w = wallOf(a, s.id), L = G.wallGeo(w).L;
    h = `<div class="prow">${numField('Länge cm (Wandmitte)', 'wlen', L)}${numField('Dicke cm', 'wt', w.t)}</div>
      <div class="prow seg">${[10, 12, 20, 24, 30].map(t => `<button data-act="wthick" data-v="${t}" class="${w.t === t ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="prow acts"><button data-act="del" class="del">🗑 Wand löschen</button></div>`;
  } else if (s && s.k === 'op') {
    const o = a.openings.find(x => x.id === s.id);
    if (o) h = `<div class="prow"><b class="ptitle">${o.type === 'door' ? '🚪 Tür' : '🪟 Fenster'}</b>${numField('Breite cm', 'ow', o.w)}</div>
      <div class="prow acts">${o.type === 'door' ? '<button data-act="side">⇅ Aufschlag-Seite</button><button data-act="hinge">⇄ Anschlag</button>' : ''}<button data-act="del" class="del">🗑 Löschen</button></div>`;
  } else if (s && s.k === 'room') {
    const r = a.rooms.find(x => x.id === s.id);
    if (r) h = `<div class="prow"><label class="fld grow"><span>Raumname</span><input type="text" data-fld="rname" id="rnameIn" value="${esc(r.name)}" maxlength="30"></label></div>
      <div class="prow acts"><button data-act="del" class="del">🗑 Löschen</button></div>`;
  } else {
    const n = variant().furniture.length;
    h = `<div class="prow idle">${cur.tool === 'select' ? `${esc(variant().name)}: ${n} Möbel${n ? '' : ' – tippe unten auf „Möbel“'}` : ''}${cur.tool === 'wall' && cur.pending ? '<button data-act="endchain" class="on">Kette beenden</button>' : ''}</div>`;
  }
  p.innerHTML = h;
  p.classList.toggle('slim', !h.includes('prow acts') && !h.includes('fld'));
  if (cur.focusName) { cur.focusName = false; const i = $('#rnameIn'); if (i) { i.focus(); i.select(); } }
}

let fieldBefore = null;
function applyField(el, finalPass) {
  const a = apt(), s = cur.sel; if (!s) return;
  const k = el.dataset.fld, raw = el.value;
  const num = parseFloat(String(raw).replace(',', '.'));
  if (s.k === 'f') {
    const f = getF(s.id); if (!f) return;
    if (k === 'name') f.name = raw;
    else if (!isNaN(num)) {
      if (k === 'w') f.w = clamp(num, 10, 3000);
      if (k === 'd') f.d = clamp(num, 10, 3000);
      if (k === 't') f.t = clamp(num, 5, 3000);
      if (k === 'rot') f.rot = ((num % 360) + 360) % 360;
    }
  } else if (s.k === 'w') {
    const w = wallOf(a, s.id); if (!w) return;
    if (k === 'wt' && !isNaN(num)) { w.t = clamp(num, 3, 100); S.lastWallT = w.t; }
    if (k === 'wlen' && finalPass && !isNaN(num) && num >= 10) setWallLength(a, w, num);
  } else if (s.k === 'op') {
    const o = a.openings.find(x => x.id === s.id); if (!o) return;
    if (k === 'ow' && !isNaN(num)) { const L = G.wallGeo(wallOf(a, o.wallId)).L; o.w = clamp(num, 20, Math.max(20, L)); o.c = clamp(o.c, o.w / 2, L - o.w / 2); }
  } else if (s.k === 'room') {
    const r = a.rooms.find(x => x.id === s.id); if (r && k === 'rname') r.name = raw;
  }
}
function groupAt(a, x, y) {
  const refs = [];
  for (const w of a.walls) {
    if (Math.hypot(w.x1 - x, w.y1 - y) < 1) refs.push({ w, e: 1 });
    if (Math.hypot(w.x2 - x, w.y2 - y) < 1) refs.push({ w, e: 2 });
  }
  return refs;
}
const setRef = (r, x, y) => { if (r.e === 1) { r.w.x1 = x; r.w.y1 = y; } else { r.w.x2 = x; r.w.y2 = y; } };
function fixOpenings(a, w) {
  const L = G.wallGeo(w).L;
  for (const o of a.openings) if (o.wallId === w.id) { o.w = Math.min(o.w, Math.max(20, L)); o.c = clamp(o.c, o.w / 2, Math.max(o.w / 2, L - o.w / 2)); }
}
function setWallLength(a, w, len) {
  const g = G.wallGeo(w), refs = groupAt(a, w.x2, w.y2);
  const nx = w.x1 + g.ux * len, ny = w.y1 + g.uy * len;
  for (const r of refs) setRef(r, nx, ny);
  new Set(refs.map(r => r.w)).forEach(x => fixOpenings(a, x));
}
function wirePanel() {
  const p = $('#panel');
  p.addEventListener('input', e => {
    const el = e.target; if (!el.dataset.fld || el.dataset.fld === 'wlen') return;
    if (fieldBefore == null) fieldBefore = JSON.stringify(apt());
    applyField(el); render();
  });
  p.addEventListener('change', e => {
    const el = e.target; if (!el.dataset.fld) return;
    if (el.dataset.fld === 'wlen') { const b = JSON.stringify(apt()); applyField(el, true); commit(b); render(); return; }
    if (fieldBefore != null) { commit(fieldBefore); fieldBefore = null; }
  });
  p.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  p.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    panelAction(b.dataset.act, b.dataset.v);
  });
}
function panelAction(act, v) {
  const a = apt(), s = cur.sel;
  if (act === 'endchain') { cur.pending = null; cur.ghost = null; updateTools(); renderPanel(); return render(); }
  if (!s) return;
  if (act === 'del') {
    return mutate((a2, vv) => {
      if (s.k === 'f') vv.furniture = vv.furniture.filter(f => f.id !== s.id);
      if (s.k === 'w') { a2.walls = a2.walls.filter(w => w.id !== s.id); a2.openings = a2.openings.filter(o => o.wallId !== s.id); }
      if (s.k === 'op') a2.openings = a2.openings.filter(o => o.id !== s.id);
      if (s.k === 'room') a2.rooms = a2.rooms.filter(r => r.id !== s.id);
      cur.sel = null;
    });
  }
  if (s.k === 'f') {
    const f = getF(s.id); if (!f) return;
    if (act === 'tpl') {
      return askText('Name der Vorlage', f.name, 'Speichern', n => { S.templates.push({ n, s: f.shape, w: f.w, d: f.d, t: f.t, c: 'eigene', col: f.color, ghost: f.ghost }); save(); toast('Vorlage gespeichert (Möbel → Eigene)'); });
    }
    if (act === 'dup') {
      const c = Object.assign(deepCopy(f), { id: uid(), x: f.x + 30, y: f.y + 30 });
      mutate((a2, vv) => vv.furniture.push(c)); return select({ k: 'f', id: c.id });
    }
    return mutate(() => {
      if (act === 'shape') { f.shape = v; if (v === 'round' && Math.abs(f.w - f.d) < 1) f.d = f.w; if (v === 'L' && !f.t) f.t = 50; }
      if (act === 'color') f.color = v;
      if (act === 'rot90') f.rot = ((f.rot || 0) + 90) % 360;
      if (act === 'flip') f.flip = !f.flip;
      if (act === 'ghost') f.ghost = !f.ghost;
    });
  }
  if (s.k === 'w' && act === 'wthick') return mutate(() => { const w = wallOf(a, s.id); w.t = +v; S.lastWallT = +v; });
  if (s.k === 'op') {
    const o = a.openings.find(x => x.id === s.id);
    return mutate(() => { if (act === 'side') o.side = -(o.side || 1); if (act === 'hinge') o.hinge = o.hinge ? 0 : 1; });
  }
}

// ---------- Ansicht: Zoom, Einpassen, Rendern ----------
function fitView() {
  const a = apt(), v = variant();
  const W = cvs.clientWidth || 360, H = cvs.clientHeight || 400;
  let bb = bboxOf(a, v);
  if (!bb) bb = { x0: 0, y0: 0, x1: 600, y1: 400 };
  const bw = Math.max(bb.x1 - bb.x0, 100), bh = Math.max(bb.y1 - bb.y0, 100), m = 36;
  const s = clamp(Math.min((W - 2 * m) / bw, (H - 2 * m) / bh), 0.05, 3);
  cur.view = { s, x: W / 2 - (bb.x0 + bw / 2) * s, y: H / 2 - (bb.y0 + bh / 2) * s };
}
function zoomAt(px, py, factor) {
  const vw = cur.view, s = clamp(vw.s * factor, 0.05, 8), k = s / vw.s;
  vw.x = px - (px - vw.x) * k; vw.y = py - (py - vw.y) * k; vw.s = s;
}
function zoomBy(f) { zoomAt(cvs.clientWidth / 2, cvs.clientHeight / 2, f); render(); }
let raf = 0;
function sched() { if (!raf) raf = requestAnimationFrame(render); }

function gridPath(vb, vw, W, H) {
  const levels = [[10, '#f0e6d4'], [50, '#e8dcc6'], [100, '#dccdb0'], [500, '#cdbb98']];
  let out = '';
  for (const [step, col] of levels) {
    if (step * vw.s < 9) continue;
    let d = '';
    for (let x = Math.ceil(vb.x0 / step) * step; x <= vb.x1; x += step) { const sx = (x * vw.s + vw.x).toFixed(1); d += `M${sx} 0V${H}`; }
    for (let y = Math.ceil(vb.y0 / step) * step; y <= vb.y1; y += step) { const sy = (y * vw.s + vw.y).toFixed(1); d += `M0 ${sy}H${W}`; }
    out += `<path d="${d}" stroke="${col}" stroke-width="1" fill="none"/>`;
  }
  return out;
}
function render() {
  raf = 0;
  if (screen !== 'editor' || !svg) return;
  const a = apt(), v = variant(), vw = cur.view;
  const W = cvs.clientWidth, H = cvs.clientHeight, px = 1 / vw.s;
  const vb = { x0: -vw.x / vw.s, y0: -vw.y / vw.s, x1: (W - vw.x) / vw.s, y1: (H - vw.y) / vw.s };
  cur.conf = G.conflicts(a, v);
  const o = { edit: true, sel: cur.sel, conf: cur.conf, px, dims: S.dims, ghost: cur.ghost, pending: cur.pending, guides: cur.guides, vb };
  svg.innerHTML = `<rect width="${W}" height="${H}" fill="#fffaf0"/>${gridPath(vb, vw, W, H)}` +
    `<g transform="translate(${vw.x.toFixed(2)} ${vw.y.toFixed(2)}) scale(${vw.s})">${sceneSVG(a, v, o)}${overlaySVG(a, v, o)}</g>`;
  updateTop();
}

// ---------- Fangen / Einrasten ----------
const gridV = v => S.snap ? rnd(v, 10) : Math.round(v);
function wallEnds(skip) {
  const out = [];
  for (const w of apt().walls) {
    if (!skip || !skip(w, 1)) out.push([w.x1, w.y1]);
    if (!skip || !skip(w, 2)) out.push([w.x2, w.y2]);
  }
  return out;
}
// Punkt für Wandzeichnen: Endpunkte > Winkel (0/45/90°) > Raster
function snapPt(p, opt) {
  const thr = 14 / cur.view.s;
  const ends = wallEnds(opt.skip);
  let best = null, bd = thr;
  for (const e of ends) { const d = Math.hypot(e[0] - p.x, e[1] - p.y); if (d < bd) { bd = d; best = e; } }
  if (best) return { x: best[0], y: best[1] };
  let x = p.x, y = p.y, lx = false, ly = false;
  const f = opt.from;
  if (f && S.snap) {
    const dx = p.x - f.x, dy = p.y - f.y, len = Math.hypot(dx, dy);
    if (len > 1) {
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const near = Math.round(ang / 45) * 45;
      if (Math.abs(ang - near) < 7) {
        const m = ((near % 180) + 180) % 180;
        if (m === 0) { y = f.y; x = gridV(p.x); ly = true; }
        else if (m === 90) { x = f.x; y = gridV(p.y); lx = true; }
        else { const L = gridV(Math.max(Math.abs(dx), Math.abs(dy))); x = f.x + Math.sign(dx) * L; y = f.y + Math.sign(dy) * L; lx = ly = true; }
      } else { x = gridV(p.x); y = gridV(p.y); }
    }
  } else { x = gridV(p.x); y = gridV(p.y); }
  if (S.snap) for (const e of ends) {
    if (!lx && Math.abs(x - e[0]) < thr / 2) x = e[0];
    if (!ly && Math.abs(y - e[1]) < thr / 2) y = e[1];
  }
  return { x, y };
}
function prepFurnSnap(exceptId) {
  const a = apt(), v = variant(), xs = [], ys = [];
  for (const f of v.furniture) {
    if (f.id === exceptId || f.ghost) continue;
    const bb = G.bounds(G.pieces(f));
    xs.push(bb.x0, bb.x1, f.x); ys.push(bb.y0, bb.y1, f.y);
  }
  for (const w of a.walls) for (const q of G.wallQuads(a, w)) for (const [x, y] of q) { xs.push(x); ys.push(y); }
  return { xs, ys };
}
function snapFurn(f, nx, ny, sn) {
  if (!S.snap) return { x: Math.round(nx), y: Math.round(ny), guides: [] };
  const bb = G.bounds(G.pieces(Object.assign({}, f, { x: 0, y: 0 })));
  const thr = 10 / cur.view.s, guides = [];
  const axis = (n, offs, cands, ax) => {
    let best = null;
    for (const off of offs) for (const c of cands) {
      const d = c - (n + off);
      if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, c };
    }
    if (best) { guides.push({ axis: ax, v: best.c }); return n + best.d; }
    return rnd(n, 5);
  };
  return { x: axis(nx, [bb.x0, bb.x1, 0], sn.xs, 'x'), y: axis(ny, [bb.y0, bb.y1, 0], sn.ys, 'y'), guides };
}
function nearestWall(a, p, maxd) {
  let best = null;
  for (const w of a.walls) {
    const g = G.wallGeo(w), dx = p.x - w.x1, dy = p.y - w.y1;
    const t = clamp(dx * g.ux + dy * g.uy, 0, g.L);
    const d = Math.hypot(p.x - (w.x1 + g.ux * t), p.y - (w.y1 + g.uy * t));
    if (d <= maxd + w.t / 2 && (!best || d < best.d)) best = { wall: w, t, d, side: (dx * g.nx + dy * g.ny) >= 0 ? 1 : -1 };
  }
  return best;
}

// ---------- Zeigerereignisse ----------
const P = new Map();
let drag = null, pinch = null, locked = false;
const scr = e => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const toW = p => ({ x: (p.x - cur.view.x) / cur.view.s, y: (p.y - cur.view.y) / cur.view.s });

function startPinch() {
  const [p1, p2] = [...P.values()];
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  pinch = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, s0: cur.view.s, w: toW(mid) };
}
function doPinch() {
  const [p1, p2] = [...P.values()];
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const s = clamp(pinch.s0 * (Math.hypot(p1.x - p2.x, p1.y - p2.y) / pinch.d0), 0.05, 8);
  cur.view.s = s; cur.view.x = mid.x - pinch.w.x * s; cur.view.y = mid.y - pinch.w.y * s;
  sched();
}
function cancelDrag() {
  if (drag && drag.before && drag.changed) { restore(drag.before); }
  drag = null; cur.ghost = null; cur.guides = []; sched();
}
function onWheel(e) {
  e.preventDefault();
  const p = scr(e);
  if (e.ctrlKey || e.metaKey) zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.01));
  else if (Math.abs(e.deltaY) > 0 && e.deltaMode === 1) zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.05));
  else { cur.view.x -= e.deltaX; cur.view.y -= e.deltaY; }
  sched();
}

function onDown(e) {
  if (e.pointerType === 'mouse' && e.button === 2) return;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  try { svg.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
  const pt = scr(e); P.set(e.pointerId, pt);
  if (P.size >= 2) { if (drag) cancelDrag(); startPinch(); locked = true; return; }
  locked = false;
  const w = toW(pt);
  const el = e.target.closest ? e.target.closest('[data-k]') : null;
  const k = el ? el.dataset.k : null, id = el ? el.dataset.id : null;
  const a = apt();
  if (e.pointerType === 'mouse' && e.button === 1) { drag = { type: 'pan', pt0: pt, v0: Object.assign({}, cur.view) }; return; }

  if (cur.tool === 'wall') {
    const s = cur.pending || snapPt(w, {});
    drag = { type: 'wdraw', pt0: pt, start: { x: s.x, y: s.y }, moved: false };
    cur.ghost = { x1: s.x, y1: s.y, x2: s.x, y2: s.y };
    sched(); return;
  }
  if (cur.tool === 'door' || cur.tool === 'window') { placeOpening(w); return; }
  if (cur.tool === 'room') { placeRoom(w); return; }

  const before = JSON.stringify(a);
  if (k === 'handle') {
    const f = getF(cur.sel.id);
    drag = { type: 'hdl', h: el.dataset.h, before, f0: Object.assign({}, f), w0: w, pt0: pt, changed: false, snap: prepFurnSnap(f.id) };
  } else if (k === 'whandle') {
    const wl = wallOf(a, id), e2 = +el.dataset.end;
    const x = e2 === 1 ? wl.x1 : wl.x2, y = e2 === 1 ? wl.y1 : wl.y2;
    const refs = groupAt(a, x, y);
    drag = { type: 'wend', before, wl, e2, refs, other: e2 === 1 ? { x: wl.x2, y: wl.y2 } : { x: wl.x1, y: wl.y1 }, pt0: pt, changed: false };
  } else if (k === 'f') {
    select({ k: 'f', id });
    const f = getF(id);
    drag = { type: 'fmove', before, f0: { x: f.x, y: f.y }, w0: w, pt0: pt, changed: false, snap: prepFurnSnap(id) };
  } else if (k === 'w') {
    select({ k: 'w', id });
    const wl = wallOf(a, id);
    const refs = []; const seen = new Set();
    for (const r of groupAt(a, wl.x1, wl.y1).concat(groupAt(a, wl.x2, wl.y2))) {
      const key = r.w.id + ':' + r.e; if (seen.has(key)) continue; seen.add(key);
      r.ox = r.e === 1 ? r.w.x1 : r.w.x2; r.oy = r.e === 1 ? r.w.y1 : r.w.y2; refs.push(r);
    }
    drag = { type: 'wmove', before, wl, refs, w0: w, p10: { x: wl.x1, y: wl.y1 }, pt0: pt, changed: false };
  } else if (k === 'op') {
    select({ k: 'op', id });
    drag = { type: 'omove', before, op: a.openings.find(o => o.id === id), pt0: pt, changed: false };
  } else if (k === 'room') {
    select({ k: 'room', id });
    const r = a.rooms.find(x => x.id === id);
    drag = { type: 'rmove', before, r, r0: { x: r.x, y: r.y }, w0: w, pt0: pt, changed: false };
  } else {
    if (cur.sel) { cur.sel = null; renderPanel(); render(); }
    drag = { type: 'pan', pt0: pt, v0: Object.assign({}, cur.view) };
  }
}

function onMove(e) {
  if (!P.has(e.pointerId)) {
    if (cur && cur.tool === 'wall' && cur.pending && !drag && e.pointerType === 'mouse') {
      const s = snapPt(toW(scr(e)), { from: cur.pending });
      cur.ghost = { x1: cur.pending.x, y1: cur.pending.y, x2: s.x, y2: s.y }; sched();
    }
    return;
  }
  const pt = scr(e); P.set(e.pointerId, pt);
  if (pinch && P.size >= 2) return doPinch();
  if (locked || !drag) return;
  const w = toW(pt), a = apt(), d = drag;
  if (Math.hypot(pt.x - d.pt0.x, pt.y - d.pt0.y) > 4) d.moved = true;
  if (!d.moved && d.type !== 'wdraw') return;
  d.changed = true;
  switch (d.type) {
    case 'pan':
      cur.view.x = d.v0.x + (pt.x - d.pt0.x); cur.view.y = d.v0.y + (pt.y - d.pt0.y); d.changed = false; break;
    case 'wdraw': {
      const s = snapPt(w, { from: d.start });
      cur.ghost = { x1: d.start.x, y1: d.start.y, x2: s.x, y2: s.y }; d.changed = false; break;
    }
    case 'fmove': {
      const f = getF(cur.sel.id);
      const r = snapFurn(f, d.f0.x + (w.x - d.w0.x), d.f0.y + (w.y - d.w0.y), d.snap);
      f.x = r.x; f.y = r.y; cur.guides = r.guides; break;
    }
    case 'hdl': {
      const f = getF(cur.sel.id), f0 = d.f0;
      if (d.h === 'rot') {
        let ang = Math.atan2(w.y - f.y, w.x - f.x) * 180 / Math.PI + 90;
        ang = ((ang % 360) + 360) % 360;
        const sn = S.snap ? rnd(ang, 15) : (Math.abs(ang - rnd(ang, 90)) < 4 ? rnd(ang, 90) : Math.round(ang));
        f.rot = ((sn % 360) + 360) % 360;
      } else {
        const r = (f0.rot || 0) * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
        const dx = w.x - d.w0.x, dy = w.y - d.w0.y;
        const dl = dx * ux + dy * uy, dm = -dx * uy + dy * ux;
        const q = S.snap ? 5 : 1;
        let nw = f0.w, nd = f0.d, cx = f0.x, cy = f0.y;
        if (d.h.includes('e')) { nw = Math.max(10, rnd(f0.w + dl, q)); const k2 = nw - f0.w; cx += ux * k2 / 2; cy += uy * k2 / 2; }
        if (d.h.includes('s')) { nd = Math.max(10, rnd(f0.d + dm, q)); const k2 = nd - f0.d; cx += -uy * k2 / 2; cy += ux * k2 / 2; }
        f.w = nw; f.d = nd; f.x = cx; f.y = cy;
        if (f.shape === 'round' && d.h === 'se' && Math.abs(f0.w - f0.d) < 1) f.d = f.w;
      }
      break;
    }
    case 'wend': {
      const s = snapPt(w, { from: d.other, skip: (wl, e2) => d.refs.some(r => r.w === wl && r.e === e2) });
      for (const r of d.refs) setRef(r, s.x, s.y);
      new Set(d.refs.map(r => r.w)).forEach(x => fixOpenings(a, x));
      break;
    }
    case 'wmove': {
      let dx = w.x - d.w0.x, dy = w.y - d.w0.y;
      if (S.snap) { dx = gridV(d.p10.x + dx) - d.p10.x; dy = gridV(d.p10.y + dy) - d.p10.y; }
      for (const r of d.refs) setRef(r, r.ox + dx, r.oy + dy);
      break;
    }
    case 'omove': {
      const wl = wallOf(a, d.op.wallId), g = G.wallGeo(wl);
      let t = (w.x - wl.x1) * g.ux + (w.y - wl.y1) * g.uy;
      if (S.snap) t = rnd(t, 5);
      d.op.c = clamp(t, d.op.w / 2, g.L - d.op.w / 2); break;
    }
    case 'rmove':
      d.r.x = rnd(d.r0.x + w.x - d.w0.x, S.snap ? 5 : 1); d.r.y = rnd(d.r0.y + w.y - d.w0.y, S.snap ? 5 : 1); break;
  }
  sched();
}

function endPointer(e, cancelled) {
  P.delete(e.pointerId);
  if (P.size < 2) pinch = null;
  if (P.size > 0) return;
  if (locked) { locked = false; drag = null; cur.guides = []; sched(); return; }
  const d = drag; drag = null;
  if (!d) return;
  if (cancelled) { drag = d; cancelDrag(); return; }
  cur.guides = [];
  if (d.type === 'wdraw') return finishWall(d, scr(e));
  if (d.changed && d.before) {
    commit(d.before);
    if (d.type === 'wend' || d.type === 'wmove') renderPanel();
  }
  sched();
}
const onUp = e => endPointer(e, false);
const onCancel = e => endPointer(e, true);

function finishWall(d, pt) {
  const a = apt();
  const dragged = d.moved && Math.hypot(pt.x - d.pt0.x, pt.y - d.pt0.y) > 8;
  const g = cur.ghost; cur.ghost = null;
  const add = (x1, y1, x2, y2) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 10) return false;
    const before = JSON.stringify(a);
    a.walls.push({ id: uid(), x1, y1, x2, y2, t: S.lastWallT });
    commit(before); return true;
  };
  if (dragged) {
    if (g) add(g.x1, g.y1, g.x2, g.y2);
    cur.pending = null;
  } else if (cur.pending) {
    const e = snapPt(toW(pt), { from: cur.pending });
    if (add(cur.pending.x, cur.pending.y, e.x, e.y)) cur.pending = { x: e.x, y: e.y };
  } else {
    cur.pending = { x: d.start.x, y: d.start.y };
  }
  updateTools(); renderPanel(); render();
}

function placeOpening(w) {
  const a = apt();
  const near = nearestWall(a, w, 30 / cur.view.s);
  if (!near) return toast('Tippe direkt auf eine Wand');
  const g = G.wallGeo(near.wall), type = cur.tool;
  let ow = type === 'door' ? 90 : 120;
  if (g.L < ow + 10) ow = Math.max(20, rnd(g.L - 10, 5));
  if (g.L < 30) return toast('Wand zu kurz');
  const c = clamp(S.snap ? rnd(near.t, 5) : near.t, ow / 2, g.L - ow / 2);
  const op = { id: uid(), wallId: near.wall.id, type, c, w: ow, side: near.side, hinge: 0 };
  mutate(a2 => a2.openings.push(op));
  setTool('select'); select({ k: 'op', id: op.id });
}
function placeRoom(w) {
  const r = { id: uid(), name: 'Raum', x: rnd(w.x, 5), y: rnd(w.y, 5) };
  mutate(a => a.rooms.push(r));
  setTool('select'); cur.focusName = true; select({ k: 'room', id: r.id });
  if (cur.focusName) { cur.focusName = false; const i = $('#rnameIn'); if (i) { i.focus(); i.select(); } }
}

// Tastatur (Mac/iPad mit Tastatur)
document.addEventListener('keydown', e => {
  if (screen !== 'editor' || !cur) return;
  const tag = (document.activeElement || {}).tagName;
  if (tag === 'INPUT') return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (e.key === 'Escape') { cur.pending = null; cur.ghost = null; setTool('select'); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && cur.sel) { e.preventDefault(); panelAction('del'); }
});

// ---------- Export / Import ----------
async function saveFile(name, obj) {
  const text = JSON.stringify(obj, null, 1);
  const blob = new Blob([text], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || !Array.isArray(j.apartments)) throw new Error('format');
    let n = 0;
    for (const a of j.apartments) { S.apartments.push(sanitizeApt(a)); n++; }
    for (const t of (j.templates || [])) {
      if (t && t.n && !S.templates.some(x => x.n === t.n && x.w === t.w && x.d === t.d)) S.templates.push({ n: String(t.n), s: ['round', 'L'].includes(t.s) ? t.s : 'rect', w: +t.w || 50, d: +t.d || 50, t: +t.t || 50, c: 'eigene', col: t.col, ghost: !!t.ghost });
    }
    save(); toast(`${n} Wohnung${n === 1 ? '' : 'en'} importiert`);
    if (screen === 'home') renderHome();
  } catch (err) { toast('Datei konnte nicht gelesen werden'); }
});

// ---------- Start ----------
document.addEventListener('gesturestart', e => e.preventDefault());
renderHome();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
window.WP = { get S() { return S; }, get cur() { return cur; }, openApt, renderHome, setTool, select, mutate, render, G };
