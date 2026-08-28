# 完整成片管线（功能一 · 多段）

> **先运行 `models --json` 读取用户所选模型的单段上限。总时长不超过该上限时优先单段直出。** 本管线只用于超过所选模型上限、必须多场景硬切或需跨段复用同一锚定体系的成片。

用于超过模型单段上限、多场景或需要跨段一致性的成片。原则：**每步产物落盘可审，钱只烧在确认过的方案上，失败只重做失败段。**

## 阶段 0：立项

创建项目目录，写 `brief.md`：一句话想法、目标总时长、比例、风格基调、已确认项与保守假设。

## 阶段 1：规划（免费）

1. 按实时目录的 `minDuration` / `maxDuration` 拆成叙事段；段边界选在**状态清晰的静止点**，并为每段写明首帧状态与尾帧状态——后段首帧状态必须等于前段尾帧状态。
2. 写 `shotlist.json`：

```json
{
  "title": "…", "ratio": "9:16", "total_seconds": 45,
  "segments": [
    { "id": "seg01", "seconds": 12, "beat": "钩子：…",
      "start_state": "…", "end_state": "…",
      "anchors": ["girl", "cat"], "audio": "雨声渐强，无BGM" }
  ]
}
```

3. **成本确认点（唯一一次打扰用户）**：展示精确模型 ID、价格版本、实时单价、分段表、总计费秒数、总估算金额和需要的锚定图数量。确认后全程自动，不再逐段询问。

## 阶段 2：一致性素材（便宜）

所选模型支持图片参考时，跨段出现的人物、产品、场景先生成锚定图；不支持图片参考的模型必须向用户说明一致性风险，不能偷偷添加参考图：

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" image --prompt "<角色/产品/场景的精确描述，含服装、材质、光线>" --aspect 9:16 --out "<project>/assets"
```

- 每个锚定对象一张图，命名清晰（`assets/girl.png`、`assets/product_front.png`）。
- 写 `assets/manifest.json`：每张图一个唯一职责（外观/场景/构图/风格，不得竞争）。
- 用户自有素材（产品图等）直接入 assets 并登记，优先于生成图。
- 单段简单需求跳过本阶段。

## 阶段 3：逐段生成

每段独立目录、提示词存档：

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" video --prompt "<segNN 提示词>" --duration <秒> --ratio <比例> --image "<project>/assets/girl.png" --require-image --out "<project>/segments/seg01" --no-wait
```

- 提示词写入 `prompts/segNN.txt` 后再提交；段内四层结构照常，**全局锁定层各段逐字复用**（同一身份、服装、场景与声音策略描述），并声明每张 `@图片` 的职责。
- 付费提交前先 `--dry-run`，核对 `[REFERENCE-AUDIT].imageCount >= 1`；提交返回任务ID后向用户说明正在监控，再用 `status --task <ID> --wait --out <段目录>` 持续监控。
- 段首写明起始状态（承接上段尾帧），段尾写明可见结束状态。
- 顺序生成（同一锚定体系下并发意义不大且难审）；每段完成后快速抽 1 帧目检衔接状态。
- 失败段：按 troubleshooting.md 诊断，修复后在**新子目录**重交（`segments/seg03-r2/`），成功段绝不重跑。

## 阶段 4：拼接

```powershell
node "<PLUGIN_ROOT>/scripts/studio.mjs" concat --dir "<project>/segments" --out "<project>/final/final.mp4"
```

- 同 API 产出编码一致，默认流复制（无损、秒级完成）；报错时加 `--reencode`。
- 重试段与原段并存时，用多个 `--input` 显式指定正确版本，不用 `--dir` 自动扫描。
- 拼完 `ffprobe` 核对总时长。

## 阶段 5：交付

报告：实际模型与价格版本、估算和实际用量、`final/final.mp4` 绝对路径、段落表，以及一条确有必要的预防性建议。

## 段间连贯性技巧

- 身份靠锚定图锁，不靠文字描述——文字每段重写必然漂移。
- 转场偏保守：硬切最稳；需要柔和过渡时让前段以低运动收尾。
- 声音策略全片统一（都生成音频或都静音后期配乐），避免拼接处音场跳变。
- BGM 需求建议后期统一铺一条，而不是让每段各自生成音乐。
