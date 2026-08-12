---
name: seedance-studio
description: 三大工作流的一站式视频工作室（基于 88api.ai 的 Seedance 2.5 满血版 + gpt-image-2）：①一个想法 → 完整成片，自动按规模分级——单镜/短片（规划分镜、生成锚定图与关键帧、分段生成 4–30 秒、ffmpeg 拼接）或大项目短剧/剧集/电影（剧本审核 → 导演分镜头脚本 → 角色/场景/道具设定图 → 逐镜锚定图串接保证跨集同一张脸 → 连续性追踪 → 分集交付）；②一个视频 → 证据优先的反推提示词；③一个视频 → 可复刻工程包（结构化分镜、素材需求清单、合规新身份锚定图、逐段绑定提示词）。用户提到出片、生视频、做短片、AI 短剧、连续剧、剧集、AI 电影、分镜头脚本、角色设定、图生视频、反推提示词、复刻这条视频、仿拍、素材包、Seedance、即梦视频，或"把这个想法做成视频/短剧"时使用。不用于纯图片任务或非 Seedance 模型咨询。
---

# Seedance Studio

把一句话或一条参考视频变成成片。用户不需要懂模式、参数或提示词术语——翻译工作全部由你完成。

## 运行时定位

定位本 `SKILL.md` 所在目录，向上两级得到 `<PLUGIN_ROOT>`，所有 API 与拼接调用通过：

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" <参数>
```

## 首次使用检查

按需运行免费命令：`--get-config`（Key 已脱敏）、`--self-test`（验证 Key 与模型分组，不计费）。未配置 Key 时告诉用户去 [88api.ai](https://88api.ai/) 创建 Key 并执行 `--set-key "<Key>"`。绝不将真实 Key 写入源码、日志或对话回显。

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

## 意图分级（启动前先判断规模，自动分级，别审问用户）

从用户一句话里**自动判断规模**，只有大项目档才强制确认，其余直接开工——这是本插件"一句话出片"的底线：

| 档 | 触发信号 | 是否先确认 | 走向 |
|---|---|---|---|
| **T0 直接出片** | 单一画面/动作、≤30 秒、无剧情分场 | 不确认，直接出 | 下方"快速出片" |
| **T1 短片** | 多镜头、30 秒–几分钟、有起承转合 | 只确认 1 次拆段+总秒数 | [references/pipeline.md](references/pipeline.md) |
| **T2 大项目** | 出现"短剧/剧集/连续剧/EP/第几集/电影/系列/角色设定/分镜头脚本"，或明显需要跨集同一角色 | **强制先立项**（集数·时长·总计费秒数·先试拍第1集），确认后全自动 | [references/production.md](references/production.md) |

判不准就按"会实质改变结果"的原则问 1 句（附默认值）。T2 一定是多镜头×多秒数=真金白银，**未确认预算不得进入生成**。

## 意图路由

| 用户意图 | 工作流 | 加载 |
|---|---|---|
| 功能一（T0）：想法 → 成片（≤30 秒单段，默认） | 下方"快速出片" | [references/prompting.md](references/prompting.md) |
| 功能一（T1）：想法 → 完整成片（>30 秒 / 多场景） | 完整成片管线 | [references/pipeline.md](references/pipeline.md)、[references/long-video.md](references/long-video.md) |
| 功能一（T2）：想法 → 短剧/剧集/电影（多集/跨集一致） | 大项目前期制片管线 | [references/production.md](references/production.md)、[references/screenwriting.md](references/screenwriting.md) |
| 图生视频 / 多模态参考 | 快速出片 + `--image` | [references/references.md](references/references.md) |
| 功能二：视频 → 反推提示词 | 反推流程 | [references/reverse.md](references/reverse.md) |
| 功能三：视频 → 可复刻工程包 | 复刻工程包流程 | [references/replicate.md](references/replicate.md)（内部先走 reverse.md） |
| 生成的视频翻车了 | 诊断后针对性修复单段 | [references/troubleshooting.md](references/troubleshooting.md) |
| 要现成模板 | 套用后走快速出片 | [references/prompt-recipes.md](references/prompt-recipes.md) |
| 接口细节 / 报错 / 参数 | 查表回答 | [references/api.md](references/api.md) |

## 功能一：快速出片（单段 ≤30 秒）

1. **推断配置，不审问用户。** 默认：10 秒（有起承转合则 30 秒内取所需）、社媒/竖屏意图 `9:16` 否则 `16:9`、音频开。最多问 1–2 个会实质改变结果的问题，且必须附默认值。
2. **写提示词。** 按 prompting.md 四层结构（参考声明 → 一句话总览 → 可见推进/时间戳分镜 → 全局锁定）。
3. **展示计划（5 秒确认点）。** 2–3 行：配置 + 提示词 + 计费秒数。用户说过"直接出/别问了"则跳过。
4. **关键帧预审（可选，便宜）。** 场景复杂、拿不准或涉及产品外观时先 `image` 生成 1 张关键帧确认方向。
5. **提交生成。**

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" video --prompt "<提示词>" --duration 10 --ratio 9:16 --out "<project>/segments/seg01"
```

图生视频加 `--image <本地图>`（自动 base64，最多 30 张，每张职责写进提示词）。脚本自动轮询下载 MP4。**参考图本身含文字、标注、编号或 Logo（海报、爆炸图、截图）时，必须在提示词中声明"只参考造型/氛围，画面中禁止出现任何文字、数字、标注和 Logo"，否则标注会漏入成片。**
6. **交付。** 报告成片路径与用量。失败时读 troubleshooting.md 诊断，**修完提示词才允许重交**。

超过 30 秒或多场景需求：切换到 [references/pipeline.md](references/pipeline.md) 的完整管线（规划 → 锚定图 → 分段生成 → `concat` 拼接）。

## 功能一（T2）：大项目——短剧 / 剧集 / 电影

出现"短剧/剧集/连续剧/电影/系列/角色设定/分镜头脚本"意图，或需要**跨集同一个角色**时，加载 [references/production.md](references/production.md) 的前期制片管线：**先立项确认预算（唯一强制打扰）→ 剧本审核（[references/screenwriting.md](references/screenwriting.md) 铁律：无聊是最大的罪、第一集决定生死）→ 导演分镜头脚本 → 用 gpt-image-2 生成角色/场景/道具设定图（一致性地基）→ 逐镜把锚定图当 `--image` 参考串接（保证同一张脸）→ 连续性追踪 → 分集拼接交付**。核心认知：大项目卡点不是模型不行，而是缺"前期制片"这一层；生图在这里从"可选预审"升级为跨集一致性的地基。**务必先只做第 1 集验证风格与角色一致，用户满意再批量续做。**

## 功能二：反推提示词

加载 [references/reverse.md](references/reverse.md) 执行：ffprobe 元数据 → ffmpeg 联系表 + 密集帧 → **亲眼逐帧观察**（证据优先，禁止臆测）→ 固定格式输出提示词。产出的 shotlist 与提示词可直接转入功能三（补素材）或功能一（直接生成）。向用户说明：好视频光有提示词不够——需要素材绑定时主动推荐功能三。

## 功能三：可复刻工程包

加载 [references/replicate.md](references/replicate.md) 执行。交付的不是一段文字，而是一个工程包：结构化 shotlist + 素材职责表 + **缺失素材清单**（原片每种产品形态各需一张干净图）+ 合规锚定图（人物一律生成新身份，绝不从原片抽帧）+ 逐段绑定提示词。用户补齐素材后一键进入功能一的生成阶段。

## 成本与安全铁律

- 单次生成上限 30 秒；更长成片必须走管线拆段，**拆段方案与总计费秒数先展示确认（一次确认，之后不再打扰）**。
- 输出目录有 `run.json` 时禁止重复提交（脚本拦截）；queued/in_progress 只能 `status --task <id> --wait` 续查；重试失败段用新子目录（如 `seg03-r2/`）。
- 批量任务（≥3 段）先 `--dry-run` 汇总全部载荷与总秒数。
- `failed` 即 [NO-RETRY]：先诊断（内容审核？素材 URL？提示词？），修复后才重交。
- 视频/音频参考必须公网 URL；本地视频参考给出替代方案（对象存储，或抽帧转图片参考）。
- 拼接用 `concat` 命令（同 API 产出编码一致，默认流复制；异常时加 `--reencode`）。

## 与即梦网页版的边界

本插件生成面为 88api API：4–30 秒、720P。即梦网页版专属能力（30–180 秒原生超长、局部编辑、绿幕、白模渲染）无法经此 API 调用——需要时为用户生成可粘贴到即梦网页的提示词作为降级方案，并明确说明边界。

## 输出契约

每次交付按序报告：① 实际配置；② 成片/工程包绝对路径；③ 用量（多段累加 `usage.seconds`）；④ **提示词所在位置**——告知 `prompts/segNN.txt`（或 T2 的 `epNN/prompts/`）路径，说明"真实提示词已逐字存档于此，需要可自行打开查看"，默认不在对话里粘贴全文，用户要看再贴；⑤ 仅在能预防下次翻车时给一条建议。不展示内部流程名，不给新手多个竞争方案。
