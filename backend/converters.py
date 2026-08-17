import math
import os
import shutil
import threading
from pathlib import Path

_BASE = Path(__file__).resolve().parent.parent


def _app_root():
    return _BASE


_FFMPEG_CANDIDATES = [
    _app_root() / "assets" / "ffmpeg-master-latest-win64-gpl" / "bin" / "ffmpeg.exe",
    _app_root() / "assets" / "ffmpeg" / "bin" / "ffmpeg.exe",
    Path(r"C:\DevTools\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"),
]


def _find_ffmpeg():
    override = os.environ.get("ECONVERT_FFMPEG")
    if override:
        p = Path(override)
        if p.is_file():
            return p
    for cand in _FFMPEG_CANDIDATES:
        if cand.is_file():
            return cand
    which = shutil.which("ffmpeg")
    if which:
        return Path(which)
    return _FFMPEG_CANDIDATES[0]


FFMPEG_PATH = str(_find_ffmpeg())
FFPROBE_PATH = os.path.join(os.path.dirname(FFMPEG_PATH), "ffprobe.exe")
FFMPEG_READY = os.path.isfile(FFMPEG_PATH)

if FFMPEG_READY:
    os.environ["FFMPEG_BINARY"] = FFMPEG_PATH
    ffmpeg_dir = os.path.dirname(FFMPEG_PATH)
    if ffmpeg_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
    from pydub import AudioSegment
    AudioSegment.converter = FFMPEG_PATH
    AudioSegment.ffprobe = FFPROBE_PATH


class CancelledError(Exception):
    pass


def fmt_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def unique_path(path: Path) -> Path:
    path = Path(path)
    if not path.exists():
        return path
    for i in range(1, 10000):
        cand = path.with_name(f"{path.stem} ({i}){path.suffix}")
        if not cand.exists():
            return cand
    return path.with_name(f"{path.stem} ({id(path)}){path.suffix}")


def pdf_to_word(pdf_path: Path, docx_path: Path, on_page=None, cancel=None):
    from pdf2docx import Converter
    cv = Converter(str(pdf_path))
    try:
        try:
            from docx import Document
            cv.parse(start=0, end=None)
            pages = [p for p in cv._pages if p.finalized]
            if pages:
                doc = Document()
                for idx, page in enumerate(pages, 1):
                    if cancel is not None and cancel.is_set():
                        raise CancelledError()
                    page.make_docx(doc)
                    if on_page:
                        on_page(idx, len(pages))
                doc.save(str(docx_path))
                return
        except CancelledError:
            raise
        except Exception:
            pass
        if docx_path.exists():
            docx_path.unlink(missing_ok=True)
        cv.convert(str(docx_path))
    finally:
        cv.close()


AUDIO_TARGETS = {
    "MP3":  {"ext": "mp3",  "format": "mp3",  "codec": "libmp3lame"},
    "WAV":  {"ext": "wav",  "format": "wav",  "codec": "pcm_s16le"},
    "FLAC": {"ext": "flac", "format": "flac", "codec": "flac"},
    "OGG":  {"ext": "ogg",  "format": "ogg",  "codec": "libvorbis"},
    "M4A":  {"ext": "m4a",  "format": "ipod", "codec": "aac"},
    "OPUS": {"ext": "opus", "format": "opus", "codec": "libopus"},
}
AUDIO_EXTENSIONS = {"mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma",
                    "aiff", "aif", "amr", "mka", "mp2", "m4b"}


def convert_audio(src: Path, dst: Path, target: str, a_cfg=None):
    from pydub import AudioSegment
    a_cfg = a_cfg or {}
    cfg = AUDIO_TARGETS[target]
    seg = AudioSegment.from_file(str(src))
    volume = int(a_cfg.get("volume", 100) or 100)
    rate = int(a_cfg.get("rate", 0) or 0)
    if volume != 100:
        seg = seg.apply_gain(20.0 * math.log10(max(volume, 1) / 100.0))
    if rate:
        seg = seg.set_frame_rate(rate)
    seg.export(str(dst), format=cfg["format"], codec=cfg["codec"])


def to_rgb_with_alpha(im):
    bg = im.convert("RGB")
    rgb = im.convert("RGBA")
    alpha = rgb.split()[-1]
    bg.paste(rgb, mask=alpha)
    return bg


def convert_image(src: Path, dst: Path, target: str, quality=None):
    from PIL import Image, ImageOps
    fmt = target.upper()
    q = int(quality) if quality is not None else 90
    q = min(max(q, 1), 100)
    with Image.open(str(src)) as im:
        im = ImageOps.exif_transpose(im)
        if fmt == "JPG":
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                im = to_rgb_with_alpha(im)
            elif im.mode != "RGB":
                im = im.convert("RGB")
            im.save(str(dst), format="JPEG", quality=q, subsampling=1, optimize=True)
        elif fmt == "WEBP":
            im.save(str(dst), format="WEBP", quality=q, method=6)
        elif fmt == "PNG":
            im.save(str(dst), format="PNG",
                    compress_level=round(q / 100.0 * 9), optimize=True)
        elif fmt == "ICO":
            im.save(str(dst), format="ICO",
                    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        else:
            im.save(str(dst), format=fmt)


VIDEO_TARGETS = {
    "MP4":  {"ext": "mp4",  "codec": "libx264", "audio_codec": "aac"},
    "MKV":  {"ext": "mkv",  "codec": "libx264", "audio_codec": "aac"},
    "MOV":  {"ext": "mov",  "codec": "libx264", "audio_codec": "aac"},
    "AVI":  {"ext": "avi",  "codec": "libx264", "audio_codec": "mp3"},
    "WEBM": {"ext": "webm", "codec": "libvpx",  "audio_codec": "libvorbis"},
    "GIF":  {"ext": "gif",  "codec": None,      "audio_codec": None},
}

VIDEO_CODECS = {
    "h264": "libx264",
    "h265": "libx265",
    "av1": "libsvtav1",
}


def convert_video(src: Path, dst: Path, target: str, v_cfg=None):
    from moviepy import VideoFileClip
    v_cfg = v_cfg or {}
    clip = VideoFileClip(str(src))
    try:
        if target == "GIF":
            fps = int(v_cfg.get("fps", 15) or 15)
            clip.write_gif(str(dst), fps=min(max(fps, 5), 30))
            return
        cfg = VIDEO_TARGETS[target]
        has_audio = clip.audio is not None

        height = int(v_cfg.get("height", 0) or 0)
        if height and abs(int(clip.size[1]) - height) > 1:
            clip = clip.resized(height=height)

        codec_name = VIDEO_CODECS.get(str(v_cfg.get("codec", "h264")), "libx264")
        if target == "WEBM" and codec_name in ("libx264", "libx265"):
            codec_name = "libvpx-vp9"

        crf = int(v_cfg.get("crf", 18) or 18)
        fps = int(v_cfg.get("fps", 30) or 30)
        preset = "6" if codec_name == "libsvtav1" else "medium"
        ff_params = ["-crf", str(crf)]

        volume = int(v_cfg.get("volume", 100) or 100)
        rate = int(v_cfg.get("rate", 0) or 0)
        temp_audio = None
        audio_clip = clip
        if has_audio and (volume != 100 or rate):
            from pydub import AudioSegment
            from moviepy import AudioFileClip
            seg = AudioSegment.from_file(str(src))
            if volume != 100:
                seg = seg.apply_gain(20.0 * math.log10(max(volume, 1) / 100.0))
            if rate:
                seg = seg.set_frame_rate(rate)
            temp_audio = dst.with_name(f"{dst.stem}_tmp_audio.wav")
            seg.export(str(temp_audio), format="wav")
            audio_clip = AudioFileClip(str(temp_audio))
            clip = clip.with_audio(audio_clip)

        try:
            clip.write_videofile(
                str(dst),
                fps=fps,
                codec=codec_name,
                audio=has_audio,
                audio_codec=cfg["audio_codec"] if has_audio else None,
                preset=preset,
                ffmpeg_params=ff_params,
                logger=None,
            )
        finally:
            if temp_audio:
                try:
                    audio_clip.close()
                except Exception:
                    pass
                temp_audio.unlink(missing_ok=True)
    finally:
        try:
            clip.close()
        except Exception:
            pass


def IMG_TARGETS():
    from PIL import Image as PILImage
    return {
        "PNG":  {"ext": "png"},
        "JPG":  {"ext": "jpg"},
        "WEBP": {"ext": "webp"},
        "GIF":  {"ext": "gif"},
        "BMP":  {"ext": "bmp"},
        "TIFF": {"ext": "tiff"},
        "ICO":  {"ext": "ico"},
    }