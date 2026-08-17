import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote

from . import converters

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
OUTPUTS_DIR = DATA_DIR / "outputs"


class Job:
    def __init__(self, mode, target, files, outdir, settings):
        self.id = uuid.uuid4().hex
        self.mode = mode
        self.target = target
        self.files = files
        self.outdir = outdir
        self.settings = settings
        self.status = "queued"
        self.progress = 0
        self.current = "等待中…"
        self.ok = 0
        self.fail = 0
        self.errors = []
        self.results = []
        self.cancelled = False
        self.created_at = time.time()
        self.finished_at = None
        self._cancel = threading.Event()

    def cancel(self):
        self._cancel.set()

    def to_dict(self):
        return {
            "id": self.id,
            "mode": self.mode,
            "target": self.target,
            "status": self.status,
            "progress": self.progress,
            "current": self.current,
            "ok": self.ok,
            "fail": self.fail,
            "errors": self.errors,
            "cancelled": self.cancelled,
            "results": self.results,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }


class JobManager:
    def __init__(self):
        self._jobs = {}
        self._lock = threading.Lock()
        self._slot = threading.BoundedSemaphore(1)

    def create(self, mode, target, files, settings):
        outdir = OUTPUTS_DIR / uuid.uuid4().hex
        outdir.mkdir(parents=True, exist_ok=True)
        job = Job(mode, target, files, outdir, settings)
        with self._lock:
            self._jobs[job.id] = job
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return job

    def get(self, job_id):
        with self._lock:
            return self._jobs.get(job_id)

    def _run(self, job):
        with self._slot:
            try:
                job.status = "running"
                total = len(job.files)
                for i, f in enumerate(job.files, 1):
                    if job._cancel.is_set():
                        job.cancelled = True
                        break
                    src = Path(f["path"])
                    dst = converters.unique_path(
                        job.outdir / f"{Path(f['name']).stem}.{job.target.lower()}")
                    job.current = f"正在转换 ({i}/{total}): {f['name']}"
                    try:
                        if job.mode == "pdf":
                            def on_page(done_pages, total_pages):
                                job.current = (f"正在转换 ({i}/{total}): {f['name']}"
                                               f"  ·  页码 {done_pages}/{total_pages}")
                            converters.pdf_to_word(src, dst, on_page=on_page,
                                                   cancel=job._cancel)
                        elif job.mode == "audio":
                            converters.convert_audio(src, dst, job.target,
                                                     job.settings.get("audio"))
                        elif job.mode == "image":
                            converters.convert_image(
                                src, dst, job.target,
                                (job.settings.get("image") or {}).get("quality"))
                        else:
                            converters.convert_video(src, dst, job.target,
                                                     job.settings.get("video"))
                        job.ok += 1
                        job.results.append({
                            "name": dst.name,
                            "size": dst.stat().st_size,
                            "url": f"/api/jobs/{job.id}/files/{quote(dst.name)}",
                        })
                    except converters.CancelledError:
                        job.cancelled = True
                        dst.unlink(missing_ok=True)
                        break
                    except Exception as exc:
                        job.fail += 1
                        job.errors.append(f"{f['name']}: {exc}")
                    job.progress = int(i / total * 100)
                    src.unlink(missing_ok=True)
            finally:
                job.finished_at = time.time()
                if job.cancelled:
                    job.status = "cancelled"
                else:
                    job.status = "done"
                    job.current = (f"转换完成 · 成功 {job.ok} 个"
                                   + (f"，失败 {job.fail} 个" if job.fail else ""))


class UploadStore:
    def __init__(self):
        self._files = {}
        self._lock = threading.Lock()

    def save(self, filename, data):
        name = Path(filename or "file").name or "file"
        fid = uuid.uuid4().hex
        path = UPLOADS_DIR / f"{fid}{Path(name).suffix.lower()}"
        with path.open("wb") as fh:
            fh.write(data)
        with self._lock:
            self._files[fid] = {"id": fid, "name": name, "path": str(path)}
        return self._files[fid]

    def get(self, fid):
        with self._lock:
            return self._files.get(fid)

    def drop(self, fid):
        with self._lock:
            entry = self._files.pop(fid, None)
        if entry:
            try:
                Path(entry["path"]).unlink(missing_ok=True)
            except Exception:
                pass
