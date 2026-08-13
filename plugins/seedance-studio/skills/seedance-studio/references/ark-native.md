# Seedance 2.5 官方能力全集（火山方舟 Ark）

> 来源：火山方舟官方文档 `ark.volcengine.com/docs/82379/2607688`（2026-08 抓取）。
> **重要**：本插件默认后端是 **88api.ai**（第三方代理，模型名 `seedance2.5满血版`，端点 `/v1/videos`）。本文记录的是**字节官方 Ark 原生能力**（端点 `/api/v3/contents/generations/tasks`，模型 `doubao-seedance-2-5-260628`）。二者不是同一套 API。
> **透传实测结果（2026-08 三档实测，权威结论见 `api.md` 的实测矩阵）**：
> - ✅ **88api 已透传**：中/英台词配音、声音语法、480p、首帧/首尾帧、视频参考、音频参考。
> - 🟡 **可用但不稳**：视频编辑 edit / 视频延长 extend（约 50% 成功率，需容错重试）。
> - ❌ **88api 未透传（缩水）**：`output_format:mov`（回吐 mp4）、`watermark`（无水印）、对口型（台词仅配音、嘴不动）。
> - ❗ **硬约束**：视频/音频参考必须配 ≥1 图（无纯视频/纯音频参考）。
>
> 下方 Ark 原生规格供**直连 Ark**或理解模型上限时参考；**提示词层能力（声音语法、多语言、@素材职责）与后端无关，可直接用**。

## 端点与鉴权（直连 Ark 时）

| 项 | 值 |
|---|---|
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` |
| 创建任务 | `POST /api/v3/contents/generations/tasks` |
| 查询任务 | `GET /api/v3/contents/generations/tasks/{id}` |
| 模型 ID | `doubao-seedance-2-5-260628` |
| 鉴权 | `Authorization: Bearer $ARK_API_KEY`（火山引擎 API Key，与 88api Key 不同） |
| 开通门槛 | 账户余额 ≥200 元 或 已购 2.5 资源包 |
| SDK | `pip install 'volcengine-python-sdk[ark]'`；也可用 API Explorer 一键生成请求 |

## 任务类型（这是 2.5 的核心：一个模型，六种活）

Seedance 2.5 会**根据输入素材 + 提示词意图自动判定任务类型**；也可用 `omni_reference_task_type` 显式声明把报错前置。

| 任务类型 | 触发 | ratio | duration | 提示词关键词 | 备注 |
|---|---|---|---|---|---|
| 文生视频 | 仅文本 | 无限制 | 无限制 | — | 最自由 |
| 首帧生视频 | 1 图 role=`first_frame` | 必须 `adaptive`（随首帧） | [4,30] 或 -1 | — | [Ark原生] |
| 首尾帧生视频 | 2 图 `first_frame`+`last_frame` | 必须 `adaptive`（随首帧） | [4,30] 或 -1 | — | [Ark原生] |
| 参考生视频 | role=`reference_image/video/audio` | `adaptive` | -1 | — | `omni_reference_task_type=auto` |
| 视频编辑 | 含 `reference_video` + 编辑意图 | 必须 `adaptive`（随原视频） | 必须 -1（随原视频，误差≤0.4s） | 编辑视频 / 增加·加上 / 删除·去掉 / 修改·替换·改成 | `=edit`；输入视频须 4–30s；建议 mov 进出 |
| 视频延长 | 含 `reference_video` + 延长意图 | 必须 `adaptive`（随原视频） | [4,30] 或 -1 | 向前·向后延长 / 延续 / 续写 | `=extend` |

**报错机制**：
- 显式声明 `edit`/`extend` 但参数不符 → 提交时**同步报错**。
- 声明的类型与模型实际判定不符 → `InvalidParameter.TaskTypeMismatch`（异步）。
- 参数与任务类型不兼容 → `InvalidParameter.TaskTypeConstraint`（异步）。
- 对策：**遵循上表的提示词关键词写法**，别让模型误判。

## 输出规格参数

| 参数 | 默认 | 可选 | 说明 |
|---|---|---|---|
| `resolution` | `720p` | `480p` / `720p` | **2.5 不支持 1080p / 4k** |
| `ratio` | `adaptive` | 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / adaptive | 编辑·延长·首帧任务仅支持 adaptive |
| `duration` | `-1` | [4,30] 或 -1 | -1=模型在 4–30s 内自选整数秒 |
| `output_format` | `mp4` | `mp4` / `mov` | mov=H.264+yuv444p+PCM 高保真，供调色/抠像/合成；编辑·延长建议用 mov |
| `watermark` | `false` | true / false | true=右下角 AI 生成水印 |

> ratio 各档像素（720p）：16:9=1280×720、9:16=720×1280、1:1=960×960、4:3=? 、21:9=1680×720 等（adaptive 由模型选）。480p 同比例减半量级（如 16:9=854×480、21:9=992×432）。

## 请求体结构（直连 Ark；[Ark原生]）

`content` 为数组，参考素材项带 `role`；输出参数按 doubao-seedance 惯例多以 `--` 命令行标记写在 text 内（**确切机制以 API Explorer 生成的请求为准**）：

```json
{
  "model": "doubao-seedance-2-5-260628",
  "omni_reference_task_type": "auto",
  "content": [
    { "type": "text", "text": "<提示词> --resolution 720p --ratio adaptive --duration -1 --watermark false" },
    { "type": "image_url", "role": "first_frame",      "image_url": { "url": "https://..." } },
    { "type": "image_url", "role": "reference_image",  "image_url": { "url": "https://..." } },
    { "type": "video_url", "role": "reference_video",  "video_url": { "url": "https://..." } },
    { "type": "audio_url", "role": "reference_audio",  "audio_url": { "url": "https://..." } }
  ]
}
```

素材传入方式：图片=URL / Base64 / 素材ID；视频=URL / 素材ID；音频=URL / Base64 / 素材ID。大文件勿用 Base64（请求体 ≤64MB）。素材 URL 建议放对象存储（TOS）并设公共读。

## 提示词层能力（与后端无关，直接可用）

### 声音语法（把音频写进提示词，模型直接生成有声视频）
- 音乐 → 圆括号 `( )`
- 音效 → 尖括号 `< >`
- 台词 → 花括号 `{ }`
- 字幕 → 中文方括号 `【 】`
- 非中文台词：在台词前注明语言，如 `{英语：Hello}`。

### 原生多语言（11 种）
提示词输入与**有声视频生成**原生支持：中文、英语、西班牙语、印度尼西亚语、马来语、泰语、阿拉伯语、葡萄牙语、越南语、日语、韩语。
→ **中文台词直接得普通话人声**（无需外接 TTS 就能出中文配音；缺点：无音色 ID，跨镜音色不可锁定）。

### @素材职责声明
用 `@图片1`、`@视频1`、`@音频1` 指代素材，逐条说明"提供什么（外貌/动作/音色）、不采用什么"。

### 官方提示词优化技能
`npx --yes skills@latest add`（Seedance 2.5 提示词优化技能），对话里 `/sd25-pe + 提示词` 调优。

## 输入素材限制

| 类型 | 格式 | 单个 | 数量/总量 |
|---|---|---|---|
| 图片 | jpeg/png/webp/bmp/tiff/gif/heic/heif | 宽高比[0.4,2.5]、边长300–6000px、≤30MB | 首帧1 / 首尾帧2 / 参考1–30 |
| 视频 | mp4/mov（H.264·H.265，音频AAC·MP3） | [2,30]s、480p/720p、FPS[24,60]、≤200MB、总像素[409600,8295044] | ≤10 个，**总时长≤30s** |
| 音频 | wav/mp3 | [2,30]s、≤15MB | ≤10 段，**总时长≤30s** |

**总参考上限 50 个（30 图 + 10 视频 + 10 音频）**，可任意组合；支持**纯音频参考**生成视频（无需配图/视频）。

## 肖像合规（硬限制）

- **不支持直接上传含真人人脸的参考图/视频**（触发审核拦截）。
- 合规路径：① 官方**预置虚拟人像库**（免费、合规、多样，适合"要真人脸但不指定具体人物"）；② 便利创作含肖像方案；③ 已获授权的真人素材；④ 本账号下本系列模型生成的含脸产物可作二次创作输入（不触发拦截）。
- 本插件既有做法（人物一律用 gpt-image-2-4k / gemini-3-pro-image 新生成锚定图、绝不从原片抽脸）与此一致。

## 配额与留存

- 任务记录留 7 天；视频 URL 留 24 小时、下载上限 100 次——**必须立即下载或转存**。
- 限流：个人 RPM 180 / 并发 3；企业 RPM 600 / 并发 10。超 RPM 报错，超并发排队。

## 2.5 相对 2.0 系列的增量（一句话）

30s 连贯直出（2.0 是 15s）、50 参考素材（2.0 是 15）、新增视频编辑/延长/纯音频参考、原生多语言有声、mov 输出、更智能 adaptive 宽高比与时长。同系列模型 ID：`doubao-seedance-2-0-260128`、`-2-0-fast-260128`、`-2-0-mini-260615`、`-2-5-260628`。
