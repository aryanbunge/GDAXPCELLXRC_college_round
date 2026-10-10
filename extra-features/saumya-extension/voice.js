// Speech input via Web Speech API. onText(text, startedAt) receives each final utterance
// together with the time the user STARTED speaking (used to look up where they were looking then).
(function (root) {
  'use strict';
  const HF = (root.HF = root.HF || {});
  let rec = null, enabled = false, speechStart = 0, handler = null;

  function supported() { return !!(root.SpeechRecognition || root.webkitSpeechRecognition); }
  function start(onText) {
    const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
    if (!SR) return false;
    handler = onText; enabled = true;
    rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!speechStart) speechStart = Date.now() - 250;
        if (e.results[i].isFinal) {
          const text = e.results[i][0].transcript.trim();
          const at = speechStart; speechStart = 0;
          if (text && handler) handler(text, at);
        }
      }
    };
    rec.onend = () => { if (enabled) { try { rec.start(); } catch (err) { /* already started */ } } };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') enabled = false; };
    try { rec.start(); } catch (e) { return false; }
    return true;
  }
  function stop() { enabled = false; try { rec && rec.stop(); } catch (e) { /* ignore */ } }
  HF.voice = { supported, start, stop, isOn: () => enabled };
})(typeof window !== 'undefined' ? window : globalThis);
