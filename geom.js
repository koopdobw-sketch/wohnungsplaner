'use strict';
// Geometrie-Helfer: Möbelformen, Wandstücke, Türschwung, Kollisionstest (SAT). Alle Maße in cm.
const G = (() => {
  const rad = d => d * Math.PI / 180;

  function rotPt(x, y, deg) {
    const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }

  // Schenkelbreite der L-Form, begrenzt auf sinnvolle Werte
  function clampT(f) {
    return Math.max(5, Math.min(f.t || 50, Math.min(f.w, f.d) - 5));
  }

  // Konvexe Teilstücke in lokalen Koordinaten (Mittelpunkt = 0/0)
  function localPieces(f) {
    const w = f.w, d = f.d;
    let pcs;
    if (f.shape === 'round') {
      const n = 28, pts = [];
      for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n;
        pts.push([Math.cos(a) * w / 2, Math.sin(a) * d / 2]);
      }
      pcs = [pts];
    } else if (f.shape === 'L') {
      const t = clampT(f);
      pcs = [
        [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + t], [-w / 2, -d / 2 + t]],
        [[-w / 2, -d / 2 + t], [-w / 2 + t, -d / 2 + t], [-w / 2 + t, d / 2], [-w / 2, d / 2]]
      ];
    } else {
      pcs = [[[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]];
    }
    if (f.flip) pcs = pcs.map(p => p.map(([x, y]) => [-x, y]));
    return pcs;
  }

  // Möbelstücke als Weltkoordinaten
  function pieces(f) {
    return localPieces(f).map(p => p.map(([x, y]) => {
      const [rx, ry] = rotPt(x, y, f.rot || 0);
      return [f.x + rx, f.y + ry];
    }));
  }

  function bounds(polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }

  // Überlappungstiefe zweier konvexer Polygone (0 = keine Überlappung)
  function satDepth(A, B) {
    let min = Infinity;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        let nx = -(q[1] - p[1]), ny = q[0] - p[0];
        const l = Math.hypot(nx, ny);
        if (l < 1e-9) continue;
        nx /= l; ny /= l;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const [x, y] of A) { const v = x * nx + y * ny; if (v < a0) a0 = v; if (v > a1) a1 = v; }
        for (const [x, y] of B) { const v = x * nx + y * ny; if (v < b0) b0 = v; if (v > b1) b1 = v; }
        const ov = Math.min(a1, b1) - Math.max(a0, b0);
        if (ov <= 0) return 0;
        if (ov < min) min = ov;
      }
    }
    return min === Infinity ? 0 : min;
  }

  function wallGeo(w) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const L = Math.hypot(dx, dy) || 1e-6;
    return { L, ux: dx / L, uy: dy / L, nx: -dy / L, ny: dx / L };
  }

  // Berührt das Wandende (end = 1 oder 2) das Ende einer anderen Wand? (für saubere Ecken)
  function endTouches(walls, w, end) {
    const x = end === 1 ? w.x1 : w.x2, y = end === 1 ? w.y1 : w.y2;
    for (const o of walls) {
      if (o === w) continue;
      if (Math.hypot(o.x1 - x, o.y1 - y) < 1 || Math.hypot(o.x2 - x, o.y2 - y) < 1) return true;
    }
    return false;
  }

  // Wand in Stücke zerlegen (ohne Öffnungen); gibt Vierecke zurück
  function wallQuads(apt, w) {
    const g = wallGeo(w), t = w.t, h = t / 2;
    const ops = apt.openings.filter(o => o.wallId === w.id).sort((a, b) => (a.c - a.w / 2) - (b.c - b.w / 2));
    const segs = [];
    let cur = 0;
    for (const o of ops) {
      const s = Math.max(0, o.c - o.w / 2), e = Math.min(g.L, o.c + o.w / 2);
      if (s > cur + 0.5) segs.push([cur, s]);
      cur = Math.max(cur, e);
    }
    if (g.L > cur + 0.5) segs.push([cur, g.L]);
    const ext1 = endTouches(apt.walls, w, 1) ? h : 0;
    const ext2 = endTouches(apt.walls, w, 2) ? h : 0;
    return segs.map(([a, b]) => {
      const a2 = a === 0 ? a - ext1 : a, b2 = b === g.L ? b + ext2 : b;
      const P = (s, k) => [w.x1 + g.ux * s + g.nx * h * k, w.y1 + g.uy * s + g.ny * h * k];
      return [P(a2, 1), P(b2, 1), P(b2, -1), P(a2, -1)];
    });
  }

  // Fläche, die eine Tür beim Aufschwingen braucht (Viertelkreis)
  function swingPoly(w, o) {
    const g = wallGeo(w);
    const a = o.c - o.w / 2, b = o.c + o.w / 2;
    const ht = o.hinge ? b : a, dc = o.hinge ? -1 : 1, s = o.side || 1;
    const hx = w.x1 + g.ux * ht, hy = w.y1 + g.uy * ht;
    const pts = [[hx, hy]];
    for (let i = 0; i <= 8; i++) {
      const th = Math.PI / 2 * i / 8;
      pts.push([
        hx + o.w * (Math.cos(th) * g.ux * dc + Math.sin(th) * g.nx * s),
        hy + o.w * (Math.cos(th) * g.uy * dc + Math.sin(th) * g.ny * s)
      ]);
    }
    return { pts, hx, hy, dc, s, g };
  }

  // Alle Kollisionen einer Möblierungsvariante
  function conflicts(apt, variant) {
    const list = [], ids = new Set();
    const items = variant.furniture.filter(f => !f.ghost).map(f => {
      const pcs = pieces(f);
      return { f, pcs, bb: bounds(pcs) };
    });
    const hit = (A, B) => A.some(a => B.some(b => satDepth(a, b) > 1));
    const bbHit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (!bbHit(items[i].bb, items[j].bb)) continue;
        if (hit(items[i].pcs, items[j].pcs)) {
          list.push({ ids: [items[i].f.id, items[j].f.id], a: items[i].f.name, b: items[j].f.name });
          ids.add(items[i].f.id); ids.add(items[j].f.id);
        }
      }
    }
    const obstacles = [];
    for (const w of apt.walls) for (const q of wallQuads(apt, w)) obstacles.push({ poly: q, label: 'Wand', bb: bounds([q]) });
    for (const o of apt.openings) {
      if (o.type !== 'door') continue;
      const w = apt.walls.find(x => x.id === o.wallId);
      if (!w) continue;
      const sp = swingPoly(w, o);
      obstacles.push({ poly: sp.pts, label: 'Türschwung', bb: bounds([sp.pts]) });
    }
    for (const it of items) {
      for (const ob of obstacles) {
        if (!bbHit(it.bb, ob.bb)) continue;
        if (it.pcs.some(p => satDepth(p, ob.poly) > 1)) {
          list.push({ ids: [it.f.id], a: it.f.name, b: ob.label });
          ids.add(it.f.id);
        }
      }
    }
    return { list, ids };
  }

  return { rotPt, clampT, localPieces, pieces, bounds, satDepth, wallGeo, endTouches, wallQuads, swingPoly, conflicts };
})();
