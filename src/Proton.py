import pyttsx3
import speech_recognition as sr
from datetime import date
import time
import webbrowser
import datetime
from pynput.keyboard import Key, Controller
import pyautogui
import sys
import os
import re
import json
import urllib.parse
import urllib.request
import tempfile
import wave
from os import listdir
from os.path import isfile, join
import smtplib
import Gesture_Controller
#import Gesture_Controller_Gloved as Gesture_Controller
import app
from ai_assistant import NeoAssistant, NeoAIError, open_app_by_name, close_app_by_name, _validated_url
import voice_config
from threading import Thread


# -------------Object Initialization---------------
r = sr.Recognizer()
keyboard = Controller()
try:
    engine = pyttsx3.init('sapi5')
    voices = engine.getProperty('voices')
    if voices:
        engine.setProperty('voice', voices[0].id)
except Exception as exc:
    engine = None
    print('Neo speech output is unavailable:', exc)

# ----------------Variables------------------------
file_exp_status = False
files =[]
path = ''
neo_ai = NeoAssistant()
dictation_target = None
ACTIVE_LISTEN_SECONDS = 12
WAKE_COMMAND_WAIT_SECONDS = 10
microphone_available = True
is_awake = True  #Bot status
WAKE_WORD = 'neo'
WAKE_PREFIX = re.compile(r'^\s*(?:hey\s+)?neo\b', re.IGNORECASE)
NEW_WAKE_PREFIX = re.compile(r'^\s*(?:hey\s+)?new\b', re.IGNORECASE)

def has_wake_word(text, allow_new=False):
    # Google may hear the wake word as "new". Only accept that while idle/scanning;
    # during an active session "new" must remain ordinary command text.
    text = text or ''
    return bool(WAKE_PREFIX.search(text) or (allow_new and NEW_WAKE_PREFIX.search(text)))

def remove_wake_word(text, allow_new=False):
    text = text or ''
    if WAKE_PREFIX.search(text):
        return WAKE_PREFIX.sub('', text, count=1).strip(' ,.!?')
    if allow_new and NEW_WAKE_PREFIX.search(text):
        return NEW_WAKE_PREFIX.sub('', text, count=1).strip(' ,.!?')
    return text.strip(' ,.!?')

def set_status(message, state='listening'):
    try:
        app.ChatBot.setStatus(message, state)
    except Exception:
        pass

def set_device_state(microphone=True, camera=False, hand_control=False):
    try:
        app.ChatBot.setDevices(microphone, camera, hand_control)
    except Exception:
        pass

def yield_focus_to_desktop():
    """If a dashboard button was used, return focus to the app behind Neo."""
    try:
        import win32gui
        hwnd = win32gui.GetForegroundWindow()
        title = win32gui.GetWindowText(hwnd).lower()
        if 'hands-free computer control' in title:
            pyautogui.hotkey('alt', 'tab')
            time.sleep(0.18)
    except Exception:
        pass

def canonicalize_tracking_command(text):
    """Map common natural phrasings to the existing tracking commands."""
    phrase = re.sub(r'\s+', ' ', (text or '').lower().replace('\u2019', "'")).strip(' ,.!?')
    if not phrase or re.match(r'^(?:how|why|what|when|where|who)\b', phrase):
        return None

    # Do not turn a request to keep tracking on/off into the opposite action.
    if re.search(r"\b(?:don't|dont|do not|never)\s+(?:ever\s+)?(?:stop|disable|deactivate|turn off|switch off|pause)\b", phrase):
        return None
    if re.search(r"\b(?:don't|dont|do not|never)\s+(?:ever\s+)?(?:start|enable|activate|turn on|switch on)\b", phrase):
        return None
    if re.search(r"\b(?:don't|dont|do not|never)\b.{0,24}\b(?:switch|change|move)\b", phrase):
        return None

    # A destination in a switch request disambiguates phrases mentioning both.
    destination = re.search(
        r'\b(?:switch|change|move)\s+(?:back\s+)?'
        r'(?:from\s+(?:head|hand)(?:\s+(?:tracking|control|mode))?\s+)?'
        r'to\s+(?:using\s+)?(head|hand|gesture)\b', phrase)
    has_head = bool(re.search(r'\bhead\b', phrase))
    has_hand = bool(re.search(r'\b(?:hand|hands|gesture|gestures|camera|webcam)\b', phrase))
    if destination:
        target = 'head' if destination.group(1) == 'head' else 'hand'
        wants_on = True
        wants_off = False
    else:
        if has_head == has_hand:
            return None
        target = 'head' if has_head else 'hand'
        wants_off = bool(re.search(
            r'\b(?:stop|disable|deactivate|pause|end|quit|turn off|switch off|shut off)\b', phrase))
        wants_on = bool(re.search(
            r'\b(?:start|enable|activate|launch|begin|resume|use|turn on|switch on)\b', phrase))
        if re.search(r"\b(?:don't|dont|do not|no longer)\s+use\b", phrase):
            wants_on = False

        # Also understand the natural word order: “turn hand tracking off/on”.
        if re.search(r'\b(?:turn|switch|set|keep|leave)\b.{0,28}\boff\b', phrase):
            wants_off = True
        if re.search(r'\b(?:turn|switch|set|keep|leave)\b.{0,28}\bon\b', phrase):
            wants_on = True
        if re.search(r"\b(?:don't|dont|do not|no longer)\s+(?:want|need|use)\b", phrase):
            wants_off = True

        if wants_off == wants_on:
            return None

    if target == 'head':
        return 'start head tracking' if wants_on else 'stop head tracking'
    return 'start hand control' if wants_on else 'stop hand control'

def run_quick_action(text):
    """Run common, clearly phrased commands locally without an AI round trip."""
    phrase = (text or '').strip()
    lower = phrase.lower().strip(' .!?')
    if not lower:
        return None
    if lower in ('launch gesture recognition', 'start gesture recognition',
                 'start hand control', 'launch hand control', 'enable hand control', 'start camera', 'turn on hand control',
                 'stop gesture recognition', 'stop hand control',
                 'disable hand control', 'stop camera', 'turn off hand control',
                 'start head tracking', 'enable head tracking', 'use head tracking',
                 'switch to head tracking', 'stop head tracking', 'disable head tracking',
                 'use hand tracking', 'switch to hand tracking', 'return to hand tracking'):
        return None

    desktop_actions = (
        'go back', 'back a page', 'previous page', 'browser back', 'go forward',
        'forward a page', 'next page', 'browser forward', 'top of page',
        'go to top', 'scroll to top', 'bottom of page', 'go to bottom',
        'scroll to bottom', 'click', 'click here',
        'click link', 'click the link', 'left click', 'confirm click',
        'double click', 'double-click',
        'select this', 'activate this', 'right click', 'open context menu',
        'start drag', 'start dragging', 'begin drag', 'begin dragging',
        'hold left mouse', 'release drag', 'stop dragging', 'drop',
        'release mouse', 'release left mouse', 'cancel drag',
        'next link', 'next control', 'next item', 'move to next control',
        'previous link', 'previous control', 'previous item', 'select',
        'select control', 'activate selected', 'press enter', 'escape',
        'press escape', 'cancel dialog', 'focus address bar',
        'address bar', 'search bar', 'new tab', 'open a new tab', 'close tab',
        'close this tab', 'reopen tab', 'reopen closed tab', 'switch tab',
        'next tab', 'previous tab', 'switch to previous tab',
        'close this window', 'close current window',
        'minimize window', 'minimize this window', 'maximize window',
        'maximize this window', 'show desktop', 'hide all windows',
    )
    if lower in desktop_actions or re.match(r'^(?:scroll|page)\s+(?:up|down|left|right)', lower):
        yield_focus_to_desktop()

    sites = {
        'google': 'https://www.google.com', 'youtube': 'https://www.youtube.com',
        'gmail': 'https://mail.google.com',
        'reddit': 'https://www.reddit.com', 'amazon': 'https://www.amazon.com',
        'github': 'https://github.com', 'maps': 'https://maps.google.com',
    }
    website = re.match(r'^(?:open|visit|go to|navigate to)\s+(?:(?:the )?(?:website|web site|site)\s+)(.+)$', lower)
    if website:
        target = website.group(1).strip().rstrip(' .!?').replace(' dot ', '.')
        url = sites.get(target)
        if not url:
            url = _validated_url(target)
        webbrowser.open(url)
        return 'Opening ' + target + '.'
    domain = re.match(r'^(?:go to|navigate to|visit)\s+([a-z0-9.-]+\.[a-z]{2,})$', lower)
    if domain:
        target = domain.group(1).replace(' dot ', '.')
        webbrowser.open(_validated_url(target))
        return 'Opening ' + target + '.'
    website_name = re.match(r'^(?:open|visit|go to)\s+(google|youtube|gmail|reddit|amazon|github|maps)$', lower)
    if website_name:
        name = website_name.group(1)
        webbrowser.open(sites[name])
        return 'Opening ' + name + '.'
    open_domain = re.match(r'^open\s+([a-z0-9.-]+\.[a-z]{2,})$', lower)
    if open_domain:
        target = open_domain.group(1)
        webbrowser.open(_validated_url(target))
        return 'Opening ' + target + '.'

    if lower in ('go back', 'back a page', 'previous page', 'browser back'):
        pyautogui.hotkey('alt', 'left')
        return 'Going back one page.'
    if lower in ('go forward', 'forward a page', 'next page', 'browser forward'):
        pyautogui.hotkey('alt', 'right')
        return 'Going forward one page.'
    if lower in ('top of page', 'go to top', 'scroll to top'):
        pyautogui.press('home')
        return 'Moved to the top of the page.'
    if lower in ('bottom of page', 'go to bottom', 'scroll to bottom'):
        pyautogui.press('end')
        return 'Moved to the bottom of the page.'
    match = re.match(r'^(?:scroll|page)\s+(up|down)(?:\s+(\d+))?$', lower)
    if match:
        steps = min(8, max(1, int(match.group(2) or 3)))
        pyautogui.scroll(steps if match.group(1) == 'up' else -steps)
        return 'Scrolling ' + match.group(1) + '.'
    horizontal_scroll = re.match(r'^scroll\s+(left|right)(?:\s+(\d+))?$', lower)
    if horizontal_scroll:
        direction = horizontal_scroll.group(1)
        steps = min(8, max(1, int(horizontal_scroll.group(2) or 3)))
        pyautogui.keyDown('shift')
        try:
            # Match the existing left-hand pinch mapping: right is negative wheel.
            pyautogui.scroll(-steps if direction == 'right' else steps)
        finally:
            pyautogui.keyUp('shift')
        return 'Scrolling ' + direction + '.'
    if lower in ('double click', 'double-click'):
        pyautogui.doubleClick()
        return 'Double-clicked the item under the pointer.'
    if lower in ('click', 'click here', 'click link', 'click the link',
                 'left click', 'confirm click', 'select this', 'activate this'):
        pyautogui.click()
        return 'Clicked the item under the pointer.'
    if lower in ('right click', 'open context menu'):
        pyautogui.click(button='right')
        return 'Opened the context menu.'
    if lower in ('start drag', 'start dragging', 'begin drag', 'begin dragging',
                 'hold left mouse'):
        started = Gesture_Controller.Controller.start_voice_drag()
        return ('Drag started. Move the pointer, then say “drop” or “release drag”.'
                if started else 'Drag is already active. Move the pointer, then say “drop”.')
    if lower in ('release drag', 'stop dragging', 'drop', 'release mouse',
                 'release left mouse', 'cancel drag'):
        released = Gesture_Controller.Controller.stop_voice_drag()
        return 'Drag released.' if released else 'No voice drag is active.'
    if lower in ('escape', 'press escape', 'cancel dialog'):
        pyautogui.press('esc')
        return 'Cancelled the current dialog.'
    if lower in ('next link', 'next control', 'next item', 'move to next control'):
        pyautogui.press('tab')
        return 'Moved to the next keyboard-accessible control. Say select to activate it.'
    if lower in ('previous link', 'previous control', 'previous item'):
        pyautogui.hotkey('shift', 'tab')
        return 'Moved to the previous keyboard-accessible control.'
    if lower in ('select', 'select control', 'activate selected', 'press enter'):
        pyautogui.press('enter')
        return 'Activated the focused control.'
    if lower in ('focus address bar', 'address bar', 'search bar'):
        pyautogui.hotkey('ctrl', 'l')
        return 'Address bar focused. Say an address or start dictation.'
    find_text = re.match(r'^(?:find|search this page for|search on this page for)\s+(.+)$', phrase, re.IGNORECASE)
    if find_text:
        yield_focus_to_desktop()
        pyautogui.hotkey('ctrl', 'f')
        pyautogui.write(find_text.group(1), interval=0.01)
        pyautogui.press('enter')
        return 'Searching this page for ' + find_text.group(1) + '.'
    if lower in ('new tab', 'open a new tab'):
        pyautogui.hotkey('ctrl', 't')
        return 'Opened a new tab.'
    if lower in ('close tab', 'close this tab'):
        pyautogui.hotkey('ctrl', 'w')
        return 'Closed the current tab.'
    if lower in ('reopen tab', 'reopen closed tab'):
        pyautogui.hotkey('ctrl', 'shift', 't')
        return 'Reopened the last closed tab.'
    if lower in ('switch tab', 'next tab'):
        pyautogui.hotkey('ctrl', 'tab')
        return 'Switched to the next tab.'
    if lower in ('previous tab', 'switch to previous tab'):
        pyautogui.hotkey('ctrl', 'shift', 'tab')
        return 'Switched to the previous tab.'
    if lower in ('switch window', 'switch app', 'next window'):
        pyautogui.hotkey('alt', 'tab')
        return 'Switching windows.'
    if lower in ('close this window', 'close current window'):
        pyautogui.hotkey('alt', 'f4')
        return 'Closing the active window.'
    if lower in ('minimize window', 'minimize this window'):
        pyautogui.hotkey('alt', 'space')
        pyautogui.press('n')
        return 'Minimized the active window.'
    if lower in ('maximize window', 'maximize this window'):
        pyautogui.hotkey('alt', 'space')
        pyautogui.press('x')
        return 'Maximized the active window.'
    if lower in ('show desktop', 'hide all windows'):
        pyautogui.hotkey('win', 'd')
        return 'Showing the desktop.'
    if lower in ('lock computer', 'lock my computer', 'lock laptop'):
        pyautogui.hotkey('win', 'l')
        return 'Locking the computer.'
    shortcuts = {
        'copy': ('ctrl', 'c'), 'copy selection': ('ctrl', 'c'),
        'paste': ('ctrl', 'v'), 'paste clipboard': ('ctrl', 'v'),
        'cut': ('ctrl', 'x'), 'undo': ('ctrl', 'z'), 'redo': ('ctrl', 'y'),
        'select all': ('ctrl', 'a'), 'save': ('ctrl', 's'), 'find': ('ctrl', 'f'),
        'refresh': ('ctrl', 'r'), 'undo that': ('ctrl', 'z'),
    }
    shortcut = next((keys for command, keys in shortcuts.items()
                     if lower == command or lower.startswith(command + ' ')), None)
    if shortcut:
        yield_focus_to_desktop()
        pyautogui.hotkey(*shortcut)
        return lower.split()[0].capitalize() + '.'

    volume = re.match(r'^(?:set\s+)?volume\s+(?:to\s+)?(\d{1,3})(?:\s*percent)?$', lower)
    if volume:
        value = max(0, min(100, int(volume.group(1))))
        Gesture_Controller.Controller.set_volume_percent(value)
        return 'Volume set to ' + str(value) + ' percent.'
    if lower in ('volume up', 'increase volume', 'turn volume up'):
        Gesture_Controller.Controller.adjust_volume_percent(10)
        return 'Volume increased.'
    if lower in ('volume down', 'decrease volume', 'turn volume down'):
        Gesture_Controller.Controller.adjust_volume_percent(-10)
        return 'Volume decreased.'
    if lower == 'mute':
        Gesture_Controller.Controller.set_volume_percent(0)
        return 'Volume muted.'
    brightness = re.match(r'^(?:set\s+)?brightness\s+(?:to\s+)?(\d{1,3})(?:\s*percent)?$', lower)
    if brightness:
        value = max(0, min(100, int(brightness.group(1))))
        Gesture_Controller.Controller.set_brightness_percent(value)
        return 'Brightness set to ' + str(value) + ' percent.'
    if lower in ('brightness up', 'increase brightness', 'brighter screen'):
        Gesture_Controller.Controller.adjust_brightness_percent(10)
        return 'Brightness increased.'
    if lower in ('brightness down', 'decrease brightness', 'dimmer screen'):
        Gesture_Controller.Controller.adjust_brightness_percent(-10)
        return 'Brightness decreased.'
    if lower in ('recalibrate', 'recalibrate cursor', 'reset cursor tracking', 'recenter cursor'):
        if not Gesture_Controller.GestureController.gc_mode:
            return 'Start hand or head control first, then recalibrate in a comfortable neutral position.'
        Gesture_Controller.Controller.request_calibration()
        return 'Recalibrating pointer tracking. Hold a comfortable neutral head or hand position briefly.'

    open_app = re.match(r'^(?:open|launch|start)\s+(?:the\s+)?(?:app\s+)?(.+)$', phrase, re.IGNORECASE)
    if open_app:
        app_name = open_app.group(1).strip().rstrip(' .!?')
        if app_name.lower() in sites:
            webbrowser.open(sites[app_name.lower()])
            return 'Opening ' + app_name + '.'
        open_app_by_name(app_name)
        return 'Opening ' + app_name + '.'
    close_app = re.match(r'^close\s+(?:the\s+)?(?:app\s+)?(.+)$', phrase, re.IGNORECASE)
    if close_app and close_app.group(1).strip().lower() not in ('neo', 'this window', 'current window', 'tab'):
        app_name = close_app.group(1).strip().rstrip(' .!?')
        close_app_by_name(app_name)
        return 'Asked ' + app_name + ' to close. Any unsaved work prompt will remain available.'
    return None

def gesture_controller_worker(controller):
    try:
        controller.start()
    except Exception as exc:
        print('Hand tracking stopped unexpectedly:', exc)
        Gesture_Controller.GestureController.gc_mode = 0
        cap = Gesture_Controller.GestureController.cap
        if cap is not None:
            cap.release()
            Gesture_Controller.GestureController.cap = None
        try:
            Gesture_Controller.cv2.destroyAllWindows()
        except Exception:
            pass
        set_device_state(microphone_available, False, False)
        message = 'Hand tracking stopped: ' + str(exc)
        set_status(message, 'error')
        try:
            app.ChatBot.addAppMsg(message)
        except Exception:
            pass
    else:
        set_status('Hand tracking is off', 'listening')
    finally:
        Gesture_Controller.Controller.set_head_tracking(False)
        set_device_state(microphone_available, False, False)


def stop_browser_head_tracker(timeout=4.0):
    """Stop the Eel/MediaPipe camera before Python hand tracking opens the webcam."""
    try:
        app.eel.stopHeadTracking()
    except Exception as exc:
        print('Could not ask the Neo window to stop head tracking:', exc)
        if not app.ChatBot.browser_tracker_active:
            Gesture_Controller.Controller.set_head_tracking(False)
            return True
    deadline = time.monotonic() + timeout
    while app.ChatBot.browser_tracker_active and time.monotonic() < deadline:
        time.sleep(0.05)
    Gesture_Controller.Controller.set_head_tracking(False)
    return not app.ChatBot.browser_tracker_active


def stop_python_hand_tracker(timeout=4.0):
    """Release OpenCV's webcam before the browser FaceLandmarker requests it."""
    if Gesture_Controller.GestureController.gc_mode:
        Gesture_Controller.GestureController.gc_mode = 0
    deadline = time.monotonic() + timeout
    while (Gesture_Controller.GestureController.gc_mode or
           Gesture_Controller.GestureController.cap is not None) and time.monotonic() < deadline:
        time.sleep(0.05)
    return (not Gesture_Controller.GestureController.gc_mode and
            Gesture_Controller.GestureController.cap is None)

# ------------------Functions----------------------
def reply(audio):
    set_status('Neo is speaking', 'speaking')
    app.ChatBot.addAppMsg(audio)

    print(audio)
    if not speak_with_configured_voice(audio) and engine is not None:
        try:
            engine.say(audio)
            engine.runAndWait()
        except Exception as exc:
            print('Neo could not speak this response:', exc)
    if dictation_target:
        set_status('Dictation is listening', 'dictating')
    else:
        set_status('Listening for “Neo”', 'listening')


def speak_with_configured_voice(text):
    """Speak through the optional neural provider; return False for local fallback."""
    if voice_config.TTS_PROVIDER != 'elevenlabs':
        return False

    api_key = voice_config.ELEVENLABS_API_KEY
    voice_id = voice_config.ELEVENLABS_VOICE_ID
    if not api_key or not voice_id or voice_id == 'PASTE_YOUR_LICENSED_VOICE_ID_HERE':
        print('Neural voice is not configured; using the installed Windows voice.')
        return False

    audio_path = None
    try:
        import winsound

        payload = {
            'text': str(text),
            'model_id': voice_config.ELEVENLABS_MODEL_ID,
            'voice_settings': {
                'stability': 0.55,
                'similarity_boost': 0.75,
                'style': 0.15,
                'use_speaker_boost': True,
            },
        }
        request = urllib.request.Request(
            'https://api.elevenlabs.io/v1/text-to-speech/' +
            urllib.parse.quote(voice_id, safe='') + '?output_format=pcm_22050',
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'xi-api-key': api_key,
                'Content-Type': 'application/json',
                'Accept': 'audio/pcm',
            },
            method='POST',
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            pcm_audio = response.read()

        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_audio:
            audio_path = temp_audio.name
        with wave.open(audio_path, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(22050)
            wav_file.writeframes(pcm_audio)
        winsound.PlaySound(audio_path, winsound.SND_FILENAME)
        return True
    except Exception as exc:
        print('Neo neural voice failed; using the installed Windows voice:', exc)
        return False
    finally:
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except OSError:
                pass


def wish():
    hour = int(datetime.datetime.now().hour)

    if hour>=0 and hour<12:
        reply("Good Morning!")
    elif hour>=12 and hour<18:
        reply("Good Afternoon!")   
    else:
        reply("Good Evening!")  
        
    reply("I am Neo, how may I help you?")

# Set Microphone parameters; keep the dashboard available if Windows denies access.
try:
    with sr.Microphone() as source:
        r.energy_threshold = 500
        r.dynamic_energy_threshold = True
except Exception as exc:
    microphone_available = False
    print('Neo could not open the microphone:', exc)

# Audio to String
def record_audio(status='Listening for “Neo”'):
    global microphone_available
    if not microphone_available:
        set_device_state(False, bool(Gesture_Controller.GestureController.gc_mode),
                         bool(Gesture_Controller.GestureController.gc_mode))
        set_status('Microphone unavailable — check Windows privacy permissions', 'error')
        time.sleep(0.75)
        return ''
    try:
        with sr.Microphone() as source:
            r.pause_threshold = 0.8
            r.dynamic_energy_threshold = True
            set_status(status, 'listening')
            try:
                # Return to the command loop regularly so typed input stays responsive.
                audio = r.listen(source, timeout=1.0, phrase_time_limit=5)
            except sr.WaitTimeoutError:
                return ''
        set_status('Checking what you said', 'processing')
        return r.recognize_google(audio)
    except sr.RequestError:
        reply('Speech recognition is unavailable. Check your Internet connection.')
        set_status('Speech recognition unavailable — check your Internet connection', 'error')
    except sr.UnknownValueError:
        set_status("I couldn't recognize that — try again", 'error')
    except Exception as exc:
        microphone_available = False
        print('Neo lost microphone access:', exc)
        set_device_state(False, bool(Gesture_Controller.GestureController.gc_mode),
                         bool(Gesture_Controller.GestureController.gc_mode))
        set_status('Microphone unavailable — check Windows privacy permissions', 'error')
    return ''


# Executes Commands (input: string)
def respond(voice_data):
    global file_exp_status, files, is_awake, path, dictation_target
    raw_text = (voice_data or '').strip()
    voice_data = raw_text.lower()
    print(raw_text)
    if not raw_text:
        if is_awake:
            reply('I am listening. What can I help you with?')
        return
    app.eel.addUserMsg(raw_text)

    # In dictation mode, the next utterance is literal text, even if it begins
    # with words such as "hello" that also match old static voice commands.
    if dictation_target:
        if (voice_data in ('cancel', 'cancel dictation', 'stop dictation', 'end dictation', 'never mind') or
                re.fullmatch(r'(?:please\s+)?(?:stop|end|cancel) dictation(?:\s+please)?', voice_data)):
            dictation_target = None
            reply('Dictation ended. Your text is in the focused field.')
            return
        try:
            yield_focus_to_desktop()
            pyautogui.write(raw_text, interval=0.005)
            reply('Added that text. Say Neo before the next phrase, or say Neo then stop dictation.')
        except Exception as exc:
            dictation_target = None
            reply('I could not type that text: ' + str(exc))
        return

    if voice_data in ('start dictation', 'begin dictation', 'turn on dictation', 'dictation mode', 'type into this field'):
        dictation_target = 'focused field'
        set_status('Dictation is listening — say the text to type', 'dictating')
        reply('Dictation is ready. Say Neo, then the text to type. Say Neo then stop dictation when finished.')
        return

    if voice_data in ('sleep', 'go to sleep', 'stop listening', 'pause voice control'):
        is_awake = False
        reply('Voice controls paused. Say “Neo” when you want me again.')
        return
    if voice_data in ('wake up', 'resume listening', 'resume voice control'):
        is_awake = True
        reply('I am listening again.')
        return

    # A two-turn dictation flow: "type in Notepad" then speak the text.
    dictation_match = re.match(
        r'^\s*(?:type|write)(?:\s+this)?\s+(?:in|into)\s+notepad(?:\s+(.+))?\s*$',
        raw_text, re.IGNORECASE)
    if dictation_match:
        dictated_text = dictation_match.group(1)
        try:
            open_app_by_name('Notepad')
            if dictated_text:
                pyautogui.write(dictated_text, interval=0.005)
                reply('Typed in Notepad.')
            else:
                dictation_target = 'Notepad'
                set_status('Dictation is listening — Notepad', 'dictating')
                reply('Notepad is ready. Say Neo, then the text to type. Say Neo then stop dictation when finished.')
        except NeoAIError as exc:
            dictation_target = None
            reply(str(exc))
        return

    if re.search(r'\b(?:add|open|new|another)\b.*\btab\b.*\bnotepad\b', voice_data):
        try:
            open_app_by_name('Notepad')
            pyautogui.hotkey('ctrl', 'n')
            reply('Opened a new Notepad tab.')
        except NeoAIError as exc:
            reply(str(exc))
        return

    file_navigation_command = file_exp_status and (
        bool(re.search(r'\bback\b', voice_data)) or
        ('open' in voice_data and bool(re.search(r'\b\d+\b', voice_data))))
    if file_exp_status and not file_navigation_command:
        file_exp_status = False
    tracking_command = canonicalize_tracking_command(raw_text)
    if tracking_command:
        raw_text = tracking_command
        voice_data = tracking_command
    if not file_navigation_command:
        try:
            quick_reply = run_quick_action(raw_text)
        except NeoAIError as exc:
            quick_reply = str(exc)
        except Exception as exc:
            quick_reply = 'That action failed: ' + str(exc)
        if quick_reply:
            reply(quick_reply)
            return

    if is_awake==False:
        if 'wake up' in voice_data:
            is_awake = True
            wish()

    # STATIC CONTROLS
    elif 'hello' in voice_data:
        wish()

    elif 'what is your name' in voice_data:
        reply('My name is Neo!')

    elif re.search(r'\bdate\b', voice_data):
        reply(date.today().strftime("%B %d, %Y"))

    elif re.search(r'\btime\b', voice_data):
        reply(str(datetime.datetime.now()).split(" ")[1].split('.')[0])

    elif 'search' in voice_data:
        query = re.sub(r'^search(?:\s+the\s+web)?(?:\s+for)?\s*', '', voice_data, count=1).strip()
        if not query:
            reply('Tell me what you would like to search for.')
        else:
            reply('Searching for ' + query)
            url = 'https://google.com/search?q=' + urllib.parse.quote_plus(query)
            try:
                webbrowser.get().open(url)
                reply('This is what I found Sir')
            except:
                reply('Please check your Internet')

    elif 'location' in voice_data:
        reply('Which place are you looking for ?')
        temp_audio = record_audio('Listening for a location')
        app.eel.addUserMsg(temp_audio)
        reply('Locating...')
        url = 'https://google.nl/maps/place/' + temp_audio + '/&amp;'
        try:
            webbrowser.get().open(url)
            reply('This is what I found Sir')
        except:
            reply('Please check your Internet')

    elif re.search(r'\b(?:bye|goodbye)\b|\bgood\s+bye\b', voice_data):
        reply("Good bye Sir! Have a nice day.")
        is_awake = False

    elif (voice_data in ('exit', 'terminate', 'quit neo', 'close neo') or
          re.search(r'\b(?:exit|terminate|quit|close)\s+neo\b', voice_data)):
        if Gesture_Controller.GestureController.gc_mode:
            Gesture_Controller.GestureController.gc_mode = 0
        stop_browser_head_tracker(timeout=1.0)
        app.ChatBot.close()
        #sys.exit() always raises SystemExit, Handle it in main loop
        sys.exit()
        
    
    # DYNAMIC CONTROLS
    elif voice_data in ('start head tracking', 'enable head tracking', 'use head tracking',
                        'switch to head tracking'):
        if Gesture_Controller.Controller.head_tracking_enabled:
            reply('Head tracking is already active.')
        elif app.ChatBot.browser_tracker_active:
            try:
                app.eel.startHeadTrackingFromBackend()
                reply('Head tracking is already open. Follow the setup on screen, or cancel it there.')
                set_status('Head tracking setup is open', 'processing')
            except Exception as exc:
                reply('Head tracking setup is already open. Finish or cancel it in Neo. ' + str(exc))
        else:
            try:
                if not stop_python_hand_tracker():
                    raise RuntimeError('Hand tracking did not release the webcam. Stop it and try again.')
                app.eel.startHeadTrackingFromBackend()
                reply('Head tracking setup is on Neo’s screen. Click Allow camera, then Continue and follow the calibration dots.')
                set_status('Starting head tracking in Neo', 'processing')
            except Exception as exc:
                Gesture_Controller.Controller.set_head_tracking(False)
                reply(str(exc))
                set_status(str(exc), 'error')

    elif voice_data in ('stop head tracking', 'disable head tracking', 'use hand tracking',
                        'switch to hand tracking', 'return to hand tracking'):
        if (Gesture_Controller.Controller.head_tracking_enabled or
                app.ChatBot.browser_tracker_active):
            if stop_browser_head_tracker():
                reply('Head tracking is off. You can start hand control or use the keyboard and voice.')
                set_status('Head tracking is off', 'listening')
            else:
                reply('The head tracker did not release the webcam. Close Neo and try again.')
                set_status('Head tracker is still using the camera', 'error')
        else:
            reply('Head tracking is already off.')

    elif any(command in voice_data for command in (
            'launch gesture recognition', 'start gesture recognition',
            'start hand control', 'launch hand control', 'enable hand control',
            'start camera', 'turn on hand control')):
        if Gesture_Controller.GestureController.gc_mode:
            reply('Gesture recognition is already active')
        else:
            try:
                if not stop_browser_head_tracker():
                    raise RuntimeError('Head tracking did not release the webcam. Stop it and try again.')
                gc = Gesture_Controller.GestureController()
                t = Thread(target=gesture_controller_worker, args=(gc,))
                t.daemon = True
                t.start()
                set_device_state(microphone_available, True, True)
                set_status('Hand tracking is active', 'listening')
                reply('Hand tracking is on. The camera preview shows detected actions.')
            except Exception as exc:
                set_device_state(microphone_available, False, False)
                reply(str(exc))
                set_status(str(exc), 'error')

    elif any(command in voice_data for command in (
            'stop gesture recognition', 'top gesture recognition',
            'stop hand control', 'disable hand control', 'stop camera',
            'turn off hand control')):
        if Gesture_Controller.GestureController.gc_mode:
            Gesture_Controller.GestureController.gc_mode = 0
            Gesture_Controller.Controller.set_head_tracking(False)
            set_device_state(microphone_available, False, False)
            reply('Gesture recognition stopped')
        elif (Gesture_Controller.Controller.head_tracking_enabled or
              app.ChatBot.browser_tracker_active):
            if stop_browser_head_tracker():
                reply('Head tracking stopped.')
            else:
                reply('The head tracker did not release the webcam. Close Neo and try again.')
        else:
            reply('Gesture recognition is already inactive')
        
    elif 'copy' in voice_data:
        with keyboard.pressed(Key.ctrl):
            keyboard.press('c')
            keyboard.release('c')
        reply('Copied')
          
    elif 'page' in voice_data or 'pest'  in voice_data or 'paste' in voice_data:
        with keyboard.pressed(Key.ctrl):
            keyboard.press('v')
            keyboard.release('v')
        reply('Pasted')
        
    # File Navigation (Default Folder set to C://)
    elif 'list' in voice_data:
        counter = 0
        path = 'C://'
        files = listdir(path)
        filestr = ""
        for f in files:
            counter+=1
            print(str(counter) + ':  ' + f)
            filestr += str(counter) + ':  ' + f + '<br>'
        file_exp_status = True
        reply('These are the files in your root directory')
        app.ChatBot.addAppMsg(filestr)
        
    elif file_exp_status == True:
        counter = 0   
        if 'open' in voice_data:
            if isfile(join(path,files[int(voice_data.split(' ')[-1])-1])):
                os.startfile(path + files[int(voice_data.split(' ')[-1])-1])
                file_exp_status = False
            else:
                try:
                    path = path + files[int(voice_data.split(' ')[-1])-1] + '//'
                    files = listdir(path)
                    filestr = ""
                    for f in files:
                        counter+=1
                        filestr += str(counter) + ':  ' + f + '<br>'
                        print(str(counter) + ':  ' + f)
                    reply('Opened Successfully')
                    app.ChatBot.addAppMsg(filestr)
                    
                except:
                    reply('You do not have permission to access this folder')
                                    
        if 'back' in voice_data:
            filestr = ""
            if path == 'C://':
                reply('Sorry, this is the root directory')
            else:
                a = path.split('//')[:-2]
                path = '//'.join(a)
                path += '//'
                files = listdir(path)
                for f in files:
                    counter+=1
                    filestr += str(counter) + ':  ' + f + '<br>'
                    print(str(counter) + ':  ' + f)
                reply('ok')
                app.ChatBot.addAppMsg(filestr)
                   
    else:
        set_status('Thinking with local AI', 'processing')
        try:
            reply(neo_ai.handle(voice_data))
        except NeoAIError as exc:
            reply(str(exc))

# ------------------Driver Code--------------------

t1 = Thread(target = app.ChatBot.start)
t1.start()

# Lock main thread until Chatbot has started
while not app.ChatBot.started and t1.is_alive():
    time.sleep(0.5)

if not app.ChatBot.started:
    print('Neo could not open its window. Check the startup error above, then retry.')
    sys.exit(1)

set_device_state(microphone_available, False, False)
wish()
voice_data = None
awaiting_command = False
command_deadline = 0.0
session_active = False
session_deadline = 0.0
while True:
    command_from_voice = False
    if app.ChatBot.isUserInput():
        # Typed dashboard requests are one command and return to wake-word standby.
        voice_data = app.ChatBot.popUserInput()
        awaiting_command = False
        command_deadline = 0.0
        set_status('Processing your message', 'processing')
        command_data = remove_wake_word(voice_data)
    else:
        if awaiting_command and time.monotonic() >= command_deadline:
            awaiting_command = False
            command_deadline = 0.0
            session_deadline = 0.0
            session_active = False
            set_status('Listening for “Neo”', 'listening')
            continue

        if session_active and not awaiting_command and time.monotonic() >= session_deadline:
            session_active = False
            session_deadline = 0.0

        if dictation_target:
            if awaiting_command:
                listen_status = 'Neo heard — say a dictation phrase'
            elif session_active:
                listen_status = 'Dictation active — say another phrase or “sleep”'
            else:
                listen_status = 'Dictation paused — say “Neo” to continue'
        else:
            if awaiting_command:
                listen_status = 'Neo heard — say a command'
            elif session_active:
                listen_status = 'Neo active — say another command or “sleep”'
            else:
                listen_status = 'Listening for “Neo”'
        voice_data = record_audio(listen_status)

        if has_wake_word(voice_data, allow_new=not session_active):
            is_awake = True
            command_data = remove_wake_word(voice_data, allow_new=not session_active)
            if not command_data:
                # A standalone wake word opens a short command window.
                session_active = True
                session_deadline = 0.0
                awaiting_command = True
                command_deadline = time.monotonic() + WAKE_COMMAND_WAIT_SECONDS
                app.ChatBot.addUserMsg('Neo')
                reply("I'm listening. Go ahead with your command.")
                set_status('Neo heard — listening for a command', 'listening')
                continue
        elif awaiting_command or session_active:
            if not voice_data:
                if awaiting_command and time.monotonic() >= command_deadline:
                    awaiting_command = False
                    command_deadline = 0.0
                    session_active = False
                    session_deadline = 0.0
                    set_status('Listening for “Neo”', 'listening')
                elif awaiting_command:
                    set_status('Neo heard — say a command', 'listening')
                elif session_active:
                    set_status('Neo active — say another command or “sleep”', 'listening')
                continue
            command_data = voice_data
        else:
            if voice_data:
                set_status('Say “Neo” or “new” to activate', 'listening')
            continue

        # Consume the first-command slot; after handling, keep a short rolling
        # session so follow-up commands do not need another wake word.
        awaiting_command = False
        command_deadline = 0.0
        command_from_voice = True

    try:
        # Voice reaches commands through the wake word or an active short session.
        respond(command_data)
        if command_from_voice and is_awake:
            session_active = True
            session_deadline = time.monotonic() + ACTIVE_LISTEN_SECONDS
            set_status('Neo active — say another command or “sleep”', 'listening')
        else:
            session_active = False
            session_deadline = 0.0
    except SystemExit:
        reply("Exit Successful")
        break
    except Exception as exc:
        print("Command error:", exc)
        set_status('Something went wrong; listening for “Neo”', 'error')
        


