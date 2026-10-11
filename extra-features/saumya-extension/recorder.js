// Intent Replay, teaching side: capture a demonstration as semantic steps (+ optional narration).
(function (root) {
  'use strict';
  const HF = (root.HF = root.HF || {});
  const C = HF.core;
  const doc = root.document;

  const R = { active: false, pending: '', lastTyped: new WeakMap(), onStep: null };

  function intentOf(step) {
    const d = step.desc, nm = C.clip(d.name || d.placeholder || d.attr || d.tag, 50);
    const where = d.ctx.kinds.find((k) => ['navigation', 'nav', 'header', 'footer', 'form', 'aside', 'dialog', 'table'].includes(k));
    const loc = where ? ` (${d.role} in ${where})` : ` (${d.role})`;
    switch (step.type) {
      case 'type': return `Type ${step.masked ? '••••' : '"' + C.clip(step.value, 30) + '"'} into "${nm}"`;
      case 'select': return `Choose "${C.clip(step.value, 30)}" in "${nm}"`;
      case 'press': return `Press ${step.key} in "${nm}"`;
      default: return `Click "${nm}"${loc}`;
    }
  }
  function emit(step) {
    step.desc.alts = undefined;
    step.url = root.location.href;
    if (R.pending) { step.hint = R.pending; R.pending = ''; }
    step.intent = intentOf(step);
    step.t = Date.now();
    HF.bg && HF.bg('hf:recordStep', { step }).then((r) => R.onStep && R.onStep(step, r && r.n));
  }
  const closestInter = (t) => (t && t.closest ? t.closest(C.INTERACTIVE) : null);
  const isTextual = (el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !['submit', 'button', 'checkbox', 'radio', 'reset'].includes((el.type || '').toLowerCase());

  function flushTyping(el) {
    if (!isTextual(el) || el.tagName === 'SELECT') return;
    if (R.lastTyped.get(el) === el.value || el.value === '') return;
    R.lastTyped.set(el, el.value);
    const sensitive = HF.actions.isSensitiveField(el);
    emit({ type: 'type', desc: C.describe(el), value: sensitive ? '' : el.value, masked: sensitive });
  }

  doc.addEventListener('click', (e) => {
    if (!R.active || !e.isTrusted) return;
    const el = closestInter(e.target);
    if (!el || C.isOurs(el) || isTextual(el) || el.tagName === 'SELECT') return;
    emit({ type: 'click', desc: C.describe(el) });
  }, true);
  doc.addEventListener('change', (e) => {
    if (!R.active || !e.isTrusted) return;
    const el = e.target;
    if (C.isOurs(el)) return;
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      emit({ type: 'select', desc: C.describe(el), value: o ? o.text : el.value });
    } else flushTyping(el);
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (!R.active || !e.isTrusted || e.key !== 'Enter' || C.isOurs(e.target)) return;
    const el = e.target;
    if (!el || !isTextual(el)) return;
    flushTyping(el);
    emit({ type: 'press', key: 'Enter', desc: C.describe(el) });
  }, true);

  HF.recorder = R;
  HF.recorder.intentOf = intentOf;
})(typeof window !== 'undefined' ? window : globalThis);
