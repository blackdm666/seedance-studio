# Seedance-Studio

一句话出片的 Codex 集合插件：基于 [88api.ai](https://88api.ai/) 的 **Seedance 2.5 满血版**。

**你只需要做两件事：装插件、填 Key。** 之后一句话说想法，剩下的全部由 Codex 自动完成。

## 三大工作流

| 工作流 | 输入 | Codex 自动完成 | 产出 |
|---|---|---|---|
| **① 想法 → 成片** | 一句话想法 | 规划分镜 → 生成锚定图/关键帧 → 分段生成（每段 4–30s）→ ffmpeg 拼接 | 完整 MP4 成片 |
| **② 视频 → 反推** | 一条参考视频 | ffmpeg 抽帧 → 逐帧证据观察 → 结构化还原运镜/动作/文字/声音 | 可直接生成的提示词 |
| **③ 视频 → 复刻工程包** | 一条参考视频 | ②的全部 + 素材盘点 + 合规新身份锚定图 + 逐段绑定提示词 | 补齐素材即可一键生成的完整工程 |

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

## 快速开始

1. 安装插件（本仓库为标准 Codex 插件市场结构）。
2. 配置 Key（只此一次）：

```powershell
node plugins/seedance-studio/scripts/studio.mjs --set-key "<你的88api Key>"
node plugins/seedance-studio/scripts/studio.mjs --self-test
```

3. 在 Codex 新任务里说人话：

```text
@Seedance-Studio 做一个 45 秒的竖屏治愈短片：雨夜女孩把流浪猫带回家。
@Seedance-Studio 反推这条视频的提示词：D:\videos\ref.mp4
@Seedance-Studio 给我这条视频的复刻工程包，我想换成我自己的产品：D:\videos\hot.mp4
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
- 反推与复刻方法论参考社区证据优先实践（fkyhdd、daihuo-fanpai 等项目的公开经验），正文为本项目重写。
- 插件结构参考 [blackdm666/88API-image-gen](https://github.com/blackdm666/88API-image-gen)；接口规格来自 88api.ai 官方文档。

非 ByteDance / 即梦 / Dreamina / 88api 官方项目。
