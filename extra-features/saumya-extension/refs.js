// "See What I Mean": resolve "this / that / the second one / the field above this" to page elements
// using the user's fixation point (head/gaze/cursor), page structure, and short-term discourse memory.
(function (root) {
  'use strict';
  const HF = (root.HF = root.HF || {});
  const C = HF.core, M = HF.matcher;
  const doc = root.document;

  // ---------- attention (fixation from pointer history) ----------
  const Attn = {
    buf: [],
    sample(x, y, t) {
      t = t || Date.now();
      this.buf.push({ x, y, t });
      while (this.buf.length && t - this.buf[0].t > 2000) this.buf.shift();
    },
    // Weighted mean of recent, slow samples up to time `at` (default: now).
    // Using the time the user STARTED speaking avoids the cursor drifting while speech is recognised.
    fixation(at) {
      const b = this.buf.filter((s) => at == null || s.t <= at);
      if (!b.length) return null;
      const now = b[b.length - 1].t;
      let sw = 0, sx = 0, sy = 0;
      for (let i = 0; i < b.length; i++) {
        const s = b[i];
        let speed = 0;
        if (i > 0) { const p = b[i - 1]; speed = (Math.hypot(s.x - p.x, s.y - p.y) / Math.max(1, s.t - p.t)) * 1000; }
        const w = Math.exp(-(now - s.t) / 500) / (1 + speed / 200);
        sw += w; sx += w * s.x; sy += w * s.y;
      }
      return { x: sx / sw, y: sy / sw };
    },
  };
  if (doc) {
    doc.addEventListener('mousemove', (e) => Attn.sample(e.clientX, e.clientY), { passive: true, capture: true });
    root.addEventListener('hf:pointer', (e) => e.detail && Attn.sample(e.detail.x, e.detail.y, e.detail.t));
  }

  const Memory = { last: null, group: null };

  // ---------- parsing ----------
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1, next: 'next', previous: 'prev', prior: 'prev' };
  const DEICTIC = new Set(['this', 'that', 'these', 'those', 'here', 'there', 'it']);
  const DETS = new Set([...DEICTIC, 'the', 'a', 'an', 'my', 'me']);
  const NOUN_WORDS = {
    menu: ['menu', 'dropdown', 'drop-down', 'nav', 'navigation', 'navbar', 'hamburger'],
    field: ['field', 'input', 'box', 'textbox', 'blank', 'entry', 'textarea'],
    button: ['button', 'btn'],
    link: ['link', 'url', 'anchor'],
    form: ['form'],
    table: ['table'],
    list: ['list'],
    image: ['image', 'picture', 'photo', 'img'],
    tab: ['tab'],
    page: ['page'],
    section: ['section', 'part', 'area', 'block', 'region', 'panel', 'portion', 'paragraph', 'text', 'article', 'card'],
    item: ['one', 'item', 'option', 'result', 'row'],
  };
  const FILLER = new Set(['of', 'on', 'in', 'to', 'please', 'for', 'at', 'up', 'out', 'and']);
  const VERBS = [
    ['summarize', /^\s*(?:please\s+)?(?:summari[sz]e|sum\s+up|tl;?dr|give\s+me\s+(?:a\s+)?summary\s+of|explain|what(?:'s|\s+is|\s+does)|tell\s+me\s+about)\s+/i],
    ['read', /^\s*(?:please\s+)?read(?:\s+out(?:\s+loud)?|\s+aloud)?\s+/i],
    ['fill', /^\s*(?:please\s+)?(?:fill(?:\s+in|\s+out)?|complete|auto-?fill)\s+/i],
    ['open', /^\s*(?:please\s+)?(?:open|click(?:\s+on)?|press|tap|select|choose|expand|go\s+to|hit|activate|toggle)\s+/i],
    ['focus', /^\s*(?:please\s+)?(?:focus(?:\s+on)?|jump\s+to|scroll\s+to|show\s+me|take\s+me\s+to)\s+/i],
  ];
  const REL = [
    [/\b(?:above|over|before)\b/, 'above'],
    [/\b(?:below|under|underneath|beneath|after)\b/, 'below'],
    [/\bleft\s+of\b/, 'left'],
    [/\bright\s+of\b/, 'right'],
    [/\b(?:next\s+to|beside|near|close\s+to)\b/, 'near'],
  ];

  function parsePhrase(p) {
    const toks = String(p).toLowerCase().replace(/[^a-z0-9#' -]+/g, ' ').split(/\s+/).filter(Boolean);
    const out = { det: null, ordinal: null, noun: null, label: [] };
    const rest = [];
    for (let k = 0; k < toks.length; k++) {
      const w = toks[k];
      if (DETS.has(w) && !out.det) { out.det = w; continue; }
      if (w === 'number' && /^\d+$/.test(toks[k + 1] || '')) { out.ordinal = parseInt(toks[k + 1], 10); k++; continue; }
      const m = /^#?(\d+)(?:st|nd|rd|th)?$/.exec(w);
      if (m && out.ordinal == null) { out.ordinal = parseInt(m[1], 10); continue; }
      if (ORD[w] !== undefined && out.ordinal == null) { out.ordinal = ORD[w]; continue; }
      rest.push(w);
    }
    for (let k = 0; k < rest.length && !out.noun; k++) {
      for (const n of Object.keys(NOUN_WORDS)) {
        if (NOUN_WORDS[n].includes(rest[k])) { out.noun = n; rest.splice(k, 1); break; }
      }
    }
    out.label = rest.filter((w) => !FILLER.has(w));
    return out;
  }

  function parse(raw) {
    let s = ' ' + String(raw).trim().replace(/[?!.,;]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    const out = { raw, verb: null, value: null, det: null, ordinal: null, noun: null, label: [], rel: null, anchor: null, named: false };
    const m = /^\s*(?:please\s+)?(?:type|enter|input)\s+(.+?)\s+(?:in|into|inside|on|to)\s+(.+?)\s*$/i.exec(s);
    if (m) { out.verb = 'type'; out.value = m[1].replace(/^["“']|["”']$/g, ''); s = ' ' + m[2] + ' '; }
    else {
      for (const [v, re] of VERBS) { const mm = re.exec(s); if (mm) { out.verb = v; s = ' ' + s.slice(mm[0].length) + ' '; break; } }
    }
    if (!out.verb) return out;
    if (out.verb === 'fill') s = s.replace(/\s+(?:in|out|up)\s*$/i, ' ');
    let relIdx = -1, relType = null, relLen = 0;
    for (const [re, t] of REL) {
      const mm = re.exec(s);
      if (mm && (relIdx < 0 || mm.index < relIdx)) { relIdx = mm.index; relType = t; relLen = mm[0].length; }
    }
    let head = s, anchorS = null;
    if (relIdx >= 0) { head = s.slice(0, relIdx); anchorS = s.slice(relIdx + relLen); out.rel = relType; }
    Object.assign(out, parsePhrase(head));
    out.anchor = out.rel ? (anchorS && anchorS.trim() ? parsePhrase(anchorS) : { det: 'this', ordinal: null, noun: null, label: [] }) : null;
    out.named = out.label.length > 0 && !DEICTIC.has(out.det) && out.ordinal == null && !out.rel;
    return out;
  }

  // ---------- geometry ----------
  const rect = (el) => C.env.rectOf(el);
  const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
  const distTo = (r, p) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
  const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);
  const nested = (a, b) => a.contains(b) || b.contains(a);

  function dirCost(dir, A, c) {
    const cxA = (A.left + A.right) / 2, cyA = (A.top + A.bottom) / 2, cx = (c.left + c.right) / 2, cy = (c.top + c.bottom) / 2;
    const ovX = Math.min(A.right, c.right) - Math.max(A.left, c.left);
    const ovY = Math.min(A.bottom, c.bottom) - Math.max(A.top, c.top);
    const latX = ovX > 0 ? 0 : Math.min(Math.abs(c.left - A.right), Math.abs(A.left - c.right));
    const latY = ovY > 0 ? 0 : Math.min(Math.abs(c.top - A.bottom), Math.abs(A.top - c.bottom));
    switch (dir) {
      case 'above': return c.bottom > A.top + 6 ? null : A.top - c.bottom + 2 * latX + 0.2 * Math.abs(cx - cxA);
      case 'below': return c.top < A.bottom - 6 ? null : c.top - A.bottom + 2 * latX + 0.2 * Math.abs(cx - cxA);
      case 'left': return c.right > A.left + 6 ? null : A.left - c.right + 2 * latY + 0.2 * Math.abs(cy - cyA);
      case 'right': return c.left < A.right - 6 ? null : c.left - A.right + 2 * latY + 0.2 * Math.abs(cy - cyA);
      default: return Math.hypot(cx - cxA, cy - cyA);
    }
  }

  // ---------- pools ----------
  const Q = {
    field: 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=checkbox]):not([type=radio]),select,textarea,[contenteditable=true],[role=textbox],[role=combobox]',
    button: 'button,[role=button],input[type=submit],input[type=button]',
    link: 'a[href],[role=link]',
    menu: 'nav,[role=menu],[role=menubar],[role=navigation],[aria-haspopup],button[aria-expanded],summary,[class*=menu],[id*=menu]',
    form: 'form,[role=form]',
    table: 'table,[role=table]',
    list: 'ul,ol,[role=list],[role=listbox]',
    image: 'img,[role=img],picture',
    tab: '[role=tab]',
    section: 'section,article,aside,main,header,footer,fieldset,form,table,figure,details,[role=region],[role=article],div,p,li,ul,ol,blockquote',
  };
  const textLen = (el) => C.collapse(el.innerText !== undefined ? el.innerText : el.textContent).length;
  const isToggle = (el) => el.getAttribute('aria-expanded') === 'false' || !!el.getAttribute('aria-haspopup') || el.tagName === 'SUMMARY';

  function poolFor(noun) {
    if (!noun || noun === 'item') return null;
    if (noun === 'page') return [doc.querySelector('main') || doc.body];
    if (noun === 'section') return C.query(Q.section).filter((e) => textLen(e) >= 40);
    return C.query(Q[noun]);
  }

  function siblingGroups() {
    const groups = [], parents = new Set();
    C.query('li,article,tr,div,section,a,button').slice(0, 1500).forEach((e) => { if (e.parentElement) parents.add(e.parentElement); });
    parents.forEach((p) => {
      const sig = new Map();
      Array.from(p.children).forEach((ch) => {
        if (C.isOurs(ch) || !C.isVisible(ch)) return;
        const key = ch.tagName + '.' + (ch.className || '');
        if (!sig.has(key)) sig.set(key, []);
        sig.get(key).push(ch);
      });
      sig.forEach((g) => { if (g.length >= 2 && g.every((x) => C.collapse(x.textContent).length > 1)) groups.push(g); });
    });
    return groups;
  }
  function groupByContainer(items) {
    const m = new Map();
    items.forEach((e) => {
      const k = e.closest('form,fieldset,ul,ol,table,nav,[role=list],[role=menu],section,main') || doc.body;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    });
    return Array.from(m.values());
  }
  function bbox(els) {
    const rs = els.map(rect);
    const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function pickGroup(groups, fix) {
    const vp = C.env.vw() * C.env.vh();
    let best = null, bs = -1;
    groups.forEach((g) => {
      const b = bbox(g);
      const s = Math.exp(-distTo(b, fix) / 150) * (1 / (1 + area(b) / vp)) * (1 + 0.05 * Math.min(g.length, 8));
      if (s > bs) { bs = s; best = g; }
    });
    return best;
  }
  const sortVisual = (arr) => arr.slice().sort((a, b) => { const ra = rect(a), rb = rect(b); return Math.round(ra.top / 10) - Math.round(rb.top / 10) || ra.left - rb.left; });

  // ---------- element / region under attention ----------
  function atomAt(fix) {
    const els = C.env.pointEls(fix.x, fix.y).filter((e) => !C.isOurs(e) && e !== doc.documentElement && e !== doc.body);
    return els[0] || null;
  }
  function anchorAt(fix) {
    const atom = atomAt(fix);
    if (atom) {
      const inter = atom.closest(C.INTERACTIVE);
      if (inter && !C.isOurs(inter)) return inter;
    }
    let best = null, bd = 50;
    C.interactives().forEach((e) => { const d = distTo(rect(e), fix); if (d < bd) { bd = d; best = e; } });
    return best || atom;
  }
  const BLOCKISH = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'LI', 'UL', 'OL', 'TABLE', 'FORM', 'FIELDSET', 'MAIN', 'BLOCKQUOTE', 'DETAILS', 'FIGURE']);
  function regionAt(fix, minChars = 140) {
    let el = atomAt(fix);
    while (el && el !== doc.body && el !== doc.documentElement) {
      if (BLOCKISH.has(el.tagName) && textLen(el) >= minChars && !C.isOurs(el)) return el;
      el = el.parentElement;
    }
    return doc.querySelector('main') || doc.body;
  }
  function fieldRegionAt(fix) {
    const start = atomAt(fix) || anchorAt(fix);
    for (let cur = start; cur && cur !== doc.body; cur = cur.parentElement) {
      if (cur.tagName === 'FORM' || (cur.querySelectorAll && cur.querySelectorAll(Q.field).length >= 2)) return cur;
    }
    return (start && start.closest && start.closest('form')) || null;
  }

  // ---------- resolution ----------
  function proxScore(el, fix, verb) {
    const r = rect(el), vp = C.env.vw() * C.env.vh();
    let s = Math.exp(-distTo(r, fix) / 200);
    const a = area(r);
    if (a > 0.35 * vp) s *= 0.5;
    if (a > 0.7 * vp) s *= 0.5;
    if (verb === 'open' && isToggle(el)) s *= 1.4;
    if (el.matches && el.matches(C.INTERACTIVE)) s *= 1.2;
    return s;
  }
  function simpleAnchor(a, fix) {
    if (a.det === 'it' && Memory.last && Memory.last.isConnected) return Memory.last;
    if (a.noun && a.noun !== 'item') {
      const p = poolFor(a.noun) || [];
      return p.map((e) => ({ e, s: proxScore(e, fix) })).sort((x, y) => y.s - x.s).map((x) => x.e)[0] || null;
    }
    return anchorAt(fix);
  }
  function finish(cands) {
    cands = cands.filter((c) => c.score > 0.02).sort((a, b) => b.score - a.score).slice(0, 4);
    if (!cands.length) return { status: 'none', el: null, candidates: [] };
    let status = 'ok';
    if (cands[1] && cands[1].score / cands[0].score > 0.85 && !nested(cands[0].el, cands[1].el)) status = 'ambiguous';
    return { status, el: cands[0].el, candidates: cands };
  }

  function resolve(ref, opts = {}) {
    const fix = opts.fix || Attn.fixation(opts.at) || { x: C.env.vw() / 2, y: C.env.vh() / 2 };
    const out = resolveInner(ref, fix);
    if (out.el) { Memory.last = out.el; }
    out.fix = fix;
    return out;
  }

  function resolveInner(ref, fix) {
    const verb = ref.verb;
    if (ref.det === 'it' && !ref.noun && Memory.last && Memory.last.isConnected) return { status: 'ok', el: Memory.last, candidates: [{ el: Memory.last, score: 1 }] };

    // region-level verbs: "summarize this", "fill this part in"
    const regional = (verb === 'summarize' || verb === 'read' || verb === 'fill') && !ref.rel && ref.ordinal == null && !ref.named;
    if (regional && (!ref.noun || ['section', 'page', 'form', 'item'].includes(ref.noun))) {
      let el = null;
      if (ref.noun === 'page') el = doc.querySelector('main') || doc.body;
      else if (verb === 'fill') el = ref.noun === 'form' ? (atomAt(fix) && atomAt(fix).closest('form')) || fieldRegionAt(fix) : fieldRegionAt(fix);
      else el = regionAt(fix);
      if (el) return { status: 'ok', el, candidates: [{ el, score: 1 }] };
    }

    if (ref.rel) {
      const anchor = simpleAnchor(ref.anchor || { det: 'this' }, fix);
      if (!anchor) return { status: 'none', el: null, candidates: [] };
      const A = rect(anchor);
      const base = ref.noun && ref.noun !== 'item' ? poolFor(ref.noun) : C.interactives();
      const cands = [];
      (base || []).forEach((el) => {
        if (el === anchor || nested(el, anchor)) return;
        const cost = dirCost(ref.rel, A, rect(el));
        if (cost != null) cands.push({ el, score: Math.exp(-cost / 250) });
      });
      return finish(cands);
    }

    if (ref.ordinal != null) {
      const group = ref.noun && ref.noun !== 'item' ? pickGroup(groupByContainer(poolFor(ref.noun) || []), fix) : pickGroup(siblingGroups(), fix);
      if (!group || !group.length) return { status: 'none', el: null, candidates: [] };
      const ordered = sortVisual(group);
      let idx;
      if (ref.ordinal === 'next' || ref.ordinal === 'prev') {
        const cur = Memory.last, i = cur ? ordered.findIndex((e) => e === cur || e.contains(cur) || cur.contains(e)) : -1;
        idx = i < 0 ? 0 : i + (ref.ordinal === 'next' ? 1 : -1);
      } else idx = ref.ordinal === -1 ? ordered.length - 1 : ref.ordinal - 1;
      const el = ordered[idx];
      Memory.group = ordered;
      return el ? { status: 'ok', el, candidates: [{ el, score: 1 }], group: ordered } : { status: 'none', el: null, candidates: [] };
    }

    if (ref.named) {
      const base = ref.noun && ref.noun !== 'item' ? poolFor(ref.noun) || C.interactives() : C.interactives();
      const r = M.resolveByText(ref.label.join(' '), { candidates: base });
      return finish(r.ranked.filter((x) => x.score > 0.4).slice(0, 5).map((x) => ({ el: x.el, score: x.score })));
    }

    // deictic / nearest-of-kind
    const base = ref.noun && ref.noun !== 'item' ? poolFor(ref.noun) : null;
    if (!base) {
      const a = anchorAt(fix);
      return a ? { status: 'ok', el: a, candidates: [{ el: a, score: 1 }] } : { status: 'none', el: null, candidates: [] };
    }
    return finish(base.map((el) => ({ el, score: proxScore(el, fix, verb) })));
  }

  HF.refs = { Attn, Memory, parse, resolve, regionAt, fieldRegionAt, atomAt, anchorAt, rect, Q, poolFor, siblingGroups };
  if (typeof module !== 'undefined') module.exports = HF.refs;
})(typeof window !== 'undefined' ? window : globalThis);
