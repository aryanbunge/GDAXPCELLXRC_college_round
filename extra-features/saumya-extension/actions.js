// Action primitives shared by Autopilot, See What I Mean and Intent Replay.
(function (root) {
  'use strict';
  const HF = (root.HF = root.HF || {});
  const C = HF.core;
  const doc = root.document;

  // ---------- risk ----------
  const HIGH = /\b(buy|purchase|pay|checkout|check out|place order|order now|submit|send|post|publish|delete|remove|cancel|confirm|subscribe|sign up|register|apply|book|transfer|donate|unsubscribe|withdraw)\b/i;
  function riskOf(el) {
    const txt = [C.accessibleName(el), el.getAttribute('value'), el.getAttribute('title'), el.getAttribute('href')].filter(Boolean).join(' ');
    const type = (el.type || '').toLowerCase();
    if (type === 'submit' || HIGH.test(txt)) return 'high';
    if (/\b(add to|shortlist|wishlist|bookmark|save|upload|follow)\b/i.test(txt)) return 'medium';
    return 'low';
  }
  const isSensitiveField = (el) => {
    const t = (el.type || '').toLowerCase(), ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return t === 'password' || /cc-|one-time-code|current-password|new-password/.test(ac) || /card|cvv|cvc|otp|password|passcode/i.test(C.accessibleName(el) + ' ' + (el.name || ''));
  };

  // ---------- low-level interaction ----------
  function setValue(el, val) {
    const tag = el.tagName;
    if (tag === 'SELECT') {
      const want = String(val).toLowerCase();
      let best = null, bs = 0;
      Array.from(el.options).forEach((o) => {
        const s = Math.max(C.textSim(o.text, val), o.value.toLowerCase() === want ? 1 : 0, o.text.toLowerCase() === want ? 1 : 0);
        if (s > bs) { bs = s; best = o; }
      });
      if (!best || bs < 0.4) return false;
      el.value = best.value;
    } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const proto = tag === 'INPUT' ? root.HTMLInputElement.prototype : root.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, val);
    } else if (el.isContentEditable) el.textContent = val;
    else return false;
    el.dispatchEvent(new root.Event('input', { bubbles: true }));
    el.dispatchEvent(new root.Event('change', { bubbles: true }));
    return true;
  }
  function clickEl(el) {
    if (el.tagName === 'A' && el.target === '_blank') el.removeAttribute('target');
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    el.click();
  }
  function pressKey(el, key) {
    const opt = { key, code: key, bubbles: true, cancelable: true };
    el.dispatchEvent(new root.KeyboardEvent('keydown', opt));
    el.dispatchEvent(new root.KeyboardEvent('keyup', opt));
    if (key === 'Enter' && el.form && el.tagName === 'INPUT') { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
  }

  // ---------- summarize ----------
  const SW = new Set('the a an and or but if then of to in on at by for with from as is are was were be been it its this that these those i you he she they we not no yes do does did has have had can could will would should may might about into over under also than so such there their our your his her my'.split(' '));
  function extractiveSummary(text, n = 3) {
    const sents = text.replace(/\n+/g, '. ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 25);
    if (sents.length <= n) return sents.join(' ') || text.slice(0, 300);
    const freq = {};
    sents.forEach((s) => s.toLowerCase().match(/[a-z]{3,}/g)?.forEach((w) => { if (!SW.has(w)) freq[w] = (freq[w] || 0) + 1; }));
    const scored = sents.map((s, i) => {
      const ws = (s.toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !SW.has(w));
      const sc = ws.reduce((a, w) => a + freq[w], 0) / Math.sqrt(ws.length || 1) * (i === 0 ? 1.3 : 1);
      return { s, i, sc };
    });
    return scored.sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
  }

  // ---------- fill ----------
  function parseProfile(str) {
    const p = {};
    String(str || '').split(/\n+/).forEach((l) => { const m = /^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/.exec(l); if (m) p[m[1].toLowerCase()] = m[2]; });
    return p;
  }
  const AUTOCOMPLETE = { name: 'name', 'given-name': 'first name', 'family-name': 'last name', email: 'email', tel: 'phone', 'street-address': 'address', 'address-line1': 'address', 'postal-code': 'pincode', city: 'city', 'address-level2': 'city', organization: 'college' };
  function valueFor(el, profile) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    const label = C.accessibleName(el) + ' ' + (el.name || '') + ' ' + (el.id || '');
    let best = null, bs = 0;
    const keys = Object.keys(profile);
    const hints = [AUTOCOMPLETE[ac], type === 'email' ? 'email' : null, type === 'tel' ? 'phone' : null].filter(Boolean);
    keys.forEach((k) => {
      let s = C.textSim(label, k);
      if (hints.some((h) => C.textSim(h, k) > 0.7)) s = Math.max(s, 0.9);
      if (s > bs) { bs = s; best = k; }
    });
    return bs >= 0.45 ? { key: best, value: profile[best] } : null;
  }
  function fillRegion(region, profile) {
    const fields = Array.from(region.matches && region.matches(HF.refs.Q.field) ? [region] : region.querySelectorAll(HF.refs.Q.field)).filter((f) => C.isVisible(f) && !f.disabled && !f.readOnly);
    const filled = [], missing = [], skipped = [];
    fields.forEach((f) => {
      const name = C.clip(C.accessibleName(f) || f.name || f.id || 'field', 40);
      if (isSensitiveField(f)) { skipped.push(name); return; }
      if (f.value && f.tagName !== 'SELECT') { skipped.push(name + ' (already filled)'); return; }
      const v = valueFor(f, profile);
      if (v && setValue(f, v.value)) filled.push({ el: f, name, value: v.value });
      else missing.push(name);
    });
    return { filled, missing, skipped };
  }

  // ---------- observe / act (Autopilot) ----------
  const ObsMap = new Map();
  const valueOfEl = (el) => (isSensitiveField(el) ? '' : C.clip(String(el.value || ''), 40));
  function observe() {
    const vh = C.env.vh();
    const items = C.interactives().map((el) => ({ el, r: C.env.rectOf(el) }));
    const inV = items.filter((x) => x.r.bottom > 0 && x.r.top < vh), out = items.filter((x) => !(x.r.bottom > 0 && x.r.top < vh));
    ObsMap.clear();
    const elements = inV.concat(out).slice(0, 120).map((x, i) => {
      const id = i + 1; ObsMap.set(id, x.el);
      const d = C.describe(x.el);
      const href = x.el.getAttribute('href');
      return {
        id, role: d.role, name: C.clip(d.name || d.placeholder || d.attr, 80), type: d.type || undefined,
        value: ['textbox', 'combobox'].includes(d.role) ? valueOfEl(x.el) : undefined,
        href: href ? C.clip(href, 70) : undefined, disabled: x.el.disabled || undefined,
        checked: x.el.checked || undefined, risk: riskOf(x.el), inView: x.r.bottom > 0 && x.r.top < vh, ctx: C.clip(d.ctx.heading, 40) || undefined,
      };
    });
    const main = doc.querySelector('main') || doc.body;
    const se = doc.scrollingElement || doc.documentElement;
    return { url: root.location.href, title: doc.title, elements, text: C.clip(C.regionText(main, 4000), 3500), scrollY: Math.round(se.scrollTop), scrollMax: Math.round(se.scrollHeight - se.clientHeight) };
  }

  function act(m) {
    const el = m.id != null ? ObsMap.get(m.id) : null;
    if (['click', 'type', 'select', 'press'].includes(m.op) && (!el || !el.isConnected)) return { ok: false, error: 'Element id is stale; the page changed. Observe again.' };
    switch (m.op) {
      case 'click':
        el.scrollIntoView({ block: 'center' });
        HF.ui && HF.ui.highlight(el, { label: 'click', key: 'act', tone: 'act' });
        setTimeout(() => { HF.ui && HF.ui.clearHighlights('act'); clickEl(el); }, 140);
        return { ok: true };
      case 'type':
        if (isSensitiveField(el)) return { ok: false, error: 'Refusing to type into a password/payment field. Use ask_user.' };
        el.scrollIntoView({ block: 'center' });
        if (!setValue(el, m.text || '')) return { ok: false, error: 'Element is not a text field.' };
        if (m.submit) setTimeout(() => pressKey(el, 'Enter'), 120);
        return { ok: true };
      case 'select': return setValue(el, m.value || m.text || '') ? { ok: true } : { ok: false, error: 'No matching option.' };
      case 'press': pressKey(el, m.key || 'Enter'); return { ok: true };
      case 'scroll': root.scrollBy({ top: (m.direction === 'up' ? -1 : 1) * root.innerHeight * 0.8, behavior: 'instant' }); return { ok: true };
      default: return { ok: false, error: 'Unknown op ' + m.op };
    }
  }
  const elementById = (id) => ObsMap.get(id) || null;

  HF.actions = { riskOf, isSensitiveField, setValue, clickEl, pressKey, extractiveSummary, parseProfile, fillRegion, observe, act, elementById };
  if (typeof module !== 'undefined') module.exports = HF.actions;
})(typeof window !== 'undefined' ? window : globalThis);
