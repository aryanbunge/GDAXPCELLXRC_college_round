// Camera + face tracking engine, built to keep detecting in poor light.
import { FaceLandmarker, FilesetResolver } from './lib/vision_bundle.mjs';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const CACHE = 'hf-models', KEY = 'face_landmarker.task';

export async function openCamera() {
  const base = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false }); }
  catch (e) {
    if (e.name === 'OverconstrainedError' || e.name === 'TypeError') stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    else throw e;
  }
  try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ exposureMode: 'continuous' }, { whiteBalanceMode: 'continuous' }, { focusMode: 'continuous' }] }); } catch (_) {}
  return stream;
}

export async function modelBuffer(onProgress) {
  try { const r = await fetch('./models/face_landmarker.task'); if (r.ok) { const b = await r.arrayBuffer(); if (b.byteLength > 1e6) return { buf: b, from: 'packaged' }; } } catch (_) {}
  const c = await caches.open(CACHE);
  const hit = await c.match(KEY);
  if (hit) { const b = await hit.arrayBuffer(); if (b.byteLength > 1e6) return { buf: b, from: 'cache' }; }
  const r = await fetch(MODEL_URL);
  if (!r.ok) throw new Error('Model download failed (HTTP ' + r.status + ')');
  const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length; onProgress && onProgress(got, total); }
  const buf = new Uint8Array(got); let o = 0; for (const ch of chunks) { buf.set(ch, o); o += ch.length; }
  await c.put(KEY, new Response(buf.buffer));
  return { buf: buf.buffer, from: 'download' };
}
export async function saveModelFile(file) { const b = await file.arrayBuffer(); const c = await caches.open(CACHE); await c.put(KEY, new Response(b)); }

export async function createLandmarker(onStatus) {
  if (globalThis.__HF_STUB_LANDMARKER) return globalThis.__HF_STUB_LANDMARKER;
  onStatus && onStatus({ text: 'Loading face model', pct: 0 });
  const { buf, from } = await modelBuffer((g, t) => onStatus && onStatus({ text: 'Downloading face model (first time only)', pct: t ? g / t : 0 }));
  onStatus && onStatus({ text: 'Starting tracker (' + from + ')', pct: 1 });
  const fs = await FilesetResolver.forVisionTasks('./lib/wasm');
  const opts = (d) => ({
    baseOptions: { modelAssetBuffer: new Uint8Array(buf), delegate: d },
    runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  try { return await FaceLandmarker.createFromOptions(fs, opts('GPU')); }
  catch (_) { return await FaceLandmarker.createFromOptions(fs, opts('CPU')); }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Tracker {
  constructor(o = {}) {
    this.onFrame = o.onFrame || (() => {});
    this.running = false; this.gain = 1; this.sim = null; this.lm = null;
    this.mults = [1, 1.7, 0.6, 2.6, 0.4];
    this.lostFrames = 0; this.profile = 0; this.box = null; this.lastRaw = null; this.lastGood = 0;
    this.fps = 0; this.inferMs = 0; this.lastFrameT = 0; this.frameN = 0; this.luma = 120; this.errors = 0;
  }
  async init(onStatus) { if (!this.lm) this.lm = await createLandmarker(onStatus); }
  start(stream) {
    if (this.running) return;
    this.stream = stream;
    const v = this.video = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:4px;height:4px;opacity:0;pointer-events:none';
    document.body.appendChild(v); v.play().catch(() => {});
    this.proc = document.createElement('canvas'); this.pctx = this.proc.getContext('2d', { willReadFrequently: true });
    this.sc = document.createElement('canvas'); this.sctx = this.sc.getContext('2d', { willReadFrequently: true });
    this.probe = document.createElement('canvas'); this.probe.width = this.probe.height = 32;
    this.xctx = this.probe.getContext('2d', { willReadFrequently: true });
    this.running = true; this.lastTs = 0; this.lastVT = -1; this.lastNew = performance.now(); this.lastStall = 0;
    try { this.worker = new Worker('./ticker.js'); this.worker.onmessage = () => this._tick(); this.worker.postMessage({ ms: 33 }); }
    catch (_) { this.timer = setInterval(() => this._tick(), 33); }
  }
  stop() {
    this.running = false;
    if (this.worker) this.worker.terminate();
    if (this.timer) clearInterval(this.timer);
    if (this.video) this.video.remove();
  }
  setSim(s) { this.sim = s; }

  _measure(src, w, h) {
    // Mean luma of the face region (or the centre of the frame), so a bright background does not fool exposure.
    let sx, sy, sw, sh;
    if (this.box) { const b = this.box, pad = 0.1; sx = clamp(b.x0 - pad, 0, 1) * w; sy = clamp(b.y0 - pad, 0, 1) * h; sw = Math.max(8, (clamp(b.x1 + pad, 0, 1) - clamp(b.x0 - pad, 0, 1)) * w); sh = Math.max(8, (clamp(b.y1 + pad, 0, 1) - clamp(b.y0 - pad, 0, 1)) * h); }
    else { sx = w * 0.2; sy = h * 0.2; sw = w * 0.6; sh = h * 0.6; }
    this.xctx.drawImage(src, sx, sy, sw, sh, 0, 0, 32, 32);
    const d = this.xctx.getImageData(0, 0, 32, 32).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / 1024;
  }

  _applySim(w, h) {
    // Test-only degradation (dim, bright, backlit) done per pixel so it works on every machine.
    const s = this.sim, ctx = this.sctx, b = s.b || 1, c = s.c || 1;
    ctx.drawImage(this.video, 0, 0, w, h);
    const im = ctx.getImageData(0, 0, w, h), d = im.data, lut = new Uint8ClampedArray(256);
    for (let x = 0; x < 256; x++) lut[x] = (x * b - 128) * c + 128;
    if (s.backlit) {
      const cx = w / 2, cy = h / 2, r0 = h * 0.15, r1 = h * 0.75;
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
        const add = 230 * clamp((Math.hypot(x - cx, y - cy) - r0) / (r1 - r0), 0, 1);
        d[i] = lut[d[i]] + add; d[i + 1] = lut[d[i + 1]] + add; d[i + 2] = lut[d[i + 2]] + add;
      }
    } else for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(im, 0, 0);
  }
  _enhance(src, w, h, g, c, gamma) {
    // Gain + gamma lift + contrast through a lookup table: brightens shadows without blowing out highlights.
    const ctx = this.pctx; ctx.drawImage(src, 0, 0, w, h);
    if (Math.abs(g - 1) < 0.03 && c < 1.02 && gamma < 1.02) return;
    const im = ctx.getImageData(0, 0, w, h), d = im.data, lut = this.lut || (this.lut = new Uint8ClampedArray(256));
    for (let x = 0; x < 256; x++) { let v = Math.min(1, x * g / 255); v = Math.pow(v, 1 / gamma); v = (v - 0.5) * c + 0.5; lut[x] = Math.round(v * 255); }
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(im, 0, 0);
  }

  _tick() {
    if (!this.running || this.busy || !this.lm) return;
    const v = this.video; if (!v || v.readyState < 2 || !v.videoWidth) return;
    const now = performance.now();
    if (v.currentTime === this.lastVT) {
      if (now - this.lastNew > 1000 && now - this.lastStall > 500) { this.lastStall = now; this.onFrame({ t: now, state: 'stalled', raw: null, fps: 0, luma: this.luma, gain: this.gain }); }
      return;
    }
    this.lastVT = v.currentTime; this.lastNew = now; this.busy = true;
    try {
      const w = v.videoWidth, h = v.videoHeight;
      if (this.proc.width !== w) { this.proc.width = this.sc.width = w; this.proc.height = this.sc.height = h; }
      let src = v;
      if (this.sim) { this._applySim(w, h); src = this.sc; }
      if (this.frameN++ % 3 === 0) {
        this.luma = this._measure(src, w, h);
        const target = clamp(118 / Math.max(this.luma, 6), 0.6, 4.5);
        this.gain += (target - this.gain) * 0.4;
      }
      const mult = this.lostFrames >= 3 ? this.mults[this.profile % this.mults.length] : 1;
      const g = clamp(this.gain * mult, 0.3, 6), c = 1 + clamp((95 - this.luma) / 200, 0, 0.4);
      const gamma = 1 + clamp((90 - this.luma) / 120, 0, 0.6);
      this._enhance(src, w, h, g, c, gamma);
      let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts;
      const res = this.lm.detectForVideo(this.proc, ts);
      this.inferMs += (performance.now() - ts - this.inferMs) * 0.2;
      const face = res && res.faceLandmarks && res.faceLandmarks[0];
      let state = 'lost', raw = null, nose = null, faceW = 0;
      if (face) {
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const p of face) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
        faceW = x1 - x0;
        if (faceW > 0.08 && y1 > y0) {
          const n = face[1]; nose = { x: n.x, y: n.y }; raw = { x: 1 - n.x, y: n.y };
          this.box = { x0, y0, x1, y1 }; this.lastRaw = raw; this.lastGood = now; state = 'tracking';
          if (mult !== 1) this.gain = clamp(this.gain * mult, 0.3, 6);
          this.lostFrames = 0; this.profile = 0;
        }
      }
      if (state !== 'tracking') {
        this.lostFrames++; if (this.lostFrames >= 3) this.profile++;
        if (now - this.lastGood < 350 && this.lastRaw) { state = 'holding'; raw = this.lastRaw; }
        else if (this.lostFrames > 45) this.box = null;
      }
      const dt = now - this.lastFrameT; this.lastFrameT = now; if (dt > 0 && dt < 1000) this.fps += (1000 / dt - this.fps) * 0.15;
      this.errors = 0;
      this.onFrame({ t: now, state, raw, nose, faceW, box: this.box, luma: this.luma, gain: g, fps: this.fps, inferMs: this.inferMs, lostFrames: this.lostFrames });
    } catch (e) {
      this.errors++;
      if (this.errors === 1 || this.errors % 60 === 0) this.onFrame({ t: performance.now(), state: 'error', raw: null, error: String(e && e.message || e), fps: this.fps });
    } finally { this.busy = false; }
  }
}
