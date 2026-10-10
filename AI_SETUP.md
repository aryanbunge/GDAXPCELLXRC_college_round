# Neo AI setup

Neo supports Gemini's hosted API for faster responses and Ollama as a local
fallback. The AI integration uses Python's standard library and needs no extra
package in the existing Python 3.8 env.

## Launch Neo like a desktop app

Double-click `Launch-Neo.bat` in the repository folder. On first launch, enter
your Gemini API key when prompted, or press Enter to use local Ollama. Neo
remembers this choice. On later launches, just double-click the same file.
The Gemini key is saved outside the repository in a Windows user-encrypted
file under `%LOCALAPPDATA%\Neo`.

To add a desktop shortcut, right-click `Launch-Neo.bat`, choose **Show more
options** > **Create shortcut**, then move the shortcut to your Desktop. You
can set the shortcut icon later when your team provides the logo. This is a
convenient launcher for the current Python app; it is not yet a packaged
standalone `.exe`.

Neo requires the existing `gest` Conda environment and an installed Miniconda
or Anaconda location. If the launcher cannot find Conda, edit the candidate
paths in `Launch-Neo.ps1` to match your installation.

## Use the hosted Gemini API

1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey).
2. The first time you double-click `Launch-Neo.bat`, paste the key at the
   hidden prompt. The launcher encrypts it for your Windows user and reuses it
   on future launches; it is not written to the project.

For manual PowerShell launch instead, in the same window you will use to
launch Neo, enter:

   ```powershell
   $secureKey = Read-Host "Gemini API key" -AsSecureString
   $env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
   Remove-Variable secureKey
   $env:NEO_AI_PROVIDER = "gemini"
   ```

   The input is masked and held in that PowerShell process environment.
   Close that PowerShell window to clear it. Do not paste the key into chat or
   source files.

3. From the same window, start Neo:

   ```powershell
   Set-Location "C:\Users\aryan_ptanz4j\OneDrive\Desktop\Bnb\Gesture-Controlled-Virtual-Mouse-main\src"
   & "C:\Users\aryan_ptanz4j\miniconda3\Scripts\conda.exe" run --name gest python .\Proton.py
   ```

Neo uses `gemini-3.1-flash-lite` by default for this provider. It is designed
for speed. The free API tier has usage quotas and rate limits; it is not
unlimited. The Gemini API's free tier may use submitted content to improve
Google products, so avoid dictating passwords or sensitive information.

## Use local Ollama instead

Without `GEMINI_API_KEY`, Neo defaults to Ollama and `qwen3.5:0.8b`. Install
[Ollama for Windows](https://ollama.com/download/windows), then run:

```powershell
ollama pull qwen3.5:0.8b
```

Leave Ollama running before starting Neo. Local AI avoids hosted token quotas,
but response speed depends on the laptop. To explicitly select local AI even
when a key is set:

```powershell
$env:NEO_AI_PROVIDER = "ollama"
```

For stronger local responses (at some speed cost), run `ollama pull
qwen3.5:2b` and set `$env:NEO_AI_MODEL = "qwen3.5:2b"` before launching Neo.

## Current AI actions and limits

- Answer questions, open a named website, or search the web.
- Open an explicitly named app through Windows Search (for example, “Neo, open
  Calculator”).
- Close a visible app window by title (for example, “Neo, close Notepad”), or
  close the foreground window (“Neo, close this window”). Apps can still show
  their normal save-before-close prompt.
- Switch windows, minimize/maximize/restore the current window, show the desktop,
  or lock Windows.
- Use explicit common keyboard commands: copy/paste/undo/save/find, browser
  tabs and address bar, Enter/Escape/Tab, arrows, Home/End, and Page Up/Down.
- Go back or forward, scroll, or click at the current pointer.
- Type explicitly dictated text into the currently focused field.
- App opening searches by app name. Model-provided shell commands and file paths
  are never executed. Use explicit commands and verify the foreground window
  before close, click, or keyboard actions.

Common computer actions are also routed directly, without waiting on Gemini or
Ollama. Say “Neo” and then use commands such as “open Notepad”, “close
Notepad”, “open website example.com”, “go back”, “scroll down”, “new tab”,
“next control”, “select”, “volume up”, “set brightness to 40 percent”, “show
desktop”, or “recalibrate cursor”. “Next control” uses the website's keyboard
tab order; say “select” only after checking the focused control. “Neo, click”
activates the target under the hand cursor.

For voice typing, focus the field you want first, say “start dictation”, then
speak the text. Dictation stays on for several phrases; say “stop dictation” or
“cancel” to leave it. To use Notepad, say “type in Notepad”, wait for Neo's
ready message, and then speak the text. Neo types into the already focused
Notepad window instead of reopening it.

## Hand control and calibration

Start or stop hand control from the dashboard or say “start hand control” / “stop
hand control”. The webcam preview displays the detected pose and its action.
Current mappings are:

- Show a **V sign** to move the cursor. Keep the V sign visible to arm the
  deliberate hand click gestures.
- Change from V sign to **middle finger** for left click, **index finger** for
  right click, or bring index and middle fingers together for double click.
- Make a **fist** to hold left mouse down while moving; open your hand to
  release. Show an **open palm** to return to the neutral/no-action pose.
- With the **left hand**, pinch thumb and index; move primarily up/down to
  scroll vertically or sideways to scroll horizontally.
- With the **right hand**, pinch thumb and index; move primarily sideways to
  adjust brightness or up/down to adjust volume.

If posture changes, say “recalibrate cursor” or press **Recalibrate**. Neo
rebases movement tracking on the next camera frame while leaving the cursor in
place; the one-step reset takes less than 30 seconds. This is a quick tracking
reset, not a four-corner screen calibration.
The camera turns off when hand control stops. The current project supports the
existing hand-tracking path; head-pose cursor control is not implemented.

## Browser compatibility

Neo opens websites in the Windows default browser and sends navigation,
keyboard, and pointer input at the operating-system level. It does not install
a browser extension or inspect page contents. Back/forward, tabs, scrolling,
keyboard-accessible links, focused-field dictation, and pointing at visible
controls work through ordinary browser input. A page's Tab order and focus
indicators vary, so Neo cannot reliably select a control by its spoken label on
every site. Use **next control** and **select**, or point and say **click**.

See [EVALUATION.md](EVALUATION.md) for the reproducible task-time, command
accuracy, selection error, and accidental-activation protocol.

For combined pointing and voice activation, point the existing gesture cursor
at a target and say a clear command such as “Neo, click.” Neo cannot inspect the
contents or controls of every website or app. The existing speech recognizer
still uses Google's speech recognition service for voice-to-text; Gemini gets
the resulting transcript, not the microphone audio, from this integration.

After saying “Neo,” Neo now stays in an active voice-command session for up to
60 seconds after each command, so short follow-up exchanges do not need the wake
word repeated. For dictation, say “type in Notepad,” wait for “Notepad dictation
is ready,” then say the words to type. Say “cancel” to stop. You can also say
“type in Notepad [words]” in one utterance. To start another Notepad tab, say
“add another tab on Notepad.”

## Troubleshooting

- **Microphone or webcam unavailable**: in Windows, open **Settings > Privacy &
  security > Microphone** and enable access for desktop apps. Check the Camera
  privacy setting as well. Close another app that may have exclusive access to
  the webcam, then restart Neo.
- **Gemini rejects the key (HTTP 401)**: set `GEMINI_API_KEY` again and check
  that it is a Gemini API key.
- **Gemini quota error (HTTP 429)**: check AI Studio's rate limits and wait for
  quota reset. The free tier is limited.
- **Slow or unavailable Gemini**: confirm the same PowerShell window has the
  key and internet access. Set `$env:NEO_AI_PROVIDER = "ollama"` to use local
  mode instead.
