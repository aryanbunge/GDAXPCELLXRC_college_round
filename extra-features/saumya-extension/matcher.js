// Semantic element matching: find a recorded control by meaning, not coordinates.
(function (root) {
  'use strict';
  const HF = (root.HF = root.HF || {});
  const C = HF.core;

  const ACT = new Set(['link', 'button', 'menuitem', 'tab']);
  const T = { ACCEPT: 0.5, AMBIG_MIN: 0.4, MARGIN: 0.07, MOVED_PX: 120 };
  const W = { name: 0.46, role: 0.1, attr: 0.14, ctx: 0.14, struct: 0.06, pos: 0.05, dl: 0.05 };

  const textOf = (d) => Array.from(new Set([d.name, d.aria, d.title, d.placeholder, d.label].filter(Boolean))).join(' ');
  const ctxText = (c) => [c.heading, c.label].filter(Boolean).join(' ');

  function jaccard(a, b) {
    if (!a.length && !b.length) return 1;
    const A = new Set(a), B = new Set(b); let n = 0;
    A.forEach((x) => { if (B.has(x)) n++; });
    return n / (A.size + B.size - n);
  }

  function scoreOne(d, c, hint) {
    const nameSim = Math.max(C.textSim(textOf(d), textOf(c)), hint ? C.textSim(hint, textOf(c)) * 0.9 : 0);
    const roleSim = d.role === c.role ? 1 : ACT.has(d.role) && ACT.has(c.role) ? 0.7 : 0;
    const attrSim = d.attr && c.attr ? C.textSim(d.attr, c.attr) : 0;
    const ctxSim = ctxText(d.ctx) || ctxText(c.ctx)
      ? 0.7 * C.textSim(ctxText(d.ctx), ctxText(c.ctx)) + 0.3 * jaccard(d.ctx.kinds, c.ctx.kinds)
      : jaccard(d.ctx.kinds, c.ctx.kinds);
    const structSim = jaccard(d.chain, c.chain);
    const dist = Math.hypot(d.pos.x - c.pos.x, d.pos.y - c.pos.y);
    const posSim = Math.exp(-dist / 700);
    const dl = d.hasDownload === c.hasDownload ? 1 : 0;
    let s = W.name * nameSim + W.role * roleSim + W.attr * attrSim + W.ctx * ctxSim + W.struct * structSim + W.pos * posSim + W.dl * dl;
    if (roleSim === 0) s *= 0.5;
    return { score: s, parts: { name: nameSim, role: roleSim, attr: attrSim, ctx: ctxSim, struct: structSim, pos: posSim, dl } };
  }

  // Rank candidates against a recorded descriptor (plus any user-corrected alternates).
  function rank(d, { hint = '', candidates = null, hidden = false } = {}) {
    const pool = candidates || (hidden ? C.query(C.INTERACTIVE, { hidden: true }).filter((e) => !C.isVisible(e)) : C.interactives());
    const targets = [d].concat(d.alts || []);
    const out = [];
    for (const el of pool) {
      const cd = C.describe(el);
      let best = null;
      targets.forEach((t, i) => {
        const r = scoreOne(t, cd, hint);
        if (!best || r.score > best.score) best = Object.assign({ via: i === 0 ? 'primary' : 'alt' }, r);
      });
      out.push({ el, desc: cd, score: best.score, parts: best.parts, via: best.via });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function judge(ranked) {
    const top = ranked[0], second = ranked[1];
    if (!top || top.score < T.ACCEPT) return 'none';
    // A previously corrected match is trusted unless something else is just as good.
    if (second && second.score >= T.AMBIG_MIN && top.score - second.score < T.MARGIN) return 'ambiguous';
    return 'ok';
  }

  function resolve(d, opts = {}) {
    const ranked = rank(d, opts);
    const status = judge(ranked);
    const top = ranked[0];
    const moved = !!top && Math.hypot(top.desc.pos.x - d.pos.x, top.desc.pos.y - d.pos.y) > T.MOVED_PX;
    return { status, ranked, top, second: ranked[1], moved };
  }

  // Resolve a free-text label ("login button") against visible controls.
  function resolveByText(text, { role = null, candidates = null } = {}) {
    const pool = candidates || C.interactives();
    const out = pool.map((el) => {
      const d = C.describe(el);
      let s = C.textSim(text, textOf(d));
      if (role && d.role === role) s += 0.1;
      return { el, desc: d, score: Math.min(1, s) };
    }).sort((a, b) => b.score - a.score);
    const top = out[0], second = out[1];
    let status = !top || top.score < 0.5 ? 'none' : 'ok';
    if (status === 'ok' && second && second.score >= 0.45 && top.score - second.score < 0.08) status = 'ambiguous';
    return { status, ranked: out, top, second };
  }

  // Find the visible control that reveals a hidden element (hamburger, disclosure, dropdown).
  function findToggler(el) {
    const doc = root.document;
    for (let cur = el.parentElement; cur && cur !== doc.body; cur = cur.parentElement) {
      if (cur.id) {
        const t = doc.querySelector('[aria-controls~="' + cur.id.replace(/["\\]/g, '\\$&') + '"]');
        if (t && C.isVisible(t)) return t;
      }
    }
    const cands = C.interactives().filter((b) => b.getAttribute('aria-expanded') === 'false' || b.getAttribute('aria-haspopup') || /menu/i.test(C.accessibleName(b)));
    return cands[0] || null;
  }

  HF.matcher = { T, W, scoreOne, rank, judge, resolve, resolveByText, findToggler, textOf };
  if (typeof module !== 'undefined') module.exports = HF.matcher;
})(typeof window !== 'undefined' ? window : globalThis);
