export const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

export async function speechMode(lang = 'en-IN') {
  const C = SR();
  if (!C) return 'none';
  try {
    if (C.available) {
      const a = await C.available({ langs: [lang], processLocally: true });
      if (a === 'available') return 'local';
      if (a === 'downloadable' || a === 'downloading') return 'download';
    }
  } catch (_) {}
  return 'cloud';
}
export async function installLocalSpeech(lang = 'en-IN') {
  const C = SR();
  try { await C.install({ langs: [lang], processLocally: true }); return true; } catch (_) { return false; }
}

export const ERRORS = {
  'not-allowed': 'Microphone is blocked. Allow it in the address bar, then try again.',
  'service-not-allowed': 'Speech service is blocked for this page.',
  'audio-capture': 'No microphone was found.',
  network: 'Cloud speech needs internet. Check your connection, or switch to on-device speech.',
  'language-not-supported': 'This language is not supported by speech recognition.',
  aborted: '',
  'no-speech': '',
};

// Continuous recogniser that restarts itself, reports interim text and alternatives.
export class Voice {
  constructor(o = {}) { this.o = o; this.running = false; this.lang = o.lang || 'en-IN'; this.local = !!o.local; this.fails = 0; }
  start() {
    const C = SR();
    if (!C) { this.o.onError && this.o.onError('unsupported', 'Speech recognition is not available in this browser.'); return false; }
    this.running = true; this._spawn(); return true;
  }
  _spawn() {
    const C = SR(), o = this.o, r = new C();
    r.continuous = true; r.interimResults = true; r.lang = this.lang; r.maxAlternatives = 4;
    if (this.local && 'processLocally' in r) r.processLocally = true;
    let delay = 400;
    r.onstart = () => { o.onState && o.onState('listening'); };
    r.onresult = (e) => {
      this.fails = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], alts = [...res].map((a) => a.transcript.trim());
        if (res.isFinal) o.onFinal && o.onFinal(alts[0], alts, res[0].confidence);
        else o.onInterim && o.onInterim(alts[0]);
      }
    };
    r.onerror = (e) => {
      const msg = ERRORS[e.error];
      if (msg) o.onError && o.onError(e.error, msg);
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) this.running = false;
      if (e.error === 'network') delay = 2500;
      this.fails++;
    };
    r.onend = () => {
      o.onState && o.onState('idle');
      if (this.running) setTimeout(() => this.running && this._spawn(), Math.min(delay + this.fails * 300, 4000));
    };
    try { r.start(); } catch (_) {}
    this.r = r;
  }
  stop() { this.running = false; try { this.r && this.r.abort(); } catch (_) {} }
}

// Microphone level and room-noise measurement.
export class Level {
  constructor(stream) {
    this.ac = new AudioContext(); this.an = this.ac.createAnalyser(); this.an.fftSize = 1024;
    this.ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(this.an);
    this.buf = new Uint8Array(this.an.fftSize);
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
  }
  read() { this.an.getByteTimeDomainData(this.buf); let s = 0; for (const v of this.buf) { const d = (v - 128) / 128; s += d * d; } return Math.sqrt(s / this.buf.length); }
  async noiseFloor(ms = 3000) { const v = []; const end = performance.now() + ms; while (performance.now() < end) { v.push(this.read()); await new Promise((r) => setTimeout(r, 50)); } return v.reduce((a, b) => a + b, 0) / v.length; }
}
