#!/usr/bin/env node
// seedance-studio CLI — 88api.ai dynamic video catalog + gpt-image keyframes
// Zero-dependency Node 18+. Config: ~/.seedance-studio/config.json
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, readdirSync, statSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, extname, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);

const CONFIG_DIR = join(homedir(), ".seedance-studio");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULTS = {
  baseUrl: "https://88api.ai",
  videoModel: "",
  imageModel: "gpt-image-2",
  accessToken: "",
  userId: "",
  onboardingShown: false,
  pollIntervalMs: 12000,
  pollTimeoutMs: 25 * 60 * 1000,
};
const ENV = {
  apiKey: ["SEEDANCE_STUDIO_API_KEY"],
  accessToken: ["SEEDANCE_STUDIO_ACCESS_TOKEN", "RELAY_88API_ACCESS_TOKEN"],
  userId: ["SEEDANCE_STUDIO_USER_ID", "RELAY_88API_USER_ID"],
};
const VIDEO_ENDPOINT_TYPES = new Set(["openai-video", "video-generation"]);
const AUTH_IDENTITY_VIDEO_LOCK = "【授权真人身份唯一基准】第一张普通参考图（不含首帧/尾帧）是用户明确授权使用的真人身份照片，只控制人物的脸、五官比例、发型、肤色、体型与稳定可见特征。首帧、尾帧及其它 AI 关键帧只控制场景、服装、构图和状态，不得改写人物身份；发生冲突时一律以该真人身份图为准。不要迁移身份图中的背景、镜面重复人物、文字、Logo 或无关物品。保留真实面部不对称、自然皮肤纹理与拍摄质感，禁止标准化美化和换脸。";
const AUTH_IDENTITY_IMAGE_LOCK = "【授权真人身份唯一基准】第一张参考图是用户明确授权使用的真人身份照片，只控制人物的脸、五官比例、发型、肤色、体型与稳定可见特征。其它参考图只控制场景、服装、构图或风格，不得改写身份；发生冲突时一律以第一张身份图为准。保留真实面部不对称、自然皮肤纹理与拍摄质感，禁止标准化美化和换脸。";
function withIdentityLock(prompt, lock) {
  const s = String(prompt || "");
  return s.includes("【授权真人身份唯一基准】") ? s : lock + "\n\n" + s;
}
const RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
// 尺寸表与参考插件 88api-image-gen 的 SIZE_MATRIX 完全一致（后端最长边上限 IMAGE_MAX_EDGE=3840，4K 档不是把 2K 翻倍）
const IMG_ASPECTS = { "1:1":"2048x2048","3:2":"2048x1360","2:3":"1360x2048","4:3":"2048x1536","3:4":"1536x2048","16:9":"2048x1152","9:16":"1152x2048","2:1":"2048x1024","1:2":"1024x2048","7:4":"2208x1264","4:7":"1264x2208" };
const IMG_ASPECTS_4K = { "1:1":"2880x2880","3:2":"3520x2352","2:3":"2352x3520","4:3":"3264x2448","3:4":"2448x3264","16:9":"3840x2160","9:16":"2160x3840","2:1":"3840x1920","1:2":"1920x3840","7:4":"3808x2176","4:7":"2176x3808" };
const IMAGE_MAX_EDGE = 3840;
// 生图模型预设（gpt-image 家族，全部走 /v1/images/*；2026-08 实测）
const IMG_MODELS = {
  "gpt-image-2":     { id: "gpt-image-2",     kind: "images", scale: "2k", note: "默认模型·稳定 2K 档（16:9≈2048×1152、2:3=1360×2048，返回 URL；OpenAI 上游）；出图稳、支持 --ref 垫图/锁角色；网关侧对该模型自带兜底，插件不再自建兜底" },
  "gpt-image-2-4k":  { id: "gpt-image-2-4k",  kind: "images", scale: "4k", note: "高清档（16:9 实测真 4K UHD 3840×2160；方图约 2880²，返回 URL；OpenAI 上游）。仅在 --model 4k/gpt-image-2-4k 显式请求时调用；88api 侧该渠道时有时无，断渠道会直接报错（不自动回退）" },
};
// 友好别名 → 预设键
const IMG_ALIASES = {
  "4k":"gpt-image-2-4k","gpt-4k":"gpt-image-2-4k","gpt-image-2-4k":"gpt-image-2-4k",
  "default":"gpt-image-2","gpt":"gpt-image-2",
  "2":"gpt-image-2","image2":"gpt-image-2","gpt2":"gpt-image-2","gpt-2":"gpt-image-2","gpt-image-2":"gpt-image-2",
};
// 不自建兜底：默认就是 gpt-image-2，newapi 网关对 image2 已自带兜底；显式 --model 4k 时也不回退（4k 渠道断则直接报错，交由用户决定）
const IMG_FALLBACKS = [];
// 并发（抄 88api-image-gen：MAX_CONCURRENCY=10、DEFAULTS.concurrency=3）；单 key 默认保守，别把上游打熔断
const IMG_MAX_CONCURRENCY = 10;
const IMG_DEFAULT_CONCURRENCY = 3;
function resolveImgModel(name) {
  if (!name) return IMG_MODELS["gpt-image-2"];
  const key = IMG_ALIASES[String(name).toLowerCase()];
  if (key) return IMG_MODELS[key];
  const id = String(name);
  return { id, kind: "images", scale: "native", note: "(自定义模型 id，按原生尺寸提交)" };
}
function imgSize(aspect, scale) {
  const table = scale === "4k" ? IMG_ASPECTS_4K : IMG_ASPECTS;
  return table[aspect] || null;
}
// 某模型能否出这个画幅：gpt-image 家族看像素尺寸表（2K/4K 两表键一致）。
function imgAspectOk(_id, aspect) {
  return Object.prototype.hasOwnProperty.call(IMG_ASPECTS, aspect);
}
// 与参考插件 88api-image-gen 一致：按目标 size 追加"画幅约束"提示词后缀，再拼进最终 prompt
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function aspectPromptSuffixForSize(size) {
  const mm = /^(\d+)x(\d+)$/.exec(String(size || ""));
  if (!mm) return "";
  const w = Number(mm[1]), h = Number(mm[2]);
  const d = gcd(w, h); if (!d) return "";
  const aspect = (w / d) + ":" + (h / d);
  if (w === h) return "请严格按照 " + aspect + " 正方形画幅生成最终图片，整张图片必须为 " + aspect + " 比例。";
  if (h > w) return "请严格按照 " + aspect + " 竖版画幅生成最终图片，整张图片必须为 " + aspect + " 竖向构图，不要正方形，不要横版。";
  return "请严格按照 " + aspect + " 横版画幅生成最终图片，整张图片必须为 " + aspect + " 横向构图，不要正方形，不要竖版。";
}
function imageApiPrompt(prompt, size) {
  return [prompt, aspectPromptSuffixForSize(size)].filter(Boolean).join("\n\n");
}
// 与参考插件 extractImagesFromImageApi 一致：b64_json / base64 / image.b64_json 都认
function imgItemB64(it) { return (it && (it.b64_json || it.base64 || (it.image && it.image.b64_json))) || null; }
// 按真实字节 magic number 定扩展名（flash 返回 JPEG、gpt 可能 PNG/JPEG——别无脑当 .png）
function imgExt(buf) {
  if (!buf || buf.length < 12) return ".png";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return ".png";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return ".jpg";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return ".webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return ".gif";
  return ".png"; // 未知兜底
}
const MIME = { ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp", ".gif":"image/gif" };
const CAPS = [
  "视频生成：从 88API /api/pricing 动态获取当前视频模型、价格、能力说明和端点兼容性。",
  "  • 不再内置固定 Seedance 模型；首次生成前必须由用户明确选择模型。",
  "  • `models` 合并账户可见模型与生成 API Key 的 /v1/models 结果，分开标注目录、账户和 Key 状态。",
  "  • 时长、画幅、分辨率、参考图/视频/音频和首尾帧能力以当前模型目录为准，生成前重新校验。",
  "  • 按秒计费模型会在 dry-run 和正式提交前显示实时单价、价格版本和本次估算金额。",
  "账户：个人访问令牌只读调用 /api/user/self、/api/pricing、/api/status、/api/user/models；API Key 仅调用生成端点。",
  "音频反推：默认 gemini-3.7-flash，通过 /v1/chat/completions 的 input_audio 一次拆解台词、BGM 与音效。",
  "生图（关键帧/锚定图，纯 gpt-image 家族，2026-08 实测）：",
  "  • 默认 gpt-image-2（OpenAI 上游，/v1/images）：稳定 2K 档（16:9≈2048×1152、2:3=1360×2048），出图稳、支持 --ref；不写 --model 即用它。网关侧对 image2 自带兜底，插件不再自建兜底链。",
  "  • gpt-image-2-4k（`--model 4k` / `--model gpt-image-2-4k` 显式请求）：16:9 出真 4K UHD 3840×2160；方图约 2880²（返回 URL）。88api 侧该渠道时有时无，断渠道直接报错、不自动回退。",
  "  • 错误分类分流：确定性错误(401/审核/模型名/400)立即停并诊断；上游熔断/容量/瞬时抖动(fetch failed/timeout/502/504)同模型快速重试 1 次，再不行报错交用户决定。",
  "  • 参考图生图（垫图/锁角色/锁产品）：加 `--ref <图> [--ref <图>...]`——走 /v1/images/edits；功能三保产品/人物一致性首选",
];
const ONBOARDING_LINES = [
  "欢迎使用 88API-Seedance-Studio。它主要有三种用法：",
  "  1. 想法 → 成片：描述短片/TVC，插件整理需求、选择实时视频模型、生成并下载成片。",
  "  2. 视频 → 反推：分析参考视频的画面、运镜、动作、台词、BGM 与音效，产出可生成提示词。",
  "  3. 视频 → 复刻工程包：在反推基础上整理分镜、素材职责和缺失素材，换成你的产品或授权人物。",
  "常用说法：`做一条 10 秒竖屏运动鞋广告`、`反推这个视频`、`把这个参考片做成可复刻工程包`。",
  "首次付费生成前需要配置 88API API Key 与个人访问令牌，并从实时模型列表中由你明确选择视频模型。两项凭据都可在可信聊天中直接交给 Agent 一键配置；个人访问令牌也保留本机隐藏输入方式。",
];

function readStoredConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); }
  catch { return {}; }
}
function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
    if (process.platform === "win32") {
      const script = "[Environment]::GetEnvironmentVariable('" + name.replace(/'/g, "''") + "','User')";
      const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
      const userValue = result.status === 0 ? String(result.stdout || "").trim() : "";
      if (userValue) return userValue;
    }
  }
  return "";
}
function loadConfig() {
  const stored = readStoredConfig();
  return {
    ...DEFAULTS,
    ...stored,
    apiKey: firstEnv(ENV.apiKey) || stored.apiKey || "",
    accessToken: stored.accessToken || firstEnv(ENV.accessToken) || "",
    userId: stored.userId || firstEnv(ENV.userId) || "",
  };
}
function saveConfigPatch(patch) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const stored = readStoredConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...stored, ...patch }, null, 2), { encoding: "utf8", mode: 0o600 });
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* Windows may not expose POSIX mode bits. */ }
}
function mask(k) {
  if (!k) return "(not set)";
  const s = String(k);
  if (s.length <= 10) return s.slice(0, 2) + "..." + s.slice(-2);
  return s.slice(0, 6) + "..." + s.slice(-4);
}
// die 不再同步 process.exit()——那会在 undici 连接句柄关闭中途触发 Windows libuv 断言崩溃。
// 改为抛错，由顶层统一打印并设置 exitCode，让事件循环自然收尾。
function die(msg) { const e = new Error(msg); e.isDie = true; throw e; }
// 生图错误分类（关键词集合沿用参考插件 88api-image-gen 的 isRetryable/isFatal 口径）：
//   fatal      = 确定性错误（换模型/重试都无用）→ 立即停、诊断
//   capacity   = 上游熔断/容量耗尽 → 报错（默认 image2 由网关侧兜底；显式 4k 断渠道交用户决定）
//   transient  = 瞬时网络抖动 → 同模型快速重试 1 次，再不行报错
function classifyImgError(msg) {
  const s = String(msg || "").toLowerCase();
  if (/circuit breaker|temporarily suspended|no active tokens|no available (channel|account)|account pool busy|可用渠道不存在/.test(s)) return "capacity";
  if (/http 400|http 401|http 403|http 404|http 422|unauthorized|forbidden|invalid api key|incorrect api key|missing api key|invalid parameter|model_not_found|not supported model|content[_ ]?(policy|moderat)|moderation|nsfw|内容审核/.test(s)) return "fatal";
  if (/http 429|http 502|http 503|http 504|http 524|timeout|rate limit|too many requests|please retry later|temporarily unavailable|overloaded|fetch failed|socket hang up|econnreset|terminated|did not contain|无图片数据|未返回图片/.test(s)) return "transient";
  return "unknown";
}
// 上游熔断/容量类 → 干净的一句诊断（默认 image2 由网关侧兜底，插件不自建兜底链）
function upstreamHint(msg) {
  const s = String(msg || "");
  if (/circuit breaker|temporarily suspended|no active tokens|no available (channel|account)|可用渠道不存在|503|no available channel/i.test(s))
    return "\n88API 上游通道熔断/容量不足（非你的 Key/提示词/模型名问题），失败调用不产图、不计费。请前往 https://88api.ai 后台内联系客服！";
  return "";
}
// 确定性错误的对症提示（换模型也没用，先修这里）
function fatalHint(msg) {
  const s = String(msg || "").toLowerCase();
  if (/http 401|unauthorized|invalid api key|incorrect api key|missing api key/.test(s)) return "\n[诊断] Key 缺失、无效或无权限。通过 Codex 使用时，请把可用的 88API Key 交给 Agent，由 Agent 一键重设并脱敏验证。";
  if (/content[_ ]?(policy|moderat)|moderation|nsfw|内容审核/.test(s)) return "\n[诊断] 内容审核未通过（非上游故障）→ 调整提示词/参考图后再试，勿反复重交。";
  if (/model_not_found|not supported model/.test(s)) return "\n[诊断] 模型名/端点不匹配 → 检查 --model（仅支持 gpt-image-2-4k / gpt-image-2 或自定义 images 模型 id）。";
  if (/http 400|invalid parameter/.test(s)) return "\n[诊断] 请求参数不合法 → 检查 --aspect / --ref（参考图是否可读、是否 >8MB）。";
  return "\n[诊断] 确定性错误：换模型/重试无用，请按上面报文修正后再试。";
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  if (!cfg.apiKey) die('未配置 API Key。通过 Codex 使用时，请把 88API Key 发给 Agent，由 Agent 为你一键配置；无需自己运行 PowerShell。');
  return cfg.apiKey;
}
function requireAccessToken(cfg) {
  if (!cfg.accessToken) die('未配置 88API 个人访问令牌。请登录 https://88api.ai/，进入“个人资料 → 安全”，创建系统访问令牌后交给 Agent 一键配置。访问令牌只用于读取账户余额、模型目录、价格和可用状态，不用于付费生成。');
  return cfg.accessToken;
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
async function dashboardApi(cfg, method, path, body, options = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (options.auth !== false) {
    headers.Authorization = "Bearer " + requireAccessToken(cfg);
    if (cfg.userId) headers["New-Api-User"] = String(cfg.userId);
  }
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok || json.success === false) {
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
// 下载为 Buffer（便于按真实字节定扩展名）
async function downloadBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("下载失败 HTTP " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- 88API account + dynamic video catalog ----------
function listOf(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === "") return [];
  return String(value).split(",").map((x) => x.trim()).filter(Boolean);
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function inferResolution(modelName, description) {
  const text = (String(modelName || "") + " " + String(description || "")).toLowerCase();
  for (const item of [["4k", "4k"], ["2k", "2k"], ["1440p", "1440p"], ["1080p", "1080p"], ["768p", "768p"], ["720p", "720p"], ["480p", "480p"]]) {
    if (text.includes(item[0])) return item[1];
  }
  return "";
}
function inferVideoCapabilities(row) {
  const description = String(row.description || "");
  const modelName = String(row.model_name || "");
  const text = modelName + " " + description;
  const durationMatch = text.match(/(\d+)\s*[–—~\-]\s*(\d+)\s*秒/i);
  const maxDurationMatch = text.match(/(?:最大支持|最长(?:支持)?|支持)\s*(\d+)\s*秒/i);
  const defaultDurationMatch = text.match(/默认\s*(\d+)\s*秒/i);
  const ratios = unique(text.match(/(?:21:9|16:9|9:16|1:1|4:3|3:4)/g) || []);
  const maxImages = finiteNumber((text.match(/最多\s*(\d+)\s*张参考图/i) || [])[1]);
  const maxVideos = finiteNumber((text.match(/(?:最多\s*)?(\d+)\s*个参考视频/i) || [])[1]);
  const maxAudios = finiteNumber((text.match(/(?:最多\s*)?(\d+)\s*个参考音频/i) || [])[1]);
  const noImageReference = /不提供参考图|无参考轻量版/i.test(text);
  const noVideoReference = /不提供[^。；]*参考视频|无参考轻量版/i.test(text);
  const noAudioReference = /不提供[^。；]*参考音频|无参考轻量版/i.test(text);
  const yesImageReference = /图生视频|参考图|图片[^。；]*生成视频|多图参考|支持文本、图片/i.test(text);
  const yesVideoReference = /参考视频|支持[^。；]*视频输入/i.test(text);
  const yesAudioReference = /参考音频|支持[^。；]*音频/i.test(text);
  const supportValue = (yes, no) => no ? false : yes ? true : null;
  return {
    textToVideo: /文生视频|文字[^。；]*生成视频|纯文本生成视频|文本生成视频|支持文本、图片|支持文本、图片、音频和视频输入/i.test(text) ? true : null,
    imageReference: supportValue(yesImageReference, noImageReference),
    videoReference: supportValue(yesVideoReference, noVideoReference),
    audioReference: supportValue(yesAudioReference, noAudioReference),
    firstLastFrame: /首尾帧/i.test(text) ? true : null,
    generatedAudio: /音效生成|同步音频|带音频|预设语音|seedance-2\.5/i.test(text) ? true : null,
    resolution: inferResolution(modelName, description),
    minDuration: durationMatch ? Number(durationMatch[1]) : null,
    maxDuration: durationMatch ? Number(durationMatch[2]) : maxDurationMatch ? Number(maxDurationMatch[1]) : null,
    defaultDuration: defaultDurationMatch ? Number(defaultDurationMatch[1]) : null,
    ratios,
    maxImages,
    maxVideos,
    maxAudios,
  };
}
function pickAutoGroup(row, pricing) {
  const groups = listOf(row.enable_groups || row.enable_group);
  const autoGroups = listOf(pricing.auto_groups);
  return autoGroups.find((group) => groups.includes(group)) || groups[0] || "auto";
}
function normalizeVideoPrice(row, pricing, status) {
  const billingMode = String(row.billing_mode || (Number(row.quota_type) === 1 ? "per_request" : "legacy"));
  const group = pickAutoGroup(row, pricing);
  const multiplier = finiteNumber(pricing.group_ratio && pricing.group_ratio[group], 1);
  const currency = String((status.data && status.data.quota_display_type) || "CNY");
  if (Number(row.quota_type) === 1 || billingMode === "per_second" || finiteNumber(row.model_price, 0) > 0) {
    const base = finiteNumber(row.model_price, 0);
    const unit = billingMode === "per_second" ? "second" : "request";
    return { billingMode, currency, unit, base, multiplier, effective: base * multiplier, group };
  }
  const quotaPerUnit = finiteNumber(status.data && status.data.quota_per_unit, 500000);
  const inputPerMillion = finiteNumber(row.model_ratio, 0) * (1000000 / quotaPerUnit) * multiplier;
  return { billingMode, currency, unit: "million_input_tokens", base: inputPerMillion / multiplier, multiplier, effective: inputPerMillion, group };
}
function isVideoCatalogRow(row) {
  const groups = listOf(row.enable_groups || row.enable_group);
  const endpoints = listOf(row.supported_endpoint_types);
  return groups.includes("视频模型") || endpoints.some((x) => VIDEO_ENDPOINT_TYPES.has(x)) || /视频|video/i.test(String(row.description || ""));
}
function endpointCompatible(row) {
  return listOf(row.supported_endpoint_types).some((x) => VIDEO_ENDPOINT_TYPES.has(x));
}
function availabilityLabel(value) {
  return ({
    available: "可用",
    unverified_key: "账户可见·待 Key 验证",
    not_in_api_key: "当前 API Key 不可用",
    not_visible: "账户不可见",
    unsupported_endpoint: "当前插件端点不兼容",
  })[value] || value;
}
async function fetchGenerationModelIds(cfg) {
  if (!cfg.apiKey) return { ids: null, error: "API Key 未配置" };
  try {
    const response = await api(cfg, "GET", "/v1/models");
    return { ids: new Set((response.data || []).map((item) => String(item.id))), error: "" };
  } catch (error) {
    return { ids: null, error: error.message };
  }
}
async function fetchVideoCatalog(cfg, options = {}) {
  const [pricing, status, visibleResponse] = await Promise.all([
    dashboardApi(cfg, "GET", "/api/pricing"),
    dashboardApi(cfg, "GET", "/api/status", undefined, { auth: false }),
    dashboardApi(cfg, "GET", "/api/user/models"),
  ]);
  const visible = new Set(listOf(visibleResponse.data));
  const keyResult = options.checkApiKey === false ? { ids: null, error: "未检查 API Key" } : await fetchGenerationModelIds(cfg);
  const vendors = new Map();
  for (const vendor of (pricing.vendors || [])) vendors.set(String(vendor.id), vendor);
  const models = (pricing.data || []).filter(isVideoCatalogRow).map((row) => {
    const endpoints = listOf(row.supported_endpoint_types);
    const compatible = endpointCompatible(row);
    const userVisible = visible.has(String(row.model_name));
    const keyVisible = keyResult.ids ? keyResult.ids.has(String(row.model_name)) : null;
    let availability = "available";
    if (!compatible) availability = "unsupported_endpoint";
    else if (!userVisible) availability = "not_visible";
    else if (keyVisible === false) availability = "not_in_api_key";
    else if (keyVisible == null) availability = "unverified_key";
    const price = normalizeVideoPrice(row, pricing, status);
    return {
      id: String(row.model_name),
      description: String(row.description || ""),
      vendor: (vendors.get(String(row.vendor_id)) || {}).name || String(row.vendor_id || ""),
      enabledGroups: listOf(row.enable_groups || row.enable_group),
      endpointTypes: endpoints,
      endpointCompatible: compatible,
      userVisible,
      apiKeyVisible: keyVisible,
      availability,
      availabilityLabel: availabilityLabel(availability),
      selectable: compatible && userVisible && keyVisible === true,
      price,
      capabilities: inferVideoCapabilities(row),
    };
  }).sort((a, b) => Number(b.selectable) - Number(a.selectable)
    || Number(b.endpointCompatible) - Number(a.endpointCompatible)
    || Number(b.userVisible) - Number(a.userVisible)
    || a.vendor.localeCompare(b.vendor, "zh-CN")
    || a.id.localeCompare(b.id, "zh-CN"));
  return {
    retrievedAt: new Date().toISOString(),
    pricingVersion: pricing.pricing_version || "",
    currency: String((status.data && status.data.quota_display_type) || "CNY"),
    apiKeyCheck: { checked: Boolean(keyResult.ids), error: keyResult.error },
    models,
  };
}
function money(value, currency) {
  if (!Number.isFinite(Number(value))) return "未知";
  const prefix = String(currency).toUpperCase() === "CNY" ? "¥" : String(currency) + " ";
  return prefix + Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
function priceLabel(price) {
  const unit = price.unit === "second" ? "秒" : price.unit === "request" ? "次" : "百万输入 Token";
  return money(price.effective, price.currency) + "/" + unit + (price.multiplier !== 1 ? "（" + price.group + " ×" + price.multiplier + "）" : "");
}
function modelSummary(model) {
  const c = model.capabilities;
  const pieces = [];
  if (c.resolution) pieces.push(c.resolution);
  if (c.minDuration && c.maxDuration) pieces.push(c.minDuration + "–" + c.maxDuration + "秒");
  else if (c.maxDuration) pieces.push("最长 " + c.maxDuration + "秒");
  else if (c.minDuration) pieces.push("最短 " + c.minDuration + "秒");
  if (c.textToVideo) pieces.push("文生视频");
  if (c.imageReference) pieces.push("图/参考图");
  if (c.videoReference) pieces.push("参考视频");
  if (c.audioReference) pieces.push("参考音频");
  if (c.firstLastFrame) pieces.push("首尾帧");
  if (c.generatedAudio) pieces.push("生成音频");
  return pieces.join(" · ") || model.description || "目录未提供能力摘要";
}
async function fetchAccount(cfg) {
  const [self, status] = await Promise.all([
    dashboardApi(cfg, "GET", "/api/user/self"),
    dashboardApi(cfg, "GET", "/api/status", undefined, { auth: false }),
  ]);
  const user = self.data || {};
  const quotaPerUnit = finiteNumber(status.data && status.data.quota_per_unit, 500000);
  const currency = String((status.data && status.data.quota_display_type) || "CNY");
  return {
    id: user.id,
    username: user.username || "",
    group: user.group || "",
    status: user.status,
    currency,
    quotaPerUnit,
    balance: finiteNumber(user.quota, 0) / quotaPerUnit,
    used: finiteNumber(user.used_quota, 0) / quotaPerUnit,
    requestCount: finiteNumber(user.request_count, 0),
  };
}
async function cmdAccount(cfg, args) {
  const account = await fetchAccount(cfg);
  if (args.json) { log(JSON.stringify(account, null, 2)); return; }
  log("88API 账户: " + (account.username || "用户 #" + account.id) + "（分组 " + account.group + "）");
  log("余额: " + money(account.balance, account.currency));
  log("累计使用: " + money(account.used, account.currency) + " · 请求 " + account.requestCount + " 次");
}
async function cmdModels(cfg, args) {
  const catalog = await fetchVideoCatalog(cfg, { checkApiKey: !args["no-key-check"] });
  if (args.json) { log(JSON.stringify(catalog, null, 2)); return catalog; }
  log("88API 当前视频模型 · 价格版本 " + catalog.pricingVersion + " · " + catalog.retrievedAt);
  if (!catalog.apiKeyCheck.checked) log("[提示] 未完成生成 API Key 验证：" + catalog.apiKeyCheck.error);
  let index = 0;
  for (const model of catalog.models) {
    index++;
    log(index + ". " + model.id + " · " + priceLabel(model.price) + " · " + model.availabilityLabel);
    const summary = modelSummary(model);
    log("   能力: " + summary);
    if (model.description && model.description !== summary) log("   目录: " + model.description);
  }
  if (catalog.apiKeyCheck.checked) log("选择后保存: node studio.mjs --set-video-model \"<模型ID>\"");
  else log("当前只完成目录/账户查询；请先配置有效 API Key，再保存模型选择。");
  return catalog;
}
async function cmdSetVideoModel(cfg, modelId) {
  const catalog = await fetchVideoCatalog(cfg);
  if (!catalog.apiKeyCheck.checked) die("无法验证生成 API Key 的模型可用状态，未保存选择: " + catalog.apiKeyCheck.error);
  const model = catalog.models.find((item) => item.id === modelId);
  if (!model) die("88API 当前视频目录中没有模型: " + modelId + "。先运行 models 查看实时列表。");
  if (!model.selectable) die("该模型当前不能由本插件选择: " + model.availabilityLabel + "（端点 " + model.endpointTypes.join(", ") + "）");
  saveConfigPatch({ videoModel: model.id, videoModelSelectedAt: new Date().toISOString(), videoPricingVersion: catalog.pricingVersion });
  log("视频模型已保存: " + model.id + " · " + priceLabel(model.price));
  log("能力: " + modelSummary(model));
  return model;
}
async function cmdSetAccessToken(cfg, token) {
  const candidate = String(token || "").trim();
  if (!candidate) die("个人访问令牌不能为空");
  const probe = { ...cfg, accessToken: candidate, userId: "" };
  let account;
  try { account = await fetchAccount(probe); }
  catch (error) { die("个人访问令牌验证失败，未保存: " + error.message); }
  saveConfigPatch({ accessToken: candidate, userId: String(account.id || ""), accessTokenConfiguredAt: new Date().toISOString() });
  log("个人访问令牌已验证并保存到 " + CONFIG_PATH + "（" + mask(candidate) + "）");
  log("已自动识别用户 ID；不会在回复或日志中显示完整令牌。验证完成，继续原任务即可。");
}
function cmdConfigureAccessToken() {
  if (process.platform !== "win32") {
    die("安全配置助手当前仅支持 Windows。请在系统安全环境中设置 SEEDANCE_STUDIO_ACCESS_TOKEN；可选设置 SEEDANCE_STUDIO_USER_ID。不要把访问令牌放在命令行参数或普通配置文件中。");
  }
  const helper = join(SCRIPT_DIR, "configure_access_token.ps1");
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper], { stdio: "inherit" });
  if (result.error) die("无法启动访问令牌安全配置助手: " + result.error.message);
  if (result.status !== 0) die("访问令牌配置未完成。");
  saveConfigPatch({ accessToken: null, userId: null, accessTokenConfiguredAt: null });
  log("配置已完成。后续命令会从 Windows 用户环境变量读取访问令牌；不会写入 " + CONFIG_PATH + "。");
}
function cmdIntro() {
  for (const line of ONBOARDING_LINES) log(line);
}
async function selectedVideoModel(cfg, args) {
  const selectedId = String(args.model || cfg.videoModel || "").trim();
  if (!selectedId) die("尚未选择视频模型。先运行 `node studio.mjs models` 获取 88API 当前视频模型、价格和能力，让用户明确选择后再执行 --set-video-model。");
  const catalog = await fetchVideoCatalog(cfg);
  if (!catalog.apiKeyCheck.checked) die("生成 API Key 验证失败，不能提交付费任务: " + catalog.apiKeyCheck.error);
  const model = catalog.models.find((item) => item.id === selectedId);
  if (!model) die("已选模型已不在 88API 当前目录: " + selectedId + "。请重新运行 models 并让用户选择。");
  if (!model.selectable) die("已选模型当前不可用: " + selectedId + " · " + model.availabilityLabel + "。请重新运行 models 并选择可用模型。");
  return { model, catalog };
}

// ---------- video ----------
function buildVideoPayload(cfg, args, modelInfo) {
  let prompt = args.prompt ? String(args.prompt) : "";
  const capabilities = modelInfo.capabilities || {};
  const minDuration = capabilities.minDuration;
  const maxDuration = capabilities.maxDuration;
  const defaultDuration = capabilities.defaultDuration;
  if (args.duration === undefined && defaultDuration == null) {
    die("模型 " + modelInfo.id + " 的实时目录没有提供默认时长；请根据目录说明让用户明确给出 --duration，插件不会猜测。");
  }
  const duration = args.duration !== undefined ? parseInt(args.duration, 10) : defaultDuration;
  if (!Number.isInteger(duration) || duration <= 0) die("duration 必须是正整数秒，当前: " + args.duration);
  if (minDuration != null && duration < minDuration) die("模型 " + modelInfo.id + " 的最短时长为 " + minDuration + " 秒，当前: " + duration);
  if (maxDuration != null && duration > maxDuration) die("模型 " + modelInfo.id + " 的最长时长为 " + maxDuration + " 秒，当前: " + duration);
  const ratio = String(args.ratio || "16:9");
  if (!RATIOS.includes(ratio)) die("ratio 仅支持: " + RATIOS.join(", "));
  if (capabilities.ratios && capabilities.ratios.length && !capabilities.ratios.includes(ratio)) {
    die("模型 " + modelInfo.id + " 当前目录声明的 ratio 仅支持: " + capabilities.ratios.join(", "));
  }
  const identityImages = asArray(args["identity-image"]).map(String);
  const regularImages = asArray(args.image).map(String);
  if (identityImages.length > 1) die("--identity-image 当前只允许 1 张授权真人身份图，避免多个身份权威互相冲突");
  if (identityImages.length) {
    const identityKey = /^https?:\/\//.test(identityImages[0]) ? identityImages[0] : resolve(identityImages[0]).toLowerCase();
    const duplicated = regularImages.some((p) => (/^https?:\/\//.test(p) ? p : resolve(p).toLowerCase()) === identityKey);
    if (duplicated) die("授权真人身份图不要同时作为 --identity-image 和 --image 重复提交");
    if (!/^https?:\/\//.test(identityImages[0]) && !existsSync(resolve(identityImages[0]))) die("授权真人身份图不存在: " + identityImages[0]);
    prompt = withIdentityLock(prompt, AUTH_IDENTITY_VIDEO_LOCK);
  }
  const images = [...identityImages, ...regularImages];
  const videoUrls = asArray(args["video-url"]);
  const audioUrls = asArray(args["audio-url"]);
  const firstFrame = args["first-frame"] ? String(args["first-frame"]) : "";
  const lastFrame = args["last-frame"] ? String(args["last-frame"]) : "";
  const maxImages = capabilities.maxImages || 30;
  const maxVideos = capabilities.maxVideos || 10;
  const maxAudios = capabilities.maxAudios || 10;
  if (images.length > maxImages) die("模型 " + modelInfo.id + " 的图片参考最多 " + maxImages + " 张（含 --identity-image）");
  if (videoUrls.length > maxVideos) die("模型 " + modelInfo.id + " 的视频参考最多 " + maxVideos + " 个");
  if (audioUrls.length > maxAudios) die("模型 " + modelInfo.id + " 的音频参考最多 " + maxAudios + " 个");
  if ((images.length || firstFrame || lastFrame) && capabilities.imageReference === false) die("模型 " + modelInfo.id + " 的当前目录明确不支持图片参考/图生视频");
  if (videoUrls.length && capabilities.videoReference === false) die("模型 " + modelInfo.id + " 的当前目录明确不支持参考视频");
  if (audioUrls.length && capabilities.audioReference === false) die("模型 " + modelInfo.id + " 的当前目录明确不支持参考音频");
  if ((firstFrame || lastFrame) && capabilities.firstLastFrame === false) die("模型 " + modelInfo.id + " 的当前目录明确不支持首尾帧");
  for (const u of [...videoUrls, ...audioUrls]) {
    if (!/^https?:\/\//.test(u)) die("视频/音频参考必须是公网 http(s) URL（本地文件不支持，需先上传对象存储）: " + u);
  }
  const hasImageAnchor = images.length || firstFrame || lastFrame;
  // 实测硬约束（88api 后端）：带视频/音频参考时必须至少配 1 张图片参考（首帧/尾帧也算），
  // 否则上游直接 400: "video/audio reference requires at least one image reference"。
  // 这里前置拦截，省掉一次无谓的失败提交。
  if (/seedance-2\.5/i.test(modelInfo.id) && (videoUrls.length || audioUrls.length) && !hasImageAnchor) {
    die("88api 约束：使用视频/音频参考时必须同时提供至少 1 张图片参考（--image / --first-frame <图>）。\n纯视频参考或纯音频参考在本后端不支持——请补一张锚定图/关键帧一起提交。");
  }
  const payload = {
    model: modelInfo.id,
    duration,
    ratio,
  };
  if (args["no-audio"]) payload.generate_audio = false;
  else if (args.audio || capabilities.generatedAudio === true) payload.generate_audio = true;
  if (["480p", "720p", "1080p", "2k", "4k"].includes(capabilities.resolution)) payload.resolution = capabilities.resolution;
  if (args.seed !== undefined) payload.seed = parseInt(args.seed, 10);
  const hasMulti = images.length || videoUrls.length || audioUrls.length || firstFrame || lastFrame;
  if (!prompt) die("需要 --prompt 提示词");
  payload.prompt = prompt;
  const toUrl = p => /^https?:\/\//.test(p) ? p : imageToDataUrl(resolve(p));
  // 实测：上游要求顶层 prompt 必填。
  // ① 带首帧/尾帧（图生视频）→ 必须走 content[] 并给每项打 role（first_frame/last_frame/reference_*），首帧决定片头画面。
  // ② 仅普通图片参考（无首尾帧、无视频/音频）→ 用 images 简写（最稳路径）。
  // ③ 其它含视频/音频参考的多模态情况 → content 数组（不打 role，沿用历史稳定写法）。
  if (firstFrame || lastFrame) {
    const content = [{ type: "text", text: prompt }];
    if (firstFrame) content.push({ type: "image_url", role: "first_frame", image_url: { url: toUrl(firstFrame) } });
    if (lastFrame) content.push({ type: "image_url", role: "last_frame", image_url: { url: toUrl(lastFrame) } });
    for (const p of images) content.push({ type: "image_url", role: "reference_image", image_url: { url: toUrl(p) } });
    for (const u of videoUrls) content.push({ type: "video_url", role: "reference_video", video_url: { url: u } });
    for (const u of audioUrls) content.push({ type: "audio_url", role: "reference_audio", audio_url: { url: u } });
    payload.content = content;
  } else if (images.length && !videoUrls.length && !audioUrls.length) {
    payload.images = images.map(p => toUrl(p));
  } else if (hasMulti) {
    const content = [{ type: "text", text: prompt }];
    for (const p of images) content.push({ type: "image_url", image_url: { url: toUrl(p) } });
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
      const dest = join(dir, "video_" + taskId.slice(-8) + ".mp4");
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
  const [{ model, catalog }, account] = await Promise.all([selectedVideoModel(cfg, args), fetchAccount(cfg)]);
  if (Number(account.status) !== 1) die("88API 账户当前不是正常状态（status=" + account.status + "），未提交付费任务。");
  const payload = buildVideoPayload(cfg, args, model);
  const dir = outDir(args);
  const estimatedCost = model.price.unit === "second" ? model.price.effective * payload.duration
    : model.price.unit === "request" ? model.price.effective : null;
  if (estimatedCost != null && account.balance < estimatedCost) {
    die("88API 余额不足：当前 " + money(account.balance, account.currency) + "，本次估算 " + money(estimatedCost, model.price.currency) + "。未提交付费任务。");
  }
  const catalogAudit = { retrievedAt: catalog.retrievedAt, pricingVersion: catalog.pricingVersion, model: model.id, price: model.price, availability: model.availability, balanceBefore: account.balance, balanceCurrency: account.currency };
  const identitySources = asArray(args["identity-image"]).map(String).map((p) => /^https?:\/\//.test(p) ? p : resolve(p));
  const identityAudit = identitySources.length ? { mode: "authorized-direct", authority: "source-photo", sources: identitySources } : { mode: "generated-or-unspecified", sources: [] };
  if (identitySources.length) log("[IDENTITY] 授权真人原图已作为唯一身份权威直接附加；AI 首尾帧不得改写身份");
  if (args["dry-run"]) {
    log("[DRY-RUN] 不会调用付费接口。将提交:");
    log("POST " + cfg.baseUrl + "/v1/videos");
    log("[IDENTITY-AUDIT] " + JSON.stringify(identityAudit));
    log(JSON.stringify(sanitizePayload(payload), null, 2));
    log("[模型] " + model.id + " · " + modelSummary(model));
    log("[价格] " + priceLabel(model.price) + " · 目录版本 " + catalog.pricingVersion);
    log("[余额] " + money(account.balance, account.currency));
    if (estimatedCost != null) {
      const formula = model.price.unit === "second" ? payload.duration + " 秒 × " + priceLabel(model.price) : "1 次 × " + priceLabel(model.price);
      log("[估算] " + formula + " = " + money(estimatedCost, model.price.currency));
    }
    return;
  }
  const runFile = join(dir, "run.json");
  if (existsSync(runFile)) {
    const prev = JSON.parse(readFileSync(runFile, "utf8"));
    die("输出目录已有任务 " + prev.taskId + "（防重复提交）。续查:\n  node studio.mjs status --task " + prev.taskId + ' --wait --out "' + dir + '"\n或换一个 --out 目录。');
  }
  const frameNote = payload.content ? (payload.content.some(c => c.role === "first_frame") ? ", first_frame" : "") + (payload.content.some(c => c.role === "last_frame") ? ", last_frame" : "") : "";
  const identityNote = identitySources.length ? ", identity=authorized-direct" : "";
  const audioMode = payload.generate_audio == null ? "model-default" : String(payload.generate_audio);
  log("[submit] POST /v1/videos · " + model.id + " (" + payload.duration + "s, " + payload.ratio + ", audio=" + audioMode + frameNote + identityNote + ")");
  log("[price] " + priceLabel(model.price) + (estimatedCost != null ? " · 本次估算 " + money(estimatedCost, model.price.currency) : "") + " · 当前余额 " + money(account.balance, account.currency));
  const task = await api(cfg, "POST", "/v1/videos", payload);
  const taskId = task.id || task.task_id;
  if (!taskId) die("提交响应中无任务 ID: " + JSON.stringify(task).slice(0, 400));
  writeFileSync(runFile, JSON.stringify({ taskId, submittedAt: new Date().toISOString(), catalogAudit, estimatedCost, identityAudit, payload: sanitizePayload(payload) }, null, 2));
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
  if (!payload.model) {
    if (!cfg.videoModel) die("raw payload 未指定 model，且尚未选择默认视频模型。先运行 models 并执行 --set-video-model。");
    payload.model = cfg.videoModel;
  }
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
// ---------- image request（仅 gpt-image 家族，走 /v1/images/*；文生图 generations、参考图 edits） ----------
async function requestImages(cfg, modelId, prompt, n, size, refs) {
  const finalPrompt = imageApiPrompt(prompt, size);
  if (refs.length) {
    const fd = new FormData();
    fd.append("model", modelId);
    fd.append("prompt", finalPrompt);
    fd.append("n", String(n));
    fd.append("size", size);
    for (const r of refs) {
      const p = resolve(r);
      const buf = readFileSync(p);
      if (buf.length > 8 * 1024 * 1024) die("参考图过大 (>8MB)，请压缩: " + p);
      const mime = MIME[extname(p).toLowerCase()] || "image/png";
      fd.append("image[]", new Blob([buf], { type: mime }), "reference" + extname(p));
    }
    const res = await fetch(cfg.baseUrl + "/v1/images/edits", { method: "POST", headers: { Authorization: "Bearer " + requireKey(cfg) }, body: fd });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + ((json.error && json.error.message) || text.slice(0, 200)));
    const items = json.data || [];
    if (!items.length) throw new Error("无图片数据");
    return items;
  }
  const res = await api(cfg, "POST", "/v1/images/generations", { model: modelId, prompt: finalPrompt, n, size });
  const items = res.data || [];
  if (!items.length) throw new Error("无图片数据");
  return items;
}
// 并发池：抄 88api-image-gen 的 `Promise.all(Array.from({length}, dispatcher))` 结构（单 key，去掉多 worker/粘性分组）。
// N 个 dispatcher 从共享游标 cursor 拉任务，跑完一个立刻拉下一个，直到队列空。
async function runImagePool(total, concurrency, runTask) {
  const results = new Array(total);
  const limit = Math.max(1, Math.min(Number(concurrency) || IMG_DEFAULT_CONCURRENCY, total, IMG_MAX_CONCURRENCY));
  let cursor = 0, active = 0, peak = 0;
  async function dispatcher() {
    for (;;) {
      const index = cursor++;
      if (index >= total) return;
      active++; peak = Math.max(peak, active);
      try { results[index] = await runTask(index); }
      finally { active--; }
    }
  }
  await Promise.all(Array.from({ length: limit }, () => dispatcher()));
  return { results, peak, limit };
}
// 单张生成流水线：按模型链尝试（默认仅主模型，不自建兜底），含错误分类（确定性停链 / 瞬时同模型重试 1 次 / 容量报错）。返回 1 张的原始 item。
async function generateOneImage(cfg, slot) {
  const { prompt, aspect, refs, chain } = slot;
  const errs = [];
  let fatal = false;
  for (let idx = 0; idx < chain.length && !fatal; idx++) {
    const id = chain[idx];
    if (!imgAspectOk(id, aspect)) { errs.push(id + " → 跳过：该模型不支持 " + aspect + " 画幅"); continue; } // 别静默改比例
    const m = IMG_MODELS[id] || resolveImgModel(id);
    const size = imgSize(aspect, m.scale);
    let attempt = 0;
    for (;;) {
      try {
        const items = await requestImages(cfg, id, prompt, 1, size, refs);
        return { ok: true, model: m, items, spec: size, fellBack: idx > 0 };
      } catch (e) {
        const cls = classifyImgError(e.message);
        if (cls === "transient" && attempt < 1) { attempt++; await sleep(3000); continue; } // ③ 瞬时抖动：同模型重试 1 次
        errs.push(id + " → " + e.message);
        if (cls === "fatal") fatal = true; // ① 确定性错误：停整条链
        break; // ② 容量/未知/瞬时用尽 → 走下一个上游
      }
    }
  }
  return { ok: false, errs, fatal };
}
async function cmdImage(cfg, args) {
  const rawPrompts = asArray(args.prompt).map(String).map((s) => s.trim()).filter(Boolean);
  if (!rawPrompts.length) die("需要 --prompt（可重复 --prompt 出多张不同图，并发跑）");
  const aspect = String(args.aspect || "16:9");
  const primary = resolveImgModel(args.model);
  if (!imgAspectOk(primary.id, aspect)) {
    die("aspect 对 " + primary.id + " 仅支持: " + Object.keys(IMG_ASPECTS).join(", "));
  }
  const n = args.n ? parseInt(args.n, 10) : 1;
  if (!(n >= 1 && n <= 4)) die("--n 限 1–4（每个 --prompt 出几张）");
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : IMG_DEFAULT_CONCURRENCY;
  if (!(concurrency >= 1 && concurrency <= IMG_MAX_CONCURRENCY)) die("--concurrency 限 1–" + IMG_MAX_CONCURRENCY);
  // 授权真人身份图必须保持为第一张参考；普通 --ref 只控制场景/服装/产品等其它维度。
  const identityRefs = asArray(args["identity-ref"]).map(String);
  if (identityRefs.length > 1) die("--identity-ref 当前只允许 1 张授权真人身份图，避免多个身份权威互相冲突");
  const regularRefs = [].concat(args.ref || []).filter(Boolean).map(String);
  if (identityRefs.length) {
    const identityKey = resolve(identityRefs[0]).toLowerCase();
    if (regularRefs.some((p) => resolve(p).toLowerCase() === identityKey)) die("授权真人身份图不要同时作为 --identity-ref 和 --ref 重复提交");
  }
  const refs = [...identityRefs, ...regularRefs];
  for (const r of refs) if (!existsSync(resolve(r))) die("参考图不存在: " + r);
  const prompts = identityRefs.length ? rawPrompts.map((p) => withIdentityLock(p, AUTH_IDENTITY_IMAGE_LOCK)) : rawPrompts;
  const dir = outDir(args);
  const noFallback = !!args["no-fallback"];
  // 兜底链：主模型 + 跨上游兜底（去重、去掉与主模型同款）。--no-fallback 只留主模型。
  const chain = noFallback ? [primary.id] : [primary.id, ...IMG_FALLBACKS.filter(f => f !== primary.id)];
  const endpointOf = () => refs.length ? "/v1/images/edits (multipart)" : "/v1/images/generations";

  // 批次：每个提示词各出 n 张 → 总槽位；并发池并行跑（抄 88api-image-gen 的 dispatcher×N 结构）
  const slots = [];
  for (let p = 0; p < prompts.length; p++)
    for (let k = 0; k < n; k++)
      slots.push({ prompt: prompts[p], aspect, refs, chain });
  const total = slots.length;
  const lanes = Math.min(concurrency, total);

  if (args["dry-run"]) {
    if (identityRefs.length) log("[IDENTITY] 授权真人原图已作为第一张生图参考直接附加；禁止锚定图套锚定图替代身份");
    log("[DRY-RUN] 生图 " + total + " 张（" + prompts.length + " 提示词 × " + n + "）· 并发 " + lanes + " · 模型 " + chain.join(" → "));
    for (const id of chain) {
      const m = IMG_MODELS[id] || resolveImgModel(id);
      const size = imgSize(aspect, m.scale);
      log(JSON.stringify({ model: m.id, endpoint: cfg.baseUrl + endpointOf(m.id), note: m.note, prompt: imageApiPrompt(prompts[0], size), n: 1, size, refs }, null, 2));
    }
    if (prompts.length > 1) log("... 其余 " + (prompts.length - 1) + " 个提示词同构，每次请求单张（n 靠并发池循环）");
    return;
  }

  const primarySpec = imgSize(aspect, primary.scale);
  if (identityRefs.length) log("[IDENTITY] 授权真人原图已作为第一张生图参考直接附加；输出关键帧不得取代身份权威");
  const submit = refs.length ? "参考图生图 " + total + " 张 ←垫图 " + refs.length + " 张" : "生图 " + total + " 张 " + primarySpec;
  log("[submit] " + submit + "（" + prompts.length + " 提示词 × " + n + "，并发 " + lanes + "）· 模型 " + primary.id
    + (chain.length > 1 ? " → 兜底 " + chain.slice(1).join("/") : "（网关自带兜底，插件不再自建）") + " · " + endpointOf(primary.id));

  const batchTs = Date.now();
  const pad = (x) => String(x).padStart(2, "0");
  const { results, peak } = await runImagePool(total, concurrency, async (index) => {
   try {
    const r = await generateOneImage(cfg, slots[index]);
    if (!r.ok) {
      log("  [" + (index + 1) + "/" + total + "] FAIL " + (r.fatal ? "确定性错误" : "上游未成") + "：" + r.errs.join(" | "));
      return { index, ok: false, errs: r.errs, fatal: r.fatal };
    }
    const paths = [];
    let sub = 0;
    for (const it of r.items) {
      const b64 = imgItemB64(it);
      let buf = null;
      if (b64) buf = Buffer.from(b64, "base64");
      else if (it.url) buf = await downloadBuf(it.url);
      else continue;
      const dest = join(dir, "keyframe_" + batchTs + "_" + pad(index) + (r.items.length > 1 ? "_" + sub : "") + imgExt(buf));
      writeFileSync(dest, buf);
      paths.push(dest); sub++;
    }
    if (!paths.length) { log("  [" + (index + 1) + "/" + total + "] FAIL 响应无图片数据（" + r.model.id + "）"); return { index, ok: false, errs: ["响应无图片数据 (" + r.model.id + ")"], fatal: false }; }
    log("  [" + (index + 1) + "/" + total + "] OK " + r.model.id + " (" + r.spec + ")" + (r.fellBack ? " ←兜底" : "") + " → " + paths.map((p) => basename(p)).join(", "));
    return { index, ok: true, model: r.model, paths };
   } catch (e) { // 存盘/下载异常兜底：单张出错不炸整批
     log("  [" + (index + 1) + "/" + total + "] FAIL 保存异常：" + (e && e.message || e));
     return { index, ok: false, errs: ["保存异常: " + (e && e.message || e)], fatal: false };
   }
  });

  const okResults = results.filter((r) => r && r.ok);
  const failResults = results.filter((r) => r && !r.ok);
  const savedPaths = okResults.flatMap((r) => r.paths);

  if (!okResults.length) {
    const allErrs = failResults.flatMap((r) => r.errs).filter(Boolean);
    const last = allErrs.join(" ");
    if (failResults.some((r) => r.fatal)) die("生图全败（含确定性错误，换模型/重试无用，先按诊断修正后再试）：\n  " + allErrs.join("\n  ") + fatalHint(last));
    die("生图全败" + (chain.length > 1 ? "（兜底链全部未成）" : "") + "：\n  " + allErrs.join("\n  ") + upstreamHint(last));
  }

  log("[DONE] 成功 " + okResults.length + "/" + total + " 张，峰值并发 " + peak + "，保存于 " + dir);
  for (const p of savedPaths) log("  " + p);
  if (failResults.length) {
    log("[部分失败] " + failResults.length + " 张未成：");
    for (const r of failResults) log("  #" + (r.index + 1) + " " + r.errs.join(" | "));
    const last = failResults.flatMap((r) => r.errs).join(" ");
    if (failResults.some((r) => r.fatal)) log(fatalHint(last)); else log(upstreamHint(last));
  }
  if (!refs.length) log("[提示] 想锁角色/产品一致性？加 --ref <图> 垫图重出；对清晰度不满意可换 --model gpt-image-2-4k 重试。");
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
// ---------- audio 拆解（反推⑦：人声转写 + BGM风格描述 + 音效时间轴）----------
// 88api 无可用 STT 渠道（whisper/gpt-4o-transcribe 全 model_not_found），但 Gemini 多模态
// （默认 gemini-3.7-flash；input_audio 走 OpenAI Chat Completions 兼容端点）能一次拆出
// 台词/BGM/音效——比纯 whisper 更全。时间戳是模型估算、非帧级精准（要词级精准等 whisper 渠道）。
const AUDIO_MODEL_DEFAULT = "gemini-3.7-flash";
const AUDIO_PROMPT = [
  "你在做视频反推里的【音频拆解】。只写你真正听到的，听不清的标「不确定」，绝不编造。严格分三部分输出：",
  "【一、人声台词转写】逐句转写全部人声/对白/旁白/画外音，每句给大致时间戳（如 0:03–0:05）。完全没有人声就明确写「无人声台词」。语言非中文时标注语种并给原文。",
  "【二、背景音乐(BGM)描述】只描述、不要逐字转录歌词（版权）：风格类型、主要配器、情绪、节奏/大致 BPM、随画面的情绪起伏。",
  "【三、音效(SFX)时间轴】按时间列出可辨识音效（风声/爆破/脚步/金属撞击/低频 riser 等），各给时间段。只写确认听到的，别把画面动作臆想成音效。",
].join("\n");
async function cmdAudio(cfg, args) {
  const video = args.video || args.input;
  const audioIn = args.audio;
  if (!video && !audioIn) die("需要 --video <视频路径> 或 --audio <音频文件>");
  const model = args.model ? String(args.model) : AUDIO_MODEL_DEFAULT;
  const dir = outDir(args);
  // 1) 拿到音频：从视频抽（mp3/16k/mono，够小又保清晰）或直接用 --audio
  let audioPath;
  if (audioIn) {
    audioPath = resolve(String(audioIn));
    if (!existsSync(audioPath)) die("音频不存在: " + audioPath);
    if (!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(audioPath)) die("音频格式需为 mp3/wav/m4a/aac/ogg/flac: " + audioPath);
  } else {
    const src = resolve(String(video));
    if (!existsSync(src)) die("视频不存在: " + src);
    audioPath = join(dir, "audio.mp3");
    const win = [];
    if (args.start !== undefined) win.push("-ss", String(args.start)); // 窗口化：只拆某段
    if (args.end !== undefined) win.push("-to", String(args.end));
    log("[audio] 抽取音轨 → " + audioPath + "（mp3 / 16k / mono）");
    ffRun(["-y", "-hide_banner", "-loglevel", "error", ...win, "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-acodec", "libmp3lame", audioPath], "抽音");
    if (!existsSync(audioPath) || statSync(audioPath).size < 32) die("抽音失败：视频可能无音轨。先 ffprobe 确认音轨再重试。");
  }
  // 可选 Demucs 分离（--separate）：产出 vocals/伴奏 stem 供人耳核对转写与听 BGM；仍把整轨喂 Gemini（整轨里它已能分辨人声与配乐）。无 python/demucs 自动降级、不阻断。
  if (args.separate) {
    const py = detectPython(args);
    if (py && spawnSync(py, ["-c", "import demucs"], { encoding: "utf8" }).status === 0) {
      const sepRoot = join(dir, "stems");
      log("[audio] Demucs 分离人声/伴奏（CPU，首次含下载模型）…");
      const r = spawnSync(py, ["-m", "demucs", "--two-stems", "vocals", "-o", sepRoot, "-n", "htdemucs", audioPath], { stdio: "inherit" });
      const stem = join(sepRoot, "htdemucs", basename(audioPath, extname(audioPath)));
      if (r.status === 0 && existsSync(join(stem, "vocals.wav"))) {
        log("[audio] ✅ 分离完成（仅作核对/听感，伴奏不复用原曲·版权）: " + stem);
      } else log("[audio] Demucs 无输出，跳过（仍用整轨拆解）。");
    } else log('[audio] 缺 python/demucs，跳过分离（用整轨拆解）。装: pip install demucs');
  }
  // 2) base64 → Gemini 多模态 chat（input_audio）
  const buf = readFileSync(audioPath);
  const sizeKB = (buf.length / 1024).toFixed(0);
  const fmt = extname(audioPath).slice(1).toLowerCase().replace("m4a", "mp4");
  log("[audio] " + sizeKB + "KB → " + model + "（input_audio · /v1/chat/completions）");
  if (args["dry-run"]) { log("[DRY-RUN] 不调用付费接口。将 POST /v1/chat/completions，model=" + model + "，附音频 " + sizeKB + "KB(base64)。"); return; }
  const prompt = args.prompt ? String(args.prompt) : AUDIO_PROMPT;
  const body = { model, messages: [{ role: "user", content: [
    { type: "text", text: prompt },
    { type: "input_audio", input_audio: { data: buf.toString("base64"), format: fmt } },
  ] }] };
  let json;
  try { json = await api(cfg, "POST", "/v1/chat/completions", body); }
  catch (e) {
    const cls = classifyImgError(e.message);
    if (cls === "capacity") die(e.message + "\n[诊断] gemini-3.7-flash 当前无可用渠道 → 稍后重试；如用户明确同意降级，再用 --model 指定其它支持 input_audio 的 Gemini 模型。");
    if (cls === "fatal") die(e.message + fatalHint(e.message));
    die(e.message);
  }
  const content = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || "";
  if (!content) die("模型未返回文本，原始响应: " + JSON.stringify(json).slice(0, 400));
  const outMd = join(dir, "audio_analysis.md");
  writeFileSync(outMd, "# 音频拆解 · " + basename(audioPath) + "\n\n> 模型 " + model + "（时间戳为模型估算、非帧级精准；BGM 只描述不提取原曲）\n\n" + content + "\n");
  writeFileSync(join(dir, "audio_analysis.json"), JSON.stringify(json, null, 2));
  log("");
  log(content);
  log("");
  if (json.usage) {
    const d = json.usage.prompt_tokens_details || {};
    log("[usage] total=" + json.usage.total_tokens + (d.audio_tokens != null ? " (audio=" + d.audio_tokens + ")" : ""));
  }
  log("[DONE] 已保存: " + outMd);
  log("[audio] 合规：BGM 只描述不提取原曲（版权）；转写仅用于反推分析。原片演员不复用，用户另行提供的授权人物按身份直传分支处理（见 reverse.md / replicate.md）。");
}
// ---------- meta ----------
async function cmdSelfTest(cfg) {
  log("baseUrl: " + cfg.baseUrl);
  log("API Key: " + mask(cfg.apiKey));
  log("Access Token: " + mask(cfg.accessToken));
  try {
    requireKey(cfg);
    requireAccessToken(cfg);
    const [account, catalog] = await Promise.all([fetchAccount(cfg), fetchVideoCatalog(cfg)]);
    if (!catalog.apiKeyCheck.checked) die("生成 API Key 验证失败: " + catalog.apiKeyCheck.error);
    const available = catalog.models.filter((model) => model.availability === "available");
    log("账户余额: " + money(account.balance, account.currency));
    log("实时视频模型: " + catalog.models.length + " 个；当前 Key 可用且端点兼容: " + available.length + " 个");
    log("价格版本: " + catalog.pricingVersion);
    if (cfg.videoModel) {
      const selected = catalog.models.find((model) => model.id === cfg.videoModel);
      log("已选视频模型: " + cfg.videoModel + (selected ? " · " + selected.availabilityLabel + " · " + priceLabel(selected.price) : " · 已不在目录"));
    } else log("已选视频模型: (尚未选择；生成前必须让用户选择)");
    log("[OK] 双凭据、余额、价格目录和模型状态查询均通过。self-test 不调用付费生成接口。");
    log("");
    for (const l of CAPS) log(l);
  } catch (e) { die("self-test 失败: " + e.message); }
}
async function cmdCaps(cfg) {
  for (const line of CAPS) log(line);
  if (!cfg.videoModel || !cfg.accessToken) return;
  try {
    const catalog = await fetchVideoCatalog(cfg);
    const selected = catalog.models.find((model) => model.id === cfg.videoModel);
    if (selected) {
      log("");
      log("当前已选模型: " + selected.id + " · " + priceLabel(selected.price) + " · " + selected.availabilityLabel);
      log("能力: " + modelSummary(selected));
      log("目录说明: " + selected.description);
    }
  } catch (error) { log("[提示] 动态能力查询失败: " + error.message); }
}
// ---------- main ----------
async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cfg = loadConfig();
  if (args["set-key"]) { cfg.apiKey = String(args["set-key"]); saveConfigPatch({ apiKey: cfg.apiKey }); log("API Key 已保存到 " + CONFIG_PATH + "（" + mask(cfg.apiKey) + "）"); return; }
  if (args["set-access-token"]) return cmdSetAccessToken(cfg, args["set-access-token"]);
  if (args["configure-access-token"]) return cmdConfigureAccessToken();
  if (args["mark-onboarding-shown"]) { saveConfigPatch({ onboardingShown: true, onboardingShownAt: new Date().toISOString() }); log("首次使用介绍已标记完成。"); return; }
  if (args["set-video-model"]) return cmdSetVideoModel(cfg, String(args["set-video-model"]));
  if (args["set-base-url"]) { cfg.baseUrl = String(args["set-base-url"]).replace(/\/$/, ""); saveConfigPatch({ baseUrl: cfg.baseUrl }); log("baseUrl = " + cfg.baseUrl); return; }
  if (args["config-path"]) { log(CONFIG_PATH); return; }
  if (args["get-config"]) { log(JSON.stringify({ configPath: CONFIG_PATH, baseUrl: cfg.baseUrl, apiKey: mask(cfg.apiKey), accessToken: mask(cfg.accessToken), userId: cfg.userId || "(auto)", videoModel: cfg.videoModel || "(not selected)", imageModel: cfg.imageModel, audioModel: AUDIO_MODEL_DEFAULT, onboardingShown: Boolean(cfg.onboardingShown) }, null, 2)); return; }
  if (args["caps"] || args["capabilities"]) return cmdCaps(cfg);
  if (args["self-test"]) return cmdSelfTest(cfg);
  const cmd = args._[0];
  if (cmd === "intro") return cmdIntro();
  if (cmd === "account") return cmdAccount(cfg, args);
  if (cmd === "models") return cmdModels(cfg, args);
  if (cmd === "video") return cmdVideo(cfg, args);
  if (cmd === "image") return cmdImage(cfg, args);
  if (cmd === "status") return cmdStatus(cfg, args);
  if (cmd === "raw") return cmdRaw(cfg, args);
  if (cmd === "concat") return cmdConcat(cfg, args);
  if (cmd === "depth") return cmdDepth(cfg, args);
  if (cmd === "audio") return cmdAudio(cfg, args);
  log(["seedance-studio CLI — 用法:",
    '  配置生成 Key: node studio.mjs --set-key "sk-..."',
    '  聊天配置访问令牌: node studio.mjs --set-access-token "<令牌>"（优先；自动验证并脱敏保存）',
    '  隐藏输入访问令牌: node studio.mjs --configure-access-token（备用；不写配置文件）',
    '  首次介绍: node studio.mjs intro | --mark-onboarding-shown',
    '  查账户: node studio.mjs account [--json]',
    '  查视频模型: node studio.mjs models [--json] [--no-key-check]',
    '  选择模型: node studio.mjs --set-video-model "<模型ID>"',
    '  其它配置: node studio.mjs --get-config | --self-test | --caps',
    '  生视频: node studio.mjs video --prompt "..." [--model 临时覆盖模型ID] [--duration 秒] [--ratio 16:9]',
    "          [--first-frame 图] [--last-frame 图]（图生视频：片头随首帧/片尾随尾帧）",
    "          [--identity-image 授权真人图] [--image 场景/产品图 ...合计最多30] [--video-url URL] [--audio-url URL]",
    "          [--audio|--no-audio] [--seed N] [--out 目录] [--no-wait] [--dry-run]",
    "  查任务: node studio.mjs status --task task_xxx [--wait] [--out 目录]",
    '  生图:  node studio.mjs image --prompt "..." [--prompt "..." ...] [--aspect 16:9] [--n 1-4] [--concurrency 1-10] [--model gpt-image-2-4k] [--identity-ref 授权真人图] [--ref 场景/产品图 ...] [--dry-run]',
    "          多张并发：重复 --prompt 出多张不同图，或 --n 每个提示词出几张；总量 = 提示词数 × n，用并发池并行跑（默认并发 3、上限 10）",
    "          默认 gpt-image-2(稳定 2K，网关自带兜底)；要更高清加 --model gpt-image-2-4k(16:9 真 4K UHD，断渠道直接报错)；均走 /v1/images，支持 --ref 垫图锁角色",
    "  拼接:  node studio.mjs concat --dir <segments目录> [--input a.mp4 --input b.mp4] [--out final.mp4] [--reencode]",
    "  运动理解: node studio.mjs depth --video <片> [--mode auto|character|landscape|action] [--fps N] [--no-depth] [--out 目录]",
    "          题材自适应：character=真深度读人物动作/前后景；landscape=运动热图+原帧光色、跳深度(--with-depth 强开)；action=多人骨架(YOLO-pose)+运动+深度读武打连招(--no-pose 关骨架)；auto=都出自己挑。所有模式都出 motion_heat 读运镜",
    "  音频拆解: node studio.mjs audio --video <片> [--audio 音频] [--start 秒 --end 秒] [--model gemini-3.7-flash] [--separate] [--out 目录] [--dry-run]",
    "          抽音→Gemini 多模态一次拆出「人声台词(带时间戳) / BGM风格描述 / 音效时间轴」；默认 gemini-3.7-flash。88api 无专用 STT 渠道故走多模态。--separate 用本地 Demucs 分人声/伴奏供核对。BGM 只描述不提取原曲(版权)"].join("\n"));
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(SCRIPT_PATH).toLowerCase();
if (invokedAsScript) main().catch(e => { console.error("[ERROR] " + (e && e.message ? e.message : String(e))); process.exitCode = 1; });

export { ONBOARDING_LINES, inferVideoCapabilities, normalizeVideoPrice, isVideoCatalogRow, endpointCompatible, buildVideoPayload, fetchVideoCatalog, fetchAccount, money, priceLabel };
