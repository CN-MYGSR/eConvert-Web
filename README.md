# eConvert-Web 🌐

eConvert 的网页版：**纯前端 WASM** 文件格式转换工具，复刻原 PyQt6 应用的 UWP / Fluent 风格界面与全部转换能力。

所有转换都在浏览器内完成（文件不出浏览器，无需任何后端服务）。

| PDF 转 Word | 音频 | 图片 | 视频 |
|---|---|---|---|
| Pyodide + pdfminer + python-docx | FFmpeg.wasm | Pyodide + Pillow | FFmpeg.wasm |

## ✨ 功能特性

- **UWP 风格网页界面**：左侧导航、拖放批量添加文件、深色模式即时切换
- **打开网页自动启动转换引擎**：页面加载后自动初始化 WASM 引擎（Pyodide + FFmpeg），顶栏显示引擎状态
- **PDF 转 Word**：文字与排版提取，逐页进度显示
- **音频转换**：MP3 / WAV / FLAC / OGG / M4A / OPUS，支持从视频中提取音频
- **图片转换**：PNG / JPG / WebP / GIF / BMP / TIFF / ICO，自动 EXIF 方向修正、透明底合成
- **视频转换**：MP4 / MKV / MOV / AVI / WEBM / GIF
- **详细设置**（自动保存到浏览器 `localStorage`）：
  - 视频：恒定质量 CRF 1~22、分辨率 360p~4K、帧率 24~90fps、编码 H.264 / H.265 / AV1
  - 音频：音量 1%~150%（>100% 时提示听力健康警告）、采样率 8000Hz~384kHz
  - 图片：压缩率 1%~100%
- **结果下载**：单个文件或批量下载

## 🚀 快速开始

无需安装依赖、无需启动后端，任意静态文件服务器即可：

```bash
# 方式一：任选其一
python -m http.server 8000 -d frontend
npx serve frontend
# 然后浏览器打开 http://127.0.0.1:8000
```

> 注意：ES Module 与 Worker 需要经 HTTP 服务访问，直接双击 `index.html`（file://）无法运行。
> 全部运行时（Pyodide、FFmpeg、Python 依赖包）已内置在本地 `frontend/vendor/`，**完全离线可用**。

## 📁 目录结构

```
frontend/
├── index.html        # 单页界面（纯前端 WASM）
├── css/style.css     # UWP 风格样式（亮/暗双主题）
├── js/
│   ├── app.js        # 主逻辑：页面加载即自动启动 WASM 引擎、转换与进度
│   ├── wasm-core.js  # FFmpeg 参数构建
│   ├── wasm-worker.js# Pyodide 后台 Worker（PDF / 图片转换）
│   ├── wasm/py/converters.py  # 浏览器内运行的 Python 转换代码
│   └── vendor/       # 本地内置的 FFmpeg.wasm（core 0.12.10）与 @ffmpeg/ffmpeg 库
└── vendor/           # 离线运行时：Pyodide 全量发行版、FFmpeg ESM 核心、Python wheels
```

## 🛠️ 技术栈（全部在浏览器内运行）

- [FFmpeg.wasm](https://ffmpegwasm.netlify.app/)（本地内置 core 0.12.10）— 音频 / 视频转换
- [Pyodide](https://pyodide.org/)（本地内置） + [Pillow](https://python-pillow.org/) — 图片转换
- [pdfminer.six](https://github.com/pdfminer/pdfminer.six) + [python-docx](https://python-docx.readthedocs.io/) — PDF 转 Word
- 原生 HTML / CSS / JavaScript（ES Module）— 前端（无需构建）

> `backend/`、`run.py`、`requirements.txt` 为早期 FastAPI 服务端版本遗留，已不再使用，可忽略。