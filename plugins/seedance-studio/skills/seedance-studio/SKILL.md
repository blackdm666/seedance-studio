---
name: seedance-studio
description: 三大工作流的一站式 88API 短片工作室：实时获取当前视频模型、价格、能力与账户/API Key 可用状态，让用户明确选择模型后再生成；默认用 gemini-3.7-flash 拆解视频音频，并用 gpt-image-2 / gpt-image-2-4k 生成关键帧。专注单条短片与 TVC/广告片，不做多集连续剧：①一个想法 → 完整成片，按所选模型单段上限自动分级；②视频 → 证据优先反推提示词；③视频 → 可复刻工程包。用户提到出片、生视频、做短片、TVC、广告片、宣传片、视频模型选择、模型价格、账户余额、分镜、图生视频、反推提示词、复刻视频、仿拍、素材包、Seedance、可灵、Wan、Grok 视频或“把这个想法做成视频”时使用。不用于纯图片任务。
---

# Seedance Studio

把一句话或一条参考视频变成成片。用户不需要懂模式、参数或提示词术语——翻译工作全部由你完成。

## 运行时定位

定位本 `SKILL.md` 所在目录，向上两级得到 `<PLUGIN_ROOT>`，所有 API 与拼接调用通过：

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" <参数>
```

## 首次使用：双凭据、账户检查与模型选择

1. 在任何 88API 任务前运行 `--get-config`。插件使用两种不同凭据：
   - **API Key**：只调用 `/v1/*` 生成端点；在 88API“API 密钥”创建，建议选择 `auto` 分组。
   - **个人访问令牌**：只读调用 `/api/user/self`、`/api/pricing`、`/api/status`、`/api/user/models`，用于余额、实时价格和可用状态；在“个人资料 → 安全”创建。它不是 API Key。
2. 任一凭据缺失时停止付费请求，直接告诉用户：`请先注册并登录 https://88api.ai/：在“API 密钥”创建一个 auto 分组 API Key；再到“个人资料 → 安全”创建个人访问令牌。API Key 可以交给我配置；访问令牌不要粘贴到聊天，我会启动隐藏输入助手让你在本机输入。`
3. 收到 API Key 后由 Agent 执行 `--set-key "<API_KEY>"`。访问令牌使用 `node "<PLUGIN_ROOT>/scripts/studio.mjs" --configure-access-token` 的隐藏输入助手；不得使用 `--set-access-token <值>`、命令行参数、聊天或普通文件传递。Windows 助手会先调用 `/api/user/self` 验证，再写入专用用户环境变量并自动识别用户 ID；不得要求用户另外寻找用户 ID。若运行环境不能提供交互输入，暂停并让用户在本机终端执行同一助手，完成后自动继续原任务。
4. 运行 `account`、`models --json` 和 `--self-test`。这些都是只读检查，不产生生成费用。向用户展示当前余额，以及所有视频模型的：模型 ID、按秒/次价格、能力摘要、目录端点兼容性、账户可见性与当前 API Key 可用状态。
5. **模型必须由用户明确选择，Agent 不得按价格或主观质量替用户决定。** 用户选定后执行 `--set-video-model "<精确模型ID>"`；每次付费生成前插件仍会刷新目录并复核价格和状态。用户在请求中明确给出模型 ID 时，可用 `video --model "<模型ID>"` 临时覆盖，但仍必须通过实时校验。
6. 把两种凭据都视为敏感信息：不要在回复、进度、日志摘要、源码或项目文件中复述完整值。个人访问令牌不得写入 `config.json`；只允许从 `SEEDANCE_STUDIO_ACCESS_TOKEN`（兼容 `RELAY_88API_ACCESS_TOKEN`）读取。配置失败只说明错误类型，不得回显旧值。
7. 配置与选择成功后自动继续用户原任务，不要让用户重新描述需求。

用户只应在自己信任的 Codex 任务里提供凭据，不要发布到 GitHub Issue、公开聊天或截图中。

## 项目目录约定

每个任务建立一个项目目录（默认 `./seedance-projects/<项目名>/`），所有产物落盘、每步可审、失败只重做失败段：

```text
<project>/
├── brief.md          # 需求、已确认配置、保守假设
├── shotlist.json     # 结构化分镜（功能一规划产物 / 功能二三分析产物）
├── assets/           # 参考素材：用户提供 + 生成的锚定图/关键帧
│   └── manifest.json # 每个素材的唯一职责表
├── prompts/          # 每段最终提示词 seg01.txt …
├── segments/         # 每段生成目录 seg01/（run.json、result.json、mp4）
└── final/            # final.mp4 + 交付说明
```

## 人物身份路由（出片前强制判定）

- **复刻原片演员 / 权利不明确**：只迁移气质、年龄感和造型逻辑，生成新身份锚定图；绝不抽取原片人物脸或把原片截图作为身份参考。
- **用户另行提供人物照片并明确说“用这个人”**：视为授权真人身份分支。原照片必须成为**唯一身份权威**，登记进 `assets/manifest.json`，生成每张关键帧时都直接加 `image --identity-ref <原照片>`，生成视频时必须加 `video --identity-image <原照片>`。AI 首尾帧只控制场景、服装、构图和状态，不得取代身份。
- 授权真人分支禁止“原照片 → AI 锚定图 → 再以 AI 锚定图生其它脸图”的身份链。每张含脸关键帧都直接参考原照片；可额外参考上一帧保持场景，但上一帧不能成为身份唯一来源。
- 视频提交前先 `--dry-run`，必须看到 `[IDENTITY-AUDIT]` 的 `mode:"authorized-direct"` 且 `sources` 含原照片；缺失则停止，不得付费生成。

## 意图分级（启动前先判断规模，自动分级，别审问用户）

从用户一句话里**自动判断规模**，多数直接开工，只有多镜短片开拍前做 1 次轻确认——这是本插件"一句话出片"的底线：

| 档 | 触发信号 | 是否先确认 | 走向 |
|---|---|---|---|
| **T0 直接出片** | 单一画面/动作、总时长不超过所选模型的实时单段上限 | 模型已选则不再确认，直接出 | 下方“快速出片” |
| **T1 多镜短片** | 超过所选模型单段上限，或必须多场景硬切 | 只确认 1 次拆段、所选模型与总估算费用 | [references/pipeline.md](references/pipeline.md) |

判不准就按"会实质改变结果"的原则问 1 句（附默认值）。**本插件只做单条成片，不做多集连续短剧/剧集/电影**——用户提连续剧时见下方"能力边界"。

## 意图路由

| 用户意图 | 工作流 | 加载 |
|---|---|---|
| 功能一（T0）：想法 → 成片（不超过所选模型单段上限） | 下方“快速出片” | [references/prompting.md](references/prompting.md) |
| 功能一（T1）：想法 → 完整成片（超过单段上限 / 多场景） | 完整成片管线 | [references/pipeline.md](references/pipeline.md)、[references/long-video.md](references/long-video.md) |
| 图生视频 / 多模态参考 | 快速出片 + `--image` | [references/references.md](references/references.md) |
| 功能二：视频 → 反推提示词 | 反推流程 | [references/reverse.md](references/reverse.md) |
| 功能三：视频 → 可复刻工程包 | 复刻工程包流程 | [references/replicate.md](references/replicate.md)（内部先走 reverse.md） |
| 生成的视频翻车了 | 诊断后针对性修复单段 | [references/troubleshooting.md](references/troubleshooting.md) |
| 要现成模板 | 套用后走快速出片 | [references/prompt-recipes.md](references/prompt-recipes.md) |
| 接口细节 / 报错 / 参数（88api 后端） | 查表回答 | [references/api.md](references/api.md) |
| 官方原生能力 / 视频编辑·延长 / 首尾帧 / 多语言配音 / 请求格式 | 查官方能力全集 | [references/ark-native.md](references/ark-native.md) |

## 功能一：快速出片（单段不超过所选模型上限）

1. **先刷新模型目录。** 运行 `models --json`，确认已选模型仍为 `available`，读取它的实时价格、单段时长、分辨率、画幅和参考素材能力。模型未选、已下架、端点不兼容、账户不可见或当前 API Key 不可用时停止，不得付费提交。
2. **推断其余配置，不审问用户。** 默认时长取模型目录的默认值；目录未提供默认时长时让用户明确给出，不得猜测。社媒/竖屏意图用 `9:16`，否则 `16:9`，前提是模型支持。总时长不超过模型单段上限时优先单段直出；超过上限或必须硬切才走 pipeline.md。完整片先定**故事弧（开场→推进→转折→收尾）**再补镜头细节。
3. **写提示词。** 按 prompting.md 四层结构（参考声明 → 一句话总览 → 可见推进/时间戳分镜 → 全局锁定）。
4. **展示计划（付费闸）。** 展示模型 ID、能力匹配、实时单价、价格版本、时长与总估算金额。即使用户说“直接出”，首次模型选择也不能跳过；模型已经由用户选择后可跳过重复确认。
5. **关键帧预审（可选，便宜）。** 仅当所选视频模型支持图片参考/图生视频时使用。场景复杂、拿不准或涉及产品外观时先 `image` 生成 1 张关键帧确认方向。片中有贯穿全片的主角/产品时，身份或产品锚定不是可选：复刻原片演员走新身份锚定；用户明确提供替换人物则走上方授权真人分支。生图默认 `gpt-image-2`；海报级高清才显式使用 `gpt-image-2-4k`。
6. **提交生成。**

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" video --prompt "<提示词>" --duration 10 --ratio 9:16 --out "<project>/segments/seg01"
```

图生视频仅在所选模型支持时加 `--image <本地图>`；图片数量上限从实时目录读取。脚本自动轮询下载 MP4。**参考图本身含文字、标注、编号或 Logo 时，必须在提示词中声明“只参考造型/氛围，画面中禁止出现任何文字、数字、标注和 Logo”。**

授权真人出片使用 `--identity-image <原照片>`；场景/产品/风格图仍用 `--image`。CLI 会把身份图放在普通参考图第一位、自动注入身份唯一基准，并在 dry-run 与 `run.json` 写入身份审计。

> **参考素材能力按模型目录执行。** 只有目录声明支持时才可用 `--video-url` 迁移运镜、`--audio-url` 卡节奏、`--first-frame` / `--last-frame` 控制首尾帧。视频/音频必须公网 URL；数量上限从实时能力说明读取。提示词需逐条声明每个素材只负责哪一维，见 [references/references.md](references/references.md)。
7. **交付。** 报告实际模型、价格版本、估算与实际用量、成片路径。失败时读 troubleshooting.md 诊断，**修完原因才允许重交**。

超过所选模型单段上限或多场景需求：切换到 [references/pipeline.md](references/pipeline.md) 的完整管线（规划 → 锚定图 → 分段生成 → `concat` 拼接）。

## 能力边界：只做单条短片 / TVC，不做多集连续剧

用户说“短剧/连续剧/剧集/电影/多集/系列/跨集同一个角色”时，**不要硬做**——直说清楚：本插件定位是**单条短片与 TVC/广告片**，单段上限由用户所选模型决定，多镜只用于拼成一条连续成片。多集连续剧不做，是硬限制：

- **跨集角色/场景一致性只能靠喂锚定图勉强撑**，集数一多必漂，不可靠；
- **角色配音通常锁不住**——视频模型内置声音多为烘焙进画面的副产物，跨镜音色可能漂移；
- 多集 = 数百计费秒的持续烧钱，翻车成本高。

遇到连续剧需求，给**替代方案**：先做一条**自成一体的单集样片 / 预告 / TVC**（走 T0 或 T1），把风格、主角脸、节奏跑通给用户看；要成系列请换专门的制片工具链，本插件不承担。

## 功能二：反推提示词（七段可视化流水线）

加载 [references/reverse.md](references/reverse.md) 执行七段，**每段落盘产物、逐段展示给用户**以体现能力：①探测（ffprobe 元数据）→ ②结构总览（ffmpeg 联系表 + 切镜点 + 密集帧）→ ③**运动理解 pass（按题材自适应）**：人物/产品片走 `--mode character`（真深度图视频：灰度/熔岩/光谱 + 四格样张，身体朝向与前后景一眼可读）；宏大风景/山河/大场面片走 `--mode landscape`（跳过深度——单目深度对天空/云海/水面失效且丢光色——改出 motion_heat 运镜热图 + atmosphere 大气原帧样张）；武打/舞蹈/快速动作片走 `--mode action`（8fps + 多人 YOLO-pose 骨架条 pose_strip/pose_skeleton 读连招站位 + 运动 + 深度）；拿不准用 `--mode auto` → ④运镜判定（Claude 亲眼读 ②③ 帧）→ ⑤分镜头脚本（Claude）→ ⑥最终提示词（Claude）→ ⑦**音频拆解**（ffmpeg 抽音 + Gemini 多模态一次拆出 台词时间线/BGM风格/音效时间轴——88api 无可用 STT 渠道故走多模态，实测计费含 audio_tokens 确认真在听）。

**为什么要③、为什么要分题材**：纯抽帧只能看孤立静帧，分不清人物是走近还是镜头推近、手是拿起还是放下——先做运动 pass 把“动”变可读。但**武器要对题材**：人物有硬几何、深度图能读朝向与层次；风景主体是空间与光，此时该用运镜热图+原帧；武打招式靠**高帧率+多人骨架**拆解。必须向用户说明：反推可以还原提示词结构，但所选生成模型未必支持帧级精确动作复刻。命令：

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" depth --video "<视频>" --mode character|landscape|action|auto --out "<project>/analysis"
node "<PLUGIN_ROOT>/scripts/studio.mjs" audio --video "<视频>" --out "<project>/analysis/audio"   # ⑦ 音频拆解（台词/BGM/音效）
```

FF 的位置：**ffprobe 只做①，ffmpeg 做②抽帧与③的上色/合成/运动（搬运层）+ ⑦的抽音，人物模式的真深度交给 Depth-Anything V2、武打模式的骨架交给 YOLO-pose、风景模式直接用 ffmpeg 运动热图+原帧、⑦的音频转写+描述交给 Gemini 多模态（88api 无可用 STT 渠道），④⑤⑥的判断永远是 Claude 亲眼看帧**——ffmpeg 不做真深度。产出的 shotlist 与提示词可直接转入功能三或功能一。反推到出片时按上方人物身份路由：原片演员生成新身份；用户另行提供并指定人物则原图直传。好视频光有提示词不够，身份、场景和素材职责都必须绑定。

## 功能三：可复刻工程包

加载 [references/replicate.md](references/replicate.md) 执行。交付结构化 shotlist + 素材职责表 + 缺失素材清单 + 逐段绑定提示词。原片演员默认生成新身份；若用户另行提供并指定替换人物，则保留该原照片为唯一身份权威并使用授权真人分支，绝不从参考视频抽帧。

## 成本与安全铁律

- **主角先行（合规 + 一致性）**：原片人物不可直接复用，必须生成新身份；用户另行提供并明确指定的授权人物不可被 AI 锚定图替代，必须以原图 `--identity-ref` / `--identity-image` 直传。多形象同一授权人物时，每张关键帧都直接带原身份图，不得只拿上一张 AI 图锁脸。
- 单次生成上限、分辨率和参考素材能力以所选模型实时目录为准；更长成片必须拆段，**拆段方案、模型单价、价格版本与总估算金额先展示确认**。
- 输出目录有 `run.json` 时禁止重复提交（脚本拦截）；queued/in_progress 只能 `status --task <id> --wait` 续查；重试失败段用新子目录（如 `seg03-r2/`）。
- 批量任务（≥3 段）先 `--dry-run` 汇总全部载荷与总秒数。
- `failed` 即 [NO-RETRY]：先诊断（内容审核？素材 URL？提示词？），修复后才重交。
- 视频/音频参考必须公网 URL；本地视频参考给出替代方案（对象存储，或抽帧转图片参考）。
- 拼接用 `concat` 命令（同 API 产出编码一致，默认流复制；异常时加 `--reencode`）。

## 模型能力边界

不要把一个模型的能力套到其它模型。实时目录的 `description`、`supported_endpoint_types`、时长、分辨率和参考素材声明是当前选择依据；目录未声明的能力不得承诺。`openai-video` / `video-generation` 之外的模型可以展示，但当前 CLI 不允许选作 `/v1/videos` 任务。目录可见不等于上游容量永远健康：`available` 表示目录、账户和当前 API Key 三层检查通过，不代表付费提交时绝不会遇到临时熔断。

只有用户选择 Seedance 2.5 时，才加载 [references/ark-native.md](references/ark-native.md) 并应用其中已验证的首尾帧、多模态参考和即梦网页降级边界；其它模型只按实时目录说明与实际返回处理。

## 输出契约

每次交付按序报告：① 实际配置；② 成片/工程包绝对路径；③ 用量（多段累加 `usage.seconds`）；④ **提示词所在位置**——告知 `prompts/segNN.txt` 路径，说明"真实提示词已逐字存档于此，需要可自行打开查看"，默认不在对话里粘贴全文，用户要看再贴；⑤ 仅在能预防下次翻车时给一条建议。不展示内部流程名，不给新手多个竞争方案。
