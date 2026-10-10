import { Voice, speechMode } from './voice.js';

const $ = (id) => document.getElementById(id);
const send = (m) => { try { chrome.runtime.sendMessage({ from: 'tracker', ...m }).catch(() => {}); } catch (_) {} };
let tracker = null, voice = null, cam = null, lastSent = 0, lastLostSent = 0, lastNote = '';

function status(text, bad) { const s = $('status'); s.textContent = text; s.style.background = bad ? 'linear-gradient(180deg,#ff7a70,#ff453a)' : 'rgba(255,255,255,.18)'; s.style.color = '#fff'; }
function note(t) { $('note').textContent = t || ''; if (t !== lastNote) { lastNote = t; if (t) send({ type: 'status', text: t }); } }
const camErr = (e) => e.name === 'NotAllowedError' ? 'Camera is blocked. Click the camera icon in the address bar and allow it.' : e.name === 'NotFoundError' ? 'No camera found.' : e.name === 'NotReadableError' ? 'Camera is in use by another app.' : 'Camera error: ' + e.message;

function onFrame(f) {
  const now = performance.now();
  if ((f.state === 'tracking' || f.state === 'holding') && f.raw) {
    if (now - lastSent >= 30) { lastSent = now; send({ type: 'pos', x: f.raw.x, y: f.raw.y }); }
    status(f.state === 'tracking' ? 'Tracking' : 'Holding');
  } else if (f.state === 'lost') {
    if (now - lastLostSent > 200) { lastLostSent = now; send({ type: 'noface' }); }
    status('Face not found. Look at the camera.', true);
  } else if (f.state === 'stalled') status('Camera stopped sending pictures. Bring this window back into view.', true);
  else if (f.state === 'error') status('Tracker error: ' + f.error, true);
  if (f.fps && f.fps < 12 && f.state === 'tracking') note('Tracking is slow. Keep the tracker window visible.');
  else if (f.gain > 2.2) note('Low light: boosting automatically.');
  else note('');
}

async function startVoice() {
  const { settings } = await chrome.storage.local.get('settings');
  const mode = await speechMode();
  voice = new Voice({
    local: mode === 'local' || !!(settings && settings.speechLocal),
    onInterim: (t) => { $('heard').textContent = 'Hearing: ' + t; },
    onFinal: (t, alts) => { $('heard').textContent = 'Heard: "' + t + '"'; send({ type: 'voice', text: t, alts }); },
    onError: (c, m) => { if (m) $('heard').textContent = m; },
  });
  if (!voice.start()) $('heard').textContent = 'Voice commands are not available in this browser.';
}

async function start() {
  $('start').disabled = true; status('Starting camera...');
  let E;
  try { E = await import('./engine.js'); } catch (e) { status('Tracking files could not load: ' + e.message, true); $('start').disabled = false; return; }
  try { cam = await E.openCamera(); } catch (e) { status(camErr(e), true); $('start').disabled = false; return; }
  tracker = new E.Tracker({ onFrame });
  try { await tracker.init((s) => status(s.text + (s.pct && s.pct < 1 ? ' ' + Math.round(s.pct * 100) + '%' : ''))); }
  catch (e) { status('Face model not loaded: ' + e.message + ' Open Settings, then Camera and voice test, to load it.', true); $('start').disabled = false; return; }
  $('video').srcObject = cam; $('video').play().catch(() => {});
  tracker.start(cam); startVoice();
  const { cal } = await chrome.storage.local.get('cal');
  if (!cal) setTimeout(() => send({ type: 'calibrate' }), 1500);
}

$('start').onclick = start;
$('cal').onclick = () => send({ type: 'calibrate' });
$('setup').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#settings') });
$('test').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#diagnostics') });
(async () => { try { const p = await navigator.permissions.query({ name: 'camera' }); if (p.state === 'granted') start(); } catch (_) {} })();
