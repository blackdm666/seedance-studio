# 88API-Seedance-Studio

一句话出片的 Codex 集合插件：基于 [88api.ai](https://88api.ai/) 的 **Seedance 2.5 满血版**。

**你只需要做两件事：装插件、填 Key。** 之后一句话说想法，剩下的全部由 Codex 自动完成。

## 三大工作流

| 工作流 | 输入 | Codex 自动完成 | 产出 |
|---|---|---|---|
| **① 想法 → 成片** | 一句话想法 | **自动按规模分级**：T0 单镜直接出 · T1 短片拆段拼接 · T2 大项目（短剧/剧集/电影）走前期制片管线（剧本审核 → 分镜头脚本 → 角色/场景/道具设定图 → 逐镜锚定图串接保证跨集同一张脸 → 连续性追踪 → 分集拼接） | 单条 MP4，或多集短剧/电影 |
| **② 视频 → 反推** | 一条参考视频 | ffmpeg 抽帧 → 逐帧证据观察 → 结构化还原运镜/动作/文字/声音 | 可直接生成的提示词 |
| **③ 视频 → 复刻工程包** | 一条参考视频 | ②的全部 + 素材盘点 + 合规新身份锚定图 + 逐段绑定提示词 | 补齐素材即可一键生成的完整工程 |

> **① 自动分级只有 T2（大项目）会先跟你确认集数与总计费秒数**，T0/T1 一句话直接开工——既保住"一句话出片"，又不让你在不知情下烧掉一部剧的钱。做 AI 短剧/电影的卡点从来不是模型不行，而是缺"前期制片"这一层：剧本、分镜、角色资产库、跨集一致性——这些正是 T2 补上的。

> 功能③是对"光有提示词还不够"的回答：好视频 = 提示词 × 素材绑定 × 时间结构。工程包内含素材职责表与**缺失素材清单**（原片每种产品形态各需一张干净图），补齐后直接进入①的生成阶段。

## 内置能力

- 🎬 Seedance 2.5 满血版：4–30 秒、720P、同步音频、多模态参考（30 图 / 10 视频 / 10 音频）
- 🖼 gpt-image-2 生图：关键帧预审、人物/产品/场景锚定图（跨段一致性）
- 🔍 反推：ffmpeg 抽帧 + Codex 逐帧观察，零 API 成本，证据优先防幻觉
- 🧵 拼接：`concat` 命令流复制拼段（异常时 `--reencode`）
- 🛡 成本安全：dry-run、防重复提交闸、failed 任务 NO-RETRY、拆段方案先确认总计费秒数

## 环境要求

- Codex 插件功能 + Node.js 18+
- ffmpeg（反推与拼接需要）
- 一个 88api.ai Key（`auto` 分组，或包含视频与生图模型分组）

## 创建并配置 88API Key

### 1. 注册并登录

打开 [88api.ai](https://88api.ai/) 注册账号并登录。

### 2. 创建 API Key

进入“API 密钥”页面，点击“创建 API 密钥”。名称可以自定义（例如 `Seedance Studio`），分组建议选择 `auto`（自动分组），以便同时调用 Seedance 视频模型和 Image-2 关键帧模型。如需在当前分组请求失败时继续尝试下一分组，可以开启“跨分组重试”。

![创建 88API Key](docs/assets/88api-create-image-key.png)

### 3. 复制 Key

创建完成后，复制 Key 的完整内容。Key 只用于你自己的 Codex 配置，请勿粘贴到 Issue、公开聊天、仓库文件或截图中。

![复制 88API Key](docs/assets/88api-copy-key.png)

### 4. 配置并检查插件

在仓库根目录运行：

```powershell
node plugins/seedance-studio/scripts/studio.mjs --set-key "<YOUR_88API_KEY>"
node plugins/seedance-studio/scripts/studio.mjs --get-config
node plugins/seedance-studio/scripts/studio.mjs --self-test
```

Key 会保存在本机 `~/.seedance-studio/config.json`，配置输出会自动隐藏完整 Key。`--self-test` 只检查接口与模型列表，不会发起付费生成任务。

## 快速开始

1. 安装插件（本仓库为标准 Codex 插件市场结构）。
2. 按上方流程创建并配置 88API Key（只需一次）。
3. 在 Codex 新任务里说人话：

```text
@88API-Seedance-Studio 做一个 45 秒的竖屏治愈短片：雨夜女孩把流浪猫带回家。
@88API-Seedance-Studio 反推这条视频的提示词：D:\videos\ref.mp4
@88API-Seedance-Studio 给我这条视频的复刻工程包，我想换成我自己的产品：D:\videos\hot.mp4
```

## CLI 直接使用（可选）

```powershell
node plugins/seedance-studio/scripts/studio.mjs video --prompt "雨夜东京街头，银色跑车驶过，霓虹倒影，电影级跟拍" --duration 10 --ratio 16:9
node plugins/seedance-studio/scripts/studio.mjs video --prompt "..." --image product.jpg --duration 8 --dry-run
node plugins/seedance-studio/scripts/studio.mjs status --task task_xxx --wait
node plugins/seedance-studio/scripts/studio.mjs image --prompt "产品关键帧…" --aspect 16:9
node plugins/seedance-studio/scripts/studio.mjs concat --dir seedance-projects/demo/segments --out final.mp4
```

## 边界说明

- API 生成面为 4–30 秒 / 720P；更长成片由插件自动拆段 + 拼接。即梦网页版专属能力（180 秒原生超长、局部编辑、绿幕、白模）不经 API；需要时插件生成可粘贴到即梦网页的提示词作为降级。
- 视频/音频参考素材需公网可直连 URL；图片参考走 base64 无此限制。
- 复刻他人视频时人物一律生成新身份锚定图，不从原片抽帧（肖像合规）；BGM 不提取原曲（版权）。
- Key 保存在本机 `~/.seedance-studio/config.json`，不要提交到任何仓库。

## 鸣谢与来源

- 提示词方法论 references 改编自 [allenGKC/Seedance-2.5](https://github.com/allenGKC/Seedance-2.5)（MIT，见 THIRD-PARTY-LICENSE-seedance25os.txt）。
- 大项目剧本审核铁律（`screenwriting.md`）改编自 [Vi7QY/screenwriter-skill](https://github.com/Vi7QY/screenwriter-skill)（MIT）；剧本→分镜拆解思路参考 [neopen/story-shot-agent](https://github.com/neopen/story-shot-agent)（MIT）；T2 前期制片全流程架构思路参考 [ArcReel/ArcReel](https://github.com/ArcReel/ArcReel)（AGPL-3.0，仅借鉴思路，未取用其代码或文本）。各来源署名见 THIRD-PARTY-NOTICES.md。
- 反推与复刻方法论参考社区证据优先实践（fkyhdd、daihuo-fanpai 等项目的公开经验），正文为本项目重写。
- 插件结构参考 [blackdm666/88API-image-gen](https://github.com/blackdm666/88API-image-gen)；接口规格来自 88api.ai 官方文档。

非 ByteDance / 即梦 / Dreamina / 88api 官方项目。
