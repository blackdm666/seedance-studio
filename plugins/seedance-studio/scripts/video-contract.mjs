// Public 88API contract, verified 2026-09-17:
// https://88api.ai/zh/docs/api/video/video-api-standard/
// These are public sales IDs, never the gateway's internal plugin/upstream IDs.
export const DEFAULT_VIDEO_ADAPTER = Object.freeze({
  name: "88api-video-tasks",
  createEndpoint: "/v1/videos",
  statusEndpoint: "/v1/videos/{id}",
  payloadKind: "unified",
});

const COMMON_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const GROK_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"];
const adapters = {};
function add(id, payloadKind, capabilities) {
  adapters[id] = Object.freeze({ ...DEFAULT_VIDEO_ADAPTER, name: "88api-" + payloadKind,
    apiModelId: id, payloadKind, capabilities: Object.freeze(capabilities) });
}
const multi = {
  textToVideo: true, imageReference: true, videoReference: true, audioReference: true,
  firstLastFrame: true, minDuration: 4, maxDuration: 15, defaultDuration: 5,
  ratios: COMMON_RATIOS, maxImages: 9, maxVideos: 3, maxAudios: 3,
  audioControl: false, framesExclusive: false,
};
for (const resolution of ["480p", "720p", "1080p"]) {
  add("SD2.0 " + resolution.toUpperCase(), "unified", { ...multi, resolution,
    framesExclusive: true, maxTotalMedia: 12, generatedAudio: true });
  add("SD2.5 " + resolution.toUpperCase(), "unified", { ...multi, resolution,
    maxDuration: 30, maxImages: 30, maxVideos: 10, maxAudios: 10,
    ratios: ["auto", ...COMMON_RATIOS], framesExclusive: true, audioControl: true, generatedAudio: true });
  add("wan3.0-video-" + resolution, "unified", { ...multi, resolution,
    maxDuration: 30, ratios: COMMON_RATIOS.filter((r) => r !== "21:9"),
    maxImages: resolution === "480p" ? 30 : 10,
    maxVideos: resolution === "480p" ? 10 : 5, maxAudios: resolution === "480p" ? 10 : 5,
    framesExclusive: resolution !== "480p" });
}
for (const id of ["Seedance-2.5-720p官方版", "Seedance-2.0-720p官方版", "Seedance-2.0-fast-720p官方版"]) {
  const is25 = id.includes("2.5");
  add(id, "unified", { ...multi, resolution: "720p", defaultDuration: 4,
    maxDuration: is25 ? 30 : 15, maxImages: is25 ? 30 : 9,
    maxVideos: is25 ? 10 : 3, maxAudios: is25 ? 10 : 3, framesExclusive: true });
}
for (const resolution of ["480p", "720p"]) {
  add("seedance-2.0-mini-" + resolution, "unified", { ...multi, resolution, firstLastFrame: false });
}
for (const resolution of ["720p", "1080p", "2k", "4k"]) {
  add("kling-3.0-turbo-" + resolution, "unified", { ...multi, resolution,
    ratios: ["16:9", "9:16", "1:1"], maxImages: 30, maxVideos: 10, maxAudios: 0,
    audioReference: false, audioControl: true, generatedAudio: true, framesCountAsImages: true });
}
// H3 has multiple service paths. The live catalog supplies its reference limits;
// these must not be inferred from one upstream plugin's limits.
add("minimax-h3-768p", "unified", { resolution: "768p", audioControl: false, audioRequiresVisual: true });
for (const id of ["veo-3.1", "veo-3.1-fast"]) {
  add(id, "veo", { textToVideo: true, imageReference: true, videoReference: false, audioReference: false,
    firstLastFrame: true, generatedAudio: true, audioControl: true,
    resolution: "1080p", resolutions: ["720p", "1080p"], minDuration: 4, maxDuration: 8,
    durations: [4, 6, 8], defaultDuration: 8, ratios: ["16:9", "9:16"],
    maxImages: 3, maxVideos: 0, maxAudios: 0, framesExclusive: true });
}
for (const id of ["grok-imagine-video", "grok-imagine-video-1.5", "grok-imagine-video-1.5-1080p"]) {
  const fixed = id.endsWith("-1080p");
  add(id, "grok", { textToVideo: true, imageReference: true, videoReference: false, audioReference: false,
    firstLastFrame: false, firstFrameOnly: true, generatedAudio: true, audioControl: false,
    resolution: fixed ? "1080p" : "720p", resolutions: fixed ? ["1080p"] : ["480p", "720p"],
    minDuration: 1, maxDuration: 15, defaultDuration: 8, ratios: GROK_RATIOS,
    maxImages: 1, maxVideos: 0, maxAudios: 0 });
}
add("gemini-omni-flash", "omni", { textToVideo: true, imageReference: true, videoReference: true,
  audioReference: false, firstLastFrame: false, audioControl: false, resolution: "720p",
  minDuration: 3, maxDuration: 10, ratios: ["16:9", "9:16"], maxImages: 10, maxVideos: 1, maxAudios: 0 });
export const VIDEO_MODEL_ADAPTERS = Object.freeze(adapters);

export function mergeVideoCapabilities(inferred, documented = {}) {
  const merged = { ...inferred, ...documented };
  // A current catalog can tighten a published limit. Never expand that limit.
  for (const key of ["maxDuration", "maxImages", "maxVideos", "maxAudios", "maxTotalMedia"]) {
    if (inferred[key] != null) merged[key] = documented[key] == null ? inferred[key] : Math.min(inferred[key], documented[key]);
  }
  if (inferred.minDuration != null) merged.minDuration = Math.max(inferred.minDuration, documented.minDuration ?? 0);
  if (inferred.defaultDuration != null) merged.defaultDuration = inferred.defaultDuration;
  for (const key of ["imageReference", "videoReference", "audioReference", "firstLastFrame"]) {
    if (inferred[key] === false) merged[key] = false;
  }
  if (inferred.framesExclusive) merged.framesExclusive = true;
  return merged;
}

// Recognize complete, documented price expressions, not arbitrary executable JS.
// Unknown expressions remain unknown; never fall back to a stale model_ratio.
export function parseVideoPriceExpression(expression) {
  const number = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const rate = new RegExp('^tier\\(\\s*"([^"\\\\]+)"\\s*,\\s*u\\(\\s*"seconds"\\s*\\)\\s*\\*\\s*(' + number + ')\\s*\\)$');
  const source = String(expression || "").trim();
  const simple = source.match(rate);
  if (simple) return { rates: [{ tier: simple[1], base: Number(simple[2]) }] };
  const conditional = source.match(/^u\(\s*"resolution"\s*\)\s*==\s*"([^"\\]+)"\s*\?\s*(.+)\s*:\s*(.+)$/);
  if (!conditional) return null;
  const yes = conditional[2].trim().match(rate), no = conditional[3].trim().match(rate);
  if (!yes || !no) return null;
  return { rates: [
    { tier: yes[1], resolution: conditional[1], base: Number(yes[2]) },
    { tier: no[1], default: true, base: Number(no[2]) },
  ] };
}

export function priceForVideoRequest(price, resolution) {
  if (!price.rates) return price;
  const selected = price.rates.find((r) => r.resolution === resolution) || price.rates.find((r) => r.default) || (price.rates.length === 1 ? price.rates[0] : null);
  if (!selected || !Number.isFinite(selected.base)) return { ...price, effective: null };
  return { ...price, tier: selected.tier, base: selected.base, effective: selected.base * price.multiplier };
}

export function estimateVideoCost(price, duration) {
  if (price.effective == null || !Number.isFinite(price.effective)) return null;
  if (price.unit === "second") return price.effective * duration;
  if (price.unit === "request") return price.effective;
  return null;
}
