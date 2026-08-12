# 大项目前期制片管线（功能一 · T2：短剧 / 剧集 / 电影）

用于**多集、多场景、需要跨集角色一致**的大项目。核心认知：**AI 短剧/电影做不出来，卡点从来不是 Seedance 模型不行，而是缺"前期制片"这一层**。模型只负责"生成一个镜头"；一部剧需要在镜头之上有剧本、分镜、角色资产库和连续性管理。本管线把生图（gpt-image-2）从"可选预审"升级为**一致性的地基**。

> 架构思路参考 ArcReel（AGPL，仅借鉴思路未取用代码）；剧本方法论见 [screenwriting.md](screenwriting.md)（改编自 Vi7QY/screenwriter-skill, MIT）；分镜拆解参考 neopen/story-shot-agent（MIT）。

## 铁律：先确认，再烧钱

T2 一定是多镜头 × 多秒数 = **真金白银**。T2 **有且只有两个确认点**：① 立项预算（阶段 0）② 剧本定稿（阶段 1，你过目批准）。这两点之间与之后全自动，不再逐镜打扰。启动前先做①：
- 集数与每集时长（如 8 集 × 60 秒）、比例、整体基调；
- **总计费秒数估算**（Σ 所有镜头秒数）与"先做第 1 集试拍"的建议；
- 用户自有素材（真人肖像、真实产品）盘点。
未确认预算、未定稿剧本，都不得进入生成阶段。

## 项目目录约定（一部剧一个目录）

```text
<series>/
├── series-bible.md          # 剧集圣经：世界观、基调、集数规划、总预算(秒)、风格锁定
├── characters/
│   ├── bible.json           # 角色档案：每人固定描述(脸/发/身材/服装/身份)——跨集逐字复用
│   └── <name>_sheet.png     # 角色设定图(三视图/表情/服装) —— 一致性地基
├── locations/<place>_plate.png   # 场景底图
├── props/<prop>.png              # 关键道具图
├── scripts/epNN.md          # 分集剧本(经 screenwriting.md 审核通过)
├── epNN/
│   ├── shotlist.json        # 该集导演分镜头脚本
│   ├── prompts/shotNNNN.txt # 逐镜提示词
│   ├── segments/shotNNNN/   # 逐镜生成(run.json、result.json、mp4)
│   └── final/epNN.mp4       # 该集成片
└── continuity.md            # 连续性追踪：跨集状态(谁在哪、穿什么、剧情进度到哪)
```

## 阶段 0：立项 + 意图确认（确认点 ①）

写 `series-bible.md`：一句话核心概念、题材调性、目标受众、集数与时长规划、总预算(秒)、风格锁定（画幅/色调/镜头语言/声音策略）。展示给用户做**确认点 ①：预算确认**。

## 阶段 1：剧本（免费，决定成败 · 确认点 ②）

剧本有两种入口，都以"用户过目定稿"收口：

- **入口 A — 用户带稿来**（有剧本/大纲）：加载 [screenwriting.md](screenwriting.md) 当**审稿人**逐条挑问题、给改稿方向，**不擅自重写**。
- **入口 B — 用户只有一句话想法**：你**自己写初稿**（logline → 分集大纲 → 分集剧本），写完先按 screenwriting.md 铁律**自审一遍**，再拿去给用户看。

**无论哪条入口，剧本都落盘为 `scripts/epNN.md`，并作为确认点 ② 摆给用户过目**：用户可直接改文件，或口头提意见让你改稿；**未获用户批准，绝不进入烧钱的分镜与生成阶段**——在错的本子上生成 = 精准地浪费钱。剧本是全剧最重要的创作决定，必须由用户拍板，不是插件偷偷定了就往下花钱。

## 阶段 2：导演分镜头脚本（免费）

把每集剧本拆成镜头，写 `epNN/shotlist.json`。每个镜头是一条"导演级"记录：

```json
{ "episode": "ep01", "ratio": "9:16", "shots": [
  { "id": "shot0101", "seconds": 6, "beat": "开场钩子",
    "location": "warehouse_night", "characters": ["A","B"],
    "camera": "手持半环绕跟拍，肩高，向左平移",
    "blocking": "A踏水冲前打右直拳，B向外格挡后前踢反击",
    "dialogue": [{ "who": "A", "line": "就这点本事？", "t": "2.0-3.0s" }],
    "sound": "雨声+拳脚冲击声，无对白外配乐，无BGM",
    "anchors": ["characters/A_sheet.png","characters/B_sheet.png","locations/warehouse_night_plate.png"],
    "onscreen_text": "无",
    "start_state": "两人两米对峙", "end_state": "A被推退半步" } ] }
```

拆镜原则：单镜 4–30 秒（优先 6–12 秒）；镜头边界选**状态清晰的静止点**；后镜 `start_state` 必须等于前镜 `end_state`；台词按秒对齐，尽量用台词表达冲突而非旁白。

## 阶段 3：角色 / 场景 / 道具设定图（便宜——一致性地基）

**这是"把生图用起来"的核心，也是大项目能不能成立的分水岭。** 跨集复现"同一张脸"的唯一可靠方式，是先生成锚定图、之后每个镜头都把它当 image 参考喂给 Seedance——靠文字描述每镜重写必然漂移。

1. 先写 `characters/bible.json`：每个角色一段**固定描述**（年龄/性别/脸型/发型/身材/标志特征/服装配色/身份），跨集逐字复用。
2. 为每个角色/场景/道具生成锚定图（命名清晰）：

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" image --prompt "<角色 bible 的精确描述：三视图或正面清晰半身，含发型、服装配色、材质、光线；纯净背景，画面中禁止任何文字/数字/Logo>" --aspect 3:4 --out "<series>/characters"
```

- 一个对象一张图，职责唯一，登记进各自 manifest；
- **用户自有真人肖像/真实产品图优先于生成图**；复刻他人作品时人物一律生成新身份（肖像合规，见 replicate.md 红线）；
- 场景底图锁定空间/光线/色调基准，道具图锁定关键物件外观。

## 阶段 4：逐镜生成（把锚定图串进每个镜头）

按 shotlist 顺序，每镜一个子目录、提示词先存档再提交：

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" video --prompt "<shotNNNN 提示词>" --duration <秒> --ratio <比例> --image "<series>/characters/A_sheet.png" --image "<series>/locations/warehouse_night_plate.png" --out "<series>/ep01/segments/shot0101"
```

- 提示词写入 `prompts/shotNNNN.txt` 后再提交；四层结构照常，**全局锁定层跨镜逐字复用**（同一角色 bible 描述、同一场景、同一声音策略），并逐张声明 `@图片` 职责（"人物 A 外观以 @图片1 为唯一基准，不得改动脸型/发型/服装配色"）。
- 每镜完成抽 1 帧目检：脸/服装/场景是否与锚定图一致；漂移即在**新子目录**重生该镜，成功镜绝不重跑。
- 参考图含文字/标注/Logo（海报、包装、截图）时，提示词必须声明"只参考造型/氛围，画面禁止出现任何文字、数字、标注和 Logo"。

## 阶段 5：连续性追踪（跨集不漂移）

维护 `continuity.md`：每集结束后更新每个角色的**当前状态**（位置、服装、伤情、情绪、剧情推进点、与其他角色的关系变化）。下一集分镜与提示词从这里取"起始状态"，保证跨集衔接。角色换装/受伤等**外观变化必须新增一张对应锚定图**，不要指望文字描述让模型自己变。

## 阶段 6：拼接与分集交付

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" concat --dir "<series>/ep01/segments" --out "<series>/ep01/final/ep01.mp4"
```

- 先按集拼（`--dir` 逐镜合成该集），需要合成长片再用多个 `--input` 显式按集顺序拼；
- 交付按集报告：`final/epNN.mp4` 路径、该集各镜 `usage.seconds` 累加、镜头对应节拍表、`prompts/` 目录位置（提示词在此，需要可自行打开查看，不逐条粘贴）、一条预防性建议。

## 规模与成本现实

- 一部 8×60 秒短剧 ≈ 数十个镜头、合计数百计费秒——**务必先只做第 1 集验证风格与角色一致性**，用户满意再批量续做，避免整部烧完才发现主角脸不稳。
- 单镜仍受 API 限制：4–30 秒、720P。更长单场景走 pipeline.md 段内衔接。
- 即梦网页版专属能力（原生超长、局部编辑、绿幕、白模）不经此 API；需要时产出可粘贴到即梦网页的提示词作为降级并说明边界。
