import io
import shutil
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.responses import Response

from . import converters
from .jobs import OUTPUTS_DIR, UPLOADS_DIR, JobManager, UploadStore
from .settings import DEFAULT_SETTINGS, load_settings, save_settings

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

ALLOWED = {
    "pdf": {"docx": "docx"},
    "audio": converters.AUDIO_TARGETS,
    "image": converters.IMG_TARGETS(),
    "video": converters.VIDEO_TARGETS,
}

@asynccontextmanager
async def lifespan(app):
    for d in (UPLOADS_DIR, OUTPUTS_DIR):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="eConvert Web", version="1.0", lifespan=lifespan)
jobs = JobManager()
uploads = UploadStore()


class ConvertRequest(BaseModel):
    mode: str
    target: str
    file_ids: list[str]
    settings: dict = {}


def _validate(mode, target):
    if mode not in ALLOWED:
        raise HTTPException(400, f"未知的转换类型: {mode}")
    if target not in ALLOWED[mode]:
        raise HTTPException(400, f"未知的目标格式: {target}")


@app.get("/api/health")
def health():
    return {
        "ffmpeg_ready": converters.FFMPEG_READY,
        "ffmpeg_path": converters.FFMPEG_PATH,
        "version": app.version,
    }


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    saved = []
    for f in files:
        data = await f.read()
        if not data:
            continue
        entry = uploads.save(f.filename or "file", data)
        saved.append({"id": entry["id"], "name": entry["name"],
                      "size": len(data)})
    if not saved:
        raise HTTPException(400, "没有收到任何文件")
    return {"files": saved}


@app.post("/api/convert")
def convert(req: ConvertRequest):
    _validate(req.mode, req.target)
    if not req.file_ids:
        raise HTTPException(400, "请先添加文件")
    file_specs = []
    for fid in req.file_ids:
        entry = uploads.get(fid)
        if entry is None:
            raise HTTPException(400, f"文件不存在或已过期: {fid}")
        file_specs.append(entry)
    cfg = _build_cfg(req.settings)
    job = jobs.create(req.mode, req.target, file_specs, cfg)
    return {"job_id": job.id}


def _build_cfg(raw):
    s = dict(DEFAULT_SETTINGS)
    s.update({k: v for k, v in raw.items() if k in s})
    return {
        "audio": {
            "volume": int(s.get("audio_volume", 100)),
            "rate": int(s.get("audio_rate", 0) or 0),
        },
        "video": {
            "crf": int(s.get("video_crf", 18)),
            "height": int(s.get("video_height", 0) or 0),
            "fps": int(s.get("video_fps", 30)),
            "codec": str(s.get("video_codec", "h264")),
            "volume": int(s.get("audio_volume", 100)),
            "rate": int(s.get("audio_rate", 0) or 0),
        },
        "image": {
            "quality": int(s.get("image_quality", 90)),
        },
    }


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在")
    return job.to_dict()


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在")
    job.cancel()
    return {"ok": True}


@app.get("/api/jobs/{job_id}/files/{filename}")
def download_file(job_id: str, filename: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在")
    path = job.outdir / Path(filename).name
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    return FileResponse(path, filename=Path(filename).name)


@app.get("/api/jobs/{job_id}/download-all")
def download_all(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for res in job.results:
            path = job.outdir / res["name"]
            if path.is_file():
                zf.write(path, res["name"])
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{job_id}.zip"'})


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(raw: dict):
    s = load_settings()
    for k, v in raw.items():
        if k in s:
            s[k] = v
    save_settings(s)
    return s


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
