# Multimodal reference control

Check `api.md` before quoting input ceilings: ≤30 images, ≤10 videos, ≤10 audio, **≤50 combined**; single take 4–30s, fixed 720P. Video/audio references must be public HTTP(S) URLs; local images can be base64 Data URLs.

## Assign one authority per dimension

Create a compact map before prompt prose:

| Dimension | Possible owner |
|---|---|
| Identity | authorized source photo or generated canonical character sheet—exactly one authority |
| Costume | keyframe image or text plan; it must not override identity |
| First/final visual state | first/last-frame image |
| Motion/blocking | video |
| Camera path and pacing | video or text plan |
| Environment | image, video, or text—but choose one winner |
| Voice/timbre | authorized audio |
| Music/tempo | audio |
| Story timing | timestamp script |
| Style/material treatment | image or text art direction |

No dimension may have two owners. One asset may own several compatible dimensions. Remove any asset that owns nothing.

## Authorized real-person identity

When the user separately provides a person photo and explicitly asks to use that person:

- Keep the source photo as the sole identity authority and pass it directly to every paid video request with `--identity-image`.
- Generate every face-bearing keyframe directly from the same source with `--identity-ref`; do not use an AI keyframe as the only parent of another face image.
- Let first/last frames own composition, costume, lighting, and endpoint only. In the prompt state that their faces must yield to the authorized identity photo.
- Run `--dry-run` and require `IDENTITY-AUDIT mode=authorized-direct`. Missing source identity is a blocking preflight failure.
- Do not infer authorization from a face appearing in the reference video. This branch requires a separately supplied photo plus an explicit “use this person” instruction.

## Reference declaration pattern

`@图片1控制角色A的脸、发型与服装；@图片2控制场景；@视频1仅控制动作节奏与运镜，不迁移其中人物、服装、场景、文字和Logo；@音频1控制角色A的授权音色；时间轴控制事件发生时机。`

Preserve every `@` tag byte-for-byte. Never translate, renumber, respell, or silently replace it.

## Choose references for stability

- Prefer 1–5 clear video/audio subjects and 1–8 image subjects even though 2.5 accepts more.
- Use clean silhouettes, uncluttered motion, and a stable camera for motion donors.
- Prefer separate images for different views instead of one dense multi-view collage when many subjects are involved.
- Keep the identity reference visually unambiguous: one character, readable face, no mirror duplicate or competing look-alike. For authorized identity, preserve the raw source as authority instead of replacing it with an AI portrait.
- Mute a video donor when its audio should not own timing.

## 2.5 reference workflows

### Audio-only generation

State what the audio controls—voice, rhythm, mood, ambience, or event timing—and build the visuals in text. Do not treat possession of audio as proof of voice or music rights.

### Creative transfer

Transfer deeper production logic only when named: emotion curve, camera language, comedy timing, commercial concept, or transition pattern. Continue to exclude donor identity, environment, logo, voice, and protected material unless authorized.

### Several people

Give each character:

- a unique identity source or distinct physical description;
- a stable screen position or role;
- separate dialogue/voice ownership;
- separate action responsibility.

State which characters may touch or cross. For crowded action, split the scene or reduce simultaneous interactions before adding more adjectives.

### Multi-panel storyboard

The storyboard owns composition, shot order, framing, and action placement—not finished identity or rendering unless explicitly assigned. Feed the panel as an `image_url` reference and declare in the prompt that it controls layout/shot order only, not identity, text, or final look.

## Rights and leakage check

Use owned, licensed, public-domain, or clearly authorized assets. For an unclear donor, transfer broad motion, pacing, mood, or camera function rather than likeness, voice, logos, or a recognizable protected design.

