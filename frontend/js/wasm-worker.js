const BASE = new URL("../", self.location.href);
const INDEX_URL = new URL("vendor/pyodide/", BASE).href;
const WHEEL_PDFMINER = new URL("vendor/wheels/pdfminer_six-20260107-py3-none-any.whl", BASE).href;
const WHEEL_DOCX = new URL("vendor/wheels/python_docx-1.2.0-py3-none-any.whl", BASE).href;

let py = null;

function bufToBase64(buf) {
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  const progress = (msg) => self.postMessage({ id, type: "init-progress", msg });
  try {
    if (type === "init") {
      progress("加载 Pyodide 核心…");
      importScripts(INDEX_URL + "pyodide.js");
      py = await loadPyodide({ indexURL: INDEX_URL });
      progress("加载 Pillow / lxml / 依赖…");
      await py.loadPackage([
        "pillow", "micropip", "lxml", "typing-extensions", "charset-normalizer",
        "cryptography",
      ]);
      progress("安装 pdfminer + python-docx（本地）…");
      const whlUrls = [WHEEL_PDFMINER, WHEEL_DOCX];
      const whlPaths = [];
      await py.runPythonAsync(`
import base64
def write_b64(path, b64):
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))`);
      const writeB64 = py.globals.get("write_b64");
      for (let i = 0; i < whlUrls.length; i++) {
        const r = await fetch(whlUrls[i]);
        if (!r.ok) throw new Error("wheel 下载失败: " + whlUrls[i] + " -> " + r.status);
        const b = new Uint8Array(await r.arrayBuffer());
        const p = "/tmp/whl" + i + ".zip";
        whlPaths.push(p);
        writeB64(p, bufToBase64(b));
      }
      await py.runPythonAsync(`
import zipfile, site, importlib
from pathlib import Path
sp = Path(site.getsitepackages()[0])
for p in ${JSON.stringify(whlPaths)}:
    with zipfile.ZipFile(p) as zf:
        zf.extractall(sp)
importlib.invalidate_caches()
print("wheels extracted to", sp)`);
      progress("加载转换脚本…");
      const code = await (await fetch(payload.codeUrl)).text();
      await py.runPythonAsync(code);
      self.postMessage({ id, ok: true });
    } else if (type === "convert") {
      const { page, name, target, settings } = payload;
      const ext = "." + (name.split(".").pop() || "bin").toLowerCase();
      const inB64 = bufToBase64(new Uint8Array(payload.buf));
      const outName = "/out." + target.toLowerCase();
      if (page === "image") {
        py.globals.get("write_b64")("/in" + ext, inB64);
        py.globals.get("convert_image")(
          "/in" + ext, outName, target, settings.image_quality);
      } else {
        py.globals.get("write_b64")("/in" + ext, inB64);
        py.globals.set("on_page_cb", (p, t) =>
          self.postMessage({ id, type: "progress", p, t }));
        py.globals.get("pdf_to_word")(
          "/in" + ext, outName, py.globals.get("on_page_cb"));
      }
      const b64 = py.globals.get("read_b64")(outName);
      self.postMessage({ id, ok: true, data: b64 });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};