# Troubleshooting and retakes

## Diagnose before rewriting

Classify the failure as identity, reference conflict, action density, timing, camera, edit scope, transition continuity, audio, white-model mapping, compositing, or sampling variance. Change one variable per retry.

## Common failures

| Symptom | Likely cause | First repair |
|---|---|---|
| Generic AI-looking face | Vague beauty terms, no skin/landmark detail | Use the character realism formula: age, texture, 3–4 landmarks, gaze, hair, garment material, build |
| Several people look alike | Shared description or unclear identity owners | Give each person a separate reference/paragraph, fixed clothing, role, position, voice, and `不串脸` lock |
| Identity drifts in long video | Too many changes compete with identity | Reduce simultaneous events; repeat identity/costume locks globally and at major scene changes |
| Reference leakage | One donor controls too many dimensions | Assign one authority per dimension and state what must not transfer |
| Random subtitle or BGM | Sound/text intent omitted | State the desired sound and `全程无字幕、无背景音乐`; repeat once globally |
| Action is stiff or deformed | Too many actors/contacts or incomplete action chain | Reduce simultaneous contacts; write start → trigger → change → response → endpoint |
| Long story becomes incoherent | Timestamps describe isolated resets | Carry position, prop, motivation, and end state from each segment into the next |
| Extension has a seam | Source endpoint or transition carrier is missing | Start from the observed/user-reported final state; inherit motion/camera/audio phase; name the physical bridge |
| Edit changes the whole video | Prompt describes a new scene instead of a layer edit | Use annotation + exact target + A→B + time + preserve list |
| Viewpoint edit changes identity | New camera demand overrules preservation | Lock identity/action/time first; ask only for camera relocation and consistent spatial completion |
| Green edge or pasted look | Missing spill/light/contact constraints | Remove green spill; match light direction, perspective, contact shadow, motion blur, and depth |
| White model remains visible | Mapping/render instruction is ambiguous | Explicitly replace every model and ban white-model material and viewport guides |
| Storyboard order is wrong | Panel order/meaning is unstated | Declare reading order and that each panel is a complete shot; number every timestamped shot |
| Transition is still a hard cut | “Smooth” has no mechanism | Name shared object/shape/color/occlusion/motion and enforce position, size, speed, direction continuity |

## Retake economy

Use one verdict:

- **Keep:** the main purpose is delivered and remaining flaws are minor.
- **Fix in post:** text, mix, trim, color, or a few edge frames are cheaper outside generation.
- **Edit:** composition/timing are right and one layer is wrong.
- **Re-roll:** the prompt is sound and the failure appears random; try the same prompt no more than two or three times.
- **Rewrite:** the same flaw repeats; simplify or change the workflow.

Change only one of: one prompt clause, one reference, mode, duration, or seed. If the same failure survives two takes, stop adding quality adjectives and change structure.

## Output for a repair request

Return:

1. root cause in one sentence;
2. the single change being tested;
3. one conservative repaired prompt;
4. an edit-mode alternative when the source is mostly correct.

