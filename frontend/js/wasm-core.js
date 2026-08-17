export const AUDIO_TARGETS = {
  MP3:  { ext: "mp3",  codec: "libmp3lame" },
  WAV:  { ext: "wav",  codec: "pcm_s16le" },
  FLAC: { ext: "flac", codec: "flac" },
  OGG:  { ext: "ogg",  codec: "libvorbis" },
  M4A:  { ext: "m4a",  codec: "aac" },
  OPUS: { ext: "opus", codec: "libopus" },
};

export const VIDEO_TARGETS = {
  MP4:  { ext: "mp4",  video: "libx264",    audio: "aac" },
  MKV:  { ext: "mkv",  video: "libx264",    audio: "aac" },
  MOV:  { ext: "mov",  video: "libx264",    audio: "aac" },
  AVI:  { ext: "avi",  video: "libx264",    audio: "libmp3lame" },
  WEBM: { ext: "webm", video: "libvpx", audio: "libvorbis" },
  GIF:  { ext: "gif" },
};

export const VIDEO_CODECS = {
  h264: "libx264",
  h265: "libx265",
  av1: "libaom-av1",
};

export function clampFps(fps, lo, hi) {
  const v = Number(fps) || 15;
  return Math.min(Math.max(v, lo), hi);
}

export function buildAudioArgs(input, target, cfg, out) {
  const spec = AUDIO_TARGETS[target];
  const volume = Number(cfg.volume ?? 100);
  const rate = Number(cfg.rate ?? 0);
  const args = ["-i", input];
  if (volume !== 100) args.push("-af", `volume=${volume / 100}`);
  if (rate) args.push("-ar", String(rate));
  args.push("-c:a", spec.codec, "-y", out);
  return args;
}

export function buildGifArgs(input, cfg, out) {
  const fps = clampFps(cfg.fps, 5, 30);
  return [
    "-i", input,
    "-vf", `fps=${fps},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    "-loop", "0",
    "-y", out,
  ];
}

export function buildVideoArgs(input, target, cfg, out) {
  const spec = VIDEO_TARGETS[target];
  const codecName = VIDEO_CODECS[String(cfg.codec ?? "h264")] || "libx264";
  let vcodec = codecName;
  if (target === "WEBM") {
    // 浏览器内 vp9 编码器会崩溃（ffmpeg.wasm 已知 bug），h264/h265 一律回退 VP8
    vcodec = codecName === "libaom-av1" ? "libaom-av1" : "libvpx";
  }
  const crf = Number(cfg.crf ?? 18);
  const fps = Number(cfg.fps ?? 30);
  const height = Number(cfg.height ?? 0);
  const volume = Number(cfg.volume ?? 100);
  const rate = Number(cfg.rate ?? 0);

  const args = ["-i", input];
  const filters = [];
  if (height) filters.push(`scale=-2:${height}`);
  if (volume !== 100) filters.push(`volume=${volume / 100}`);
  if (rate) filters.push(`aresample=${rate}`);
  if (filters.length) args.push("-vf", filters.join(","));
  args.push("-c:v", vcodec);
  if (vcodec === "libaom-av1") {
    args.push("-crf", String(crf), "-cpu-used", "8", "-b:v", "0");
  } else {
    args.push("-crf", String(crf), "-preset", "medium");
  }
  args.push("-r", String(fps));
  args.push("-c:a", spec.audio);
  if (target === "MP4") args.push("-movflags", "+faststart");
  args.push("-y", out);
  return args;
}