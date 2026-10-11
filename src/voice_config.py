"""Optional voice configuration for Neo's speech output.

Default mode uses the installed Windows SAPI voice. To use a provider voice,
set NEO_TTS_PROVIDER=elevenlabs and provide an API key plus voice ID through
environment variables. Keep API keys out of source control.
"""

import os


TTS_PROVIDER = os.environ.get('NEO_TTS_PROVIDER', 'sapi5').strip().lower()
ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY', '').strip()
ELEVENLABS_VOICE_ID = os.environ.get(
    'NEO_ELEVENLABS_VOICE_ID', 'PASTE_YOUR_LICENSED_VOICE_ID_HERE'
).strip()
ELEVENLABS_MODEL_ID = os.environ.get(
    'NEO_ELEVENLABS_MODEL_ID', 'eleven_flash_v2_5'
).strip()

# Paste this into the provider's Voice Design prompt to make an original,
# polished assistant voice without copying a particular actor or character.
VOICE_DESIGN_PROMPT = (
    'An original British English voice for a helpful desktop assistant. '
    'Calm, composed, mid-low register, crisp diction, measured conversational '
    'pace, restrained warmth, and subtle dry wit. Give it a distinct identity.'
)
