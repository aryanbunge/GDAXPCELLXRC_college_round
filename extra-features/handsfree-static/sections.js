// Neo sections below the wireframe face: scroll cue, tilt/glare cards, chat, quick access.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = $('#neo'); if (!root) return;
  const still = true; // static build: no animation
  const smooth = still ? 'auto' : 'smooth';

  // ---- smooth scroll down from the face ----
  const cue = $('#cue');
  if (cue) cue.addEventListener('click', (e) => { e.preventDefault(); root.scrollIntoView({ behavior: smooth, block: 'start' }); });

  // ---- reveal on scroll ----
  const rv = $$('.rv', root);
  if (still || !('IntersectionObserver' in window)) rv.forEach((e) => e.classList.add('in'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.1 });
    rv.forEach((e) => io.observe(e));
  }

  // ---- toast ----
  const toastEl = $('#xtoast'); let tt;
  const toast = (t) => { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('on'), 2200); };

  // ---- tilt + glare: follows the mouse, or the head cursor when hand control is running ----
  const head = document.getElementById('cursor');
  const mouse = { x: -1e4, y: -1e4 };
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4; });
  const pointer = () => {
    if (head && head.style.display !== 'none') { const r = head.getBoundingClientRect(); if (r.width && (r.left || r.top)) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    return mouse;
  };
  const cards = $$('.gx', root).map((el) => ({ el, rx: 0, ry: 0, sc: 1, gx: 50, gy: 0, sh: 50, hot: false, max: el.classList.contains('sm') ? 13 : 7 }));
  const lerp = (a, b, k) => a + (b - a) * k;
  function loop() {
    const p = pointer();
    for (const c of cards) {
      const r = c.el.getBoundingClientRect();
      if (r.bottom < -60 || r.top > innerHeight + 60 || !r.width) continue;
      const inside = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      let trx = 0, tr = 0, tsc = 1;
      if (inside) {
        const px = (p.x - r.left) / r.width, py = (p.y - r.top) / r.height;
        trx = (0.5 - py) * 2 * c.max; tr = (px - 0.5) * 2 * c.max; tsc = c.max > 8 ? 1.04 : 1.012;
        c.gx = lerp(c.gx, px * 100, 0.35); c.gy = lerp(c.gy, py * 100, 0.35); c.sh = lerp(c.sh, px * 100, 0.2);
      }
      c.rx = lerp(c.rx, trx, 0.14); c.ry = lerp(c.ry, tr, 0.14); c.sc = lerp(c.sc, tsc, 0.14);
      const s = c.el.style;
      s.setProperty('--rx', c.rx.toFixed(2) + 'deg'); s.setProperty('--ry', c.ry.toFixed(2) + 'deg'); s.setProperty('--sc', c.sc.toFixed(3));
      if (inside) { s.setProperty('--gx', c.gx.toFixed(1) + '%'); s.setProperty('--gy', c.gy.toFixed(1) + '%'); s.setProperty('--sh', c.sh.toFixed(1) + '%'); }
      if (inside !== c.hot) { c.hot = inside; c.el.classList.toggle('hot', inside); }
    }
    requestAnimationFrame(loop);
  }
  if (!still) requestAnimationFrame(loop);

  // ---- live device status ----
  const camTxt = $('#xCam'), camLed = $('#xCamLed');
  setInterval(() => {
    const st = window.__hf && window.__hf.state && window.__hf.state(), f = st && st.lastFrame;
    const on = !!f && performance.now() - f.t < 1500 && (f.state === 'tracking' || f.state === 'holding');
    camTxt.textContent = on ? 'Tracking \u00b7 face locked' : f && performance.now() - f.t < 1500 ? 'Camera on \u00b7 looking for you' : 'Camera is off';
    camLed.classList.toggle('on', on);
  }, 500);
  (async () => {
    const t = $('#xMic'), led = $('#xMicLed');
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      const paint = () => { const g = p.state === 'granted'; t.textContent = g ? 'Ready \u00b7 say \u201cNeo\u201d' : 'Allow access to enable'; led.classList.toggle('on', g); };
      paint(); p.onchange = paint;
    } catch (_) {}
  })();

  // ---- buttons ----
  const go = (v) => window.__hf && window.__hf.show(v);
  $('#xStart').onclick = () => go('permissions');
  $('#xRecal').onclick = () => go('diagnostics');
  const openUrl = (u) => window.open(u, '_blank', 'noopener');
  const newTab = () => { if (globalThis.chrome && chrome.tabs) chrome.tabs.create({}); else openUrl('about:blank'); };
  const sc = (dy) => window.scrollBy({ top: dy, behavior: smooth });
  const ACT = {
    back: () => history.back(), fwd: () => history.forward(),
    up: () => sc(-innerHeight * 0.7), down: () => sc(innerHeight * 0.7),
    next: () => {
      const f = $$('a[href],button:not(:disabled),input,select,textarea,[tabindex]:not([tabindex="-1"])').filter((e) => e.offsetParent !== null);
      const i = f.indexOf(document.activeElement); const n = f[(i + 1) % f.length]; if (n) { n.focus(); toast('Focus moved'); }
    },
    act: () => { const a = document.activeElement; if (a && a !== document.body) a.click(); else toast('Nothing focused yet'); },
    click: () => toast('Point with your head, then say \u201cNeo, click\u201d'),
    open: () => openUrl('https://www.wikipedia.org'), newtab: newTab,
    vol: () => toast('Needs the Neo desktop app'), bri: () => toast('Needs the Neo desktop app'),
    desk: () => toast('Needs the Neo desktop app'), pause: () => toast('Say \u201cpause\u201d on any website'),
  };
  $$('[data-act]', root).forEach((b) => b.addEventListener('click', () => ACT[b.dataset.act] && ACT[b.dataset.act]()));

  // ---- conversation ----
  const log = $('#xLog'), inp = $('#xIn'), heard = $('#xHeard');
  const hhmm = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  function add(who, text, stamp) {
    const row = document.createElement('div'); row.className = 'cm' + (who === 'me' ? ' me' : '');
    row.innerHTML = '<b></b><div class="bub"><div class="mt"><span></span><time></time></div><p></p></div>';
    $('b', row).textContent = who === 'me' ? 'Y' : 'N'; $('.mt span', row).textContent = who === 'me' ? 'You' : 'Neo';
    $('time', row).textContent = stamp || hhmm(); $('p', row).textContent = text;
    log.appendChild(row); log.scrollTop = log.scrollHeight;
  }
  function seed() {
    log.innerHTML = '';
    const h = new Date().getHours();
    add('neo', 'Good to have you here. Tell me what you need, and I\u2019ll take it from there.', 'now');
    add('neo', h < 12 ? 'Good morning!' : h < 17 ? 'Good afternoon!' : 'Good evening!');
    add('neo', 'I am Neo, how may I help you?');
  }
  function act(c) {
    switch (c.intent) {
      case 'scrolldown': sc(innerHeight * 0.7); return 'Scrolling down.';
      case 'scrollup': sc(-innerHeight * 0.7); return 'Scrolling up.';
      case 'top': scrollTo({ top: 0, behavior: smooth }); return 'Back to the top.';
      case 'bottom': scrollTo({ top: document.body.scrollHeight, behavior: smooth }); return 'Down to the bottom.';
      case 'back': setTimeout(() => history.back(), 400); return 'Going back.';
      case 'forward': setTimeout(() => history.forward(), 400); return 'Going forward.';
      case 'newtab': newTab(); return 'Opening a new tab.';
      case 'search': openUrl('https://www.google.com/search?q=' + encodeURIComponent(c.arg)); return 'Searching for \u201c' + c.arg + '\u201d.';
      case 'goto': { const q = c.arg.replace(/\s+/g, ''); openUrl(q.includes('.') ? 'https://' + q : /^\w+$/.test(c.arg) ? 'https://www.' + q + '.com' : 'https://www.google.com/search?q=' + encodeURIComponent(c.arg)); return 'Opening ' + c.arg + '.'; }
      case 'calibrate': go('diagnostics'); return 'Opening the camera test.';
      default: return '\u201c' + c.intent + '\u201d works on any website once hand control is running.';
    }
  }
  function run(text) {
    text = String(text || '').trim(); if (!text) return;
    add('me', text); heard.textContent = 'Heard: \u201c' + text + '\u201d';
    const n = (window.HF ? HF.norm(text) : text.toLowerCase()).replace(/^neo /, '');
    let reply = null;
    if (/\b(time|clock)\b/.test(n)) reply = 'It is ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
    else if (/^(hi|hello|hey)$/.test(n)) reply = 'Hello. What would you like to do?';
    else { const c = window.HF && HF.parse(n); if (c) reply = act(c); }
    setTimeout(() => add('neo', reply || 'I did not catch a command. Try \u201cscroll down\u201d, \u201cgo back\u201d or \u201csearch for cats\u201d.'), 350);
  }
  $('#xSend').onclick = () => { run(inp.value); inp.value = ''; inp.focus(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#xSend').click(); });
  $('#xClear').onclick = () => { log.innerHTML = ''; };
  $$('[data-chip]', root).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.chip;
    if (k === 'search') { inp.value = 'search for '; inp.focus(); }
    else if (k === 'time') run('what time is it');
    else { inp.focus(); toast('Dictation: on any website say \u201ctype\u201d, then speak'); }
  }));
  seed();
})();
