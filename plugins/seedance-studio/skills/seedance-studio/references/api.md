# 88api Seedance 2.5 API 速查

来源：88api.ai 官方文档 `/zh/docs/api/video/seedance-2-5`（2026-08 抓取）。

## 基本信息

| 项目 | 值 |
|---|---|
| Base URL | `https://88api.ai` |
| 视频模型名 | `seedance2.5满血版`（必须精确匹配） |
| 提交任务 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{id}` |
| 生图 | `POST /v1/images/generations`（gpt/grok 文生图）· `POST /v1/images/edits`（gpt/grok 参考图，multipart）· `POST /v1/chat/completions`（**gemini 生图走这里**，多模态，图片以 data URL 内嵌在回复里） |
| 鉴权 | `Authorization: Bearer sk-xxxx` |

## 生图模型（关键帧 / 锚定图，2026-08 实测）

| 别名 | 模型 id | 端点/返回 | 输出实测 | 用途 |
|---|---|---|---|---|
| （**默认**） | `gpt-image-2-4k` | `/v1/images/generations` / **url**（Adobe Firefly S3，OpenAI 上游） | **16:9=3840×2160 真 4K UHD**；方图约 2880² | 高清主图 / 海报 / 产品图 / 锚定图（默认档） |
| `gemini`（pro） | `gemini-3-pro-image` | **`/v1/chat/completions`** 多模态 / 图片以 `data:image/png;base64` 内嵌在 `message.content` | 约 **2048² 原生**（16:9≈1376×768，忽略 size） | 参考图一致性最强；垫图 / 锁角色 / 锁产品；**默认档失败时首选兜底 & 不满意时手动切它** |
| `grok` | `grok-imagine-image-quality` | `/v1/images/generations` / url（xAI 上游） | 约 2048² | 又一路**不同上游**的兜底（OpenAI/Google 都挂时的末位保险） |

- 命令：`node studio.mjs image --prompt "..." [--aspect 16:9] [--n 1-4] [--model 4k|gemini|grok] [--ref 参考图 ...] [--no-fallback]`
- **默认 `gpt-image-2-4k`**（不写 `--model` 即用它，16:9 出真 4K UHD）。**跨上游自动兜底链**：默认档失败（如上游 `503 circuit breaker` / `429 no active tokens`）→ 切 **`gemini-3-pro-image`**（Google，chat 端点）→ 再切 **`grok-imagine-image-quality`**（xAI）依次重试；`--no-fallback` 可关闭。故意选**不同上游**，避免同一 OpenAI 通道熔断时兜底也一起挂。
- **端点分流是硬约束**：`gpt-image-*` / `grok-imagine-*` 走 `/v1/images/*`；**`gemini-*-image` 必须走 `/v1/chat/completions`**（`modalities:["text","image"]`）——直接把 gemini 丢到 `/v1/images/generations` 会被上游拒：`500 not supported model for image generation, only imagen models are supported`（Google 侧报错透传）。插件已按模型名自动分流。
- **上游熔断/容量类报错**（`circuit breaker` / `temporarily suspended` / `no active tokens` / `可用渠道不存在`）是 88api 上游容量问题，**非 Key/提示词/模型名问题**，失败调用不产图不计费；CLI 会解析并提示"约 N 秒后自动恢复"，稍后重试即可，别刷。
- **不满意画面内容或参考还原度**：手动 `--model gemini` 用 pro 模型重试（一致性更强）——每次成功后 CLI 也会提示这一点。
- **参考图生图（img2img / 垫图）**：任意个 `--ref <本地图>`。gpt/grok → `POST /v1/images/edits`（multipart，字段 `image` 可多次）；gemini → chat 多模态（`image_url` data URL 随 `text` 一起发）。实测：喂一张产品/角色图 + 提示词，能保留主体形态换场景/换光——**功能三保「产品外观/人物身份一致」的首选，一致性以 `gemini-3-pro-image` 最强**。
- 尺寸：`gpt-image-2-4k` 用 4K 尺寸表（16:9→4096×2304 请求、实出 3840×2160）；`gemini` / `grok` 忽略/近似 size、按原生比例出图。
- 计费按 token（`usage.output_tokens` 的 image_tokens）——**批量出锚定图前先 1 张试方向**。

## 视频能力边界

- 时长 4–30 秒（`duration` 整数或 `seconds` 字符串，二选一）
- 分辨率 `resolution`: `480p` / `720p`（**两档实测均生效**；480p 输出 854×480，720p 输出 1280×720；不支持 1080p/4k）
- `ratio`: `auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16`（优先级高于 `size`）
- `size`（可选，与 ratio 二选一、ratio 优先）：720P 三档 `1280x720`(横) / `720x1280`(竖) / `720x720`(方)
- `generate_audio` 默认 true；`seed` 整数，-1 随机
- 参考素材两种写法：`images`（图片简写数组）或 `input_reference`（string/string[]，素材 URL 或图片 Data URL）；含视频/音频参考时用多模态 `content[]`：`text` / `image_url`（≤30，**可用 base64 Data URL 传本地图**）/ `video_url`（≤10）/ `audio_url`（≤10）
- **多模态参考合计 ≤50**（30 图 + 10 视频 + 10 音频）；官方建议**按职责组织**参考：人物 / 产品 / 场景 / 风格 / 运镜(参考视频) / 音乐情绪(参考音频)，并在提示词里逐条声明每个素材只负责哪一维
- 视频与音频参考必须公网可直连 HTTP(S)，不能依赖 Cookie 或登录态；图床 403 时换对象存储

## Seedance 2.5 原生能力 vs 88api 透传边界（2026-08 三档实测）

官方（ByteDance / 即梦 Dreamina）Seedance 2.5 = 单段最长 **30 秒**、最多 **50 个多模态参考**的音视频模型。以下是**在 88api `/v1/videos` 上逐条实测**的透传结果（不是照抄官方文档）：

| 能力 | 请求写法 | 88api 实测 |
|---|---|---|
| 中文台词→普通话配音 | `{台词}` + `generate_audio:true` | ✅ 生效 |
| 多语言配音（英文等） | `{英语:…}` | ✅ 生效（标准发音） |
| 声音语法 `()<>{}【】` | 写进提示词 | ✅ 接受并出声 |
| 分辨率 480p | `resolution:480p` | ✅ 生效（854×480） |
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

> 用法取向：**≤30 秒优先一条单段直出**（连续性优于多段拼接、缝更少更省钱）；>30 秒才拆段拼接（见 pipeline.md）。写长片提示词先定 30 秒故事弧（开场→推进→转折→收尾）再补镜头细节。
> edit/extend 若首次 `generation_failed`，**换新子目录重试最多 2 次**（失败自动退款）——这是上游不稳，不是提示词问题。

## 任务生命周期

`queued → in_progress → completed | failed`。完成后从 `video_url` 下载（**有有效期，立即下载**），`usage.seconds` 为计费秒数。

- 轮询间隔 10–15 秒；客户端总超时 ≥20 分钟
- queued/in_progress 期间**不要重复提交**——会创建多个计费任务
- 只有确认 POST 未到达服务器时才允许重试提交

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
