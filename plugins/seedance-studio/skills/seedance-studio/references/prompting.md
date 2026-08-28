# Core prompting

## Default drafting flow

1. Name one intention: what should the viewer feel or understand by the end?
2. Choose the mode before writing prose.
3. Map references before describing style.
4. Write the primary subject and visible change early.
5. Add one motivated camera plan, physical light source, sound intent, and an observable endpoint.
6. Add only constraints that protect identity, continuity, anatomy, props, sound, or delivery.

## Universal video-prompt structure

`[Reference declaration] + [one-line overview] + [storyline or timestamp progression] + [global locks]`

For a simple 4–15s clip, compress it to:

`[Subject and scene]. [Visible action and endpoint]. Camera: [one move]. Light: [source]. Sound: [ambience/SFX/dialogue/silence]. Keep [critical locks]; no [critical exclusions].`

Do not force timestamps into a single simple action. Use them when the clip has multiple phases, dialogue beats, edits, or precise event timing.

## Prefer one single-pass take

Read the selected model's live `minDuration` and `maxDuration` first. When the requested duration fits one call, **default to a single take, not stitched segments**—one pass keeps pacing, transitions, lighting, and identity continuous, with no seam and lower cost. Split only when the clip exceeds that model's live single-call limit or genuinely needs a hard scene cut.

For a longer single take, write the **story arc first** (opening → progression → turning point → ending), then fill in shot/camera/light detail per beat.

## Reference declaration

Write what every asset controls and what it must not transfer:

`@图片1 controls character identity and costume. @视频1 controls movement rhythm and camera path only; do not transfer its performer, room, logo, or color palette. @音频1 controls tempo only.`

Preserve the platform's exact tag spelling, language, spacing, and number.

## Character realism formula

Build a distinctive person from observable dimensions:

`age/heritage + skin tone and real texture + 3–4 facial landmarks + gaze and underlying emotion + hair color/style/state + garment cut/material/wear + build/posture/temperament + optional framing`

Prefer concrete individuality over beauty boosters. Include real pores, fine lines, freckles, scars, fabric wear, asymmetry, or a specific bone structure when relevant. For several people, give each a separate identity paragraph and lock clothing, face, body scale, and role throughout.

## Visible performance

Translate emotion into behavior:

- Replace “sad” with gaze break, delayed inhale, tightened jaw, a restrained tear, or a hand that stops before contact.
- Replace “confident” with posture, pace, eye line, gesture economy, and how the character occupies space.
- Keep dialogue short enough to fit the assigned time segment.

## Camera and edit language

- Give each shot one primary move with a start and endpoint.
- For multi-shot work, state the cut or transition between shots.
- Keep the important action visible at the moment it happens.
- Use close-ups for one decisive detail, not as a generic “cinematic” adjective.

## Sound policy

State one of: natural ambience, specific SFX, dialogue, voice reference, music, or silence. When clean footage matters, write `全程无字幕、无背景音乐，仅保留[环境声/人声/指定音效]` and repeat it once in the global lock.

### Seedance 2.5 sound syntax (only when that model is selected)

Seedance 2.5 generates synced audio natively. Do not apply this syntax to other models unless their live description or verified documentation says so.

- Music → `( )`  · SFX → `< >`  · Dialogue → `{ }`  · On-screen subtitle → `【 】`
- Example: `女孩转身微笑 {你终于来了}<关门声>（温柔的钢琴）`

### Native multilingual voice (11 languages)

Prompt input and **spoken output** are native in: Chinese, English, Spanish, Indonesian, Malay, Thai, Arabic, Portuguese, Vietnamese, Japanese, Korean. **A Chinese `{台词}` yields native Mandarin speech directly—no external TTS needed for a single short/TVC.** Prefix non-Chinese lines with the language, e.g. `{英语：Welcome back}`. Caveat: there is no voice-ID lock, so timbre can drift across separate generations—for multi-shot voice consistency, still decouple to a fixed-preset TTS.

**Verified 2026-08 (88api): dialogue is voiceover only—the character's mouth does NOT lip-sync to it.** Native `{台词}` lays a clean spoken track over the shot, but the speaker's lips won't match the words. For a talking-head where the mouth must sync, don't rely on native dialogue: frame away from a mouth close-up, cut to B-roll while the line plays, or route the shot to a dedicated lip-sync tool (即梦网页 对口型). This is a model trait, confirmed identical for Chinese and English.

## Final quality pass

Confirm:

- Reference roles do not conflict.
- The viewer can see the main change and endpoint.
- Timestamps cover the intended duration without gaps or overlaps.
- Character and prop identity remain stable.
- Camera instructions do not hide the action.
- Sound, subtitle, and BGM intent are explicit.
- Generic boosters such as “stunning, epic, masterpiece, 8K” have been replaced by physical, visual instructions.

