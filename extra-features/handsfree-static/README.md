# Handsfree 2.0

Browse with your head and voice using a normal webcam and microphone.

## Install (about 3 minutes)
1. Unzip this folder.
2. Open chrome://extensions, turn on Developer mode, choose "Load unpacked", select this folder.
3. The setup page opens by itself. Follow the 5 steps. The face model (about 4 MB) downloads once, then works offline.
4. After setup: click the extension icon, press Start in the tracker window, open any website.

No npm or build step is needed. MediaPipe is bundled in lib/.
Optional: run ./setup.sh to put the face model inside the folder (useful for offline demos).

## Pages
- app.html            setup flow
- app.html#settings   settings (dwell time, sensitivity, cursor size, dwell on/off)
- app.html#diagnostics camera, light and voice test

## Calibration
Gentle by design: five poses (centre, left, right, up, down). Move only as far as is comfortable; your own range is stretched across the whole screen.
- Skip this dot, Quick setup (centre only) and Cancel are on screen. On web pages say "skip" or "stop", or press Esc.
- Very small movements automatically get high sensitivity. Fine tune it in Settings.
