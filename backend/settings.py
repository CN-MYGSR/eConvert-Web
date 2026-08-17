import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SETTINGS_FILE = DATA_DIR / "settings.json"

DEFAULT_SETTINGS = {
    "dark": False,
    "video_crf": 18,
    "video_height": 0,
    "video_fps": 30,
    "video_codec": "h264",
    "audio_volume": 100,
    "audio_rate": 44100,
    "image_quality": 90,
}


def load_settings():
    stored = {}
    try:
        stored = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    merged = dict(DEFAULT_SETTINGS)
    merged.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS})
    return merged


def save_settings(settings):
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(
            json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass