#!/usr/bin/env node
// seedance-studio CLI — 88api.ai Seedance 2.5 video + gpt-image-2-4k / gemini-3-pro-image keyframes
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
  imageModel: "gpt-image-2-4k",
  pollIntervalMs: 12000,
  pollTimeoutMs: 25 * 60 * 1000,
};
const RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const IMG_ASPECTS = { "1:1":"2048x2048","3:2":"2048x1360","2:3":"1360x2048","4:3":"2048x1536","3:4":"1536x2048","16:9":"2048x1152","9:16":"1152x2048","2:1":"2048x1024","1:2":"1024x2048","7:4":"2208x1264","4:7":"1264x2208" };
// 生图模型预设（gpt/grok 走 /v1/images/*；gemini 走 /v1/chat/completions 多模态，2026-08 实测）
const IMG_MODELS = {
  "gpt-image-2-4k":             { id: "gpt-image-2-4k",             kind: "images", scale: "4k",     note: "默认·高清主图/海报（16:9 实测真 4K UHD 3840×2160；方图约 2880²，返回 URL；OpenAI 上游）" },
  "grok-imagine-image-quality": { id: "grok-imagine-image-quality", kind: "images", scale: "native", note: "xAI Grok 高质量出图（约 2048²；不同上游，OpenAI 通道熔断时兜底首选）" },
  "gemini-3-pro-image":         { id: "gemini-3-pro-image",         kind: "chat",   scale: "native", note: "pro 模型·Gemini 3 Pro Image（chat 端点，约 2048² 原生；参考图一致性最强，锁角色/垫图首选）" },
};
// 友好别名 → 预设键
const IMG_ALIASES = {
  "4k":"gpt-image-2-4k","gpt":"gpt-image-2-4k","gpt-4k":"gpt-image-2-4k","gpt-image-2-4k":"gpt-image-2-4k","default":"gpt-image-2-4k",
  "grok":"grok-imagine-image-quality","grok-image":"grok-imagine-image-quality","grok-imagine":"grok-imagine-image-quality","grok-imagine-image-quality":"grok-imagine-image-quality",
  "gemini":"gemini-3-pro-image","gemini-pro":"gemini-3-pro-image","pro":"gemini-3-pro-image","gemini-3-pro-image":"gemini-3-pro-image",
};
// 主模型失败时的自动兜底链（跨上游：先 Google Gemini chat 端点，再 xAI Grok images 端点，避开同一 OpenAI 通道一起挂）
const IMG_FALLBACKS = ["gemini-3-pro-image", "grok-imagine-image-quality"];
function imgKind(id){ return /gemini/i.test(String(id)) ? "chat" : "images"; }
function resolveImgModel(name) {
  if (!name) return IMG_MODELS["gpt-image-2-4k"];
  const key = IMG_ALIASES[String(name).toLowerCase()];
  if (key) return IMG_MODELS[key];
  const id = String(name);
  return { id, kind: imgKind(id), scale: "native", note: "(自定义模型 id，按原生尺寸提交)" };
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
  "生图（关键帧/锚定图，2026-08 实测）：",
  "  • 默认 gpt-image-2-4k（OpenAI 上游，/v1/images）：16:9 实测出真 4K UHD 3840×2160；方图约 2880²（返回 URL）",
  "  • gemini-3-pro-image（`--model gemini`，pro 模型，Google 上游）：走 /v1/chat/completions 多模态，约 2048² 原生，参考图一致性最强",
  "  • grok-imagine-image-quality（`--model grok`，xAI 上游，/v1/images）：不同上游，OpenAI 通道熔断时的兜底首选",
  "  • 自动兜底链：默认档失败 → grok（不同上游）→ gemini（chat）依次重试（`--no-fallback` 关闭）；上游熔断/429 会给出恢复时间提示",
  "  • 不满意画面/参考还原：手动 `--model gemini` 用 pro 模型重试（一致性更强）",
  "  • 参考图生图（垫图/锁角色/锁产品）：加 `--ref <图> [--ref <图>...]`——gpt/grok 走 /v1/images/edits，gemini 走 chat 多模态；功能三保产品/人物一致性首选",
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
// die 不再同步 process.exit()——那会在 undici 连接句柄关闭中途触发 Windows libuv 断言崩溃。
// 改为抛错，由顶层统一打印并设置 exitCode，让事件循环自然收尾。
function die(msg) { const e = new Error(msg); e.isDie = true; throw e; }
// 上游熔断/容量类报错 → 给出"非本地问题+恢复时间"的友好提示
function upstreamHint(msg) {
  const s = String(msg || "");
  if (/circuit breaker|temporarily suspended|no active tokens|auto-recovery|429/i.test(s)) {
    const m = /auto-recovery probe in ~?(\d+)\s*s/i.exec(s);
    return "\n[诊断] 88api 上游渠道熔断/容量不足（非你的 Key/提示词/模型名问题）" +
      (m ? "，约 " + m[1] + " 秒后自动恢复，稍后重试即可。" : "，稍后重试即可。") +
      " 失败调用不产图、不计费。";
  }
  if (/可用渠道不存在|no available channel|503|channel.*(unavailable|suspended)/i.test(s))
    return "\n[诊断] 上游渠道暂不可用（非本地问题），稍后重试，或换 `--model grok` / `--model gemini`。";
  return "";
}
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
// 单次生图请求（文生图 或 参考图 edits），返回 data[] 数组；失败/无输出抛错供上层回退
// 从 chat/completions 响应里抽出图片，归一成 {b64_json} / {url}（与 images 端点返回同形，存盘逻辑复用）
function parseChatImages(json) {
  const out = [];
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  if (!msg) return out;
  const push = (u) => {
    if (!u) return;
    const m = /^data:image\/[^;]+;base64,(.+)$/s.exec(u);
    if (m) out.push({ b64_json: m[1] });
    else if (/^https?:\/\//i.test(u)) out.push({ url: u });
  };
  if (Array.isArray(msg.images)) for (const im of msg.images) push((im && im.image_url && im.image_url.url) || (im && im.url) || (im && im.b64_json ? "data:image/png;base64," + im.b64_json : null));
  const scan = (s) => {
    if (typeof s !== "string") return;
    const re = /(data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)"'<>]+?\.(?:png|jpe?g|webp)(?:\?[^\s)"'<>]*)?)/gi;
    let m; while ((m = re.exec(s))) push(m[1]);
  };
  if (typeof msg.content === "string") scan(msg.content);
  else if (Array.isArray(msg.content)) for (const p of msg.content) { if (p && p.type === "image_url" && p.image_url) push(p.image_url.url); if (p && typeof p.text === "string") scan(p.text); }
  return out;
}
// gemini 家族：图片经 /v1/chat/completions 多模态返回（chat 一次一图，n>1 循环）
async function requestChatImages(cfg, modelId, prompt, n, refs) {
  const items = [];
  for (let k = 0; k < n; k++) {
    let content;
    if (refs.length) {
      content = [{ type: "text", text: prompt }];
      for (const r of refs) {
        const p = resolve(r);
        const buf = readFileSync(p);
        if (buf.length > 8 * 1024 * 1024) die("参考图过大 (>8MB)，请压缩: " + p);
        const mime = MIME[extname(p).toLowerCase()] || "image/png";
        content.push({ type: "image_url", image_url: { url: "data:" + mime + ";base64," + buf.toString("base64") } });
      }
    } else content = prompt;
    const res = await api(cfg, "POST", "/v1/chat/completions", { model: modelId, messages: [{ role: "user", content }], modalities: ["text", "image"] });
    const imgs = parseChatImages(res);
    if (!imgs.length) throw new Error("chat 端点未返回图片（" + modelId + "）");
    items.push(...imgs);
  }
  return items;
}
async function requestImages(cfg, modelId, prompt, n, size, refs) {
  if (imgKind(modelId) === "chat") return requestChatImages(cfg, modelId, prompt, n, refs);
  if (refs.length) {
    const fd = new FormData();
    fd.append("model", modelId);
    fd.append("prompt", prompt);
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
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + ((json.error && json.error.message) || text.slice(0, 200)));
    const items = json.data || [];
    if (!items.length) throw new Error("无图片数据");
    return items;
  }
  const res = await api(cfg, "POST", "/v1/images/generations", { model: modelId, prompt, n, size });
  const items = res.data || [];
  if (!items.length) throw new Error("无图片数据");
  return items;
}
async function cmdImage(cfg, args) {
  if (!args.prompt) die("需要 --prompt");
  const prompt = String(args.prompt);
  const aspect = String(args.aspect || "16:9");
  const primary = resolveImgModel(args.model);
  if (!imgSize(aspect, primary.scale)) die("aspect 仅支持: " + Object.keys(IMG_ASPECTS).join(", "));
  const n = args.n ? parseInt(args.n, 10) : 1;
  if (!(n >= 1 && n <= 4)) die("--n 限 1–4");
  // 参考图（垫图/锁角色/锁产品）：任意个 --ref，走 /v1/images/edits
  const refs = [].concat(args.ref || []).filter(Boolean).map(String);
  for (const r of refs) if (!existsSync(resolve(r))) die("参考图不存在: " + r);
  const dir = outDir(args);
  const noFallback = !!args["no-fallback"];
  // 兜底链：主模型 + 跨上游兜底（去重、去掉与主模型同款）。--no-fallback 只留主模型。
  const chain = noFallback ? [primary.id] : [primary.id, ...IMG_FALLBACKS.filter(f => f !== primary.id)];
  const endpointOf = (id) => imgKind(id) === "chat" ? "/v1/chat/completions (多模态)" : (refs.length ? "/v1/images/edits (multipart)" : "/v1/images/generations");

  if (args["dry-run"]) {
    log("[DRY-RUN] 生图兜底链: " + chain.join(" → "));
    for (const id of chain) {
      const m = IMG_MODELS[id] || resolveImgModel(id);
      log(JSON.stringify({ model: m.id, endpoint: cfg.baseUrl + endpointOf(m.id), note: m.note, prompt, n, size: imgSize(aspect, m.scale), refs }, null, 2));
    }
    return;
  }

  let used = primary;
  let items;
  const label = refs.length ? "参考图生图 " + n + " 张 ←垫图 " + refs.length + " 张" : "生图 " + n + " 张 " + imgSize(aspect, primary.scale);
  const errs = [];
  for (let idx = 0; idx < chain.length; idx++) {
    const id = chain[idx];
    const m = IMG_MODELS[id] || resolveImgModel(id);
    if (idx === 0) log("[submit] " + label + " (" + id + " · " + endpointOf(id) + ")");
    else log("[fallback] " + chain[idx - 1] + " 失败（" + (errs[errs.length - 1] || "").replace(/^[^→]*→\s*/, "") + "）→ 切换 " + id + "（不同上游 · " + endpointOf(id) + "）重试…");
    try { items = await requestImages(cfg, id, prompt, n, imgSize(aspect, m.scale), refs); used = m; break; }
    catch (e) { errs.push(id + " → " + e.message); }
  }
  if (!items) die("生图失败，" + (chain.length > 1 ? "兜底链全部未成" : "已禁用兜底") + "：\n  " + errs.join("\n  ") + upstreamHint(errs.join(" ")));

  let i = 0;
  for (const it of items) {
    const dest = join(dir, "keyframe_" + Date.now() + "_" + i + ".png");
    if (it.b64_json) writeFileSync(dest, Buffer.from(it.b64_json, "base64"));
    else if (it.url) await download(it.url, dest);
    else continue;
    i++;
    log("[DONE] 图片已保存: " + dest);
  }
  if (!i) die("响应中没有图片数据（模型 " + used.id + "）");
  if (used.id !== "gemini-3-pro-image") log("[提示] 对画面/参考还原不满意？加 --model gemini（pro 模型，一致性更强）重试。");
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
  const cmap = String(args.colormap || "all"); // all|gray|magma|turbo
  // 题材自适应：character(人物/产品·深度为主) | landscape(风景·运动+原帧、跳深度) | action(武打/动作·骨架+运动+深度) | auto(全出，Claude自己挑)
  let mode = String(args.mode || "auto").toLowerCase();
  if (mode === "product" || mode === "person" || mode === "model") mode = "character";
  if (mode === "scenery" || mode === "scene") mode = "landscape";
  if (mode === "fight" || mode === "martial" || mode === "combat" || mode === "武打" || mode === "动作") mode = "action";
  if (!["auto", "character", "landscape", "action"].includes(mode)) mode = "auto";
  // 抽帧密度按题材：动作要抓零点几秒的招式帧→8fps；风景慢→2fps；其余 4fps
  const fps = args.fps ? parseFloat(args.fps) : (mode === "action" ? 8 : mode === "landscape" ? 2 : 4);
  // landscape：运镜靠视差+原帧光色，单目深度对天空/云海/水面/雾失效——默认跳过深度（--with-depth 可强开）；任意模式可 --no-depth 提速
  const skipDepth = (mode === "landscape" && !args["with-depth"]) || Boolean(args["no-depth"]);
  const wantPose = mode === "action" && !args["no-pose"]; // 武打骨架条（多人 YOLO-pose）
  const dir = outDir(args);
  const framesDir = join(dir, "frames"); mkdirSync(framesDir, { recursive: true });
  const depthDir = join(dir, "depth"); mkdirSync(depthDir, { recursive: true });

  const modeNote = { character: "深度为主（人物/产品有硬几何）", landscape: "运动+原帧为主，跳过深度（风景/大场面）", action: "骨架+运动+深度（武打/快速动作，高帧率抓招式）", auto: "深度+运动都出，读帧自己挑" }[mode];
  log("[depth] 题材模式: " + mode + " —— " + modeNote);
  log("[depth] 抽帧 @ " + fps + "fps → " + framesDir);
  ffRun(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", "fps=" + fps, join(framesDir, "f%05d.png")], "抽帧");
  const frameFiles = readdirSync(framesDir).filter(f => f.endsWith(".png")).sort();
  if (!frameFiles.length) die("抽帧失败，未得到任何帧");
  log("[depth] 得到 " + frameFiles.length + " 帧");

  const outputs = [];

  // ---------- 真深度 pass（character / auto；landscape 默认跳过）----------
  let realDepth = false;
  if (!skipDepth) {
    const py = detectPython(args);
    if (py) {
      const chk = spawnSync(py, ["-c", "import transformers,timm,PIL,torch"], { encoding: "utf8" });
      if (chk.status === 0) realDepth = true;
      else log('[depth] 找到 Python 但缺依赖，跳过真深度（仅出运动pass）。装真深度: "' + py + '" -m pip install transformers timm pillow torch');
    } else {
      log("[depth] 未找到 Python，跳过真深度（仅出运动pass；装 Python + torch 后可用）。");
    }
    if (realDepth) {
      const worker = join(SCRIPT_DIR, "depth_video.py");
      const model = args.model ? String(args.model) : "depth-anything/Depth-Anything-V2-Small-hf";
      log("[depth] 运行 Depth-Anything V2（CPU，约 0.6s/帧，首次含下载）…");
      const r = spawnSync(py, [worker, framesDir, depthDir, model], { stdio: "inherit" });
      const depthFiles = existsSync(depthDir) ? readdirSync(depthDir).filter(f => f.endsWith(".png")) : [];
      if (r.status !== 0 || !depthFiles.length) { log("[depth] 深度worker失败，仅出运动pass。"); realDepth = false; }
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
    }
  } else {
    log("[depth] landscape 模式：跳过单目深度（对天空/云海/水面失效、且丢掉光色大气）。要强开加 --with-depth。");
  }

  // ---------- 运动 pass（所有模式都出：读运镜/视差；landscape 时是主力）----------
  const edge = join(dir, "motion_edge.mp4");
  ffRun(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", "edgedetect=low=0.1:high=0.4,format=yuv420p", edge], "edge");
  const heat = join(dir, "motion_heat.mp4");
  ffRun(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", "tblend=all_mode=difference,format=gray,eq=contrast=4,pseudocolor=preset=turbo,format=yuv420p", heat], "heat");
  outputs.push(edge, heat);
  log("[depth] ✅ 运动pass完成（motion_edge 轮廓/构图线 + motion_heat 帧差热图/运镜）");

  // ---------- 骨架姿态 pass（action 模式：多人 YOLO-pose 画火柴人，读连招/招式/两人相对位置）----------
  if (wantPose) {
    const py = detectPython(args);
    let poseOk = false;
    if (py) {
      const chk = spawnSync(py, ["-c", "import ultralytics,cv2"], { encoding: "utf8" });
      if (chk.status === 0) poseOk = true;
      else log('[pose] 找到 Python 但缺 ultralytics/opencv，跳过骨架（仍有 edge/heat 读姿态）。装: "' + py + '" -m pip install ultralytics opencv-python');
    } else {
      log("[pose] 未找到 Python，跳过骨架 pass。");
    }
    if (poseOk) {
      const overlayDir = join(dir, "pose_overlay"); mkdirSync(overlayDir, { recursive: true });
      const skelDir = join(dir, "pose_skeleton"); mkdirSync(skelDir, { recursive: true });
      const worker = join(SCRIPT_DIR, "pose_video.py");
      const pmodel = args["pose-model"] ? String(args["pose-model"]) : "yolo11n-pose.pt";
      log("[pose] 运行多人 YOLO-pose（CPU，首次含下载模型）…");
      const r = spawnSync(py, [worker, framesDir, overlayDir, skelDir, pmodel], { stdio: "inherit" });
      const skFiles = existsSync(skelDir) ? readdirSync(skelDir).filter(f => f.endsWith(".png")).sort() : [];
      if (r.status === 0 && skFiles.length) {
        const ov = join(dir, "pose_overlay.mp4");
        ffRun(["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", join(overlayDir, "f%05d.png"), "-vf", "format=yuv420p", "-r", String(fps), ov], "pose_overlay");
        const sk = join(dir, "pose_skeleton.mp4");
        ffRun(["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", join(skelDir, "f%05d.png"), "-vf", "format=yuv420p", "-r", String(fps), sk], "pose_skeleton");
        // 招式条：等距抽 5 帧纯骨架横拼，一眼看 蓄力→出招→命中→收招
        const idx = [0, 1, 2, 3, 4].map(k => skFiles[Math.min(skFiles.length - 1, Math.round(k * (skFiles.length - 1) / 4))]);
        const strip = join(dir, "pose_strip.png");
        ffRun(["-y", "-hide_banner", "-loglevel", "error",
          "-i", join(skelDir, idx[0]), "-i", join(skelDir, idx[1]), "-i", join(skelDir, idx[2]), "-i", join(skelDir, idx[3]), "-i", join(skelDir, idx[4]),
          "-filter_complex", "[0]scale=300:-1[a];[1]scale=300:-1[b];[2]scale=300:-1[c];[3]scale=300:-1[d];[4]scale=300:-1[e];[a][b][c][d][e]hstack=inputs=5", strip], "pose_strip");
        outputs.push(ov, sk, strip);
        log("[pose] ✅ 骨架完成（pose_overlay 叠加原帧 / pose_skeleton 纯骨架 / pose_strip 招式条）");
      } else {
        log("[pose] 骨架worker失败或无输出，跳过（仍有 edge/heat 读姿态）。");
      }
    }
  }

  // ---------- 大气/光色样张（landscape 时额外出：风景反推最需要保留的光线与色调）----------
  if (skipDepth) {
    const n = frameFiles.length;
    const pk = [Math.max(0, Math.floor(n / 6)), Math.floor(n / 2), Math.min(n - 1, Math.floor(n * 5 / 6))].map(i => frameFiles[i]);
    const atmo = join(dir, "atmosphere.png");
    ffRun(["-y", "-hide_banner", "-loglevel", "error",
      "-i", join(framesDir, pk[0]), "-i", join(framesDir, pk[1]), "-i", join(framesDir, pk[2]),
      "-filter_complex", "[0]scale=440:-1[a];[1]scale=440:-1[b];[2]scale=440:-1[c];[a][b][c]hstack=inputs=3", atmo], "atmosphere");
    outputs.push(atmo);
    log("[depth] ✅ 大气样张 atmosphere.png（三帧原图横拼：读光线/色调/大气透视——风景的深度就藏在这里，别用深度图覆盖掉）");
  }

  log("[depth] 产物:");
  for (const o of outputs) log("  " + o);
  if (mode === "landscape") {
    log("[depth] 读法（风景）：以原帧看光色大气、motion_heat 看运镜视差为主；注意帧差会把硬切也点亮——只在同一镜头内(用②的切镜点)读运镜，别跨切。");
  } else if (mode === "character") {
    log("[depth] 读法（人物/产品）：以 depth_* 看身体朝向/肢体前后/前后景层次为主，motion_heat 补判运镜。");
  } else if (mode === "action") {
    log("[depth] 读法（武打）：pose_strip/pose_skeleton 看招式轨迹与两人相对站位（蓄力→出招→命中→收招）、depth 看出招肢体前后、motion_heat 看打击轨迹与命中/运镜；注意帧差在硬切/命中处会爆亮。复刻层提醒：Seedance 能演可信武打，但不做帧级精确连招/接触点。");
  } else {
    log("[depth] 读法（auto）：人物/产品看 depth_*，风景/大场面看 motion_heat+原帧；深度对天空/云海/水面失效时以运动+原帧为准。");
  }
  log("[depth] 下一步：亲眼逐帧读 → 判运镜 → 写分镜头脚本 → 收敛最终提示词（见 references/reverse.md）");
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
    '  生图:  node studio.mjs image --prompt "..." [--aspect 16:9] [--n 1-4] [--model 4k|gemini|grok] [--ref 参考图 ...] [--no-fallback] [--dry-run]',
    "          默认 gpt-image-2-4k(16:9 出真 4K UHD)；失败自动跨上游兜底 grok→gemini；gemini 走 chat 端点、一致性最强，不满意可 --model gemini 重试",
    "  拼接:  node studio.mjs concat --dir <segments目录> [--input a.mp4 --input b.mp4] [--out final.mp4] [--reencode]",
    "  运动理解: node studio.mjs depth --video <片> [--mode auto|character|landscape|action] [--fps N] [--no-depth] [--out 目录]",
    "          题材自适应：character=真深度读人物动作/前后景；landscape=运动热图+原帧光色、跳深度(--with-depth 强开)；action=多人骨架(YOLO-pose)+运动+深度读武打连招(--no-pose 关骨架)；auto=都出自己挑。所有模式都出 motion_heat 读运镜"].join("\n"));
})().catch(e => { console.error("[ERROR] " + (e && e.message ? e.message : String(e))); process.exitCode = 1; });
