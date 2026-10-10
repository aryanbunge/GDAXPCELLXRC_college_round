// Floating panel (shadow DOM): command bar, log, cards, approval/disambiguation prompts, element highlights.
(function (root) {
  'use strict';
  const HF = (root.HF = root.HF || {});
  const doc = root.document;

  let host, sh, $ = {}, pending = null, raf = 0;
  const hl = new Map(); // key -> [{el, node, opts}]
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, to: 2, too: 2, for: 4, won: 1 };
  const YES = /^(yes|yeah|yep|yup|approve|approved|confirm|ok|okay|go ahead|do it|correct|right|run|proceed|continue|sure)\b/i;
  const NO = /^(no|nope|nah|cancel|stop|reject|deny|denied|abort|don'?t)\b/i;
  const SKIP = /^skip\b/i;

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .ov{position:fixed;inset:0;pointer-events:none;z-index:1}
  .hl{position:fixed;border:3px solid #6366f1;border-radius:8px;background:rgba(99,102,241,.12);box-shadow:0 0 0 2px rgba(255,255,255,.7);transition:all .08s}
  .hl.best{border-color:#22c55e;background:rgba(34,197,94,.14)}
  .hl.warn{border-color:#f59e0b;background:rgba(245,158,11,.14)}
  .hl.act{border-color:#ef4444;background:rgba(239,68,68,.12)}
  .hl.region{border-style:dashed}
  .tag{position:absolute;left:-3px;top:-26px;background:#111827;color:#fff;font-size:12px;padding:3px 8px;border-radius:6px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
  .num{position:absolute;right:-10px;top:-10px;width:24px;height:24px;border-radius:50%;background:#111827;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
  .panel{position:fixed;right:16px;bottom:16px;width:360px;max-height:70vh;background:#0f172a;color:#e5e7eb;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;z-index:2;font-size:13px}
  .panel.min .body,.panel.min .foot{display:none}
  .head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1e293b;cursor:default}
  .head b{flex:1;font-size:13px}
  .dot{width:9px;height:9px;border-radius:50%;background:#64748b}.dot.on{background:#22c55e;box-shadow:0 0 8px #22c55e}
  .body{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
  .status{color:#93c5fd;font-size:12px;min-height:16px}
  .log div{padding:2px 0;line-height:1.35;color:#cbd5e1}.log .you{color:#fff}.log .err{color:#fca5a5}.log .ok{color:#86efac}
  .card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px}
  .card h4{margin:0 0 6px;font-size:13px;color:#fff}.card p{margin:0 0 6px;line-height:1.4;white-space:pre-wrap}
  .card ol,.card ul{margin:0 0 6px;padding-left:18px}.card li{margin:2px 0}
  .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:7px 11px;background:#334155;color:#fff}
  button.pri{background:#22c55e;color:#052e16;font-weight:600}button.dng{background:#ef4444}button:hover{filter:brightness(1.12)}
  .foot{display:flex;gap:6px;padding:8px 10px;background:#111827}
  .foot input{flex:1;background:#1f2937;border:1px solid #374151;color:#fff;border-radius:8px;padding:8px;font-size:13px;outline:none}
  .hint{font-size:11px;color:#94a3b8}`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function init() {
    if (host) return;
    host = doc.createElement('div');
    host.id = '__hf_host';
    host.setAttribute('data-hf-ignore', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${CSS}</style><div class="ov"></div>
      <div class="panel" style="pointer-events:auto">
        <div class="head"><span class="dot" id="dot"></span><b>Handsfree Agent</b><button id="mic" title="Toggle voice">🎤</button><button id="min">–</button></div>
        <div class="body"><div class="status" id="status">Ready. Type or say a command.</div><div id="cards"></div><div class="log" id="log"></div>
          <div class="hint">Try: “teach download the syllabus” · “run download the syllabus” · “summarize this” · “the field above this” · or any goal.</div></div>
        <div class="foot"><input id="inp" placeholder="Command or goal…  (Alt+H)" /><button id="go" class="pri">Go</button></div>
      </div>`;
    doc.documentElement.appendChild(host);
    ['dot', 'mic', 'min', 'status', 'cards', 'log', 'inp', 'go'].forEach((id) => { $[id] = sh.getElementById(id); });
    $.panel = sh.querySelector('.panel'); $.ov = sh.querySelector('.ov');
    const send = () => { const v = $.inp.value.trim(); if (v) { $.inp.value = ''; ui.log(v, 'you'); ui.onCommand && ui.onCommand(v); } };
    $.go.onclick = send;
    $.inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); }, true);
    $.inp.addEventListener('keyup', (e) => e.stopPropagation(), true);
    $.min.onclick = () => $.panel.classList.toggle('min');
    $.mic.onclick = () => ui.onMic && ui.onMic();
  }

  function esc2(s) { return esc(s); }

  function log(msg, kind) {
    init();
    const d = doc.createElement('div'); d.className = kind || ''; d.textContent = msg;
    $.log.appendChild(d);
    while ($.log.children.length > 8) $.log.removeChild($.log.firstChild);
    $.log.scrollTop = $.log.scrollHeight;
  }
  function status(msg) { init(); $.status.textContent = msg; }
  function setMic(on) { init(); $.dot.classList.toggle('on', !!on); }

  // card: {title, body (text), lines: [..], ordered, actions: [{label, kind, onClick}]}
  function card(id, c) {
    init();
    dropCard(id);
    const el = doc.createElement('div'); el.className = 'card'; el.dataset.id = id;
    let html = `<h4>${esc2(c.title || '')}</h4>`;
    if (c.body) html += `<p>${esc2(c.body)}</p>`;
    if (c.lines && c.lines.length) html += `<${c.ordered ? 'ol' : 'ul'}>${c.lines.map((l) => `<li>${esc2(l)}</li>`).join('')}</${c.ordered ? 'ol' : 'ul'}>`;
    if (c.hint) html += `<div class="hint">${esc2(c.hint)}</div>`;
    html += '<div class="acts"></div>';
    el.innerHTML = html;
    const acts = el.querySelector('.acts');
    (c.actions || []).forEach((a) => {
      const b = doc.createElement('button'); b.textContent = a.label;
      if (a.kind) b.className = a.kind;
      b.onclick = () => a.onClick && a.onClick();
      acts.appendChild(b);
    });
    if (!(c.actions || []).length) acts.remove();
    $.cards.prepend(el);
    return el;
  }
  function dropCard(id) { init(); const o = $.cards.querySelector(`[data-id="${id}"]`); if (o) o.remove(); }

  // Prompt with buttons AND voice. choices: [{label, value, kind, match: RegExp}] ; candidateCount adds "number N" voice.
  function ask({ id = 'ask', title, body, lines, ordered, choices, candidateCount = 0, hint }) {
    init();
    return new Promise((resolve) => {
      const done = (value) => { pending = null; dropCard(id); resolve(value); };
      pending = { choices, candidateCount, done };
      card(id, { title, body, lines, ordered, hint, actions: choices.map((c) => ({ label: c.label, kind: c.kind, onClick: () => done(c.value) })) });
    });
  }
  function pendingAsk() { return !!pending; }
  function cancelAsk(value) { if (pending) pending.done(value); }

  // Voice/text answers to the active prompt. Returns true if consumed.
  function answer(text) {
    if (!pending) return false;
    const t = String(text).trim().toLowerCase().replace(/[.!?,]/g, '');
    const m = /^(?:number|option|choice|pick|select|item|#)?\s*(\d|one|two|three|four|five|six|to|too|for|won)\b/.exec(t);
    if (m && pending.candidateCount) {
      const n = /^\d$/.test(m[1]) ? +m[1] : NUM[m[1]];
      if (n >= 1 && n <= pending.candidateCount) { pending.done('n:' + n); return true; }
    }
    for (const c of pending.choices) {
      const rx = c.match || (c.kind === 'pri' ? YES : c.kind === 'dng' ? NO : c.value === 'skip' ? SKIP : null);
      if (rx && rx.test(t)) { pending.done(c.value); return true; }
    }
    return false;
  }

  // ---------- highlights ----------
  function highlight(el, opts = {}) {
    init();
    const key = opts.key || 'default';
    const node = doc.createElement('div');
    node.className = 'hl ' + (opts.tone || '') + (opts.region ? ' region' : '');
    node.innerHTML = (opts.label ? `<span class="tag">${esc2(opts.label)}</span>` : '') + (opts.num ? `<span class="num">${opts.num}</span>` : '');
    $.ov.appendChild(node);
    if (!hl.has(key)) hl.set(key, []);
    hl.get(key).push({ el, node });
    place();
    loop();
  }
  function clearHighlights(key) {
    const keys = key ? [key] : Array.from(hl.keys());
    keys.forEach((k) => { (hl.get(k) || []).forEach((h) => h.node.remove()); hl.delete(k); });
  }
  function place() {
    hl.forEach((arr) => arr.forEach((h) => {
      if (!h.el.isConnected) { h.node.style.display = 'none'; return; }
      const r = h.el.getBoundingClientRect();
      Object.assign(h.node.style, { display: 'block', left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
    }));
  }
  function loop() {
    if (raf) return;
    const tick = () => { place(); raf = hl.size ? requestAnimationFrame(tick) : 0; };
    raf = requestAnimationFrame(tick);
  }

  function toggle() { init(); $.panel.classList.toggle('min'); if (!$.panel.classList.contains('min')) $.inp.focus(); }
  function speak(t) { try { root.speechSynthesis.cancel(); root.speechSynthesis.speak(new root.SpeechSynthesisUtterance(t)); } catch (e) { /* ignore */ } }
  const focusInput = () => { init(); $.panel.classList.remove('min'); $.inp.focus(); };

  const ui = { init, log, status, setMic, card, dropCard, ask, answer, pendingAsk, cancelAsk, highlight, clearHighlights, toggle, speak, focusInput, onCommand: null, onMic: null, YES, NO };
  HF.ui = ui;
})(typeof window !== 'undefined' ? window : globalThis);
