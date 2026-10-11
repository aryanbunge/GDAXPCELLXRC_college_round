"""Local Ollama assistant and narrowly-scoped desktop actions for Neo.

This module intentionally exposes a small action allowlist. Model output is
untrusted input and is never executed as Python, PowerShell, or a shell command.
"""
from __future__ import print_function

import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
PROVIDER = os.environ.get(
    "NEO_AI_PROVIDER", "gemini" if GEMINI_API_KEY else "ollama").strip().lower()
BASE_URL = os.environ.get("NEO_AI_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
# Accept either the Ollama server root or its /api base URL.
if PROVIDER == "ollama" and BASE_URL.endswith("/api"):
    BASE_URL = BASE_URL[:-4]
DEFAULT_MODEL = "gemini-3.1-flash-lite" if PROVIDER == "gemini" else "qwen3.5:4b"
MODEL = os.environ.get("NEO_AI_MODEL", DEFAULT_MODEL)
TIMEOUT_SECONDS = 45 if PROVIDER == "gemini" else 180

SYSTEM_PROMPT = """You are Neo, a concise hands-free computer assistant. Return one JSON object only:
{"kind":"reply","message":"...","name":"none","arguments":{}}
{"kind":"action","name":"open_app","arguments":{"app":"Calculator"},"message":"..."}
{"kind":"action","name":"close_app","arguments":{"app":"Notepad"},"message":"..."}
{"kind":"action","name":"window_action","arguments":{"action":"switch|close_current|minimize|maximize|restore|show_desktop|lock"},"message":"..."}
{"kind":"action","name":"key_command","arguments":{"command":"copy|paste|cut|undo|redo|select_all|save|find|address_bar|new_tab|close_tab|reopen_tab|next_tab|previous_tab|refresh|enter|escape|tab|shift_tab|backspace|delete|up|down|left|right|home|end|page_up|page_down"},"message":"..."}
{"kind":"action","name":"open_url","arguments":{"url":"https://example.com"},"message":"..."}
{"kind":"action","name":"search_web","arguments":{"query":"..."},"message":"..."}
{"kind":"action","name":"browser_back","arguments":{},"message":"..."}
{"kind":"action","name":"browser_forward","arguments":{},"message":"..."}
{"kind":"action","name":"scroll","arguments":{"direction":"up|down","amount":1},"message":"..."}
{"kind":"action","name":"click","arguments":{"button":"left|right"},"message":"..."}
{"kind":"action","name":"type_text","arguments":{"text":"exact text requested by the user"},"message":"..."}
Use an action only when the user clearly asks for it. Click at the current
pointer. Open apps by app name only; never pass a command or file path. Close
only the named app window or the explicitly requested foreground window. Use
keyboard actions only when explicitly requested. Type only the exact text the
user dictates. Never invent URLs or claim an action succeeded unless requested
by the schema. Keep answers brief. Every response must include name and
arguments; use name "none" and {} for a normal reply."""

GEMINI_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["reply", "action"]},
        "message": {"type": "string"},
        "name": {"type": "string", "enum": [
            "open_app", "close_app", "window_action", "key_command", "open_url",
            "search_web", "browser_back", "browser_forward", "scroll", "click",
            "type_text", "none"]},
        "arguments": {
            "type": "object",
            "properties": {
                "app": {"type": "string"},
                "action": {"type": "string", "enum": [
                    "switch", "close_current", "minimize", "maximize", "restore",
                    "show_desktop", "lock"]},
                "command": {"type": "string", "enum": [
                    "copy", "paste", "cut", "undo", "redo", "select_all", "save",
                    "find", "address_bar", "new_tab", "close_tab", "reopen_tab",
                    "next_tab", "previous_tab", "refresh", "enter", "escape", "tab",
                    "shift_tab", "backspace", "delete", "up", "down", "left", "right",
                    "home", "end", "page_up", "page_down"]},
                "url": {"type": "string"},
                "query": {"type": "string"},
                "direction": {"type": "string", "enum": ["up", "down"]},
                "amount": {"type": "integer", "minimum": 1, "maximum": 5},
                "button": {"type": "string", "enum": ["left", "right"]},
                "text": {"type": "string"},
            },
        },
    },
    "required": ["kind", "message", "name", "arguments"],
}


class NeoAIError(Exception):
    pass


def open_app_by_name(app_name):
    """Open or focus an app using Windows Search, without invoking a shell."""
    import pyautogui
    app_name = str(app_name or "").strip()
    if not re.match(r"^[A-Za-z0-9 ._&()'-]{1,60}$", app_name):
        raise NeoAIError("Tell me the app's name, for example, open Calculator.")
    pyautogui.hotkey("win", "s")
    time.sleep(0.5)
    pyautogui.write(app_name, interval=0.015)
    time.sleep(1.0)
    pyautogui.press("enter")  # launch the top Windows Search result
    time.sleep(1.2)


def close_app_by_name(app_name):
    """Ask a named visible window to close, allowing its normal save prompt."""
    app_name = str(app_name or "").strip()
    if not re.match(r"^[A-Za-z0-9 ._&()'-]{1,60}$", app_name):
        raise NeoAIError("Tell me the app name, for example, close Notepad.")
    try:
        import win32con
        import win32gui
    except ImportError as exc:
        raise NeoAIError("Closing a named app needs pywin32 in Neo's gest environment.") from exc
    matches = []

    def find_app_window(hwnd, _extra):
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd).strip()
            if title and app_name.casefold() in title.casefold():
                matches.append(hwnd)

    win32gui.EnumWindows(find_app_window, None)
    if not matches:
        raise NeoAIError(
            "I couldn't find a visible window with '" + app_name + "' in its title. "
            "Try switching to it and saying 'close this window'.")
    win32gui.PostMessage(matches[0], win32con.WM_CLOSE, 0, 0)


def _focus_app_behind_neo(pyautogui):
    """Return focus to the last desktop app when a command came from Neo's UI."""
    try:
        import win32gui
        hwnd = win32gui.GetForegroundWindow()
        title = win32gui.GetWindowText(hwnd).lower()
        if "hands-free computer control" in title:
            pyautogui.hotkey("alt", "tab")
            time.sleep(0.18)
    except Exception:
        # The voice path may already have the target app focused.
        pass
    time.sleep(0.2)


def _chat_request(messages):
    if PROVIDER == "gemini":
        if not GEMINI_API_KEY:
            raise NeoAIError(
                "Gemini API key is missing. Set GEMINI_API_KEY in PowerShell, "
                "or set NEO_AI_PROVIDER to ollama.")
        url = ("https://generativelanguage.googleapis.com/v1beta/models/"
               + urllib.parse.quote(MODEL, safe="") + ":generateContent")
        system_text = "\n".join(
            item["content"] for item in messages if item.get("role") == "system")
        contents = []
        for item in messages:
            role = item.get("role")
            if role == "system":
                continue
            contents.append({
                "role": "user" if role == "user" else "model",
                "parts": [{"text": item.get("content", "")}],
            })
        body = {
            "systemInstruction": {"parts": [{"text": system_text}]},
            "contents": contents,
            "generationConfig": {
                # Gemini's GenerateContent endpoint accepts these stable fields;
                # its newer responseFormat wrapper was rejected by this API key's
                # endpoint despite the value being application/json.
                "responseMimeType": "application/json",
                "responseSchema": GEMINI_RESPONSE_SCHEMA,
                "maxOutputTokens": 256,
                "thinkingConfig": {"thinkingLevel": "minimal"},
                "temperature": 0.2,
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
        }
    elif PROVIDER == "ollama":
        url = BASE_URL + "/api/chat"
        body = {
            "model": MODEL,
            "messages": messages,
            "stream": False,
            "format": "json",
            "think": False,
            "keep_alive": "10m",
            "options": {"temperature": 0.2, "num_ctx": 2048, "num_predict": 128},
        }
        headers = {"Content-Type": "application/json"}
    else:
        raise NeoAIError("Unknown AI provider. Set NEO_AI_PROVIDER to gemini or ollama.")

    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            error_payload = json.loads(exc.read().decode("utf-8"))
            provider_error = error_payload.get("error", "")
            if isinstance(provider_error, dict):
                detail = str(provider_error.get("message", ""))[:500]
            else:
                detail = str(provider_error)[:500]
        except (ValueError, AttributeError, TypeError):
            detail = ""
        if PROVIDER == "gemini" and exc.code == 401:
            raise NeoAIError("Gemini rejected the API key. Check GEMINI_API_KEY.") from exc
        if PROVIDER == "gemini" and exc.code == 429:
            raise NeoAIError(
                "Gemini's free-tier rate limit was reached. Wait for its quota to reset, "
                "or check your AI Studio usage limits.") from exc
        if PROVIDER == "ollama" and exc.code == 404:
            if "model" in detail.lower() and "not found" in detail.lower():
                raise NeoAIError(
                    "Ollama does not have model " + MODEL + ". In PowerShell, run: ollama pull " + MODEL) from exc
            raise NeoAIError(
                "Ollama returned HTTP 404 at " + url + ". Check that Ollama is running and "
                "NEO_AI_BASE_URL is the server root (for example, http://127.0.0.1:11434).") from exc
        message = PROVIDER + " API returned HTTP " + str(exc.code) + "."
        if detail:
            message += " " + detail
        else:
            message += " Check the provider, model name, and API settings."
        raise NeoAIError(message) from exc
    except socket.timeout as exc:
        if PROVIDER == "gemini":
            raise NeoAIError("Gemini did not answer within 45 seconds. Try again.") from exc
        raise NeoAIError("Ollama is reachable but did not answer within three minutes.") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise NeoAIError(
            ("Could not reach Gemini. Check the internet connection and API key."
             if PROVIDER == "gemini" else
             "Local AI is not connected. Start Ollama and run ollama pull "
             + MODEL + ". Neo's existing commands still work.")) from exc
    except (ValueError, KeyError) as exc:
        raise NeoAIError("The AI provider returned an unreadable response.") from exc
    try:
        if PROVIDER == "gemini":
            candidates = data.get("candidates") or []
            if not candidates:
                raise NeoAIError(
                    "Gemini returned no answer. Check the prompt, API quota, and AI Studio status.")
            parts = candidates[0].get("content", {}).get("parts", [])
            content = next((part.get("text") for part in parts if part.get("text")), None)
        else:
            content = data["message"]["content"]
        return _parse_result(content)
    except NeoAIError:
        raise
    except (ValueError, KeyError, TypeError) as exc:
        raise NeoAIError("The AI response was not valid JSON.") from exc


def _parse_result(content):
    """Parse JSON even when a provider wraps it in fences or explanatory text."""
    if isinstance(content, list):
        # Some OpenAI-compatible endpoints return content as typed text parts.
        content = "\n".join(
            part.get("text", "") for part in content if isinstance(part, dict))
    if isinstance(content, dict):
        result = content
    elif isinstance(content, str):
        value = content.strip()
        if value.startswith("```"):
            value = re.sub(r"^```(?:json)?\s*|\s*```$", "", value,
                           flags=re.IGNORECASE).strip()
        try:
            result = json.loads(value)
        except ValueError:
            # Recover a complete JSON object embedded in surrounding prose.
            start = value.find("{")
            if start < 0:
                raise
            result, _ = json.JSONDecoder().raw_decode(value[start:])
    else:
        raise TypeError("Unsupported AI response content")
    if not isinstance(result, dict):
        raise ValueError("AI response must be a JSON object")
    return result


def _validated_url(value):
    url = str(value or "").strip()
    if not re.match(r"^https?://", url, re.IGNORECASE):
        # Accept a clearly spoken hostname, but never schemes such as file: or javascript:.
        if not re.match(r"^[\w.-]+\.[a-z]{2,}([/:?#]|$)", url, re.IGNORECASE):
            raise NeoAIError("Please say a website address, such as example.com.")
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise NeoAIError("I can only open regular http or https websites.")
    return url


def _dispatch(result):
    if not isinstance(result, dict):
        raise NeoAIError("The local AI returned an invalid action.")
    message = str(result.get("message") or "Done.")[:300]
    if result.get("kind") == "reply":
        return message
    if result.get("kind") != "action":
        raise NeoAIError("I couldn't interpret that request. Please try again.")

    name = result.get("name")
    args = result.get("arguments") or {}
    if not isinstance(args, dict):
        raise NeoAIError("The local AI returned invalid action details.")

    if name == "open_app":
        app_name = str(args.get("app") or "").strip()
        # Use Windows app search, never a shell or model-supplied executable path.
        open_app_by_name(app_name)
    elif name == "close_app":
        app_name = str(args.get("app") or "").strip()
        # WM_CLOSE lets the app ask whether to save unsaved work.
        close_app_by_name(app_name)
    elif name == "window_action":
        import pyautogui
        action = args.get("action")
        if action == "switch":
            pyautogui.hotkey("alt", "tab")
        elif action == "close_current":
            _focus_app_behind_neo(pyautogui)
            pyautogui.hotkey("alt", "f4")
        elif action == "minimize":
            _focus_app_behind_neo(pyautogui)
            pyautogui.hotkey("alt", "space")
            pyautogui.press("n")
        elif action == "maximize":
            _focus_app_behind_neo(pyautogui)
            pyautogui.hotkey("alt", "space")
            pyautogui.press("x")
        elif action == "restore":
            _focus_app_behind_neo(pyautogui)
            pyautogui.hotkey("alt", "space")
            pyautogui.press("r")
        elif action == "show_desktop":
            pyautogui.hotkey("win", "d")
        elif action == "lock":
            pyautogui.hotkey("win", "l")
        else:
            raise NeoAIError("That window command is not enabled.")
    elif name == "key_command":
        import pyautogui
        _focus_app_behind_neo(pyautogui)
        command = args.get("command")
        combos = {
            "copy": ("ctrl", "c"), "paste": ("ctrl", "v"),
            "cut": ("ctrl", "x"), "undo": ("ctrl", "z"),
            "redo": ("ctrl", "y"), "select_all": ("ctrl", "a"),
            "save": ("ctrl", "s"), "find": ("ctrl", "f"),
            "address_bar": ("ctrl", "l"), "new_tab": ("ctrl", "t"),
            "close_tab": ("ctrl", "w"), "reopen_tab": ("ctrl", "shift", "t"),
            "next_tab": ("ctrl", "tab"), "previous_tab": ("ctrl", "shift", "tab"),
            "refresh": ("ctrl", "r"), "shift_tab": ("shift", "tab"),
        }
        keys = {
            "enter": "enter", "escape": "esc", "tab": "tab",
            "backspace": "backspace", "delete": "delete", "up": "up",
            "down": "down", "left": "left", "right": "right",
            "home": "home", "end": "end", "page_up": "pageup", "page_down": "pagedown",
        }
        if command in combos:
            pyautogui.hotkey(*combos[command])
        elif command in keys:
            pyautogui.press(keys[command])
        else:
            raise NeoAIError("That keyboard command is not enabled.")
    elif name == "open_url":
        webbrowser.open(_validated_url(args.get("url")))
    elif name == "search_web":
        query = str(args.get("query") or "").strip()[:500]
        if not query:
            raise NeoAIError("What would you like me to search for?")
        webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote_plus(query))
    elif name in ("browser_back", "browser_forward"):
        import pyautogui
        _focus_app_behind_neo(pyautogui)
        pyautogui.hotkey("alt", "left" if name == "browser_back" else "right")
    elif name == "scroll":
        import pyautogui
        _focus_app_behind_neo(pyautogui)
        direction = args.get("direction")
        if direction not in ("up", "down"):
            raise NeoAIError("Scroll direction must be up or down.")
        amount = max(1, min(5, int(args.get("amount", 2))))
        pyautogui.scroll(amount if direction == "up" else -amount)
    elif name == "click":
        import pyautogui
        _focus_app_behind_neo(pyautogui)
        button = args.get("button", "left")
        if button not in ("left", "right"):
            raise NeoAIError("I can only left or right click.")
        pyautogui.click(button=button)
    elif name == "type_text":
        import pyautogui
        _focus_app_behind_neo(pyautogui)
        text = args.get("text")
        if not isinstance(text, str) or not text.strip():
            raise NeoAIError("Tell me exactly what text to type.")
        if len(text) > 1000:
            raise NeoAIError("For safety, voice typing is limited to 1,000 characters at a time.")
        pyautogui.write(text, interval=0.01)
    else:
        # A model cannot expand the capability set by inventing a tool name.
        raise NeoAIError("That computer action is not enabled in Neo.")
    return message


class NeoAssistant(object):
    """Small bounded conversation history; all computer actions are allowlisted."""
    def __init__(self):
        self.history = []

    def handle(self, user_text):
        text = str(user_text or "").strip()
        if not text:
            return "Tell me what you would like help with."
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(self.history[-4:])
        messages.append({"role": "user", "content": text[:2000]})
        result = _chat_request(messages)
        answer = _dispatch(result)
        self.history.extend([
            {"role": "user", "content": text[:2000]},
            {"role": "assistant", "content": json.dumps(result, ensure_ascii=False)},
        ])
        self.history = self.history[-4:]
        return answer