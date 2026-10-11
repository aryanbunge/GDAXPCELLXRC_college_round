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
    const fresh = !!f && performance.now() - f.t < 1500;
    const face = fresh && (f.state === 'tracking' || f.state === 'holding');
    const trackerCamera = !!(window.NeoHeadTracking && window.NeoHeadTracking.cameraOn());
    const devices = window.NeoDeviceState || {};
    if (trackerCamera) {
      camTxt.textContent = face
        ? (window.NeoHeadTracking.isActive() ? 'Head control active \u00b7 face locked' : 'Head setup \u00b7 face locked')
        : 'Head camera on \u00b7 looking for you';
    } else if (devices.camera && devices.handControl) camTxt.textContent = 'Hand tracking active';
    else camTxt.textContent = 'Camera is off';
    camLed.classList.toggle('on', trackerCamera || !!devices.camera);
  }, 500);

  // ---- buttons ----
  const sc = (dy) => window.scrollBy({ top: dy, behavior: smooth });
  const sendToNeo = (text) => {
    if (!text) return;
    if (window.eel && typeof eel.getUserInput === 'function') {
      eel.getUserInput(text);
      heard.textContent = 'Sent to Neo: ' + text;
    } else toast('Neo desktop backend is not connected.');
  };
  const ACT = {
    back: () => sendToNeo('go back'), fwd: () => sendToNeo('go forward'),
    up: () => sendToNeo('scroll up'), down: () => sendToNeo('scroll down'),
    next: () => sendToNeo('next control'), act: () => sendToNeo('select'),
    click: () => sendToNeo('click'),
    newtab: () => sendToNeo('new tab'), vol: () => sendToNeo('volume up'),
    bri: () => sendToNeo('brightness down'), desk: () => sendToNeo('show desktop'),
    pause: () => sendToNeo('pause voice control'),
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
  function run(text) {
    text = String(text || '').trim(); if (!text) return;
    sendToNeo(text);
  }
  $('#xSend').onclick = () => { run(inp.value); inp.value = ''; inp.focus(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#xSend').click(); });
  $('#xClear').onclick = () => { log.innerHTML = ''; };
  $$('[data-chip]', root).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.chip;
    if (k === 'search') { inp.value = 'search for '; inp.focus(); }
    else if (k === 'time') run('what time is it');
    else run('start dictation');
  }));
  function addUserMsg(text) { add('me', String(text || '')); }
  function addAppMsg(text) { add('neo', String(text || '')); }
  function updateStatus(message, state) {
    const heardLabel = $('#xHeard'); if (heardLabel) heardLabel.textContent = message;
    const mic = $('#xMic');
    if (mic && state) mic.textContent = state === 'dictating' ? 'Active · dictation listening' : state === 'processing' ? 'Active · processing command' : state === 'speaking' ? 'Active · Neo is speaking' : 'Active · waiting for “Neo”';
  }
  function updateDevices(microphone, camera, handControl) {
    const mic = $('#xMic'), cam = $('#xCam'), micLed = $('#xMicLed'), camLed = $('#xCamLed');
    window.NeoDeviceState = { microphone: !!microphone, camera: !!camera, handControl: !!handControl };
    if (mic) mic.textContent = microphone ? 'Active · waiting for “Neo”' : 'Microphone is off';
    if (cam) cam.textContent = !camera ? 'Camera is off' : handControl ? 'Hand tracking active' : 'Head tracking active';
    if (micLed) micLed.classList.toggle('on', !!microphone);
    if (camLed) camLed.classList.toggle('on', !!camera);
    const startButton = $('#xStart');
    if (startButton) {
      const label = camera && !handControl ? 'Stop head control' : handControl ? 'Switch to head control' : 'Start head control';
      startButton.setAttribute('aria-label', label);
      const textNode = [...startButton.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = ' ' + label;
    }
  }
  const clear = () => { log.replaceChildren(); };
  $('#xClear').onclick = clear;
  if (window.eel && typeof eel.expose === 'function') {
    eel.expose(addUserMsg);
    eel.expose(addAppMsg);
    eel.expose(updateStatus);
    eel.expose(updateDevices);
  }
  $('#xStart').onclick = () => {
    const running = window.NeoHeadTracking && (
      window.NeoHeadTracking.isRunning() || window.NeoHeadTracking.cameraOn()
    );
    sendToNeo(running ? 'stop head tracking' : 'start head tracking');
  };
  $('#xRecal').onclick = () => window.NeoHeadTracking ? window.NeoHeadTracking.recalibrate() : sendToNeo('recalibrate head tracking');
  add('neo', 'Neo is connected to the desktop assistant backend. Send a command to get started.', 'now');
})();
