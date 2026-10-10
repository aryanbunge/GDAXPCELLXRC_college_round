#!/usr/bin/env bash
# OPTIONAL. The extension already bundles MediaPipe. It downloads the face model the first time
# you use it and keeps it. Run this only if you want the model packaged inside the folder
# (useful for offline demos).
set -e
mkdir -p models
curl -L -o models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
echo "Model saved to models/. Reload the extension."
