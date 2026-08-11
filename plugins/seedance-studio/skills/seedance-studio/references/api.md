# 88api Seedance 2.5 API 速查

来源：88api.ai 官方文档 `/zh/docs/api/video/seedance-2-5`（2026-08 抓取）。

## 基本信息

| 项目 | 值 |
|---|---|
| Base URL | `https://88api.ai` |
| 视频模型名 | `seedance2.5满血版`（必须精确匹配） |
| 提交任务 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{id}` |
| 生图 | `POST /v1/images/generations`（`gpt-image-2` 2K / `gpt-image-2-4k` 4K） |
| 鉴权 | `Authorization: Bearer sk-xxxx` |

## 视频能力边界

- 时长 4–30 秒（`duration` 整数或 `seconds` 字符串，二选一）
- 固定 720P 输出；`resolution` 填更高不会生效
- `ratio`: `auto, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16`（优先级高于 `size`）
- `generate_audio` 默认 true；`seed` 整数，-1 随机
- 多模态 `content[]`：`text` / `image_url`（≤30，**可用 base64 Data URL 传本地图**）/ `video_url`（≤10）/ `audio_url`（≤10）
- 视频与音频参考必须公网可直连 HTTP(S)，不能依赖 Cookie 或登录态；图床 403 时换对象存储

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
| 进度长时间不动 | 上游分阶段更新，保持 10–15 秒轮询等最终状态 |

## 官方提示词建议

按"主体 → 动作 → 场景 → 镜头 → 光线 → 风格 → 音效"排列；复杂片直接写带时间段的分镜（`0–2秒：… 2–6秒：…`）。多参考图必须在提示词中说明每张图负责外观/场景/构图/风格中的哪一项。
