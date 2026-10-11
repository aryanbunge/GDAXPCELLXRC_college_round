// Shared helpers: text semantics, visibility, descriptors. Attaches to window.HF.core.
(function (root) {
  'use strict';
  const HF = (root.HF = root.HF || {});
  const doc = () => root.document;

  // ---------- semantic tokens ----------
  const STOP = new Set('the a an to of and or for in on at by with your our my this that is are be from click button link here now please page it as'.split(' '));
  const GROUPS = [
    ['download', 'save', 'fetch', 'export'],
    ['syllabus', 'curriculum', 'syllabi'],
    ['academics', 'programs', 'courses', 'studies'],
    ['admissions', 'apply', 'enroll', 'enrollment', 'registration'],
    ['contact', 'touch', 'enquiry', 'inquiry'],
    ['department', 'dept', 'faculty'],
    ['login', 'signin'],
    ['search', 'find', 'lookup'],
    ['menu', 'navigation', 'nav', 'hamburger', 'drawer'],
    ['cart', 'basket', 'bag'],
    ['shortlist', 'wishlist', 'favourites', 'favorites', 'bookmark'],
    ['email', 'mail'],
    ['phone', 'mobile', 'telephone', 'tel', 'cell'],
    ['address', 'location'],
    ['resources', 'documents', 'materials', 'files'],
    ['submit', 'send'],
    ['name', 'fullname'],
  ];
  function stem(w) {
    w = w.toLowerCase();
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    return w;
  }
  const CANON = new Map();
  GROUPS.forEach((g) => { const c = stem(g[0]); g.forEach((w) => CANON.set(stem(w), c)); });

  function semTokens(s) {
    if (!s) return [];
    const out = [], seen = new Set();
    String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').forEach((w) => {
      if (!w || STOP.has(w) || (w.length < 2 && !/\d/.test(w))) return;
      let t = stem(w); t = CANON.get(t) || t;
      if (!seen.has(t)) { seen.add(t); out.push(t); }
    });
    return out;
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function tri(s) { s = ' ' + norm(s) + ' '; const set = new Set(); for (let i = 0; i < s.length - 2; i++) set.add(s.substr(i, 3)); return set; }
  function charSim(a, b) {
    if (!a || !b) return 0;
    const A = tri(a), B = tri(b); if (!A.size || !B.size) return 0;
    let n = 0; A.forEach((x) => { if (B.has(x)) n++; });
    return n / (A.size + B.size - n);
  }
  function dice(A, B) {
    if (!A.length || !B.length) return 0;
    const S = new Set(B); let n = 0; A.forEach((x) => { if (S.has(x)) n++; });
    return (2 * n) / (A.length + B.length);
  }
  function textSim(a, b) {
    if (!a || !b) return 0;
    return 0.7 * dice(semTokens(a), semTokens(b)) + 0.3 * charSim(a, b);
  }

  // ---------- env (overridable in tests) ----------
  const env = {
    rectOf: (el) => el.getBoundingClientRect(),
    pointEls: (x, y) => (doc().elementsFromPoint ? doc().elementsFromPoint(x, y) : []),
    vw: () => root.innerWidth || 1280,
    vh: () => root.innerHeight || 800,
    scroll: () => ({ x: root.scrollX || 0, y: root.scrollY || 0 }),
  };

  const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const attrEsc = (s) => String(s).replace(/["\\]/g, '\\$&');

  const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=switch],[role=option],[onclick],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';

  function isOurs(el) { return !!(el && el.closest && el.closest('[data-hf-ignore],#__hf_host')); }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      if (cur.hidden) return false;
      const cs = root.getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    if (root.getComputedStyle(el).opacity === '0') return false;
    const r = env.rectOf(el);
    return r.width > 0 && r.height > 0;
  }

  function query(sel, { hidden = false } = {}) {
    return Array.from(doc().querySelectorAll(sel)).filter((el) => !isOurs(el) && (hidden || isVisible(el)));
  }
  const interactives = (opts) => query(INTERACTIVE, opts);

  // ---------- naming ----------
  function labelText(el) {
    let t = '';
    if (el.labels && el.labels.length) t = Array.from(el.labels).map((l) => l.textContent).join(' ');
    else if (el.id) { const l = doc().querySelector('label[for="' + attrEsc(el.id) + '"]'); if (l) t = l.textContent; }
    if (!t && el.closest) { const l = el.closest('label'); if (l) t = l.textContent; }
    return clip(collapse(t), 80);
  }
  function ownText(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') { const t = (el.type || '').toLowerCase(); return ['submit', 'button', 'reset'].includes(t) ? el.value || '' : ''; }
    if (tag === 'select' || tag === 'textarea') return '';
    return clip(collapse(el.innerText !== undefined ? el.innerText : el.textContent), 100);
  }
  function accessibleName(el) {
    const aria = el.getAttribute('aria-label'); if (aria) return collapse(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => doc().getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' '); if (collapse(t)) return collapse(t); }
    const tag = el.tagName.toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) {
      return labelText(el) || ownText(el) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
    }
    const own = ownText(el);
    if (own) return own;
    const img = el.querySelector && el.querySelector('img[alt]'); if (img) return collapse(img.getAttribute('alt'));
    return el.getAttribute('title') || '';
  }
  function roleOf(el) {
    const r = el.getAttribute('role'); if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }
    return 'generic';
  }

  // ---------- context ----------
  const LANDMARK = 'nav,header,footer,main,aside,form,section,article,dialog,fieldset,table,ul,ol,[role=navigation],[role=menu],[role=dialog],[role=region],[role=list]';
  const HEAD = 'h1,h2,h3,h4,h5,h6,legend,caption,[role=heading]';
  function precedes(a, b) { return !!(a.compareDocumentPosition(b) & 4); }
  function headingFor(el) {
    let cur = el;
    for (let hops = 0; cur && cur !== doc().body && hops < 8; hops++) {
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.matches(HEAD)) return clip(collapse(sib.textContent), 60);
        const hs = sib.querySelectorAll ? sib.querySelectorAll(HEAD) : [];
        if (hs.length) return clip(collapse(hs[hs.length - 1].textContent), 60);
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
      if (cur && cur.matches && cur.matches('section,article,form,fieldset,aside,nav,li,[role=region]')) {
        const own = cur.querySelector(HEAD);
        if (own && !own.contains(el) && precedes(own, el)) return clip(collapse(own.textContent), 60);
      }
    }
    return '';
  }
  function contextOf(el) {
    const kinds = []; let label = '';
    for (let cur = el.parentElement, n = 0; cur && cur !== doc().body && n < 6; cur = cur.parentElement, n++) {
      if (cur.matches(LANDMARK)) {
        const k = cur.getAttribute('role') || cur.tagName.toLowerCase();
        if (!kinds.includes(k)) kinds.push(k);
        if (!label) label = cur.getAttribute('aria-label') || '';
      }
    }
    return { heading: headingFor(el), label: collapse(label), kinds };
  }
  function chainOf(el) {
    const out = [];
    for (let cur = el, n = 0; cur && cur !== doc().body && n < 5; cur = cur.parentElement, n++) out.push(cur.tagName.toLowerCase());
    return out;
  }
  function hrefTokens(el) {
    const h = el.getAttribute && el.getAttribute('href'); if (!h) return '';
    try { const u = new URL(h, root.location.href); return u.pathname.split('/').slice(-3).join(' ').replace(/[._-]+/g, ' '); } catch (e) { return h; }
  }

  function describe(el) {
    const r = env.rectOf(el), s = env.scroll();
    const href = el.getAttribute('href') || '';
    const tag = el.tagName.toLowerCase();
    return {
      tag,
      role: roleOf(el),
      type: (el.type || '').toLowerCase(),
      name: accessibleName(el),
      aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      placeholder: el.getAttribute('placeholder') || '',
      label: ['input', 'select', 'textarea'].includes(tag) ? labelText(el) : '',
      attr: [el.id, el.getAttribute('name'), el.getAttribute('data-testid'), hrefTokens(el)].filter(Boolean).join(' '),
      hasDownload: el.hasAttribute('download') || /\.(pdf|docx?|xlsx?|pptx?|zip|csv)(\?|#|$)/i.test(href),
      ctx: contextOf(el),
      chain: chainOf(el),
      pos: { x: Math.round(r.left + s.x + r.width / 2), y: Math.round(r.top + s.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) },
      page: root.location ? root.location.pathname : '',
    };
  }

  // ---------- misc ----------
  function waitReady(settleMs = 250, maxMs = 6000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let last = Date.now();
      const mo = new root.MutationObserver(() => { last = Date.now(); });
      mo.observe(doc().documentElement, { childList: true, subtree: true, attributes: true });
      (function tick() {
        const ready = doc().readyState === 'complete';
        if ((ready && Date.now() - last > settleMs) || Date.now() - t0 > maxMs) { mo.disconnect(); resolve(); } else setTimeout(tick, 60);
      })();
    });
  }

  function regionText(el, max = 6000) {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE']);
    const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'UL', 'OL', 'TR', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'FORM', 'BLOCKQUOTE', 'DT', 'DD']);
    let out = '';
    (function walk(n) {
      if (out.length > max) return;
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); return; }
      if (n.nodeType !== 1 || SKIP.has(n.tagName) || isOurs(n) || n.hidden) return;
      if (n.getAttribute('aria-hidden') === 'true') return;
      const cs = root.getComputedStyle(n); if (cs.display === 'none') return;
      const b = BLOCK.has(n.tagName);
      if (b) out += '\n';
      n.childNodes.forEach(walk);
      if (b) out += '\n';
    })(el);
    return out.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
  }

  HF.core = { semTokens, textSim, charSim, dice, norm, env, INTERACTIVE, isOurs, isVisible, query, interactives, accessibleName, roleOf, labelText, ownText, describe, contextOf, waitReady, regionText, collapse, clip, sleep, stem };
  if (typeof module !== 'undefined') module.exports = HF.core;
})(typeof window !== 'undefined' ? window : globalThis);
