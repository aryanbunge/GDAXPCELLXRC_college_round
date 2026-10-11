import { Voice, Level, speechMode, installLocalSpeech } from './voice.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hasChromeStorage = globalThis.chrome && chrome.storage && chrome.storage.local;
const localStore = {
  get: (keys) => {
    const out = {};
    for (const k of keys) {
      try { out[k] = JSON.parse(localStorage.getItem('hf_' + k)); }
      catch (_) { out[k] = null; }
    }
    return Promise.resolve(out);
  },
  set: (obj) => {
    for (const [k, v] of Object.entries(obj)) localStorage.setItem('hf_' + k, JSON.stringify(v));
    return Promise.resolve();
  },
};
const store = hasChromeStorage ? { get: (k) => new Promise((r) => chrome.storage.local.get(k, r)), set: (o) => new Promise((r) => chrome.storage.local.set(o, r)) } : localStore;

const STEPS = ['Welcome', 'Access', 'Check', 'Calibrate', 'Practice'];
const VIEW_STEP = { welcome: 0, permissions: 1, check: 2, calibrate: 3, practice: 4, done: 5, settings: -1, diagnostics: -1 };
const DEF = { dwellMs: 900, cursorSize: 34, gain: 1, dwellOn: true, speechLocal: false };
let settings = { ...DEF }, cal = null;
let E = null, tracker = null, camStream = null, micStream = null, level = null;
let cur = 'welcome', engineOn = false, calAbort = false, lastFrame = null, raw = null, rawT = 0, lt = null;
let retryTarget = null;

// ---------- navigation ----------
function renderSteps() {
  const s = VIEW_STEP[cur];
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#steps').innerHTML = s < 0 ? '' : STEPS.map((_, i) => `<div class="sq ${i < s ? 'done' : i === s ? 'on' : ''}">${i + 1}</div>`).join('') + `<div class="sqlabel">System control <span>${now}</span></div>`;
}
function show(v) {
  if (cur === 'diagnostics' && v !== 'diagnostics') leaveDiagnostics();
  cur = v;
  $$('section[data-view]').forEach((el) => (el.hidden = el.dataset.view !== v));
  $('#calview').hidden = v !== 'calibrate';
  document.body.dataset.screen = v;
  $$('[data-jump]').forEach((el) => el.classList.toggle('active', el.dataset.jump === v));
  engineOn = !!tracker && ['practice', 'done', 'settings'].includes(v);
  if (!engineOn) { $('#cursor').style.display = 'none'; anchor = null; }
  renderSteps();
  const h = $(`[data-view="${v}"] h1`); if (h) h.focus();
  (onEnter[v] || (() => {}))();
}

// ---------- settings ----------
const CONFIG = [
  { key: 'dwellMs', label: 'Dwell time', sub: 'How long to hold still before a click', min: 500, max: 2000, step: 100, fmt: (v) => (v / 1000).toFixed(1) + ' s' },
  { key: 'gain', label: 'Sensitivity', sub: 'Higher means smaller head movements', min: 0.5, max: 2.5, step: 0.1, fmt: (v) => v.toFixed(1) + 'x' },
  { key: 'cursorSize', label: 'Cursor size', sub: 'Size of the on-screen cursor ring', min: 24, max: 80, step: 8, fmt: (v) => v + ' px' },
];
const saveSettings = () => store.set({ settings });
function renderSettings() {
  const box = $('#settingsList'); box.innerHTML = '';
  for (const c of CONFIG) {
    const row = document.createElement('div'); row.className = 'setting';
    row.innerHTML = `<div><div class="lbl">${c.label}</div><div class="sub">${c.sub}</div></div><div class="stepper"><button class="alt" aria-label="Decrease ${c.label}">\u2212</button><div class="val" aria-live="polite"></div><button class="alt" aria-label="Increase ${c.label}">+</button></div>`;
    const val = $('.val', row), [minus, plus] = $$('button', row);
    const paint = () => (val.textContent = c.fmt(settings[c.key]));
    const bump = (d) => { settings[c.key] = Math.round(clamp(settings[c.key] + d * c.step, c.min, c.max) * 100) / 100; paint(); saveSettings(); applyCursor(); };
    minus.onclick = () => bump(-1); plus.onclick = () => bump(1); paint(); box.appendChild(row);
  }
  const row = document.createElement('div'); row.className = 'setting';
  row.innerHTML = `<div><div class="lbl">Dwell clicking</div><div class="sub">Click by holding still on a target</div></div><button id="dwellToggle"></button>`;
  const tg = $('#dwellToggle', row), paint = () => { tg.textContent = settings.dwellOn ? 'On' : 'Off'; tg.setAttribute('role', 'switch'); tg.setAttribute('aria-checked', String(!!settings.dwellOn)); };
  tg.onclick = () => { settings.dwellOn = !settings.dwellOn; paint(); saveSettings(); };
  paint(); box.appendChild(row);
}

// ---------- engine loading (dynamic, so a missing file cannot break the whole page) ----------
async function getEngine() {
  if (E) return E;
  try { E = await import('./engine.js'); return E; }
  catch (e) { modelBox('Tracking files could not be loaded: ' + e.message + '. Reload the extension from chrome://extensions.', 0, false); return null; }
}
function modelBox(text, pct, retry) {
  for (const sel of ['#modelBox']) { const b = $(sel); if (b) b.hidden = false; }
  $('#modelStatus').textContent = text; $('#modelBar').style.width = Math.round((pct || 0) * 100) + '%';
  $('#modelRetry').hidden = !retry; $('#modelFileLbl').hidden = !retry;
  const dm = $('#dModel'); if (dm) dm.textContent = text;
}
const hideModelBox = () => { $('#modelBox').hidden = true; const dm = $('#dModel'); if (dm) dm.textContent = ''; };

function mediaErr(e, what) {
  if (e.name === 'NotAllowedError') return `${what} is blocked. Click the camera icon in the address bar, choose Allow, then try again.`;
  if (e.name === 'NotFoundError') return `No ${what.toLowerCase()} found. Plug one in and try again.`;
  if (e.name === 'NotReadableError') return `${what} is in use by another app. Close it and try again.`;
  return `${what} error: ${e.message}`;
}

async function startTracker() {
  const eng = await getEngine(); if (!eng) return false;
  if (!camStream || !camStream.active) {
    try { camStream = await eng.openCamera(); }
    catch (e) { modelBox(mediaErr(e, 'Camera'), 0, true); return false; }
  }
  if (!tracker) tracker = new eng.Tracker({ onFrame });
  if (!tracker.lm) {
    try { await tracker.init((s) => modelBox(s.text, s.pct, false)); }
    catch (e) { modelBox('Could not load the face model: ' + e.message + '. Connect to the internet once so it can download, or choose the model file yourself.', 0, true); return false; }
  }
  tracker.start(camStream); hideModelBox();
  return true;
}
function attach(el) { if (camStream && el.srcObject !== camStream) { el.srcObject = camStream; el.play().catch(() => {}); } }

// ---------- frames ----------
function onFrame(f) {
  lastFrame = f;
  if (f.state === 'tracking' || f.state === 'holding') { raw = f.raw; if (f.state === 'tracking') rawT = performance.now(); } else raw = null;
  if (f.state === 'error') { const m = $('#modelStatus'); if (m && cur === 'check') { $('#modelBox').hidden = false; m.textContent = 'Tracker error: ' + f.error; } }
  if (engineOn) { if (raw) moveCursor(raw); else { $('#cursor').style.opacity = 0.3; anchor = null; } }
  if (cur === 'check') drawOverlay($('#overlay'), f);
  if (cur === 'diagnostics') { drawOverlay($('#doverlay'), f); paintStats(f); if (lt) { lt.frames++; if (f.state === 'tracking') lt.hits++; } }
}
function drawOverlay(cv, f) {
  const x = cv.getContext('2d'), w = cv.width, h = cv.height; x.clearRect(0, 0, w, h);
  if (f.box && f.state !== 'lost') {
    x.lineWidth = 3; x.strokeStyle = f.state === 'tracking' ? '#2EE59D' : '#FFD60A';
    x.strokeRect(f.box.x0 * w, f.box.y0 * h, (f.box.x1 - f.box.x0) * w, (f.box.y1 - f.box.y0) * h);
    if (f.nose) { x.fillStyle = '#FFD60A'; x.beginPath(); x.arc(f.nose.x * w, f.nose.y * h, 5, 0, 7); x.fill(); }
  }
}

// ---------- permissions ----------
async function paintSpeech(tagSel = '#speechTag', noteSel = '#speechNote') {
  const m = await speechMode(), tag = $(tagSel), note = noteSel ? $(noteSel) : null;
  settings.speechLocal = m === 'local'; saveSettings();
  tag.className = 'tag' + (m === 'local' ? '' : ' cloud');
  const T = { local: ['Speech: on-device', 'Your voice is processed on this computer.'], download: ['Speech: on-device available', 'Download the on-device speech pack to keep audio on this computer.'], cloud: ['Speech: cloud', 'Your browser sends audio to its speech service to understand commands.'], none: ['Speech not supported', 'Voice commands need a browser with speech recognition. Head control still works.'] }[m];
  tag.textContent = T[0]; if (note) note.textContent = T[1];
  const ib = $('#speechInstall'); if (ib && tagSel === '#speechTag') ib.hidden = m !== 'download';
}
async function allow() {
  const err = $('#permError'); err.hidden = true; let camOK = false, micOK = false; const msgs = [];
  const eng = await getEngine(); if (!eng) return;
  $('#camStatus').textContent = 'Waiting for permission...';
  try { camStream = await eng.openCamera(); camOK = true; $('#camStatus').textContent = 'Camera on'; }
  catch (e) { $('#camStatus').textContent = 'Camera off'; msgs.push(mediaErr(e, 'Camera')); }
  $('#micStatus').textContent = 'Waiting for permission...';
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); micOK = true; $('#micStatus').textContent = 'Microphone on'; }
  catch (e) { $('#micStatus').textContent = 'Microphone off'; msgs.push(mediaErr(e, 'Microphone')); }
  if (msgs.length) { err.textContent = msgs.join(' '); err.hidden = false; }
  const next = $('#permNext'); next.hidden = !camOK; next.textContent = micOK ? 'Continue' : 'Continue without voice';
  if (camOK) next.focus();
}
async function ensureMic() {
  if (!micStream) { try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch (e) { return mediaErr(e, 'Microphone'); } }
  if (!level) level = new Level(micStream);
  return '';
}

// ---------- check view ----------
const SVG = (p) => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0B0B0F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = { ok: SVG('<path d="M5 12.5l4.5 4.5L19 7"/>'), warn: SVG('<path d="M12 4l9 16H3z"/><path d="M12 10v4"/>'), bad: SVG('<path d="M6 6l12 12M18 6L6 18"/>') };
function setRow(id, state, t, d) { const r = $(`[data-row="${id}"]`); r.className = 'check ' + state; $('.sw', r).innerHTML = ICON[state]; $('.t', r).textContent = t; $('.d', r).textContent = d; }
function updateCheck() {
  const f = lastFrame, face = f && (f.state === 'tracking' || f.state === 'holding');
  face ? setRow('face', 'ok', 'Face found', 'Centered in frame') : setRow('face', 'bad', 'No face found', f && f.state === 'stalled' ? 'Camera is not sending pictures' : 'Look at the camera');
  if (!f) { setRow('light', 'bad', 'Waiting for camera', ''); } else if (f.luma < 45) setRow('light', 'warn', 'Very dark', f.gain > 3 ? 'Boosting a lot. A lamp in front of you will help.' : 'Boosting automatically');
  else if (f.luma < 80 || f.gain > 1.8) setRow('light', 'warn', 'Light is low', 'Boosting automatically');
  else if (f.luma > 210) setRow('light', 'warn', 'Very bright', 'Avoid a window behind you');
  else setRow('light', 'ok', 'Light is good', 'Even and clear');
  if (!face || f.state !== 'tracking') setRow('dist', face ? 'warn' : 'bad', face ? 'Hold still' : 'Distance unknown', 'We need to see your face');
  else if (f.faceW < 0.2) setRow('dist', 'warn', 'Too far away', 'Move a little closer');
  else if (f.faceW > 0.6) setRow('dist', 'warn', 'Too close', 'Move back a little');
  else setRow('dist', 'ok', 'Distance is good', 'About an arm\'s length');
  $('#checkNext').disabled = !face;
}
setInterval(() => { if (cur === 'check') updateCheck(); }, 250);

// ---------- OneEuro + cursor engine ----------
class OneEuro {
  constructor(mc = 0.8, beta = 4) { this.mc = mc; this.beta = beta; this.reset(); }
  reset() { this.x = null; this.dx = 0; this.t = 0; }
  a(c, dt) { return 1 / (1 + 1 / (2 * Math.PI * c) / dt); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.dx += this.a(1, dt) * ((v - this.x) / dt - this.dx);
    this.x += this.a(this.mc + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    this.t = t; return this.x;
  }
}
const fx = new OneEuro(), fy = new OneEuro();
let anchor = null, dstart = 0, cool = 0, pos = { x: 0, y: 0 };
function applyCursor() { const c = $('#cursor'), s = settings.cursorSize; c.style.width = c.style.height = s + 'px'; c.style.margin = `${-s / 2}px 0 0 ${-s / 2}px`; }
function moveCursor(r) {
  let nx, ny;
  if (cal) { nx = cal.ax * r.x + cal.bx; ny = cal.ay * r.y + cal.by; } else { nx = (r.x - 0.5) * 3.5 + 0.5; ny = (r.y - 0.5) * 3.5 + 0.5; }
  nx = 0.5 + (nx - 0.5) * settings.gain; ny = 0.5 + (ny - 0.5) * settings.gain;
  const t = performance.now();
  nx = clamp(fx.filter(clamp(nx, 0, 1), t), 0, 1); ny = clamp(fy.filter(clamp(ny, 0, 1), t), 0, 1);
  pos = { x: nx * innerWidth, y: ny * innerHeight };
  const c = $('#cursor'); c.style.display = 'block'; c.style.opacity = 1; c.style.transform = `translate(${pos.x}px,${pos.y}px)`;
  if (!settings.dwellOn) { c.style.background = ''; return; }
  if (!anchor || Math.hypot(pos.x - anchor.x, pos.y - anchor.y) > 28) { anchor = { ...pos }; dstart = t; }
  let p = 0; if (t < cool) dstart = t; else p = (t - dstart) / settings.dwellMs;
  if (p >= 1) { const el = document.elementFromPoint(pos.x, pos.y); if (el) { el.focus && el.focus(); el.click && el.click(); } cool = t + 800; p = 0; }
  c.style.background = `conic-gradient(rgba(42,68,245,.65) ${p * 360}deg, transparent 0deg)`;
}

// ---------- calibration ----------
const PTS = [[.5, .5], [.12, .5], [.88, .5], [.5, .25], [.5, .75]];
const CAL_HINTS = [
  'Relax and look at the middle dot. Hold still.',
  'Gently turn your head toward the left dot. Only as far as is comfortable. You do not need to reach it.',
  'Now gently toward the right dot. Only as far as is comfortable.',
  'Now tilt your head up a little. Only as far as is comfortable.',
  'Now tilt your head down a little. Only as far as is comfortable.',
];
const CAL_SETTLE = 1800, CAL_COLLECT = 1500, CAL_PRESET = 3.5, CAL_TINY = 6;
let calSkip = false, calQuick = false;
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
// Slope through the centre pose: your own comfortable range is mapped onto the whole screen.
// Returns { k } (ok), { preset } (not enough data or almost no movement), or { bad } (moved the wrong way).
function axisSlope(S, ri, tk, rk) {
  const c = S[0], P = S.filter((s) => s.i !== 0 && s[tk] !== .5);
  if (!P.length) return { preset: CAL_PRESET };
  let n = 0, d = 0;
  for (const s of P) { n += (s[rk] - c[rk]) * (s[tk] - .5); d += (s[rk] - c[rk]) ** 2; }
  if (d < 2e-5) return { preset: CAL_TINY };
  const k = n / d;
  return k > 0 ? { k: Math.min(k, 18) } : { bad: true };
}
function solveCal(S) {
  const x = axisSlope(S, 0, 'tx', 'rx'), y = axisSlope(S, 0, 'ty', 'ry');
  if (x.bad || y.bad) return null;
  const ax = x.k || x.preset, ay = y.k || y.preset, c = S[0];
  return { cal: { ax, bx: .5 - ax * c.rx, ay, by: .5 - ay * c.ry }, tiny: x.preset === CAL_TINY || y.preset === CAL_TINY };
}
async function runCal() {
  calAbort = false; calQuick = false; calSkip = false;
  const msg = $('#calmsg'); msg.textContent = ''; msg.classList.remove('err');
  const box = $('#caldots'); box.innerHTML = '';
  const dots = PTS.map(([l, t], i) => { const d = document.createElement('div'); d.className = 'dot'; d.style.left = l * 100 + '%'; d.style.top = t * 100 + '%'; d.textContent = i + 1; box.appendChild(d); return d; });
  const S = [];
  const stop = (i) => calAbort || calSkip || (calQuick && i > 0);
  const wait = async (ms, i) => { const end = performance.now() + ms; while (performance.now() < end && !stop(i)) await sleep(50); };
  for (let i = 0; i < PTS.length; i++) {
    if (calAbort) return;
    if (calQuick && i > 0) break;
    dots[i].classList.add('act'); $('#calcount').innerHTML = `${i + 1}<span> / ${PTS.length}</span>`;
    $('#calttl').textContent = CAL_HINTS[i]; $('#calskip').hidden = i === 0; calSkip = false;
    for (;;) {
      await wait(CAL_SETTLE, i); if (calAbort) return; if (stop(i)) break;
      const buf = []; const end = performance.now() + CAL_COLLECT;
      while (performance.now() < end && !stop(i)) { if (raw && lastFrame && lastFrame.state === 'tracking' && performance.now() - rawT < 200) buf.push({ ...raw }); await sleep(33); }
      if (calAbort) return; if (stop(i)) break;
      if (buf.length < 5) { msg.textContent = 'We lost your face. Look toward the camera. We will try this dot again.'; msg.classList.add('err'); await sleep(1600); msg.textContent = ''; msg.classList.remove('err'); continue; }
      S.push({ i, rx: avg(buf.map((b) => b.x)), ry: avg(buf.map((b) => b.y)), tx: PTS[i][0], ty: PTS[i][1] });
      break;
    }
    dots[i].classList.remove('act'); dots[i].classList.add('fin');
  }
  if (calAbort) return;
  const r = S.length ? solveCal(S) : null;
  if (!r) { msg.textContent = 'That did not work. Turn your head toward each dot as you see it. We will start again.'; msg.classList.add('err'); await sleep(2600); return runCal(); }
  if (r.tiny) { msg.textContent = 'Very small movement detected. High sensitivity is on. You can fine tune it in Settings.'; msg.classList.remove('err'); await sleep(2400); }
  cal = r.cal; await store.set({ cal }); fx.reset(); fy.reset();
  show('practice');
}

// ---------- practice ----------
let hits = new Set(), practiceVoice = null;
function buildTargets() {
  const box = $('#targets'); box.innerHTML = ''; hits = new Set(); $('#hitcount').textContent = '0 of 3 buttons clicked'; $('#practiceDone').disabled = true;
  for (let i = 1; i <= 3; i++) {
    const b = document.createElement('button'); b.className = 'target'; b.textContent = i;
    b.onclick = () => { hits.add(i); b.classList.add('hit'); $('#hitcount').textContent = `${hits.size} of 3 buttons clicked`; $('#practiceDone').disabled = hits.size < 3; };
    box.appendChild(b);
  }
}
function testMic() {
  const out = $('#heard');
  if (practiceVoice) practiceVoice.stop();
  out.textContent = 'Listening...';
  practiceVoice = new Voice({
    local: settings.speechLocal,
    onInterim: (t) => (out.textContent = 'Hearing: ' + t),
    onFinal: (t, alts) => { const r = HF.parseAny(alts); out.textContent = `Heard: "${t}"` + (r ? ` \u2192 ${r.intent}${r.arg ? ' ' + r.arg : ''}` : ' (not a command)'); practiceVoice.stop(); },
    onError: (c, m) => (out.textContent = m || 'Speech error: ' + c),
  });
  practiceVoice.start();
}

// ---------- diagnostics ----------
const results = { cam: null, voice: null };
function paintStats(f) {
  $('#sFace').textContent = { tracking: 'Tracking', holding: 'Holding', lost: 'Not found', stalled: 'Camera stalled', error: 'Error' }[f.state] || f.state;
  $('#sFps').textContent = f.fps ? f.fps.toFixed(0) : '-';
  $('#sInf').textContent = f.inferMs ? f.inferMs.toFixed(0) + ' ms' : '-';
  $('#sLuma').textContent = f.luma != null ? f.luma.toFixed(0) + ' / 255' : '-';
  $('#sGain').textContent = f.gain ? f.gain.toFixed(1) + 'x' : '-';
}
function paintSummary() {
  const c = results.cam, v = results.voice, parts = [];
  parts.push('Camera: ' + (c == null ? 'not tested' : c ? 'passed' : 'needs attention'));
  parts.push('Voice: ' + (v == null ? 'not tested' : v.pass >= 4 ? `passed (${v.pass} of ${v.total})` : `needs attention (${v.pass} of ${v.total})`));
  $('#summary').textContent = parts.join('   |   ');
}
async function lightTest() {
  if (!tracker || !tracker.running) { $('#dModel').textContent = 'Tracker is not running yet.'; return; }
  const btn = $('#lightTest'); btn.disabled = true;
  const rows = [['Normal light', null], ['Dim', { b: 0.3 }], ['Very dim', { b: 0.15 }], ['Very bright', { b: 2.4 }], ['Backlit', { b: 0.55, backlit: true }]];
  const tb = $('#lightResults tbody'); tb.innerHTML = ''; $('#lightResults').hidden = false; let passN = 0;
  for (const [name, sim] of rows) {
    tracker.setSim(sim); await sleep(900); lt = { frames: 0, hits: 0 }; await sleep(2500);
    const rate = lt.frames ? lt.hits / lt.frames : 0, g = lastFrame ? lastFrame.gain : 1; lt = null;
    const ok = rate >= 0.8; if (ok) passN++;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${name}</td><td>${Math.round(rate * 100)}%</td><td>${g.toFixed(1)}x</td><td class="${ok ? 'pass' : 'fail'}">${ok ? 'Pass' : 'Fail'}</td>`; tb.appendChild(tr);
  }
  tracker.setSim(null); btn.disabled = false;
  results.cam = passN >= 4; paintSummary();
}
let voiceTestV = null, vStep = 0, vPass = 0, vT0 = 0;
const PROMPTS = [['show numbers', { intent: 'shownum' }], ['scroll down', { intent: 'scrolldown' }], ['click five', { intent: 'clicknum', arg: 5 }], ['go back', { intent: 'back' }], ['type', { intent: 'type' }], ['stop', { intent: 'stop' }]];
const renderSteps2 = () => { $('#voiceSteps').innerHTML = PROMPTS.map((p, i) => `<li class="${p.state || (i === vStep ? 'now' : '')}">Say "${p[0]}"${p.note ? ' (' + p.note + ')' : ''}</li>`).join(''); };
function voiceNext(state, note) {
  PROMPTS[vStep].state = state; PROMPTS[vStep].note = note; if (state === 'pass') vPass++; vStep++; vT0 = 0;
  if (vStep >= PROMPTS.length) { endVoiceTest(); } else renderSteps2();
}
function endVoiceTest() {
  if (voiceTestV) voiceTestV.stop(); renderSteps2(); $('#voiceSkip').hidden = true; $('#voiceTest').disabled = false; $('#voiceTest').textContent = 'Run voice test again';
  $('#voiceLive').textContent = vPass >= 4 ? 'Voice test passed.' : 'Voice needs attention. Try a quieter room, speak closer to the mic, or check the speech mode above.';
  results.voice = { pass: vPass, total: PROMPTS.length }; paintSummary();
}
async function startVoiceTest() {
  const e = await ensureMic(); if (e) { $('#voiceLive').textContent = e; return; }
  PROMPTS.forEach((p) => { delete p.state; delete p.note; }); vStep = 0; vPass = 0; vT0 = 0;
  $('#voiceTest').disabled = true; $('#voiceSkip').hidden = false; renderSteps2(); $('#voiceLive').textContent = 'Listening...';
  voiceTestV = new Voice({
    local: settings.speechLocal,
    onInterim: (t) => { if (!vT0) vT0 = performance.now(); $('#voiceLive').textContent = 'Hearing: ' + t; },
    onFinal: (t, alts) => {
      const ms = vT0 ? Math.round(performance.now() - vT0) : 0, exp = PROMPTS[vStep][1], r = HF.parseAny(alts);
      if (r && r.intent === exp.intent && (exp.arg == null || r.arg === exp.arg)) { $('#voiceLive').textContent = `Got it: "${t}"`; voiceNext('pass', ms ? ms + ' ms' : ''); }
      else { $('#voiceLive').textContent = `Heard "${t}"` + (r ? ` (understood as ${r.intent})` : ' (not a command)') + '. Try again.'; vT0 = 0; }
    },
    onError: (c, m) => { if (m) $('#voiceLive').textContent = m; if (c === 'not-allowed' || c === 'audio-capture' || c === 'unsupported') { $('#voiceTest').disabled = false; $('#voiceSkip').hidden = true; } },
  });
  if (!voiceTestV.start()) { $('#voiceTest').disabled = false; $('#voiceSkip').hidden = true; }
}
async function noiseTest() {
  const e = await ensureMic(); if (e) { $('#noiseOut').textContent = e; return; }
  $('#noiseOut').textContent = 'Stay quiet for 3 seconds...';
  const n = await level.noiseFloor(3000);
  $('#noiseOut').textContent = n < 0.02 ? `Quiet room (${n.toFixed(3)}). Voice should work well.` : n < 0.06 ? `Moderate noise (${n.toFixed(3)}). Speak clearly and close to the mic.` : `Noisy room (${n.toFixed(3)}). Expect misheard commands. Use a headset mic if you can.`;
}
function leaveDiagnostics() { if (voiceTestV) voiceTestV.stop(); if (tracker) tracker.setSim(null); lt = null; }
setInterval(() => {
  if (!level) return; const v = level.read(), w = Math.min(100, v * 400) + '%';
  if (cur === 'diagnostics') $('#dmeter').style.width = w; if (cur === 'practice') $('#meter i').style.width = w;
}, 60);

// ---------- view hooks ----------
const onEnter = {
  permissions: () => paintSpeech(),
  check: async () => { attach($('#preview')); await startTracker(); },
  calibrate: async () => { if (!(await startTracker())) { show('check'); return; } runCal(); },
  practice: async () => { buildTargets(); await ensureMic(); },
  done: () => store.set({ onboarded: true }),
  settings: renderSettings,
  diagnostics: async () => {
    results.cam = null; results.voice = null; paintSummary(); renderSteps2(); paintSpeech('#dSpeechTag', null);
    const ok = await startTracker(); if (ok) attach($('#dpreview'));
    const e = await ensureMic(); if (e) $('#noiseOut').textContent = e;
  },
};

// ---------- wiring ----------
$('#start').onclick = () => show('permissions');
$('#toDiag').onclick = () => show('diagnostics');
$('#checkDiag').onclick = () => show('diagnostics');
$('#doneDiag').onclick = () => show('diagnostics');
$('#setDiag').onclick = () => show('diagnostics');
$('#diagBack').onclick = () => show('welcome');
$('#allow').onclick = allow;
$('#permNext').onclick = () => show('check');
$('#checkNext').onclick = () => show('calibrate');
$('#calcancel').onclick = () => { calAbort = true; show('check'); };
$('#calskip').onclick = () => { calSkip = true; };
$('#calquick').onclick = () => { calQuick = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur === 'calibrate') { calAbort = true; show('check'); } });
$('#practiceDone').onclick = () => show('done');
$('#redo').onclick = () => show('calibrate');
$('#setRedo').onclick = () => show('calibrate');
$('#setBack').onclick = () => show('welcome');
$('#toSettings').onclick = () => show('settings');
$('#micTest').onclick = testMic;
$('#openSite').onclick = () => {
  if (globalThis.chrome && chrome.tabs) chrome.tabs.create({ url: 'https://www.wikipedia.org' });
  else location.href = 'https://www.wikipedia.org';
};
$('#speechInstall').onclick = async () => { await installLocalSpeech(); paintSpeech(); };
$('#lightTest').onclick = lightTest;
$('#noiseTest').onclick = noiseTest;
$('#voiceTest').onclick = startVoiceTest;
$('#voiceSkip').onclick = () => { if (vStep < PROMPTS.length) voiceNext('skip', 'skipped'); };
$('#modelRetry').onclick = () => { const v = cur; show(v); };
$('#modelFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const eng = await getEngine(); if (eng) { await eng.saveModelFile(f); $('#modelStatus').textContent = 'Model saved. Trying again...'; show(cur); } };
$$('[data-jump]').forEach((el) => {
  el.addEventListener('click', () => show(el.dataset.jump));
});

(async () => {
  const d = await store.get(['settings', 'cal']);
  if (d.settings) settings = { ...DEF, ...d.settings };
  if (d.cal) cal = d.cal;
  applyCursor();
  const hash = location.hash.slice(1);
  show(['settings', 'diagnostics'].includes(hash) ? hash : 'welcome');
})();
window.__hf = { show, state: () => ({ cur, lastFrame, cal, results }) };
