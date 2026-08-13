#!/usr/bin/env node
// seedance-studio CLI — 88api.ai Seedance 2.5 video + gpt-image-2 keyframes
// Zero-dependency Node 18+. Config: ~/.seedance-studio/config.json
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, extname, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = join(homedir(), ".seedance-studio");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULTS = {
  baseUrl: "https://88api.ai",
  videoModel: "seedance2.5满血版",
  imageModel: "gpt-image-2",
  pollIntervalMs: 12000,
  pollTimeoutMs: 25 * 60 * 1000,
};
const RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const IMG_ASPECTS = { "1:1":"2048x2048","3:2":"2048x1360","2:3":"1360x2048","4:3":"2048x1536","3:4":"1536x2048","16:9":"2048x1152","9:16":"1152x2048","2:1":"2048x1024","1:2":"1024x2048","7:4":"2208x1264","4:7":"1264x2208" };
// 生图模型预设（均走 88api /v1/images 系列端点，实测 2026-08）
const IMG_MODELS = {
  "gpt-image-2":        { id: "gpt-image-2",        scale: "2k",     note: "2K 关键帧/锚定图（默认·快·省）" },
  "gpt-image-2-4k":     { id: "gpt-image-2-4k",     scale: "4k",     note: "高清主图/海报（方图实测上限约 2880²，返回 URL）" },
  "gemini-3-pro-image": { id: "gemini-3-pro-image", scale: "native", note: "Gemini 3 Pro Image（约 2048² 原生；参考图一致性最强，垫图/锁角色首选，返回 b64）" },
};
// 友好别名 → 预设键
const IMG_ALIASES = {
  "2k":"gpt-image-2","default":"gpt-image-2","gpt":"gpt-image-2","gpt-image-2":"gpt-image-2",
  "4k":"gpt-image-2-4k","gpt-4k":"gpt-image-2-4k","gpt-image-2-4k":"gpt-image-2-4k",
  "gemini":"gemini-3-pro-image","gemini-pro":"gemini-3-pro-image","pro":"gemini-3-pro-image","gemini-3-pro-image":"gemini-3-pro-image",
};
function resolveImgModel(name) {
  if (!name) return IMG_MODELS["gpt-image-2"];
  const key = IMG_ALIASES[String(name).toLowerCase()];
  if (key) return IMG_MODELS[key];
  return { id: String(name), scale: "2k", note: "(自定义模型 id，按 2K 尺寸表提交)" };
}
function imgSize(aspect, scale) {
  const base = IMG_ASPECTS[aspect];
  if (!base) return null;
  if (scale === "4k") { const [w, h] = base.split("x").map(Number); return (w * 2) + "x" + (h * 2); }
  return base;
}
const MIME = { ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp", ".gif":"image/gif" };
const CAPS = [
  "Seedance 2.5 能力边界（88api，插件已按此硬校验）：",
  "  • 时长 4–30 秒（整数，按秒计费）",
  "  • 分辨率 480p / 720p（实测均生效；不支持 1080p/4k）",
  "  • 画幅 ratio: auto / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16",
  "  • 图片参考 ≤30 张（本地图自动转 base64，无需公网 URL）",
  "  • 视频参考 ≤10 个（必须公网直连 http(s) URL；官方：每段 2–30s、总时长 ≤30s）",
  "  • 音频参考 ≤10 个（必须公网直连 http(s) URL；官方：每段 2–30s、总时长 ≤30s）",
  "  • 同步音频 generate_audio 默认开；seed 可控（-1 随机）",
  "原生有声（写进提示词即可，与后端无关）：",
  "  • 声音语法 音乐() 音效<> 台词{} 字幕【】",
  "  • 11 语言原生配音：中/英/西/印尼/马来/泰/阿/葡/越/日/韩（中文台词直出普通话）",
  "  • 注意：原生台词是「配音/画外音」，不是对口型——人物嘴型不跟随（需口型请走即梦网页对口型）",
  "88api 实测透传（2026-08 三档实测，可用）：",
  "  • 首帧 first_frame / 首尾帧 first+last_frame（实测生效）",
  "  • 视频参考 reference_video（迁运镜）/ 音频参考 reference_audio（卡节奏）",
  "  • 分辨率 480p（resolution:480p 实测生效，输出 854×480）",
  "  • 视频编辑 edit / 视频延长 extend（可用但约 50% 成功率，需自动容错重试）",
  "88api 实测忽略（缩水，别向用户承诺）：",
  "  • output_format:mov —— 被忽略，统一回吐标准 mp4（isom/yuv420p）",
  "  • watermark:true —— 被忽略，成片无水印",
  "硬约束（插件已前置校验）：",
  "  • 视频/音频参考必须同时配 ≥1 张图片参考，否则 400（无纯视频参考/纯音频参考）",
  "生图（关键帧/锚定图，88api /v1/images，2026-08 实测）：",
  "  • gpt-image-2（默认·2K）：快而省，做关键帧/预审用 `--model 2k`",
  "  • gpt-image-2-4k：高清主图/海报，`--model 4k`（方图实测上限约 2880²）",
  "  • gemini-3-pro-image：`--model gemini`，约 2048² 原生，参考图一致性最强",
  "  • 参考图生图（垫图/锁角色/锁产品）：加 `--ref <图> [--ref <图>...]` 走 /v1/images/edits——功能三保产品/人物一致性首选",
];

function loadConfig() {
  let c = {};
  if (existsSync(CONFIG_PATH)) { try { c = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { c = {}; } }
  return { ...DEFAULTS, ...c };
}
function saveConfig(c) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}
function mask(k) { return !k ? "(not set)" : k.slice(0, 6) + "..." + k.slice(-4); }
function die(msg) { console.error("[ERROR] " + msg); process.exit(1); }
function log(msg) { console.log(msg); }

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { args[key] = true; }
      else {
        if (args[key] === undefined) args[key] = next;
        else if (Array.isArray(args[key])) args[key].push(next);
        else args[key] = [args[key], next];
        i++;
      }
    } else args._.push(a);
  }
  return args;
}
function asArray(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }

function requireKey(cfg) {
  if (!cfg.apiKey) die('未配置 API Key。先运行: node studio.mjs --set-key "<你的88api Key>"');
  return cfg.apiKey;
}
async function api(cfg, method, path, body) {
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers: { Authorization: "Bearer " + requireKey(cfg), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || json.message || text.slice(0, 300);
    const err = new Error("HTTP " + res.status + ": " + msg);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}
function imageToDataUrl(p) {
  const mime = MIME[extname(p).toLowerCase()];
  if (!mime) die("不支持的图片格式: " + p + "（支持 jpg/png/webp/gif）");
  const buf = readFileSync(p);
  if (buf.length > 8 * 1024 * 1024) die("图片过大 (" + (buf.length/1048576).toFixed(1) + "MB > 8MB)，请压缩后重试: " + p);
  return "data:" + mime + ";base64," + buf.toString("base64");
}
function outDir(args) {
  const d = args.out ? resolve(String(args.out)) : resolve("seedance-out", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  mkdirSync(d, { recursive: true });
  return d;
}
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("下载失败 HTTP " + res.status);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

// ---------- video ----------
function buildVideoPayload(cfg, args) {
  const prompt = args.prompt ? String(args.prompt) : "";
  const duration = args.duration ? parseInt(args.duration, 10) : 10;
  if (!(duration >= 4 && duration <= 30)) die("duration 必须在 4–30 秒之间，当前: " + args.duration);
  const ratio = String(args.ratio || "16:9");
  if (!RATIOS.includes(ratio)) die("ratio 仅支持: " + RATIOS.join(", "));
  const images = asArray(args.image);
  const videoUrls = asArray(args["video-url"]);
  const audioUrls = asArray(args["audio-url"]);
  if (images.length > 30) die("图片参考最多 30 张");
  if (videoUrls.length > 10) die("视频参考最多 10 个");
  if (audioUrls.length > 10) die("音频参考最多 10 个");
  for (const u of [...videoUrls, ...audioUrls]) {
    if (!/^https?:\/\//.test(u)) die("视频/音频参考必须是公网 http(s) URL（本地文件不支持，需先上传对象存储）: " + u);
  }
  // 实测硬约束（88api 后端）：带视频/音频参考时必须至少配 1 张图片参考，
  // 否则上游直接 400: "video/audio reference requires at least one image reference"。
  // 这里前置拦截，省掉一次无谓的失败提交。
  if ((videoUrls.length || audioUrls.length) && !images.length) {
    die("88api 约束：使用视频/音频参考时必须同时提供至少 1 张图片参考（--image <图>）。\n纯视频参考或纯音频参考在本后端不支持——请补一张锚定图/关键帧一起提交。");
  }
  const payload = {
    model: cfg.videoModel,
    duration,
    ratio,
    resolution: "720p",
    generate_audio: !args["no-audio"],
  };
  if (args.seed !== undefined) payload.seed = parseInt(args.seed, 10);
  const hasMulti = images.length || videoUrls.length || audioUrls.length;
  if (!prompt) die("需要 --prompt 提示词");
  payload.prompt = prompt;
  // 实测：上游要求顶层 prompt 必填。仅图片参考时用 images 简写（最稳路径）；
  // 含视频/音频参考时才用 content 数组（text 同时放入 content 以兼容上游）。
  if (images.length && !videoUrls.length && !audioUrls.length) {
    payload.images = images.map(p => /^https?:\/\//.test(p) ? p : imageToDataUrl(resolve(p)));
  } else if (hasMulti) {
    const content = [{ type: "text", text: prompt }];
    for (const p of images) {
      const url = /^https?:\/\//.test(p) ? p : imageToDataUrl(resolve(p));
      content.push({ type: "image_url", image_url: { url } });
    }
    for (const u of videoUrls) content.push({ type: "video_url", video_url: { url: u } });
    for (const u of audioUrls) content.push({ type: "audio_url", audio_url: { url: u } });
    payload.content = content;
  }
  return payload;
}
function sanitizePayload(p) {
  const clone = JSON.parse(JSON.stringify(p));
  if (clone.images) clone.images = clone.images.map(u => u.startsWith("data:") ? "data:<base64 " + (u.length/1366).toFixed(0) + "KB omitted>" : u);
  if (clone.content) for (const c of clone.content) {
    if (c.image_url && c.image_url.url && c.image_url.url.startsWith("data:")) {
      c.image_url.url = "data:<base64 " + (c.image_url.url.length/1366).toFixed(0) + "KB omitted>";
    }
  }
  return clone;
}
async function pollTask(cfg, taskId, dir) {
  const started = Date.now();
  let lastStatus = "";
  while (true) {
    if (Date.now() - started > cfg.pollTimeoutMs) die("轮询超时（" + (cfg.pollTimeoutMs / 60000) + " 分钟）。任务可能仍在进行，稍后续查:\n  node studio.mjs status --task " + taskId + ' --wait --out "' + dir + '"');
    const st = await api(cfg, "GET", "/v1/videos/" + taskId);
    const line = st.status + " progress=" + (st.progress == null ? "?" : st.progress) + "%";
    if (line !== lastStatus) { log("[poll] " + line); lastStatus = line; }
    if (st.status === "completed") {
      if (!st.video_url) die("任务完成但未返回 video_url，原始响应: " + JSON.stringify(st).slice(0, 400));
      const dest = join(dir, "seedance_" + taskId.slice(-8) + ".mp4");
      log("[download] " + st.video_url.slice(0, 80) + "...");
      await download(st.video_url, dest);
      writeFileSync(join(dir, "result.json"), JSON.stringify(st, null, 2));
      log("[DONE] 视频已保存: " + dest);
      if (st.usage) log("[usage] " + JSON.stringify(st.usage));
      return dest;
    }
    if (st.status === "failed") die("生成失败: " + ((st.error && st.error.message) || JSON.stringify(st).slice(0, 400)) + "\n[NO-RETRY] 请先诊断原因，不要盲目重交（重交会再次计费）。");
    await new Promise(r => setTimeout(r, cfg.pollIntervalMs));
  }
}
async function cmdVideo(cfg, args) {
  const payload = buildVideoPayload(cfg, args);
  const dir = outDir(args);
  if (args["dry-run"]) {
    log("[DRY-RUN] 不会调用付费接口。将提交:");
    log("POST " + cfg.baseUrl + "/v1/videos");
    log(JSON.stringify(sanitizePayload(payload), null, 2));
    log("[估算] " + payload.duration + " 秒视频（按秒计费，以 88api 后台价格为准）");
    return;
  }
  const runFile = join(dir, "run.json");
  if (existsSync(runFile)) {
    const prev = JSON.parse(readFileSync(runFile, "utf8"));
    die("输出目录已有任务 " + prev.taskId + "（防重复提交）。续查:\n  node studio.mjs status --task " + prev.taskId + ' --wait --out "' + dir + '"\n或换一个 --out 目录。');
  }
  log("[submit] POST /v1/videos (" + payload.duration + "s, " + payload.ratio + ", audio=" + payload.generate_audio + ")");
  const task = await api(cfg, "POST", "/v1/videos", payload);
  const taskId = task.id || task.task_id;
  if (!taskId) die("提交响应中无任务 ID: " + JSON.stringify(task).slice(0, 400));
  writeFileSync(runFile, JSON.stringify({ taskId, submittedAt: new Date().toISOString(), payload: sanitizePayload(payload) }, null, 2));
  log("[task] " + taskId + " (status=" + task.status + ")");
  if (args["no-wait"]) { log("稍后查询: node studio.mjs status --task " + taskId + ' --wait --out "' + dir + '"'); return; }
  await pollTask(cfg, taskId, dir);
}
async function cmdStatus(cfg, args) {
  if (!args.task) die("需要 --task <任务ID>");
  const taskId = String(args.task);
  if (args.wait) return pollTask(cfg, taskId, outDir(args));
  const st = await api(cfg, "GET", "/v1/videos/" + taskId);
  log(JSON.stringify(st, null, 2));
}
// ---------- raw (capability probing: POST an arbitrary payload file as-is) ----------
async function cmdRaw(cfg, args) {
  if (!args.file) die("需要 --file <payload.json>");
  const p = resolve(String(args.file));
  if (!existsSync(p)) die("文件不存在: " + p);
  let payload;
  try { payload = JSON.parse(readFileSync(p, "utf8")); } catch (e) { die("payload JSON 解析失败: " + e.message); }
  if (!payload.model) payload.model = cfg.videoModel;
  const dir = outDir(args);
  if (args["dry-run"]) {
    log("[DRY-RUN][raw] POST " + cfg.baseUrl + "/v1/videos");
    log(JSON.stringify(sanitizePayload(payload), null, 2));
    return;
  }
  const runFile = join(dir, "run.json");
  if (existsSync(runFile)) { const prev = JSON.parse(readFileSync(runFile, "utf8")); die("输出目录已有任务 " + prev.taskId + "（防重复提交）。续查:\n  node studio.mjs status --task " + prev.taskId + ' --wait --out "' + dir + '"'); }
  log("[submit][raw] POST /v1/videos");
  let task;
  try { task = await api(cfg, "POST", "/v1/videos", payload); }
  catch (e) { die("提交失败: " + e.message + "\nbody=" + JSON.stringify(e.body || {}).slice(0, 500)); }
  const taskId = task.id || task.task_id;
  if (!taskId) die("提交响应中无任务 ID: " + JSON.stringify(task).slice(0, 400));
  writeFileSync(runFile, JSON.stringify({ taskId, submittedAt: new Date().toISOString(), payload: sanitizePayload(payload) }, null, 2));
  log("[task] " + taskId + " (status=" + task.status + ")");
  if (args["no-wait"]) { log("稍后: node studio.mjs status --task " + taskId + ' --wait --out "' + dir + '"'); return; }
  await pollTask(cfg, taskId, dir);
}
// ---------- image (keyframes) ----------
async function cmdImage(cfg, args) {
  if (!args.prompt) die("需要 --prompt");
  const aspect = String(args.aspect || "16:9");
  const model = resolveImgModel(args.model);
  const size = imgSize(aspect, model.scale);
  if (!size) die("aspect 仅支持: " + Object.keys(IMG_ASPECTS).join(", "));
  const n = args.n ? parseInt(args.n, 10) : 1;
  if (!(n >= 1 && n <= 4)) die("--n 限 1–4");
  // 参考图（垫图/锁角色/锁产品）：任意个 --ref，走 /v1/images/edits
  const refs = [].concat(args.ref || []).filter(Boolean).map(String);
  const dir = outDir(args);

  if (args["dry-run"]) {
    log("[DRY-RUN] " + (refs.length ? "POST " + cfg.baseUrl + "/v1/images/edits (multipart)" : "POST " + cfg.baseUrl + "/v1/images/generations"));
    log(JSON.stringify({ model: model.id, note: model.note, prompt: String(args.prompt), n, size, refs }, null, 2));
    return;
  }

  let items;
  if (refs.length) {
    for (const r of refs) if (!existsSync(resolve(r))) die("参考图不存在: " + r);
    log("[submit] 参考图生图 " + n + " 张 (" + model.id + ") ←垫图 " + refs.length + " 张");
    const fd = new FormData();
    fd.append("model", model.id);
    fd.append("prompt", String(args.prompt));
    fd.append("n", String(n));
    fd.append("size", size);
    for (const r of refs) {
      const p = resolve(r);
      const buf = readFileSync(p);
      if (buf.length > 8 * 1024 * 1024) die("参考图过大 (>8MB)，请压缩: " + p);
      const mime = MIME[extname(p).toLowerCase()] || "image/png";
      fd.append("image", new Blob([buf], { type: mime }), "ref" + extname(p));
    }
    const res = await fetch(cfg.baseUrl + "/v1/images/edits", { method: "POST", headers: { Authorization: "Bearer " + requireKey(cfg) }, body: fd });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    if (!res.ok) die("参考图生图失败 HTTP " + res.status + ": " + ((json.error && json.error.message) || text.slice(0, 300)));
    items = json.data || [];
  } else {
    const payload = { model: model.id, prompt: String(args.prompt), n, size };
    log("[submit] 生图 " + n + " 张 " + size + " (" + model.id + ")");
    const res = await api(cfg, "POST", "/v1/images/generations", payload);
    items = res.data || [];
  }

  let i = 0;
  for (const it of items) {
    const dest = join(dir, "keyframe_" + Date.now() + "_" + i + ".png");
    if (it.b64_json) writeFileSync(dest, Buffer.from(it.b64_json, "base64"));
    else if (it.url) await download(it.url, dest);
    else continue;
    i++;
    log("[DONE] 图片已保存: " + dest);
  }
  if (!i) die("响应中没有图片数据（模型 " + model.id + "）");
}
// ---------- concat (ffmpeg) ----------
function cmdConcat(cfg, args) {
  const inputs = [];
  if (args.dir) {
    const root = resolve(String(args.dir));
    if (!existsSync(root)) die("目录不存在: " + root);
    const walk = (d) => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.mp4$/i.test(e)) inputs.push(p);
      }
    };
    walk(root);
  }
  for (const f of asArray(args.input)) {
    const p = resolve(String(f));
    if (!existsSync(p)) die("文件不存在: " + p);
    inputs.push(p);
  }
  if (inputs.length < 2) die("需要至少 2 个 mp4（--dir <目录> 递归扫描，或多个 --input <文件> 显式指定顺序）");
  const out = resolve(String(args.out || "final.mp4"));
  mkdirSync(dirname(out), { recursive: true });
  const listFile = out + ".list.txt";
  writeFileSync(listFile, inputs.map(p => "file '" + p.replace(/\\/g, "/") + "'").join("\n"));
  log("[concat] 共 " + inputs.length + " 段:");
  inputs.forEach((p, i) => log("  " + (i + 1) + ". " + p));
  const ff = args.reencode
    ? ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", out]
    : ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out];
  const r = spawnSync("ffmpeg", ff, { encoding: "utf8" });
  if (r.error) die("无法运行 ffmpeg，请确认已安装并在 PATH 中: " + r.error.message);
  if (r.status !== 0) die("ffmpeg 拼接失败（可尝试加 --reencode 统一编码）:\n" + String(r.stderr || "").slice(-800));
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", out], { encoding: "utf8" });
  const dur = probe.status === 0 ? parseFloat(probe.stdout).toFixed(1) + " 秒" : "(ffprobe 不可用)";
  log("[DONE] 拼接完成: " + out + "（总时长 " + dur + "）");
}
// ---------- depth / motion pass（功能二/三 辅助：把运镜与人物动作变得可读）----------
function ffRun(argsArr, label) {
  const r = spawnSync("ffmpeg", argsArr, { encoding: "utf8" });
  if (r.error) die("无法运行 ffmpeg（需在 PATH 中）: " + r.error.message);
  if (r.status !== 0) die("ffmpeg 失败" + (label ? "（" + label + "）" : "") + ":\n" + String(r.stderr || "").slice(-600));
}
function detectPython(args) {
  const cands = [];
  if (args.py) cands.push(String(args.py));
  cands.push("python3", "python");
  cands.push(join(homedir(), "AppData/Local/Programs/Python/Python312/python.exe"));
  for (const c of cands) {
    const r = spawnSync(c, ["-c", "import sys;print(sys.version.split()[0])"], { encoding: "utf8" });
    if (r.status === 0 && String(r.stdout || "").trim()) return c;
  }
  return null;
}
async function cmdDepth(cfg, args) {
  const video = args.video || args.input;
  if (!video) die("需要 --video <视频路径>");
  const src = resolve(String(video));
  if (!existsSync(src)) die("视频不存在: " + src);
  const fps = args.fps ? parseFloat(args.fps) : 4;
  const cmap = String(args.colormap || "all"); // all|gray|magma|turbo
  const dir = outDir(args);
  const framesDir = join(dir, "frames"); mkdirSync(framesDir, { recursive: true });
  const depthDir = join(dir, "depth"); mkdirSync(depthDir, { recursive: true });

  log("[depth] 抽帧 @ " + fps + "fps → " + framesDir);
  ffRun(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", "fps=" + fps, join(framesDir, "f%05d.png")], "抽帧");
  const frameFiles = readdirSync(framesDir).filter(f => f.endsWith(".png")).sort();
  if (!frameFiles.length) die("抽帧失败，未得到任何帧");
  log("[depth] 得到 " + frameFiles.length + " 帧");

  const py = detectPython(args);
  let realDepth = false;
  if (py) {
    const chk = spawnSync(py, ["-c", "import transformers,timm,PIL,torch"], { encoding: "utf8" });
    if (chk.status === 0) realDepth = true;
    else log('[depth] 找到 Python 但缺依赖，将回退 ffmpeg 运动pass。装真深度: "' + py + '" -m pip install transformers timm pillow torch');
  } else {
    log("[depth] 未找到 Python，回退 ffmpeg 运动pass（安装 Python + torch 后可用真深度）。");
  }

  const outputs = [];
  if (realDepth) {
    const worker = join(SCRIPT_DIR, "depth_video.py");
    const model = args.model ? String(args.model) : "depth-anything/Depth-Anything-V2-Small-hf";
    log("[depth] 运行 Depth-Anything V2（CPU，约 0.6s/帧，首次含下载）…");
    const r = spawnSync(py, [worker, framesDir, depthDir, model], { stdio: "inherit" });
    const depthFiles = existsSync(depthDir) ? readdirSync(depthDir).filter(f => f.endsWith(".png")) : [];
    if (r.status !== 0 || !depthFiles.length) { log("[depth] 深度worker失败，回退 ffmpeg 运动pass。"); realDepth = false; }
  }

  if (realDepth) {
    const mk = (name, extra) => {
      const o = join(dir, "depth_" + name + ".mp4");
      ffRun(["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", join(depthDir, "f%05d.png"),
        "-vf", "format=gray,normalize" + (extra ? "," + extra : "") + ",format=yuv420p", "-r", String(fps), o], name);
      outputs.push(o);
    };
    if (cmap === "all" || cmap === "gray") mk("gray", "");
    if (cmap === "all" || cmap === "magma") mk("magma", "pseudocolor=preset=magma");
    if (cmap === "all" || cmap === "turbo" || cmap === "spectral") mk("spectral", "pseudocolor=preset=turbo");
    // 四格样张（原帧 | 灰度 | 熔岩 | 光谱），供直观确认与展示
    const mid = frameFiles[Math.floor(frameFiles.length / 2)];
    const montage = join(dir, "depth_montage.png");
    ffRun(["-y", "-hide_banner", "-loglevel", "error", "-i", join(framesDir, mid), "-i", join(depthDir, mid),
      "-filter_complex",
      "[1]format=gray,normalize,split=3[g0][g1][g2];[g0]scale=360:-1[b];[g1]pseudocolor=preset=magma,scale=360:-1[c];[g2]pseudocolor=preset=turbo,scale=360:-1[d];[0]scale=360:-1[a];[a][b][c][d]hstack=inputs=4",
      montage], "montage");
    outputs.push(montage);
    log("[depth] ✅ 真深度完成（Depth-Anything V2）");
  } else {
    // ffmpeg 运动兜底：边缘轮廓（读姿态）+ 帧差热图（读运镜）
    const edge = join(dir, "motion_edge.mp4");
    ffRun(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", "edgedetect=low=0.1:high=0.4,format=yuv420p", edge], "edge");
    const heat = join(dir, "motion_heat.mp4");
    ffRun(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", "tblend=all_mode=difference,format=gray,eq=contrast=4,pseudocolor=preset=turbo,format=yuv420p", heat], "heat");
    outputs.push(edge, heat);
    log("[depth] ✅ ffmpeg 运动pass完成（边缘+帧差热图；非真深度）");
  }
  log("[depth] 产物:");
  for (const o of outputs) log("  " + o);
  log("[depth] 下一步：亲眼逐帧读 depth/motion → 判运镜 → 写分镜头脚本 → 收敛最终提示词（见 references/reverse.md）");
}
// ---------- meta ----------
async function cmdSelfTest(cfg) {
  requireKey(cfg);
  log("baseUrl: " + cfg.baseUrl);
  log("key: " + mask(cfg.apiKey));
  try {
    const res = await api(cfg, "GET", "/v1/models");
    const ids = (res.data || []).map(m => m.id);
    log("可用模型数: " + ids.length);
    const vid = ids.filter(x => /seedance/i.test(x));
    const img = ids.filter(x => /image/i.test(x));
    log("视频模型: " + (vid.join(", ") || "(未见 seedance —— 确认 Key 分组包含视频模型)"));
    log("生图模型: " + (img.join(", ") || "(未见 image 模型)"));
    log("[OK] Key 可用。self-test 不调用付费生成接口。");
    log("");
    for (const l of CAPS) log(l);
  } catch (e) { die("self-test 失败: " + e.message); }
}
// ---------- main ----------
const argv = process.argv.slice(2);
const args = parseArgs(argv);
const cfg = loadConfig();
(async () => {
  if (args["set-key"]) { cfg.apiKey = String(args["set-key"]); saveConfig({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }); log("Key 已保存到 " + CONFIG_PATH + "（" + mask(cfg.apiKey) + "）"); return; }
  if (args["set-base-url"]) { cfg.baseUrl = String(args["set-base-url"]).replace(/\/$/, ""); saveConfig({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }); log("baseUrl = " + cfg.baseUrl); return; }
  if (args["config-path"]) { log(CONFIG_PATH); return; }
  if (args["get-config"]) { log(JSON.stringify({ configPath: CONFIG_PATH, baseUrl: cfg.baseUrl, apiKey: mask(cfg.apiKey), videoModel: cfg.videoModel, imageModel: cfg.imageModel }, null, 2)); return; }
  if (args["caps"] || args["capabilities"]) { for (const l of CAPS) log(l); return; }
  if (args["self-test"]) return cmdSelfTest(cfg);
  const cmd = args._[0];
  if (cmd === "video") return cmdVideo(cfg, args);
  if (cmd === "image") return cmdImage(cfg, args);
  if (cmd === "status") return cmdStatus(cfg, args);
  if (cmd === "raw") return cmdRaw(cfg, args);
  if (cmd === "concat") return cmdConcat(cfg, args);
  if (cmd === "depth") return cmdDepth(cfg, args);
  log(["seedance-studio CLI — 用法:",
    '  配置:  node studio.mjs --set-key "sk-..."   |  --get-config  |  --self-test  |  --caps',
    '  生视频: node studio.mjs video --prompt "..." [--duration 4-30] [--ratio 16:9]',
    "          [--image 本地图或URL ...最多30] [--video-url URL] [--audio-url URL]",
    "          [--no-audio] [--seed N] [--out 目录] [--no-wait] [--dry-run]",
    "  查任务: node studio.mjs status --task task_xxx [--wait] [--out 目录]",
    '  生图:  node studio.mjs image --prompt "..." [--aspect 16:9] [--n 1-4] [--model 2k|4k|gemini] [--ref 参考图 ...] [--dry-run]',
    "          模型: 2k=gpt-image-2(默认) · 4k=gpt-image-2-4k(高清主图) · gemini=gemini-3-pro-image(参考图一致性最强)",
    "  拼接:  node studio.mjs concat --dir <segments目录> [--input a.mp4 --input b.mp4] [--out final.mp4] [--reencode]",
    "  深度图: node studio.mjs depth --video <片> [--fps 4] [--colormap all|gray|magma|turbo] [--out 目录]",
    "          反推辅助：真深度(Depth-Anything V2)出灰度/熔岩/光谱深度视频，读人物动作与前后景；无 torch 时自动回退 ffmpeg 运动pass"].join("\n"));
})().catch(e => die(e.message));
