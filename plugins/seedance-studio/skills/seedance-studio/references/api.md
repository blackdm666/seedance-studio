# 88API 账户、模型目录与生成 API 速查

来源：88api.ai 官方文档 `/zh/docs/api/video/seedance-2-5`（2026-08 抓取）。

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

余额按 `/api/user/self.data.quota / /api/status.data.quota_per_unit` 换算；`quota` 是当前剩余额度，不再减 `used_quota`。视频模型筛选以“视频模型”分组或视频端点为证据；当前 CLI 只允许 `supported_endpoint_types` 含 `openai-video` 或 `video-generation` 的模型走 `/v1/videos`。状态分层如下：

- `available`：实时目录存在、账户可见、当前 API Key 的 `/v1/models` 可见且端点兼容。
- `unverified_key`：目录和账户可见，但 API Key 未配置或验证失败；不得付费生成。
- `not_in_api_key`：目录和账户可见，但当前 API Key 不可用。
- `unsupported_endpoint`：是视频模型，但当前 CLI 没有对应生成端点适配；只展示，不允许选择。

`billing_mode=per_second` 时，实际单价 = `model_price × 自动分组倍率`，单位取 `/api/status` 的展示币种；提交前记录 `pricing_version` 和获取时间。该可用状态不是上游容量健康保证，临时熔断仍可能发生。

## 视频模型适配器

插件不把所有模型强行套进同一种请求体。流程是：价格目录模型名 → 模型适配器 → 88API提交模型名、创建端点、状态端点和请求参数。没有专用适配器时，只有目录声明 `openai-video` / `video-generation` 才使用统一 `/v1/videos` 请求体。

| 价格目录名称 | 88API提交模型名 | 创建/状态端点 | 关键参数 |
|---|---|---|---|
| `veo-3.1` | `veo-3.1` | `POST /v1/videos` · `GET /v1/videos/{id}` | 固定 `duration:8`；横屏 `size:1920x1080`、竖屏 `1080x1920`；图片最多2张 |
| `veo-3.1-fast` | `veo-3.1-fast` | 同上 | 同上 |
| 目录声明 `openai-video` / `video-generation` 的其它模型 | 目录精确模型名 | `POST /v1/videos` · `GET /v1/videos/{id}` | 按目录实时能力构造 |

当前 MiniMax H3 的 88API 模型名是 `minimax-h3-1440p` 与 `minimax-h3-768p`；旧名 `minimax-h3` 不再作为可选或提交模型。Veo 必须使用 `/api/pricing`、`/api/user/models` 与 `/v1/models` 可见的现网公开名 `veo-3.1` / `veo-3.1-fast`；不得使用未上线的文档名称或渠道内部 `*-generate-preview` 名称。

## 生图模型（关键帧 / 锚定图，gpt-image 家族，2026-08 实测）

| 别名 | 模型 id | 端点/返回 | 输出实测 | 用途 |
|---|---|---|---|---|
| （**默认**）`2`/`image2`/`gpt`/`gpt2` | `gpt-image-2` | `/v1/images/generations`（`--ref` 时 `/v1/images/edits` multipart） / **url PNG** | **稳定 2K 档**：16:9≈2048×1152、2:3=1360×2048、方图 2048² | 默认出图主力，不写 `--model` 即用它；出图稳、**支持 `--ref` 垫图/锁角色/锁产品**；newapi 网关对该模型自带兜底 |
| `4k`/`gpt-image-2-4k`（显式请求） | `gpt-image-2-4k` | `/v1/images/generations` / **url**（Adobe Firefly S3，OpenAI 上游） | **16:9=3840×2160 真 4K UHD**；方图约 2880² | 仅在 `--model 4k`/`gpt-image-2-4k` 显式请求时用（海报级高清）。**88api 侧该渠道时有时无**（断渠道回 `500 … 可用渠道不存在`），**断渠道直接报错、不自动回退** |

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
- `video --identity-image <原照片>`：把原照片作为第一张普通 `reference_image` 直接送入 Seedance；首帧/尾帧仍分别使用 `first_frame` / `last_frame` role，但提示词自动声明它们不能改写身份。
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

## Seedance 2.5 专属能力边界

仅当用户在实时目录中明确选择 Seedance 2.5 时使用本节；其它模型不得套用这些限制或承诺。

- 时长 4–30 秒（`duration` 整数或 `seconds` 字符串，二选一）
- 分辨率：当前实时目录中的 Seedance 2.5 官方模型 ID 为 720p，插件据此提交 `720p`；本节所述 2.5 能力不支持 1080p/4k
- `ratio`: `auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16`（优先级高于 `size`）
- `size`（可选，与 ratio 二选一、ratio 优先）：720P 三档 `1280x720`(横) / `720x1280`(竖) / `720x720`(方)
- `generate_audio` 默认 true；`seed` 整数，-1 随机
- 参考素材两种写法：`images`（图片简写数组）或 `input_reference`（string/string[]，素材 URL 或图片 Data URL）；含视频/音频参考时用多模态 `content[]`：`text` / `image_url`（≤30，**可用 base64 Data URL 传本地图**）/ `video_url`（≤10）/ `audio_url`（≤10）
- **多模态参考合计 ≤50**（30 图 + 10 视频 + 10 音频）；官方建议**按职责组织**参考：人物 / 产品 / 场景 / 风格 / 运镜(参考视频) / 音乐情绪(参考音频)，并在提示词里逐条声明每个素材只负责哪一维
- 视频与音频参考必须公网可直连 HTTP(S)，不能依赖 Cookie 或登录态；图床 403 时换对象存储
- **图生视频（首帧/尾帧）CLI**：`video --first-frame <图> [--last-frame <图>]` → 插件自动走 `content[]` 并给每项打 `role`（`first_frame`/`last_frame`，附带的 `--identity-image` / `--image` 记为 `reference_image`）。用户指定授权真人时必须另加 `--identity-image <原照片>`，不能只提交 AI 首尾帧。**片头精确从首帧画面开始**；ratio 与关键帧匹配。

## Seedance 2.5 原生能力 vs 88api 透传边界（2026-08 三档实测）

官方（ByteDance / 即梦 Dreamina）Seedance 2.5 = 单段最长 **30 秒**、最多 **50 个多模态参考**的音视频模型。以下是**在 88api `/v1/videos` 上逐条实测**的透传结果（不是照抄官方文档）：

| 能力 | 请求写法 | 88api 实测 |
|---|---|---|
| 中文台词→普通话配音 | `{台词}` + `generate_audio:true` | ✅ 生效 |
| 多语言配音（英文等） | `{英语:…}` | ✅ 生效（标准发音） |
| 声音语法 `()<>{}【】` | 写进提示词 | ✅ 接受并出声 |
| 分辨率 480p | `resolution:480p` | ✅ 上游生效（854×480）；但插件统一 720p 交付、不暴露此档 |
| 首帧图 | `content[].role:first_frame` | ✅ 生效 |
| 首尾帧 | `first_frame`+`last_frame` | ✅ 生效（片头随首帧、片尾随尾帧） |
| 视频参考（迁运镜） | `content[].role:reference_video` | ✅ 出片 |
| 音频参考（卡节奏） | `content[].role:reference_audio` | ✅ 出片 |
| 视频编辑 | `omni_reference_task_type:edit` | 🟡 可用但**约 50% 成功率，需容错重试** |
| 视频延长 | `omni_reference_task_type:extend` | 🟡 可用（输出变长）**约 50% 成功率，需重试** |
| **对口型（嘴型同步）** | — | ❌ **不支持**：原生台词只是配音/画外音，人物嘴不动 |
| **mov 高保真输出** | `output_format:mov` | ❌ **被忽略**：统一回吐标准 mp4（isom/yuv420p） |
| **水印开关** | `watermark:true` | ❌ **被忽略**：成片无水印 |

**硬约束（插件已在 `buildVideoPayload` 前置校验）**：带**视频或音频参考时，必须同时提供至少 1 张图片参考**，否则上游 400 `video/audio reference requires at least one image reference`。即**无纯视频参考、无纯音频参考**——这是相对官方的一处缩水。

**降级到即梦网页**（88api 不提供）：对口型、区域级局部编辑、白模控制、绿幕、4K、mov 高保真、强制水印——需要时产出可粘贴到即梦网页的提示词作降级。

> 仅在选择 Seedance 2.5 时：≤30 秒优先单段直出，>30 秒才拆段拼接。其它模型必须使用实时目录中的单段上限。
> edit/extend 若首次 `generation_failed`，**换新子目录重试最多 2 次**（失败自动退款）——这是上游不稳，不是提示词问题。

## 任务生命周期

`queued → in_progress → completed | failed`。完成后从 `video_url` 下载（**有有效期，立即下载**），`usage.seconds` 为计费秒数。

- 轮询间隔 10–15 秒；客户端总超时 ≥20 分钟
- Agent交互先用 `video --no-wait` 获取任务ID，立即告诉用户“任务已提交，正在监控，请耐心等待”，再调用 `status --wait`。状态未变化时CLI每约24秒输出一次监控心跳，不能让用户误以为卡死。
- queued/in_progress 期间**不要重复提交**——会创建多个计费任务
- 只有确认 POST 未到达服务器时才允许重试提交

### 参考图提交审计

用户提供或刚生成了产品图、关键帧、锚定图时，视频命令必须同时传 `--image <绝对路径> --require-image`。付费前先 `--dry-run`，确认 `[REFERENCE-AUDIT].imageCount >= 1`。若提示词包含 `@图片`、“参考图”或“保持产品/人物一致”，但请求里没有图片，CLI会在提交前报错，不产生费用。`run.json`会保存 `referenceAudit`，便于事后确认实际提交数量和来源。

## 常见错误对照

| 现象 | 处理 |
|---|---|
| 401 | Key 缺失/错误/失效，让用户重新 `--set-key` |
| model_not_found | 模型名不对，或 Key 分组无视频模型权限（需 auto 分组或含视频分组） |
| content moderated (nsfw) | 内容审核未通过：调整提示词/参考素材后重交 |
| 参考素材 403 | 素材 URL 服务器无法直连：换图床/对象存储，图片改 Data URL |
| no active tokens available / 任务超时 / turnstile_required | **88api 上游（即梦）令牌池暂时耗尽或触发人机验证——非本插件问题**。失败任务自动退款；生图接口通常仍可用（可先做设定图）。稍后用**新子目录**重试，切勿短时间连刷（每次失败虽退款，但会加剧上游拥塞） |
| 进度长时间不动 | 上游分阶段更新，保持 10–15 秒轮询等最终状态 |

## 官方提示词建议

按"主体 → 动作 → 场景 → 镜头 → 光线 → 风格 → 音效"排列；复杂片直接写带时间段的分镜（`0–2秒：… 2–6秒：…`）。多参考图必须在提示词中说明每张图负责外观/场景/构图/风格中的哪一项。
