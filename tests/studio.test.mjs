import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ONBOARDING_LINES,
  explicitVideoAdapter,
  inferVideoCapabilities,
  normalizeVideoPrice,
  isVideoCatalogRow,
  endpointCompatible,
  promptRequiresImageReference,
  buildVideoPayload,
  buildReferenceAudit,
  monitorStartMessage,
  monitorHeartbeatMessage,
  fetchVideoCatalog,
  fetchAccount,
  priceLabel,
} from "../plugins/seedance-studio/scripts/studio.mjs";

test("first-use introduction covers all main workflows and chat-first credential setup", () => {
  const intro = ONBOARDING_LINES.join("\n");
  assert.match(intro, /想法 → 成片/);
  assert.match(intro, /视频 → 反推/);
  assert.match(intro, /视频 → 复刻工程包/);
  assert.match(intro, /可信聊天中直接交给 Agent/);
  assert.match(intro, /隐藏输入方式/);
});

test("chat-provided access token is verified, saved, masked and does not trigger revocation advice", async (t) => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/user/self") {
      res.end(JSON.stringify({ success: true, data: { id: 7, username: "demo", group: "default", status: 1, quota: 500000, used_quota: 0, request_count: 0 } }));
      return;
    }
    if (req.url === "/api/status") {
      res.end(JSON.stringify({ success: true, data: { quota_per_unit: 500000, quota_display_type: "CNY" } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, message: "not found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const home = mkdtempSync(join(tmpdir(), "seedance-chat-token-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const configDir = join(home, ".seedance-studio");
  mkdirSync(configDir, { recursive: true });
  const { port } = server.address();
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ baseUrl: `http://127.0.0.1:${port}` }));
  const cliPath = fileURLToPath(new URL("../plugins/seedance-studio/scripts/studio.mjs", import.meta.url));
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  delete env.SEEDANCE_STUDIO_ACCESS_TOKEN;
  delete env.RELAY_88API_ACCESS_TOKEN;
  delete env.SEEDANCE_STUDIO_USER_ID;
  delete env.RELAY_88API_USER_ID;
  const token = "chat-token-value";
  const child = spawn(process.execPath, [cliPath, "--set-access-token", token], { env, windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(stdout, new RegExp(token));
  assert.doesNotMatch(stdout, /立即撤销|重新创建/);
  const saved = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
  assert.equal(saved.accessToken, token);
  assert.equal(saved.userId, "7");
});

test("image preflight reuses the Image2 plugin Key and keeps gpt-image-2 as the default", async (t) => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      if (req.headers.authorization !== "Bearer shared-image2-key") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: { message: "invalid key" } }));
        return;
      }
      res.end(JSON.stringify({ data: [{ id: "gpt-image-2" }, { id: "gpt-image-2-4k" }] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const home = mkdtempSync(join(tmpdir(), "seedance-shared-key-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const seedanceConfigDir = join(home, ".seedance-studio");
  const codexDir = join(home, ".codex");
  mkdirSync(seedanceConfigDir, { recursive: true });
  mkdirSync(codexDir, { recursive: true });
  const { port } = server.address();
  writeFileSync(join(seedanceConfigDir, "config.json"), JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "expired-seedance-key", imageModel: "gemini-3.1-flash-image" }));
  writeFileSync(join(codexDir, "88api-image-gen-config.json"), JSON.stringify({ workers: [{ name: "default", apiKey: "shared-image2-key", enabled: true }], model: "gpt-image-2" }));
  const cliPath = fileURLToPath(new URL("../plugins/seedance-studio/scripts/studio.mjs", import.meta.url));
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  delete env.SEEDANCE_STUDIO_API_KEY;
  const runCli = (args) => new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cliPath, ...args], { env, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });

  const preflightRun = await runCli(["preflight", "--scope", "image", "--json"]);
  assert.equal(preflightRun.code, 0, preflightRun.stderr);
  const preflight = JSON.parse(preflightRun.stdout);
  assert.equal(preflight.ready, true);
  assert.equal(preflight.apiKey.configured, true);
  assert.match(preflight.apiKey.source, /88api-image-gen-config\.json$/);
  assert.equal(preflight.image.model, "gpt-image-2");

  const dryRun = await runCli(["image", "--prompt", "product", "--dry-run", "--out", join(home, "out")]);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /模型 gpt-image-2/);
  assert.doesNotMatch(dryRun.stdout, /gemini/i);
});

test("parses Seedance catalog capabilities and limits", () => {
  const capabilities = inferVideoCapabilities({
    model_name: "Seedance-2.5-720p官方版",
    description: "支持文生视频、最多 30 张参考图、10 个参考视频和 10 个参考音频，以及首尾帧生成；支持 16:9、9:16、1:1，时长 4–30 秒，默认 4 秒。",
  });
  assert.equal(capabilities.textToVideo, true);
  assert.equal(capabilities.imageReference, true);
  assert.equal(capabilities.videoReference, true);
  assert.equal(capabilities.audioReference, true);
  assert.equal(capabilities.firstLastFrame, true);
  assert.equal(capabilities.minDuration, 4);
  assert.equal(capabilities.maxDuration, 30);
  assert.equal(capabilities.defaultDuration, 4);
  assert.equal(capabilities.maxImages, 30);
  assert.equal(capabilities.maxVideos, 10);
  assert.equal(capabilities.maxAudios, 10);
});

test("distinguishes explicit no-reference from undocumented capability", () => {
  const mini = inferVideoCapabilities({
    model_name: "seedance-2.0-mini-480p",
    description: "无参考轻量版，面向纯文本生成视频，不提供参考图、参考视频或参考音频输入；时长 4–15 秒。",
  });
  assert.equal(mini.imageReference, false);
  assert.equal(mini.videoReference, false);
  assert.equal(mini.audioReference, false);

  const alias = inferVideoCapabilities({ model_name: "video-alias-1080p", description: "平台高清别名" });
  assert.equal(alias.imageReference, null);
  assert.equal(alias.videoReference, null);
  assert.equal(alias.audioReference, null);
});

test("parses generic multimodal input and maximum-only duration", () => {
  const omni = inferVideoCapabilities({
    model_name: "gemini-omni-flash",
    description: "支持文本、图片、音频和视频输入，可生成带音频的 3–10 秒 720p 视频。",
  });
  assert.equal(omni.textToVideo, true);
  assert.equal(omni.imageReference, true);
  assert.equal(omni.videoReference, true);
  assert.equal(omni.audioReference, true);
  assert.equal(omni.generatedAudio, true);
  assert.equal(omni.minDuration, 3);
  assert.equal(omni.maxDuration, 10);

  const h3 = inferVideoCapabilities({ model_name: "minimax-h3-1440p", description: "高速出片 最大支持15秒 按条计费" });
  assert.equal(h3.maxDuration, 15);
});

test("normalizes per-second price with the selected auto group multiplier", () => {
  const price = normalizeVideoPrice(
    { quota_type: 1, billing_mode: "per_second", model_price: 1.02, enable_groups: ["视频模型"] },
    { auto_groups: ["视频模型"], group_ratio: { 视频模型: 0.5 } },
    { data: { quota_display_type: "CNY", quota_per_unit: 500000 } },
  );
  assert.equal(price.effective, 0.51);
  assert.equal(price.unit, "second");
  assert.match(priceLabel(price), /^¥0\.51\/秒/);
});

test("filters video rows and accepts only /v1/videos-compatible endpoint types", () => {
  const row = { enable_groups: ["视频模型"], supported_endpoint_types: ["openai-video"] };
  assert.equal(isVideoCatalogRow(row), true);
  assert.equal(endpointCompatible(row), true);
  assert.equal(endpointCompatible({ supported_endpoint_types: ["openai"] }), false);
});

test("keeps live 88API Veo model names while applying the Veo payload schema", () => {
  const adapter = explicitVideoAdapter("veo-3.1-fast");
  assert.equal(adapter.apiModelId, "veo-3.1-fast");
  assert.equal(endpointCompatible({ model_name: "veo-3.1-fast", supported_endpoint_types: ["openai", "gemini"] }), true);
  const model = {
    id: adapter.apiModelId,
    adapter,
    capabilities: adapter.capabilities,
  };
  const payload = buildVideoPayload({}, { prompt: "test", ratio: "9:16" }, model);
  assert.deepEqual(payload, {
    model: "veo-3.1-fast",
    prompt: "test",
    duration: 8,
    size: "1080x1920",
  });
  assert.throws(() => buildVideoPayload({}, { prompt: "test", duration: "10", ratio: "16:9" }, model), /最长时长为 8 秒/);
  assert.throws(() => buildVideoPayload({}, { prompt: "test", "first-frame": "frame.png" }, model), /明确不支持首尾帧/);
});

test("builds a payload from the user-selected model profile", () => {
  const model = {
    id: "wan3.0-video-prime-1080p",
    capabilities: {
      minDuration: 4,
      maxDuration: 30,
      defaultDuration: 5,
      resolution: "1080p",
      ratios: ["16:9", "9:16"],
      imageReference: true,
      videoReference: true,
      audioReference: true,
      firstLastFrame: true,
    },
  };
  const payload = buildVideoPayload({}, { prompt: "test", ratio: "16:9" }, model);
  assert.equal(payload.model, model.id);
  assert.equal(payload.duration, 5);
  assert.equal(payload.resolution, "1080p");
});

test("blocks paid video submission when a required reference image is missing", (t) => {
  const model = {
    id: "video-with-images",
    capabilities: { minDuration: 4, maxDuration: 10, defaultDuration: 5, imageReference: true },
  };
  assert.throws(
    () => buildVideoPayload({}, { prompt: "product video", "require-image": true }, model),
    /参考图审计失败/,
  );
  assert.equal(promptRequiresImageReference("请严格参考图保持产品一致"), true);
  assert.throws(
    () => buildVideoPayload({}, { prompt: "请严格参考图保持产品一致" }, model),
    /参考图审计失败/,
  );
  const audit = buildReferenceAudit(
    { image: ["product.png"], "require-image": true },
    { prompt: "product video", images: ["data:image/png;base64,abc"] },
  );
  assert.equal(audit.imageRequired, true);
  assert.equal(audit.imageCount, 1);

  const temp = mkdtempSync(join(tmpdir(), "seedance-reference-audit-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const imagePath = join(temp, "product.png");
  writeFileSync(imagePath, Buffer.from("89504E470D0A1A0A0000000D49484452", "hex"));
  const payload = buildVideoPayload({}, { prompt: "product video", image: imagePath, "require-image": true }, model);
  assert.equal(payload.images.length, 1);
  assert.match(payload.images[0], /^data:image\/png;base64,/);
});

test("monitor messages tell the user that the Agent is still watching progress", () => {
  assert.match(monitorStartMessage("task_demo"), /正在监控.*请耐心等待.*不要重复提交/);
  assert.match(monitorHeartbeatMessage("in_progress", 35, 48), /Agent 仍在监控.*继续耐心等待/);
});

test("blocks reference images only when the catalog explicitly denies them", () => {
  const model = {
    id: "text-only-video",
    capabilities: { minDuration: 4, maxDuration: 15, imageReference: false, videoReference: false, audioReference: false },
  };
  assert.throws(
    () => buildVideoPayload({}, { prompt: "test", duration: "5", image: "missing.png" }, model),
    /明确不支持图片参考/,
  );
});

test("merges pricing, account visibility, API-key visibility and balance from read-only APIs", async (t) => {
  const responses = {
    "/api/status": { success: true, data: { quota_per_unit: 500000, quota_display_type: "CNY" } },
    "/api/user/self": { success: true, data: { id: 7, username: "demo", group: "default", status: 1, quota: 2500000, used_quota: 500000, request_count: 3 } },
    "/api/user/models": { success: true, data: ["video-good", "video-chat-only", "veo-3.1"] },
    "/api/pricing": {
      success: true,
      pricing_version: "fixture-v1",
      auto_groups: ["视频模型"],
      group_ratio: { 视频模型: 1 },
      vendors: [{ id: 1, name: "Fixture" }],
      data: [
        { model_name: "video-good", description: "支持文生视频，时长 4–10 秒，默认 5 秒。", vendor_id: 1, quota_type: 1, model_price: 0.2, billing_mode: "per_second", enable_groups: ["视频模型"], supported_endpoint_types: ["openai-video"] },
        { model_name: "video-chat-only", description: "视频模型", vendor_id: 1, quota_type: 1, model_price: 0.1, billing_mode: "per_second", enable_groups: ["视频模型"], supported_endpoint_types: ["openai"] },
        { model_name: "veo-3.1", description: "Veo 3.1 视频模型", vendor_id: 1, quota_type: 1, model_price: 0.25, billing_mode: "per_second", enable_groups: ["视频模型"], supported_endpoint_types: ["openai", "gemini"] },
      ],
    },
    "/v1/models": { data: [{ id: "video-good" }, { id: "video-chat-only" }, { id: "veo-3.1" }] },
  };
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(responses[req.url] || { success: false, message: "not found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const cfg = { baseUrl: `http://127.0.0.1:${port}`, apiKey: "sk-test", accessToken: "access-test", userId: "7" };

  const [catalog, account] = await Promise.all([fetchVideoCatalog(cfg), fetchAccount(cfg)]);
  assert.equal(catalog.pricingVersion, "fixture-v1");
  assert.equal(catalog.models.find((model) => model.id === "video-good").availability, "available");
  assert.equal(catalog.models.find((model) => model.id === "video-good").selectable, true);
  assert.equal(catalog.models.find((model) => model.id === "video-chat-only").availability, "unsupported_endpoint");
  const veo = catalog.models.find((model) => model.id === "veo-3.1");
  assert.equal(veo.catalogId, "veo-3.1");
  assert.equal(veo.availability, "available");
  assert.equal(veo.adapter.payloadKind, "veo");
  assert.equal(account.balance, 5);
  assert.equal(account.used, 1);
});
