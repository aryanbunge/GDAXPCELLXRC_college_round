"""
Offline speech recognition for Neo using Whisper (faster-whisper, CPU, int8).

Neo still uses the speech_recognition library to listen to the microphone and cut
out each phrase. This module turns that phrase into text with Whisper instead of
sending it to Google, so it works offline after the first model download.

Environment variables (all optional):
    NEO_STT=google          use the old Google recognizer instead of Whisper
    NEO_WHISPER_MODEL       tiny.en | base.en (default) | small.en | base | small ...
                            (models without .en understand many languages)
    NEO_WHISPER_LANG        e.g. en, hi. Default: en for .en models, auto for others
    NEO_WHISPER_THREADS     CPU threads for Whisper (default: half your cores, 2-4)
    NEO_WHISPER_PUNCT=1     keep Whisper's punctuation (default: stripped, because
                            Neo's voice commands match plain words)
"""
import os
import re
import threading

MODEL_NAME = os.environ.get('NEO_WHISPER_MODEL', 'base.en')
LANGUAGE = os.environ.get('NEO_WHISPER_LANG') or ('en' if MODEL_NAME.endswith('.en') else None)
KEEP_PUNCT = os.environ.get('NEO_WHISPER_PUNCT') == '1'

# Nudges Whisper toward Neo's vocabulary, including the wake word.
PROMPT = ('Neo, click, double click, right click, scroll up, scroll down, open Chrome, open Notepad, '
          'type, start dictation, show keyboard, recenter, hand control, head tracking.')

# Phrases Whisper tends to invent from noise.
_PHANTOM = {'you', 'bye', 'bye bye', 'thanks for watching', 'thank you for watching',
            'subtitles by the amara.org community'}

_model = None
_failed = False
_lock = threading.Lock()


def _threads():
    try:
        return int(os.environ['NEO_WHISPER_THREADS'])
    except (KeyError, ValueError):
        return max(2, min(4, (os.cpu_count() or 4) // 2))


def load(on_status=None):
    """Load the model once. Returns None (and remembers) if Whisper cannot start."""
    global _model, _failed
    with _lock:
        if _model is not None or _failed:
            return _model
        try:
            try:
                import av  # noqa: F401
            except Exception:
                # faster-whisper imports av only to decode audio FILES. Neo hands it raw
                # microphone samples, so a stub is enough and av need not be installed.
                import sys
                import types
                sys.modules['av'] = types.ModuleType('av')
            from faster_whisper import WhisperModel
            if on_status:
                on_status('Loading Whisper speech model (the first run downloads it)')
            _model = WhisperModel(MODEL_NAME, device='cpu', compute_type='int8', cpu_threads=_threads())
        except Exception as exc:
            _failed = True
            print('Whisper could not start, using Google speech recognition instead:', exc)
        return _model


def preload(on_status=None):
    """Start loading in the background so the first command is not delayed."""
    threading.Thread(target=load, args=(on_status,), name='neo-whisper-load', daemon=True).start()


def clean(text):
    text = (text or '').strip()
    if text.lower().strip(' .!?,') in _PHANTOM:
        return ''
    if not KEEP_PUNCT:
        text = re.sub(r'[,;:!?"\u201c\u201d]', ' ', text)
        text = re.sub(r'\.(?=\s|$)', '', text)   # sentence periods, but keep gmail.com and 3.5
    return re.sub(r'\s+', ' ', text).strip()


def transcribe(audio_data):
    """audio_data: speech_recognition.AudioData from Recognizer.listen()."""
    import numpy as np
    model = load()
    if model is None:
        raise RuntimeError('Whisper is not available')
    raw = audio_data.get_raw_data(convert_rate=16000, convert_width=2)
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _info = model.transcribe(
        samples, language=LANGUAGE, beam_size=1, best_of=1, temperature=0.0,
        vad_filter=True, vad_parameters={'min_silence_duration_ms': 400},
        condition_on_previous_text=False, initial_prompt=PROMPT,
        no_speech_threshold=0.6, without_timestamps=True,
    )
    return clean(' '.join(seg.text.strip() for seg in segments))