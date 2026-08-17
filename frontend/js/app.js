import { FFmpeg } from "./vendor/ffmpeg/esm/index.js";
import { fetchFile } from "./vendor/ffmpeg/util/index.js";
import {
  buildAudioArgs, buildGifArgs, buildVideoArgs,
} from "./wasm-core.js";

const PAGES = ["pdf", "audio", "image", "video"];
const EXTENSIONS = {
  pdf: ["pdf"],
  audio: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma", "aiff", "aif", "amr", "mka", "mp2", "m4b"],
  image: ["png", "jpg", "jpeg", "jfif", "bmp", "webp", "gif", "tiff", "tif", "ico", "eps", "raw"],
  video: ["mp4", "avi", "mkv", "mov", "webm", "flv", "wmv", "m4v", "ts", "mpg", "mpeg", "3gp", "gif"],
};
const SETTINGS_KEY = "econvert-wasm-settings";
const DEFAULT_SETTINGS = {
  dark: false, video_crf: 18, video_height: 0, video_fps: 30, video_codec: "h264",
  audio_volume: 100, audio_rate: 44100, image_quality: 90,
};

const state = {
  files: { pdf: [], audio: [], image: [], video: [] },
  selected: { pdf: new Set(), audio: new Set(), image: new Set(), video: new Set() },
  running: { pdf: false, audio: false, image: false, video: false },
  cancelled: false,
  settings: { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") },
  active: { page: null, seq: 0 },
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ---------- Engines (auto-start on page load) ---------- */

let pyWorker = null;
let pyReady = null;

function ensurePy() {
  if (!pyReady) {
    pyReady = new Promise((resolve, reject) => {
      pyWorker = new Worker("js/wasm-worker.js");
      pyWorker.onerror = (e) => reject(new Error("Pyodide worker 错误: " + e.message));
      pyCallInit(pyWorker).then(resolve, reject);
    });
  }
  return pyReady;
}

function pyCallInit(worker) {
  return new Promise((resolve, reject) => {
    const id = 0;
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === "init-progress") {
        setBadge("pyBadge", "Python 引擎：" + e.data.msg);
        return;
      }
      worker.removeEventListener("message", onMsg);
      if (e.data.ok) resolve();
      else reject(new Error(e.data.error));
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage({
      id,
      type: "init",
      payload: { codeUrl: new URL("wasm/py/converters.py", location.href).toString() },
    });
  });
}

function pyConvert(page, name, target, settings, buf) {
  return new Promise((resolve, reject) => {
    const id = ++state.active.seq;
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === "progress") {
        const page2 = state.active.page;
        setStatus(page2, `正在转换: ${name}  ·  页码 ${e.data.p}/${e.data.t}`, true);
        return;
      }
      pyWorker.removeEventListener("message", onMsg);
      if (e.data.ok) resolve(e.data.data);
      else reject(new Error(e.data.error));
    };
    pyWorker.addEventListener("message", onMsg);
    pyWorker.postMessage(
      { id, type: "convert", payload: { page, name, target, settings, buf } },
      [buf],
    );
  });
}

let ffmpeg = null;
let ffReady = null;

function ensureFF() {
  if (!ffReady) {
    ffReady = (async () => {
      const f = new FFmpeg();
      f.on("log", ({ message }) => {
        if (/error|failed/i.test(message)) console.warn("[ffmpeg.wasm]", message);
      });
      f.on("progress", ({ progress }) => {
        const p = state.active.page;
        if (!p) return;
        const overall = Math.max(0, Math.min(99, Math.floor(progress * 100)));
        const chunk = $(`.progress-chunk[data-page="${p}"]`);
        if (chunk) chunk.style.width = overall + "%";
        const pc = $(`.percent[data-page="${p}"]`);
        if (pc) pc.textContent = overall + "%";
      });
      const coreURL = new URL("vendor/ffmpeg/core/ffmpeg-core.esm.js", import.meta.url).href;
      await f.load({ coreURL });
      ffmpeg = f;
    })();
  }
  return ffReady;
}

function setBadge(id, text, ok) {
  const el = $("#" + id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("ok-badge", ok === true);
  el.classList.toggle("err-badge", ok === false);
}

function startEngines() {
  ensurePy().then(
    () => setBadge("pyBadge", "Python 引擎 已就绪", true),
    (err) => { setBadge("pyBadge", "Python 引擎 启动失败", false); console.error(err); },
  );
  ensureFF().then(
    () => setBadge("ffBadge", "FFmpeg 引擎 已就绪", true),
    (err) => { setBadge("ffBadge", "FFmpeg 引擎 启动失败", false); console.error(err); },
  );
  Promise.allSettled([ensurePy(), ensureFF()]).then(([py, ff]) => {
    const dot = $("#engineDot");
    const text = $("#engineText");
    if (py.status === "fulfilled" && ff.status === "fulfilled") {
      dot.classList.add("ok");
      text.textContent = "转换引擎就绪 · 文件不出浏览器";
    } else if (py.status === "rejected" && ff.status === "rejected") {
      dot.classList.add("err");
      text.textContent = "转换引擎启动失败";
    } else {
      dot.classList.add("err");
      text.textContent = "部分引擎启动失败";
    }
  });
}

/* ---------- Navigation & theme ---------- */

$$(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchPage(btn.dataset.page));
});

function switchPage(page) {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
}

function applyTheme() {
  document.documentElement.classList.toggle("dark", !!state.settings.dark);
}

/* ---------- Upload & file list ---------- */

const fileInput = $("#fileInput");

$$(".dropzone").forEach((dz) => {
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const page = dz.closest(".file-card").dataset.page;
    addFiles(page, e.dataTransfer.files);
  });
});

fileInput.addEventListener("change", () => {
  const page = $(".nav-btn.active").dataset.page;
  if (page !== "settings") addFiles(page, fileInput.files);
  fileInput.value = "";
});

function addFiles(page, fileList) {
  const seen = new Set(state.files[page].map((f) => f.name));
  for (const f of fileList) {
    const ext = f.name.split(".").pop().toLowerCase();
    if (!EXTENSIONS[page].includes(ext)) continue;
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    state.files[page].push(f);
  }
  renderList(page);
}

function fmtSize(n) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return i === 0 ? `${n} B` : `${n.toFixed(1)} ${units[i]}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderList(page) {
  const box = $(`.file-list[data-page="${page}"]`);
  const files = state.files[page];
  box.innerHTML = "";
  if (!files.length) {
    box.innerHTML = `<div class="file-empty">暂无文件，拖拽或点击上方区域添加</div>`;
  }
  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "file-item";
    if (state.selected[page].has(f.name)) row.classList.add("selected");
    row.innerHTML = `
      <span class="file-name">${escapeHtml(f.name)}</span>
      <span class="file-size">${fmtSize(f.size)}</span>
      <button class="file-del" title="移除">✕</button>`;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("file-del")) return;
      const sel = state.selected[page];
      if (sel.has(f.name)) sel.delete(f.name); else sel.add(f.name);
      renderList(page);
    });
    $(".file-del", row).addEventListener("click", (e) => {
      e.stopPropagation();
      state.files[page] = state.files[page].filter((x) => x !== f);
      state.selected[page].delete(f.name);
      renderList(page);
    });
    box.appendChild(row);
  });
  updateCount(page);
}

function updateCount(page) {
  $(`.count[data-page="${page}"]`).textContent = `共 ${state.files[page].length} 个文件`;
  const btn = $(`.convert-btn[data-page="${page}"]`);
  btn.disabled = !state.files[page].length || state.running[page];
}

$$("[data-act]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const page = btn.dataset.page;
    if (btn.dataset.act === "clear") {
      state.files[page] = [];
      state.selected[page] = new Set();
      renderList(page);
      setStatus(page, "就绪 · 转换在浏览器内本地完成", true);
      hideResults(page);
    } else if (btn.dataset.act === "remove-sel") {
      const sel = state.selected[page];
      if (!sel.size) return;
      state.files[page] = state.files[page].filter((f) => !sel.has(f.name));
      sel.clear();
      renderList(page);
    }
  });
});

/* ---------- Conversion ---------- */

$$(".convert-btn").forEach((btn) => {
  btn.addEventListener("click", () => startConversion(btn.dataset.page));
});

$$(".cancel-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.cancelled = true;
    setStatus(btn.dataset.page, "正在取消…", true);
  });
});

async function startConversion(page) {
  const files = state.files[page];
  if (!files.length || state.running[page]) return;
  const target = page === "pdf" ? "docx" : $(`.target-select[data-page="${page}"]`).value;
  const settings = { ...state.settings };

  state.running[page] = true;
  state.cancelled = false;
  state.active.page = page;
  $(`.cancel-btn[data-page="${page}"]`).hidden = false;
  updateCount(page);
  setProgress(page, 0);
  hideResults(page);
  setStatus(page, "准备中…", true);

  const results = [];
  const errors = [];
  let ok = 0;
  let fail = 0;
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const f = files[i];
    if (state.cancelled) break;
    setStatus(page, `正在转换 (${i + 1}/${total}): ${f.name}`, true);
    try {
      const blob = await convertOne(page, f, target, settings);
      results.push({ name: outputName(f.name, target), blob });
      ok++;
    } catch (err) {
      fail++;
      errors.push(`${f.name}: ${err.message}`);
    }
    setProgress(page, Math.round(((i + 1) / total) * 100));
  }

  const cancelled = state.cancelled;
  state.running[page] = false;
  state.active.page = null;
  $(`.cancel-btn[data-page="${page}"]`).hidden = true;
  updateCount(page);
  setProgress(page, 100);

  if (cancelled) {
    setStatus(page, `已取消 · 成功 ${ok} 个，失败 ${fail} 个`, true);
  } else if (fail === 0) {
    setStatus(page, `转换完成 · 成功 ${ok} 个文件`, true);
    renderResults(page, results);
  } else if (ok === 0) {
    setStatus(page, `转换失败 · ${fail} 个文件未能转换`, false);
    renderResults(page, results);
  } else {
    setStatus(page, `转换完成 · 成功 ${ok} 个，失败 ${fail} 个`, false);
    renderResults(page, results);
  }
  if (errors.length) {
    const head = errors.slice(0, 8).join("\n");
    const extra = errors.length > 8 ? `\n… 其余 ${errors.length - 8} 个错误未列出` : "";
    alert(`部分文件转换失败：\n\n${head}${extra}`);
  }
}

async function convertOne(page, file, target, settings) {
  if (page === "image" || page === "pdf") {
    await ensurePy();
    const b64 = await pyConvert(page, file.name, target, settings, await file.arrayBuffer());
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes]);
  }
  await ensureFF();
  const ext = "." + (file.name.split(".").pop() || "bin").toLowerCase();
  const inName = `in_${state.active.seq++}${ext}`;
  const outName = `out_${state.active.seq}.${target.toLowerCase()}`;
  await ffmpeg.writeFile(inName, await fetchFile(file));
  try {
    let args;
    if (page === "audio") {
      args = buildAudioArgs(inName, target, {
        volume: settings.audio_volume, rate: settings.audio_rate,
      }, outName);
    } else if (target === "GIF") {
      args = buildGifArgs(inName, { fps: settings.video_fps }, outName);
    } else {
      args = buildVideoArgs(inName, target, {
        crf: settings.video_crf, height: settings.video_height,
        fps: settings.video_fps, codec: settings.video_codec,
        volume: settings.audio_volume, rate: settings.audio_rate,
      }, outName);
    }
    await ffmpeg.exec(args);
    const data = await ffmpeg.readFile(outName);
    return new Blob([data]);
  } finally {
    try { await ffmpeg.deleteFile(inName); } catch (e) { /* noop */ }
    try { await ffmpeg.deleteFile(outName); } catch (e) { /* noop */ }
  }
}

function outputName(name, target) {
  const stem = name.replace(/\.[^.]+$/, "");
  return `${stem}.${target.toLowerCase()}`;
}

function renderResults(page, results) {
  const box = $(`.results[data-page="${page}"]`);
  box.innerHTML = "";
  if (!results.length) return;
  const zip = document.createElement("button");
  zip.className = "result-chip";
  zip.textContent = "⬇ 下载全部";
  zip.addEventListener("click", async () => {
    for (let i = 0; i < results.length; i++) {
      downloadBlob(results[i].name, results[i].blob);
      await new Promise((r) => setTimeout(r, 400));
    }
  });
  box.appendChild(zip);
  results.forEach((r) => {
    const a = document.createElement("a");
    a.className = "result-chip";
    a.textContent = `⬇ ${r.name}  ${fmtSize(r.blob.size)}`;
    a.href = URL.createObjectURL(r.blob);
    a.download = r.name;
    box.appendChild(a);
  });
}

function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function hideResults(page) {
  $(`.results[data-page="${page}"]`).innerHTML = "";
}

function setProgress(page, value) {
  $(`.progress-chunk[data-page="${page}"]`).style.width = `${value}%`;
  $(`.percent[data-page="${page}"]`).textContent = `${value}%`;
}

function setStatus(page, text, good) {
  const el = $(`.status[data-page="${page}"]`);
  el.textContent = text;
  el.classList.toggle("ok", good === true);
  el.classList.toggle("err", good === false);
}

/* ---------- Settings ---------- */

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  applyTheme();
}

function bindSettingsUI() {
  const s = state.settings;
  const dark = $("#set-dark");
  dark.checked = !!s.dark;
  dark.addEventListener("change", () => { s.dark = dark.checked; saveSettings(); });

  const sliders = [
    ["set-crf", "set-crf-val", "video_crf", ""],
    ["set-volume", "set-volume-val", "audio_volume", "%"],
    ["set-quality", "set-quality-val", "image_quality", "%"],
  ];
  sliders.forEach(([id, valId, key, suffix]) => {
    const el = $(`#${id}`);
    const val = $(`#${valId}`);
    el.value = String(s[key]);
    const sync = () => {
      val.textContent = `${el.value}${suffix}`;
      if (id === "set-volume") $("#set-volume-warn").hidden = Number(el.value) <= 100;
    };
    el.addEventListener("input", sync);
    el.addEventListener("change", () => { s[key] = Number(el.value); saveSettings(); });
    sync();
  });

  const selects = [
    ["set-height", "video_height"],
    ["set-fps", "video_fps"],
    ["set-codec", "video_codec"],
    ["set-rate", "audio_rate"],
  ];
  selects.forEach(([id, key]) => {
    const el = $(`#${id}`);
    el.value = String(s[key]);
    el.addEventListener("change", () => { s[key] = Number(el.value); saveSettings(); });
  });
}

/* ---------- Init (auto-start engines) ---------- */

function init() {
  applyTheme();
  bindSettingsUI();
  PAGES.forEach((p) => updateCount(p));
  startEngines();
}

init();