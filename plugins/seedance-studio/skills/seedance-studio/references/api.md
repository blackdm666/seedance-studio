# 88API 账户、模型目录与生成 API 速查

来源：[88API 视频 API 完整调用规范](https://88api.ai/zh/docs/api/video/video-api-standard/)（2026-09-17 核对，含 2026-09-15 任务迁移说明）及当日鉴权模型目录。服务端的任务插件由 NewAPI 管理；客户端仍使用公开 `/v1/videos`，不要直接调用内部插件端点或上游模型。

## 基本信息

| 项目 | 值 |
|---|---|
| Base URL | `https://88api.ai` |
| 视频模型名 | 不硬编码；从已鉴权的 `GET /api/pricing` 实时读取，用户明确选择后保存精确模型 ID |
| 提交任务 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{id}` |
| 生图 | `POST /v1/images/generations`（gpt 文生图）· `POST /v1/images/edits`（gpt 参考图/垫图，multipart） |
| 鉴权 | `Authorization: Bearer sk-xxxx` |

## 双凭据与只读账户接口

API Key 与个人访问令牌不得混用：

| 凭据 | 创建位置 | 用途 |
|---|---|---|
| API Key | 88API“API 密钥”，建议 `auto` 分组 | `/v1/models` 与 `/v1/*` 生成调用 |
| 个人访问令牌 | “个人资料 → 安全” | `/api/*` 账户、目录、价格与状态查询 |

访问令牌请求使用 `Authorization: Bearer <access-token>`；`New-Api-User` 可选，插件先调用 `/api/user/self` 自动识别用户 ID。推荐用户在受信任的 Codex 私人任务中把令牌直接交给 Agent，由 Agent 执行 `--set-access-token`、保存到权限受限的 `config.json` 并脱敏验证；验证通过后不得要求用户撤销或重新创建。用户不愿通过聊天提供时，Windows 可用 `--configure-access-token` 隐藏输入并保存到 `SEEDANCE_STUDIO_ACCESS_TOKEN` 用户环境变量；插件也兼容既有的 `RELAY_88API_ACCESS_TOKEN`。生产环境已验证 `/api/pricing` 需要访问令牌，不能依赖匿名访问；`/api/ratio_config` 当前未启用。

### 强制预检与Key复用

Agent在声称凭据缺失前必须运行：

```powershell
node studio.mjs preflight --scope image --json
node studio.mjs preflight --scope video --json
```

API Key读取优先级：`SEEDANCE_STUDIO_API_KEY` → `~/.seedance-studio/config.json` → `~/.codex/88api-image-gen-config.json` → `~/.codex/88api-nano-banana-config.json`。预检只输出来源、脱敏值和有效性。图片任务只需要API Key；个人访问令牌仅用于账户、价格和视频目录查询。

| 接口 | 用途 | 关键字段 |
|---|---|---|
| `GET /api/status` | 计价单位与配额换算 | `quota_per_unit`、`quota_display_type` |
| `GET /api/user/self` | 余额与账户状态 | `quota`、`used_quota`、`group`、`status` |
| `GET /api/pricing` | 实时模型、价格、能力、分组、端点 | `data[]`、`group_ratio`、`auto_groups`、`supported_endpoint`、`pricing_version` |
| `GET /api/user/models` | 当前账户可见模型 | `data[]` 精确模型 ID |
| `GET /v1/models` | 当前 API Key 可调用模型 | `data[].id` |

余额按 `/api/user/self.data.quota / /api/status.data.quota_per_unit` 换算；`quota` 是当前剩余额度，不再减 `used_quota`。视频模型筛选以“视频模型”分组或视频端点为证据；已核实的模型使用对应适配器；未知模型只有声明视频端点，或同时属于“视频模型”分组且提供 `billing_usage_schema.seconds.unit=second`，才适配统一任务协议。任务插件模型的旧端点标签可能只有 `openai`，不得据此误判不兼容；普通聊天模型也不能只因 `openai` 被当成视频模型。状态分层如下：

- `available`：实时目录存在、账户可见、当前 API Key 的 `/v1/models` 可见且端点兼容。
- `unverified_key`：目录和账户可见，但 API Key 未配置或验证失败；不得付费生成。
- `not_in_api_key`：目录和账户可见，但当前 API Key 不可用。
- `unsupported_endpoint`：是视频模型，但当前 CLI 没有对应生成端点适配；只展示，不允许选择。

`billing_mode=tiered_expr` 时读取完整 `billing_expr`，识别 `tier("base", u("seconds") * 单价)` 及按 `resolution` 分支的单价，估算为 **秒数 × 表达式单价 × 账户目录返回的分组倍率**。保留表达式、价格版本、获取时间和所选档位；未知表达式显示“无法估算”并阻止付费提交，绝不能回退到 `model_ratio` 的 Token 价格或把未知价格当作零。旧 `per_second` / `billing_unit=second` 与按次计费仍兼容。估算不等于最终账单；以服务端实际结算为准。

## 统一视频任务与模型差异

- 创建 `POST /v1/videos`，优先保存返回的公开 `id`，轮询 `GET /v1/videos/{id}`；旧 `task_id` 只作为兼容回退。
- 公共载荷：`model` 为目录中的精确名称、`prompt`、整数 `duration`、`size`。CLI 的 `--ratio` 映射到 `size`，不再发送顶层 `ratio` 或旧多模态 `content[]`。
- 普通图片使用顶层 `images`；SD、Seedance、Wan、Kling、H3 的视频/音频参考使用 `metadata.referenceVideos` / `metadata.referenceAudios`。
- 首尾帧使用 `metadata.firstFrame` / `metadata.lastFrame`；尾帧不能单独提交。SD2.0/2.5、Seedance 官方版和部分 Wan 档位首尾帧与普通参考素材互斥，CLI 提前拦截，不能静默丢素材。
- SD2.0 三档的图片/视频/音频参考合计最多 12 个。模型更严格的实时目录上限优先，不能把别的模型上限套入。
- 分辨率由精确销售型号锁定，如 `SD2.5 1080P`、`wan3.0-video-1080p`；不通过顶层 `resolution` 覆盖。
- `--audio` / `--no-audio` 只用于 SD2.5、Kling 或 Veo 等明确允许音频开关的型号；“生成结果带音轨”不代表支持切换开关。
- 新插件任务不发送 `callback_url`，统一轮询。创建请求不自动重试；发出请求前先保存提交记录，即使网络断开也防止重复计费。

| 模型族 | 特殊规则 |
|---|---|
| Veo 3.1 / Fast | 4/6/8 秒；`--resolution 720p|1080p`，默认为 1080p；`size` 为像素尺寸。`--image` 默认 `metadata.video_mode=reference`，最多 3 张且固定 8 秒；`--first-frame` / `--last-frame` 使用 `frames`，最多 2 张。也可显式 `--video-mode frames`；不接受视频/音频参考。显式图片输入必须为 PNG/JPEG Base64，每张 ≤20 MiB，CLI 自动处理。本型号最终开放能力以上游实际返回为准。 |
| Grok 视频 | 最多 1 张首图；`--first-frame` 转成 `images`；无尾帧/视频/音频参考。普通型号可通过 `--resolution 480p|720p` 设置 `metadata.resolution`，1080p 销售型号不可覆盖。支持 3:2、2:3 在内的七种比例。 |
| Gemini Omni | 视频参考必须放顶层 `video`，最多 1 个；无参考音频和首尾帧。视频 MP4/MOV ≤10 秒、≤64 MiB；图片最多 10 张。时长 3–10 秒，无已核实默认值时明确指定。 |
| MiniMax H3 | 只使用实时公开模型名。不同服务路径能力可能不同，目录上限不代表所有上游保证；音频参考须同时搭配视觉素材。 |

### 本地图片与公网素材

非 Veo 模型的 `--image`、`--identity-image`、`--first-frame` 和 `--last-frame` 支持本地图片。CLI 在正式生成前用 `/v1/media/uploads` 申请凭证（真实字节数、MIME、SHA-256 Base64URL），再用短期凭证 PUT 到 `assets.88api.ai`，最终只把 HTTPS URL 放进生成请求。上传地址不接收 API Key；`--dry-run` 只列本地路径占位，不上传、不生成。Veo 图片转换为 Base64，远程图片会先匿名下载。

视频/音频参考目前仍由 `--video-url` / `--audio-url` 接收匿名可下载的公网 HTTPS 直链；不能传本地路径、HTTP 或 Data URL。素材格式、时长和文件大小还要符合所选模型限制，成功上传不能增加模型能力。上传素材及站内归档结果通常保存 30 天，官方结果地址按来源有效期处理。

## 生图模型（关键帧 / 锚定图，gpt-image 家族）

Image2 行保留 2026-08 实测记录；两个 Image 2.5 模型 ID 和 Images API 端点于 2026-09-10 从 88API 实时目录核实。2.5 沿用插件 2K 预设，不代表上游分辨率上限，尚未做付费出图实测。

| 别名 | 模型 id | 端点/返回 | 输出预设或既有实测 | 用途 |
|---|---|---|---|---|
| （**默认**）`2`/`image2`/`gpt`/`gpt2` | `gpt-image-2` | `/v1/images/generations`（`--ref` 时 `/v1/images/edits` multipart） / **url PNG** | **稳定 2K 档**：16:9≈2048×1152、2:3=1360×2048、方图 2048² | 默认出图主力，不写 `--model` 即用它；出图稳、**支持 `--ref` 垫图/锁角色/锁产品**；newapi 网关对该模型自带兜底 |
| `4k`/`gpt-image-2-4k`（显式请求） | `gpt-image-2-4k` | `/v1/images/generations` / **url**（Adobe Firefly S3，OpenAI 上游） | **16:9=3840×2160 真 4K UHD**；方图约 2880² | 仅在 `--model 4k`/`gpt-image-2-4k` 显式请求时用（海报级高清）。**88api 侧该渠道时有时无**（断渠道回 `500 … 可用渠道不存在`），**断渠道直接报错、不自动回退** |
| 精确 ID | `gpt-image-2.5-flare` | `/v1/images/generations` / `/v1/images/edits` | 插件 2K 预设 | 显式选择 Image 2.5 Flare |
| 精确 ID | `gpt-image-2.5-sunburst` | `/v1/images/generations` / `/v1/images/edits` | 插件 2K 预设 | 显式选择 Image 2.5 Sunburst |

- 命令：`node studio.mjs image --prompt "..." [--prompt "..." ...] [--aspect 16:9] [--n 1-4] [--concurrency 1-10] [--model gpt-image-2-4k] [--identity-ref 授权真人原照片] [--ref 场景/产品参考图 ...]`
- **批量并发出图**：可重复 `--prompt` 出多张不同图，或 `--n` 每个提示词出几张；**总量 = 提示词数 × n**，交给并发池并行跑（`--concurrency` 默认 3、上限 10）。**并发结构抄自 `88api-image-gen`**（`MAX_CONCURRENCY=10`、默认 `concurrency=3`）：`N` 个 dispatcher 从共享游标拉任务，`Promise.all(Array.from({length:N}, dispatcher))`，跑完一个立刻拉下一个；单 key 场景已裁掉参考插件的多 worker/粘性分组。**每张都是独立单图请求**（不用服务端 `n` 批量），各自独立请求与重试（瞬时抖动同模型快速重试 1 次），单张失败/存盘异常不炸整批；输出文件名 `keyframe_<批次时间戳>_<槽位序号>.png`。默认并发保守（3），是为了别把单 key 的上游打到熔断（429/circuit breaker）；批量越大越要留意上游容量。
- **默认 `gpt-image-2`**（不写 `--model` 即用它，稳定 2K）。**插件不再自建兜底链**——newapi 网关对 `gpt-image-2` 已自带兜底。要海报级更高清再显式 `--model gpt-image-2-4k`（16:9 真 4K UHD 3840×2160）；但该 4K 渠道在 88api 侧时有时无、断渠道会直接报 `500 … 可用渠道不存在`，**不自动回退**（交用户决定重试或降级回默认 2K）。
- **两档都走 Images API**（`/v1/images/*`，OpenAI 协议，别再混 chat 端点）：文生图 `POST /v1/images/generations`；带 `--ref` 的垫图/改图 `POST /v1/images/edits`（multipart，字段 `image[]` 可多次）。返回解析兼容 `b64_json`/`base64`/`image.b64_json`/`url`。
- **上游熔断/容量类报错**（`circuit breaker` / `temporarily suspended` / `no active tokens` / `可用渠道不存在`）是 88api 上游容量/渠道问题，**非 Key/提示词/模型名问题**，失败调用不产图不计费；默认 `gpt-image-2` 由 newapi 网关侧兜底，插件只对**瞬时抖动同模型重试 1 次**；若显式用 `gpt-image-2-4k` 撞上断渠道则**直接报错**（稍后重试、或降级回默认 2K），也可前往 https://88api.ai 后台联系客服。
- **生图错误按类型分流**（`classifyImgError`，判定口径同参考插件）：① **确定性错误**（401/无权限、内容审核/nsfw、`model_not_found`/端点不匹配、400 参数）→ **立即停并对症诊断**，换模型/重试都无用；② **熔断/容量/断渠道** → 报错并提示（默认 image2 由网关兜底；4K 断渠道交用户决定重试/降级）；③ **瞬时抖动**（fetch failed / timeout / socket hang up / 502/504）→ **同模型快速重试 1 次**，再不行报错。
- **不满意画面内容或参考还原度**：手动 `--ref <首图>` 垫图重出（锁角色/产品一致性），或 `--model gpt-image-2-4k` 换更高清档重试——每次成功后 CLI 也会提示这一点。
- **参考图生图（img2img / 垫图）**：任意个 `--ref <本地图>` → `POST /v1/images/edits`（multipart，字段 `image[]` 可多次）。实测：喂一张产品/角色图 + 提示词，能保留主体形态换场景/换光——**功能三保「产品外观/人物身份一致」的首选**（`gpt-image-2` 实测 2MB PNG 垫图稳定）。
- 尺寸：`gpt-image-2-4k` 用 4K 像素尺寸表（16:9→**3840×2160**、4:3→3264×2448、3:4→2448×3264、1:1→2880²，均 ≤ 后端最长边上限 3840）；`gpt-image-2` 用 2K 像素尺寸表（16:9≈2048×1152、2:3=1360×2048、1:1=2048²）。**尺寸表 = `88api-image-gen` 的 `SIZE_MATRIX`（2K/4K 逐档一致，4K 不是把 2K 翻倍——翻倍会超 3840 最长边被上游拒）**；提示词尾部追加"画幅约束"后缀（`请严格按照 W:H … 画幅生成…`）压稳比例；参考图走 multipart `image[]`。
- 计费按 token（`usage.output_tokens` 的 image_tokens）——**批量出锚定图前先 1 张试方向**。

### 授权真人身份直传

- `image --identity-ref <原照片>`：把原照片固定为第一张参考并自动注入身份唯一基准；普通 `--ref` 只能控制场景、服装、构图或产品。每张含脸关键帧都必须再次传同一原照片，禁止 AI 图套 AI 图替代身份。
- `video --identity-image <原照片>`：把原照片固定为顶层 `images` 第一张，提示词声明身份唯一权威。模型要求首尾帧与普通素材互斥时，应保留原身份图并改用普通参考模式，不能混用或丢弃身份图。
- 两个参数都只接受一个身份权威，并阻止与普通 `--ref` / `--image` 重复提交同一文件。
- `video --dry-run` 输出 `[IDENTITY-AUDIT]`；真实提交的 `run.json` 记录 `identityAudit.mode="authorized-direct"` 和来源路径，便于确认原图没有在关键帧阶段被丢弃。
- 这些参数只用于用户有权使用、并明确指定的人物照片；参考视频中的演员不属于此分支。

## 音频拆解（反推功能⑦：无专用 STT → 走 Gemini 多模态，2026-08 实测）

反推要读台词/BGM/音效，但 **88api 当前没有可用的专用 STT 转写渠道**：`POST /v1/audio/transcriptions` 端点在、但 `whisper-1` / `whisper-large-v3` / `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` / `sensevoice-v1` / `qwen3-asr-flash` 实测全回 `503 model_not_found · No available channel … under group auto`；`gemini-3.1-tts` 拿去转写回 `Vertex AI only supports audio speech requests`（只能合成）。`/v1/models` 里唯一音频相关就是 `gemini-3.1-tts`（TTS）。

**可用路径 = Gemini 多模态**（`POST /v1/chat/completions`，`content[]` 放 `input_audio`）：插件默认 `gemini-3.7-flash`。一次拆出台词转写、BGM 风格描述和音效时间轴。

```jsonc
{ "model": "gemini-3.7-flash", "messages": [{ "role": "user", "content": [
  { "type": "text",        "text": "转写台词并描述BGM与音效…" },
  { "type": "input_audio", "input_audio": { "data": "<base64>", "format": "mp3" } } ] }] }
```

- CLI：`audio --video <片> [--audio 文件] [--start/--end 秒] [--model gemini-3.7-flash] [--separate]`（`--separate` 走本地 Demucs 分人声/伴奏供人耳核对，缺依赖自动降级）。
- **局限**：时间戳是**模型估算、非帧级精准**；要词级精准需等 88api 挂上 whisper 渠道（届时 `--model whisper-1` 可改走 `/v1/audio/transcriptions`）。
- **合规**：BGM 只描述、不逐字转录歌词、不提取原曲（版权）；转写仅用于反推分析。

## Seedance 2.5 能力说明

Seedance 官方版和 SD2.5 销售型号都要按当前目录及上方标准协议提交。单段最长 30 秒，分辨率由具体型号决定；只有 SD2.5 明确支持音频开关。旧 `content[].role`、`omni_reference_task_type`、“视频参考必须搭配图片”等 2026-08 记录不是当前插件任务的请求契约。Ark 原生文档仅用于理解能力，不可直接作为 88API 请求体，也不能凭历史试验承诺 edit/extend 或失败退款。

## 任务生命周期

`queued → in_progress → completed | failed`。完成后优先从 `url` 下载，兼容 `video_url` / `result_url`，完整保留返回的路径和查询参数，不拼接内容地址。媒体下载不携带 API Key。先保存 `result.json` 再下载，下载失败可续查原任务。若返回 `usage.seconds`，记录该用量；未返回时不得把估算冒充实际用量。

- 轮询间隔 10–15 秒；客户端总超时 ≥20 分钟
- Agent交互先用 `video --no-wait` 获取任务ID，立即告诉用户“任务已提交，正在监控，请耐心等待”，再调用 `status --wait`。状态未变化时CLI每约24秒输出一次监控心跳，不能让用户误以为卡死。
- queued/in_progress 期间**不要重复提交**——会创建多个计费任务
- 瞬时网络错误、429、5xx 只重试 GET 查询；未知提交结果保留 `run.json`，核对站点任务记录后处理，禁止自动创建第二个任务。

### 参考图提交审计

用户提供或刚生成了产品图、关键帧、锚定图时，视频命令必须同时传 `--image <绝对路径> --require-image`。付费前先 `--dry-run`，确认 `[REFERENCE-AUDIT].imageCount >= 1`。若提示词包含 `@图片`、“参考图”或“保持产品/人物一致”，但请求里没有图片，CLI会在提交前报错，不产生费用。`run.json`会保存 `referenceAudit`，便于事后确认实际提交数量和来源。

## 常见错误对照

| 现象 | 处理 |
|---|---|
| 401 | Key 缺失/错误/失效，让用户重新 `--set-key` |
| model_not_found | 模型名不对，或 Key 分组无视频模型权限（需 auto 分组或含视频分组） |
| content moderated (nsfw) | 内容审核未通过：调整提示词/参考素材后重交 |
| 参考素材 403 | 素材 URL 服务器无法直连：换可匿名下载的 HTTPS 地址；本地图片由 CLI 上传，Veo 按专用 Base64 模式处理 |
| no active tokens available / 任务超时 / turnstile_required | **88api 上游（即梦）令牌池暂时耗尽或触发人机验证——非本插件问题**。失败任务自动退款；生图接口通常仍可用（可先做设定图）。稍后用**新子目录**重试，切勿短时间连刷（每次失败虽退款，但会加剧上游拥塞） |
| 进度长时间不动 | 上游分阶段更新，保持 10–15 秒轮询等最终状态 |

## 官方提示词建议

按"主体 → 动作 → 场景 → 镜头 → 光线 → 风格 → 音效"排列；复杂片直接写带时间段的分镜（`0–2秒：… 2–6秒：…`）。多参考图必须在提示词中说明每张图负责外观/场景/构图/风格中的哪一项。
