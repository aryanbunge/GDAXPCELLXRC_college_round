(() => {
  if (window.__hf) return;
  window.__hf = true;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let settings = { dwellMs: 900, cursorSize: 34, gain: 1, dwellOn: true };
  const RADIUS = 28, COOLDOWN = 700;

  class OneEuro {
    constructor(minCutoff = 0.8, beta = 4) { this.mc = minCutoff; this.beta = beta; this.reset(); }
    reset() { this.x = null; this.dx = 0; this.t = 0; }
    a(c, dt) { return 1 / (1 + 1 / (2 * Math.PI * c) / dt); }
    filter(v, t) {
      if (this.x === null) { this.x = v; this.t = t; return v; }
      const dt = Math.max((t - this.t) / 1000, 1e-3);
      this.dx += this.a(1, dt) * ((v - this.x) / dt - this.dx);
      this.x += this.a(this.mc + this.beta * Math.abs(this.dx), dt) * (v - this.x);
      this.t = t;
      return this.x;
    }
  }
  const fx = new OneEuro(), fy = new OneEuro();

  let cal = null, raw = null, rawT = 0, paused = false, lost = true, dwellOn = true;
  let pos = { x: innerWidth / 2, y: innerHeight / 2 };
  let anchor = null, start = 0, cooldownUntil = 0;
  let dictating = false, labels = null, targets = [];

  // ---------- cursor ----------
  const root = document.documentElement;
  const cur = document.createElement('div');
  cur.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;pointer-events:none;z-index:2147483647;display:none;border:3px solid #fff;outline:3px solid #0b0b0f;';
  root.appendChild(cur);

  // ---------- storage ----------
  const applySettings = () => {
    dwellOn = settings.dwellOn !== false;
    const s = settings.cursorSize;
    cur.style.width = cur.style.height = s + 'px';
    cur.style.margin = `${-s / 2}px 0 0 ${-s / 2}px`;
  };
  chrome.storage.local.get(['cal', 'settings'], (d) => {
    if (d.cal) cal = d.cal;
    if (d.settings) settings = { ...settings, ...d.settings };
    applySettings();
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.cal) cal = c.cal.newValue;
    if (c.settings) { settings = { ...settings, ...c.settings.newValue }; applySettings(); }
  });

  // ---------- status tile (closed shadow root so page CSS cannot touch it) ----------
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647;pointer-events:none;display:none';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = '<style>.tile{display:flex;align-items:center;gap:12px;padding:11px 18px 11px 15px;background:linear-gradient(160deg,rgba(255,255,255,.30),rgba(255,255,255,.10)),rgba(30,36,80,.45);color:#fff;border:1px solid rgba(255,255,255,.32);border-radius:22px;box-shadow:0 14px 36px rgba(5,8,30,.45),inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(255,255,255,.1);-webkit-backdrop-filter:blur(30px) saturate(190%);backdrop-filter:blur(30px) saturate(190%);font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;max-width:300px}.sw{width:12px;height:12px;flex:none;border-radius:50%;box-shadow:0 0 12px 2px rgba(255,255,255,.4)}.t{font-weight:600;font-size:15px}.d{font-size:12.5px;font-weight:400;margin-top:1px;color:rgba(235,235,245,.72)}</style><div class="tile"><div class="sw" id="sw"></div><div class="tx"><div class="t" id="t"></div><div class="d" id="d"></div></div></div>';
  root.appendChild(host);
  const ST = {
    tracking: ['Tracking', '#2EE59D', 'Cursor follows your head'],
    paused: ['Paused', '#FFD60A', 'Say "resume"'],
    facelost: ['Face lost', '#FF5A3C', 'Cursor frozen, clicks off'],
    dictating: ['Dictating', '#9AA9FF', 'Say "stop" to end'],
  };
  let hudKey = 'tracking', toastTimer;
  function refreshHud() {
    hudKey = lost ? 'facelost' : paused ? 'paused' : dictating ? 'dictating' : 'tracking';
    const [t, c, d] = ST[hudKey];
    sh.getElementById('t').textContent = t;
    sh.getElementById('sw').style.background = c;
    sh.getElementById('d').textContent = d;
    host.style.display = 'block';
  }
  const toast = (text) => {
    refreshHud();
    sh.getElementById('d').textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(refreshHud, 2000);
  };

  // ---------- click / dwell ----------
  function clickEl(el) { if (!el) return; el.focus && el.focus(); el.click && el.click(); }
  function clickAt(x, y) {
    cur.style.backgroundColor = 'rgba(46,229,157,.7)';
    setTimeout(() => (cur.style.backgroundColor = ''), 200);
    clickEl(document.elementFromPoint(x, y));
  }

  function onPos(m) {
    const wasLost = lost;
    raw = { x: m.x, y: m.y }; rawT = performance.now(); lost = false;
    if (wasLost) refreshHud();
    if (paused) return;
    let nx, ny;
    if (cal) { nx = cal.ax * m.x + cal.bx; ny = cal.ay * m.y + cal.by; }
    else { nx = (m.x - 0.5) * 3.5 + 0.5; ny = (m.y - 0.5) * 3.5 + 0.5; }
    nx = 0.5 + (nx - 0.5) * settings.gain; ny = 0.5 + (ny - 0.5) * settings.gain;
    const t = performance.now();
    nx = clamp(fx.filter(clamp(nx, 0, 1), t), 0, 1);
    ny = clamp(fy.filter(clamp(ny, 0, 1), t), 0, 1);
    pos = { x: nx * innerWidth, y: ny * innerHeight };
    cur.style.display = 'block'; cur.style.opacity = 1;
    cur.style.transform = `translate(${pos.x}px,${pos.y}px)`;
    if (!dwellOn || dictating) { cur.style.backgroundImage = ''; return; }
    if (!anchor || Math.hypot(pos.x - anchor.x, pos.y - anchor.y) > RADIUS) { anchor = { ...pos }; start = t; }
    let p = 0;
    if (t < cooldownUntil) start = t; else p = (t - start) / settings.dwellMs;
    if (p >= 1) { clickAt(pos.x, pos.y); cooldownUntil = t + COOLDOWN; p = 0; }
    cur.style.backgroundImage = `conic-gradient(rgba(42,68,245,.7) ${p * 360}deg, transparent 0deg)`;
  }

  // ---------- calibration ----------
  // Gentle version: five poses (centre, left, right, up, down). You only move as far as is comfortable;
  // your own range is stretched across the whole screen. Say "skip" to skip a pose, "stop" or press Esc to cancel.
  let calAbort = false, calSkip = false, calQuick = false;
  async function calibrate() {
    paused = true; cur.style.display = 'none'; calAbort = false; calSkip = false; calQuick = false;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:#05060f;z-index:2147483647;color:#fff;font:600 24px/1.3 system-ui,sans-serif;text-align:center;padding:28px 24px 0';
    const ttl = document.createElement('div'); ov.appendChild(ttl);
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:44px;height:44px;margin:-22px;border-radius:50%;background:#fff;box-shadow:0 0 0 8px rgba(10,132,255,.5),0 0 0 14px rgba(10,132,255,.22),0 0 50px 12px rgba(100,210,255,.55)';
    ov.appendChild(dot);
    const bar = document.createElement('div'); bar.style.cssText = 'position:absolute;right:24px;bottom:24px;display:flex;gap:10px';
    const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'min-height:48px;padding:0 20px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.16);color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer'; b.onclick = fn; bar.appendChild(b); };
    mk('Skip this dot', () => { calSkip = true; }); mk('Quick setup', () => { calQuick = true; }); mk('Cancel', () => { calAbort = true; });
    ov.appendChild(bar); root.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') calAbort = true; };
    addEventListener('keydown', onKey, true);
    const done = (msg) => { removeEventListener('keydown', onKey, true); ov.remove(); paused = false; refreshHud(); if (msg) toast(msg); };
    const POSES = [[.5, .5, 'Relax and look at the middle dot. Hold still.'], [.12, .5, 'Gently turn your head toward the left dot. Only as far as is comfortable.'], [.88, .5, 'Now gently toward the right dot. Only as far as is comfortable.'], [.5, .25, 'Now tilt your head up a little. Only as far as is comfortable.'], [.5, .75, 'Now tilt your head down a little. Only as far as is comfortable.']];
    const S = [];
    const stop = (i) => calAbort || calSkip || (calQuick && i > 0);
    const wait = async (ms, i) => { const end = performance.now() + ms; while (performance.now() < end && !stop(i)) await sleep(50); };
    for (let i = 0; i < POSES.length; i++) {
      const [tx, ty, text] = POSES[i];
      if (calAbort) return done('Calibration cancelled');
      if (calQuick && i > 0) break;
      ttl.textContent = text; dot.style.left = tx * 100 + '%'; dot.style.top = ty * 100 + '%'; calSkip = false;
      for (;;) {
        await wait(1800, i); if (calAbort) return done('Calibration cancelled'); if (stop(i)) break;
        const buf = []; const end = performance.now() + 1500;
        while (performance.now() < end && !stop(i)) { if (raw && performance.now() - rawT < 200) buf.push({ ...raw }); await sleep(33); }
        if (calAbort) return done('Calibration cancelled'); if (stop(i)) break;
        if (buf.length < 5) { ttl.textContent = 'We lost your face. Look toward the camera.'; await sleep(1500); ttl.textContent = text; continue; }
        S.push({ i, rx: avg(buf.map((b) => b.x)), ry: avg(buf.map((b) => b.y)), tx, ty });
        break;
      }
    }
    if (!S.length) return done('Face not detected. Try again.');
    const c = S[0];
    const slope = (rk, tk) => {
      const P = S.filter((s) => s.i !== 0 && s[tk] !== .5);
      if (!P.length) return 3.5;
      let n = 0, d = 0;
      for (const s of P) { n += (s[rk] - c[rk]) * (s[tk] - .5); d += (s[rk] - c[rk]) ** 2; }
      if (d < 2e-5) return 6;
      return n > 0 ? Math.min(n / d, 18) : NaN;
    };
    const ax = slope('rx', 'tx'), ay = slope('ry', 'ty');
    if (![ax, ay].every(isFinite)) return done('That did not work. Say "calibrate" to try again.');
    cal = { ax, bx: .5 - ax * c.rx, ay, by: .5 - ay * c.ry };
    chrome.storage.local.set({ cal });
    fx.reset(); fy.reset();
    done('Calibrated');
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  function recenter() {
    if (!cal || !raw) return;
    cal.bx += 0.5 - (cal.ax * raw.x + cal.bx);
    cal.by += 0.5 - (cal.ay * raw.y + cal.by);
    fx.reset(); fy.reset(); toast('Recentered');
  }

  // ---------- numbered labels ----------
  function showNumbers() {
    hideNumbers();
    const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[onclick],[tabindex]:not([tabindex="-1"])';
    targets = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(e).visibility !== 'hidden';
    }).slice(0, 99);
    labels = document.createElement('div');
    labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    targets.forEach((e, i) => {
      const r = e.getBoundingClientRect(), s = document.createElement('span');
      s.textContent = i + 1;
      s.style.cssText = `position:absolute;left:${Math.max(r.left, 0)}px;top:${Math.max(r.top, 0)}px;background:#ffd60a;color:#0b0b0f;font:800 13px/1 system-ui,sans-serif;padding:3px 5px;border:2px solid #0b0b0f`;
      labels.appendChild(s);
    });
    root.appendChild(labels);
  }
  function hideNumbers() { labels && labels.remove(); labels = null; targets = []; }

  // ---------- voice ----------
  const W = { one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
  const num = (w) => parseInt(w, 10) || W[w] || 0;
  const bg = (action, arg) => chrome.runtime.sendMessage({ from: 'content', action, arg });
  const scroll = (dy) => { window.scrollBy({ top: dy, behavior: 'smooth' }); if (labels) setTimeout(showNumbers, 500); };
  function insert(text) {
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))) document.execCommand('insertText', false, text);
    else toast('Focus a text field first');
  }
  function onVoice(text, alts) {
    if (dictating) {
      if (/^stop( dictation| typing)?$/.test(HF.norm(text))) { dictating = false; refreshHud(); return toast('Dictation off'); }
      return insert(text.trim() + ' ');
    }
    const r = HF.parseAny(alts && alts.length ? alts : [text]);
    if (!r) return toast('Not a command: "' + HF.norm(text) + '"');
    toast('Heard: "' + r.heard + '"');
    const under = () => document.elementFromPoint(pos.x, pos.y);
    switch (r.intent) {
      case 'clicknum': if (labels && targets[r.arg - 1]) { clickEl(targets[r.arg - 1]); hideNumbers(); } else toast('Say "show numbers" first'); return;
      case 'click': return clickAt(pos.x, pos.y);
      case 'dblclick': { const el = under(); if (el) { clickEl(el); el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: pos.x, clientY: pos.y })); } return; }
      case 'rightclick': { const el = under(); if (el) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pos.x, clientY: pos.y, button: 2 })); return; }
      case 'shownum': return showNumbers();
      case 'hidenum': return hideNumbers();
      case 'scrolldown': return scroll(innerHeight * 0.7);
      case 'scrollup': return scroll(-innerHeight * 0.7);
      case 'top': return scroll(-1e6);
      case 'bottom': return scroll(1e6);
      case 'back': return history.back();
      case 'forward': return history.forward();
      case 'refresh': return location.reload();
      case 'newtab': return bg('newtab');
      case 'closetab': return bg('closetab');
      case 'nexttab': return bg('nexttab');
      case 'prevtab': return bg('prevtab');
      case 'goto': {
        const q = r.arg.replace(/\s+/g, '');
        return bg('goto', q.includes('.') ? 'https://' + q : /^\w+$/.test(r.arg) ? `https://www.${q}.com` : 'https://www.google.com/search?q=' + encodeURIComponent(r.arg));
      }
      case 'search': return bg('goto', 'https://www.google.com/search?q=' + encodeURIComponent(r.arg));
      case 'typetext': return insert(r.arg + ' ');
      case 'type': dictating = true; return refreshHud();
      case 'calibrate': return calibrate();
      case 'skip': calSkip = true; return;
      case 'stop': calAbort = true; return;
      case 'recenter': return recenter();
      case 'pause': paused = true; cur.style.opacity = 0.3; return refreshHud();
      case 'resume': paused = false; return refreshHud();
      case 'dwelloff': dwellOn = false; cur.style.backgroundImage = ''; return toast('Dwell off');
      case 'dwellon': dwellOn = true; return toast('Dwell on');
    }
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'pos') onPos(m);
    else if (m.type === 'noface') { if (!lost) { lost = true; anchor = null; cur.style.opacity = 0.3; refreshHud(); } }
    else if (m.type === 'voice') onVoice(m.text, m.alts);
    else if (m.type === 'status') toast(m.text);
    else if (m.type === 'calibrate') calibrate();
  });
})();
