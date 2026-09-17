import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  explicitVideoAdapter, inferVideoCapabilities, endpointCompatible, isVideoCatalogRow, normalizeVideoPrice, priceLabel,
  buildVideoPayload, buildReferenceAudit, prepareVideoMedia, fetchVideoCatalog, cmdVideo, pollTask,
} from "../plugins/seedance-studio/scripts/studio.mjs";
import { mergeVideoCapabilities, priceForVideoRequest, estimateVideoCost } from "../plugins/seedance-studio/scripts/video-contract.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/video-pricing-2026-09-17.json", import.meta.url), "utf8"));
const status = { success: true, data: { quota_per_unit: 500000, quota_display_type: "CNY" } };
function model(id) {
  const row = fixture.data.find((r) => r.model_name === id);
  assert.ok(row, id);
  const adapter = explicitVideoAdapter(id);
  return { id, adapter, capabilities: mergeVideoCapabilities(inferVideoCapabilities(row), adapter.capabilities) };
}
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "studio-task-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a26kAAAAASUVORK5CYII=", "base64");

test("all 25 live sales names work despite legacy endpoint labels and produce current request fields", () => {
  assert.equal(fixture.data.length, 25);
  for (const row of fixture.data) {
    assert.equal(endpointCompatible(row), true, row.model_name);
    const m = model(row.model_name);
    const payload = buildVideoPayload({}, { prompt: "A slow camera move", duration: 8 }, m);
    assert.equal(payload.model, row.model_name);
    assert.equal(payload.duration, 8);
    assert.ok(payload.size);
    for (const field of ["ratio", "resolution", "content", "callback_url", "task_id", "generate_audio"]) {
      assert.equal(payload[field], undefined, row.model_name + ": " + field);
    }
  }
  assert.equal(endpointCompatible({ model_name: "chat", supported_endpoint_types: ["openai"] }), false);
  assert.equal(isVideoCatalogRow({ model_name: "multimodal-chat", description: "支持视频理解、音频理解与编程", supported_endpoint_types: ["openai"] }), false);
  assert.equal(endpointCompatible({ model_name: "future-video", enable_groups: ["视频模型"], supported_endpoint_types: ["openai"], billing_usage_schema: { seconds: { unit: "second" } } }), true);
});

test("task expressions use seconds and group ratios, including zero discounts and resolution tiers", () => {
  for (const row of fixture.data) {
    const price = normalizeVideoPrice(row, fixture, status);
    assert.equal(price.unit, "second", row.model_name);
    assert.ok(price.effective > 0, row.model_name);
    assert.doesNotMatch(priceLabel(price), /Token/);
  }
  const row = fixture.data.find((r) => r.model_name === "veo-3.1-fast");
  const price = normalizeVideoPrice(row, { ...fixture, group_ratio: { 视频模型: 0.001 } }, status);
  assert.equal(price.effective, 0.0001);
  assert.match(priceLabel(price), /¥0\.0001–¥0\.00023333\/秒/);
  const selected = priceForVideoRequest(price, "1080p");
  assert.equal(estimateVideoCost(selected, 8), 0.0008);
  assert.equal(priceForVideoRequest(price, "4k").effective, 0.2333333 * 0.001);
  const free = normalizeVideoPrice(row, { ...fixture, group_ratio: { 视频模型: 0 } }, status);
  assert.equal(estimateVideoCost(free, 8), 0);
});

test("unknown or hostile expressions cannot become zero cost or legacy token prices", () => {
  for (const expression of ['u("seconds") * 0.1 + unknown()', 'tier("base", u("seconds") * 1); process.exit()', 'tier("base", u("seconds") * 1e999)', '']) {
    const price = normalizeVideoPrice({ billing_mode: "tiered_expr", billing_expr: expression, model_ratio: 37.5, model_price: 100 }, fixture, status);
    assert.equal(estimateVideoCost(price, 8), null);
    assert.match(priceLabel(price), /无法估算/);
  }
});

test("mixed references and frames use metadata and keep identity in the first image", () => {
  const m = model("SD2.5 720P");
  const identity = "https://example.com/identity.png";
  const payload = buildVideoPayload({}, { prompt: "walk", "identity-image": identity, image: "https://example.com/scene.png",
    "video-url": "https://example.com/motion.mp4", "audio-url": "https://example.com/voice.mp3", "require-image": true }, m);
  assert.equal(payload.images[0], identity);
  assert.match(payload.prompt, /身份唯一基准/);
  assert.deepEqual(payload.metadata, { referenceVideos: ["https://example.com/motion.mp4"], referenceAudios: ["https://example.com/voice.mp3"] });
  const frames = buildVideoPayload({}, { prompt: "sunset", "first-frame": identity, "last-frame": "https://example.com/end.png" }, m);
  assert.deepEqual(frames.metadata, { firstFrame: identity, lastFrame: "https://example.com/end.png" });
  assert.equal(buildReferenceAudit({ "first-frame": identity, "require-image": true }, frames).imageCount, 2);
  assert.throws(() => buildVideoPayload({}, { prompt: "walk", "identity-image": identity, "first-frame": identity }, m), /互斥/);
  assert.throws(() => buildVideoPayload({}, { prompt: "walk", "last-frame": identity }, m), /尾帧必须同时提供首帧/);
  // The obsolete Seedance rule requiring an image alongside video no longer applies.
  assert.ok(buildVideoPayload({}, { prompt: "walk", "video-url": "https://example.com/motion.mp4" }, m).metadata.referenceVideos);
});

test("duration, locked resolution, audio controls and reference limits reject invalid requests", () => {
  const sd = model("SD2.0 720P");
  for (const duration of ["5junk", "5.5", "", -1, 16]) assert.throws(() => buildVideoPayload({}, { prompt: "test", duration }, sd));
  assert.throws(() => buildVideoPayload({}, { prompt: "test", resolution: "1080p" }, sd), /分辨率/);
  assert.throws(() => buildVideoPayload({}, { prompt: "test", "no-audio": true }, sd), /音频开关/);
  assert.throws(() => buildVideoPayload({}, { prompt: "test", image: Array(9).fill("https://example.com/a.png"),
    "video-url": Array(3).fill("https://example.com/a.mp4"), "audio-url": "https://example.com/a.mp3" }, sd), /合计最多 12/);
  assert.throws(() => buildVideoPayload({}, { prompt: "test", "audio-url": "https://example.com/a.mp3" }, model("kling-3.0-turbo-720p")), /未声明支持参考音频/);
  assert.throws(() => buildVideoPayload({}, { prompt: "test", "audio-url": "https://example.com/a.mp3" }, model("minimax-h3-768p")), /需要同时提供图片或视频/);
  assert.equal(model("wan3.0-video-480p").capabilities.maxImages, 10); // live limit is tighter than published docs
  assert.equal(model("wan3.0-video-720p").capabilities.maxVideos, 5); // Chinese "段" is recognized
  for (const url of ["http://example.com/x.mp4", "https://localhost/x.mp4", "https://127.0.0.1/x.mp4", "data:video/mp4;base64,AA"]) {
    assert.throws(() => buildVideoPayload({}, { prompt: "test", "video-url": url }, sd), /公网 HTTPS/);
  }
});

test("Veo, Grok and Omni use their own reference fields and modes", () => {
  const veo = model("veo-3.1");
  const p = buildVideoPayload({}, { prompt: "clouds", duration: 6, resolution: "720p", ratio: "9:16", "no-audio": true, seed: "4" }, veo);
  assert.equal(p.size, "720x1280");
  assert.deepEqual(p.metadata, { seed: 4, generateAudio: false });
  assert.throws(() => buildVideoPayload({}, { prompt: "test", duration: 5 }, veo), /4\/6\/8/);
  assert.throws(() => buildVideoPayload({}, { prompt: "test", duration: 6, image: "https://example.com/ref.png" }, veo), /必须 8 秒/);
  const reference = buildVideoPayload({}, { prompt: "test", image: ["https://example.com/a.png", "https://example.com/b.png", "https://example.com/c.png"] }, veo);
  assert.equal(reference.metadata.video_mode, "reference");
  const grok = buildVideoPayload({}, { prompt: "test", ratio: "3:2", resolution: "480p", "first-frame": "https://example.com/start.png" }, model("grok-imagine-video-1.5"));
  assert.deepEqual(grok.images, ["https://example.com/start.png"]);
  assert.deepEqual(grok.metadata, { resolution: "480p" });
  assert.equal(grok.size, "3:2");
  const omni = buildVideoPayload({}, { prompt: "test", duration: 6, "video-url": "https://example.com/ref.mp4" }, model("gemini-omni-flash"));
  assert.equal(omni.video, "https://example.com/ref.mp4");
  assert.equal(omni.metadata, undefined);
});

test("local images upload with a SHA-256 ticket, without sending the API Key to storage", async (t) => {
  const dir = tempDir(t), path = join(dir, "ref.png");
  writeFileSync(path, png);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://88api.ai/v1/media/uploads") {
      assert.equal(options.headers.Authorization, "Bearer test-only-key");
      assert.deepEqual(JSON.parse(options.body), { size: png.length, mime_type: "image/png", sha256: createHash("sha256").update(png).digest("base64url") });
      return Response.json({ url: "https://assets.88api.ai/media/ref.png", upload_url: "https://assets.88api.ai/media/ref.png", method: "PUT", headers: { "Content-Type": "image/png", "X-Media-Upload-Token": "scoped" } });
    }
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers["X-Media-Upload-Token"], "scoped");
    assert.equal(options.headers["Content-Length"], String(png.length));
    assert.deepEqual(options.body, png);
    return Response.json({ url: "https://assets.88api.ai/media/ref.png" }, { status: 201 });
  });
  const payload = { images: [{ localImage: path }], metadata: { firstFrame: { localImage: path } } };
  const ready = await prepareVideoMedia({ baseUrl: "https://88api.ai", apiKey: "test-only-key" }, payload, { payloadKind: "unified" });
  assert.equal(calls.length, 2); // duplicate local references reuse one upload
  assert.deepEqual(ready, { images: ["https://assets.88api.ai/media/ref.png"], metadata: { firstFrame: "https://assets.88api.ai/media/ref.png" } });
  assert.deepEqual(payload.images[0], { localImage: path });
});

test("untrusted upload destinations are rejected before forwarding upload credentials", async (t) => {
  const dir = tempDir(t), path = join(dir, "ref.png"); writeFileSync(path, png);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ url: "https://evil.example/ref", upload_url: "https://evil.example/ref", method: "PUT", headers: { "Content-Type": "image/png", "X-Media-Upload-Token": "scoped" } });
  });
  await assert.rejects(prepareVideoMedia({ baseUrl: "https://88api.ai", apiKey: "test-only-key" }, { images: [{ localImage: path }] }, { payloadKind: "unified" }), /不符合 88API/);
  assert.equal(calls, 1);
});

test("Veo embeds actual PNG bytes without requesting an upload ticket", async (t) => {
  const dir = tempDir(t), path = join(dir, "ref.png"); writeFileSync(path, png);
  t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network call"); });
  const payload = buildVideoPayload({}, { prompt: "test", "first-frame": path }, model("veo-3.1-fast"));
  const ready = await prepareVideoMedia({}, payload, { payloadKind: "veo" });
  assert.equal(ready.images[0], "data:image/png;base64," + png.toString("base64"));
});

async function testServer(t, options = {}) {
  const requests = [];
  let reads = 0, baseUrl;
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    const responses = {
      "/api/status": status,
      "/api/user/self": { success: true, data: { id: 7, status: 1, quota: 50000000 } },
      "/api/pricing": options.pricing || fixture,
      "/api/user/models": { success: true, data: fixture.data.map((r) => r.model_name) },
      "/v1/models": { data: fixture.data.map((r) => ({ id: r.model_name })) },
    };
    if (responses[req.url]) return res.end(JSON.stringify(responses[req.url]));
    if (req.method === "POST" && req.url === "/v1/videos") {
      if (options.dropSubmit) { req.socket.destroy(); return; }
      return res.end(JSON.stringify({ id: "task_public", status: "queued" })); // no task_id
    }
    if (req.url === "/v1/videos/task_public") {
      reads++;
      if (options.retryRead && reads === 1) { res.statusCode = 503; res.end("{}"); return; }
      return res.end(JSON.stringify(options.failed ? { id: "task_public", status: "failed", error: { message: "test failure" } }
        : { id: "task_public", status: "completed", [options.resultField || "url"]: baseUrl + "/movie?signature=keep", usage: { seconds: 8 } }));
    }
    if (req.url === "/movie?signature=keep") { res.setHeader("Content-Type", "video/mp4"); return res.end("video-test-bytes"); }
    res.statusCode = 404; res.end("{}");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => server.close());
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { cfg: { baseUrl, apiKey: "api-key", accessToken: "access-token", userId: "7", pollIntervalMs: 1, pollTimeoutMs: 2000 }, requests };
}

test("read-only catalog and dry-run preserve all 25 models and perform no upload or generation", async (t) => {
  t.mock.method(console, "log", () => {});
  const { cfg, requests } = await testServer(t);
  const catalog = await fetchVideoCatalog(cfg);
  assert.equal(catalog.models.filter((m) => m.selectable).length, 25);
  const dir = tempDir(t), image = join(dir, "image.png"); writeFileSync(image, png);
  await cmdVideo(cfg, { model: "SD2.5 720P", prompt: "test", image, "dry-run": true, out: dir });
  assert.equal(requests.filter((r) => r.method !== "GET").length, 0);
  assert.equal(existsSync(join(dir, "run.json")), false);
});

test("task creation persists id, resumes through a transient GET error, and downloads url without auth", async (t) => {
  t.mock.method(console, "log", () => {});
  const { cfg, requests } = await testServer(t, { retryRead: true });
  const dir = tempDir(t);
  await cmdVideo(cfg, { model: "SD2.5 720P", prompt: "test", duration: 8, "no-wait": true, out: dir });
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  assert.equal(run.taskId, "task_public");
  assert.equal(run.submissionState, "accepted");
  assert.equal(run.estimatedCost, 7.6);
  await assert.rejects(cmdVideo(cfg, { model: "SD2.5 720P", prompt: "test", out: dir }), /防重复提交/);
  await pollTask(cfg, run.taskId, dir);
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
  assert.equal(requests.find((r) => r.url.startsWith("/movie")).auth, undefined);
  assert.equal(readFileSync(join(dir, "video_k_public.mp4"), "utf8"), "video-test-bytes");
});

test("legacy result URL aliases still download, and failed tasks persist their terminal state", async (t) => {
  t.mock.method(console, "log", () => {});
  for (const resultField of ["video_url", "result_url"]) {
    const { cfg } = await testServer(t, { resultField });
    await pollTask(cfg, "task_public", tempDir(t));
  }
  const { cfg, requests } = await testServer(t, { failed: true });
  const dir = tempDir(t);
  await assert.rejects(pollTask(cfg, "task_public", dir), /NO-RETRY/);
  assert.equal(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")).status, "failed");
  assert.equal(requests.some((r) => r.method === "POST"), false);
});

test("ambiguous POST failures leave a durable guard and cannot cause an automatic second task", async (t) => {
  t.mock.method(console, "log", () => {});
  const { cfg, requests } = await testServer(t, { dropSubmit: true });
  const dir = tempDir(t), args = { model: "SD2.5 720P", prompt: "test", out: dir };
  await assert.rejects(cmdVideo(cfg, args), /禁止盲目重交/);
  assert.equal(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")).submissionState, "unconfirmed");
  await assert.rejects(cmdVideo(cfg, args), /禁止盲目重复提交/);
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
});

test("unrecognized pricing prevents uploads and paid creation", async (t) => {
  t.mock.method(console, "log", () => {});
  const pricing = structuredClone(fixture);
  pricing.data.find((r) => r.model_name === "SD2.5 720P").billing_expr = "new_pricing_function()";
  const { cfg, requests } = await testServer(t, { pricing });
  await assert.rejects(cmdVideo(cfg, { model: "SD2.5 720P", prompt: "test", out: tempDir(t) }), /无法可靠估算/);
  assert.equal(requests.some((r) => r.method === "POST"), false);
});
