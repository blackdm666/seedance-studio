# Long video, timestamps, and native extension

## Choose the route

| Need | Route |
|---|---|
| One multi-phase clip up to 30s | Basic 2.5 generation with a timestamp script |
| One complete story lasting 30–180s | Ultra-long mode |
| Continue the same accepted footage | Native extension |
| Start a genuinely new scene | Intentional cut or a new generation from canonical references |

## 30-second prompt

Use three modules:

1. **Reference layer:** declare what each uploaded asset controls and lock identity/space where needed.
2. **Global setting:** environment, look, camera grammar, character design, performance core, sound policy, and critical exclusions.
3. **Timestamp script:** divide the clip into readable phases. For each phase write physical action first, then the emotional or narrative reason only if it improves performance.

Template:

```text
[Title and one-line intention]
[Reference roles]

Global: [environment and physical look]. [camera grammar]. [character locks]. [sound policy].

0–Xs: [initial state, visible action, camera, sound, endpoint].
X–Ys: [trigger and response, camera transition, sound, endpoint].
Y–30s: [decisive change and final image].

Throughout: [identity/continuity locks]. No [subtitles/BGM/deformation/unwanted elements].
```

Use fewer, longer phases for subtle acting; use shorter phases for clear action or montage. Do not pack a new location, character, camera trick, and plot turn into every two seconds.

## Ultra-long 30–180s prompt

Place duration and aspect ratio first. Then use:

`global parameters + reference roles + story premise + timestamped scenes + global continuity locks`

Every scene needs:

- a narrative job;
- start state and end state;
- location/time continuity;
- a clear transition into the next scene;
- which characters, props, and sounds persist.

For 60s or longer, plan an arc: opening promise → escalation → turn → climax → release. Keep recurring identity, costume, scale, and core visual motif in the global lock. Prefer one dominant camera grammar for the whole piece and one deliberate break at the narrative turn.

## Native extension

Use only the accepted source, not an imagined ending. If the client can inspect the source, record the observed final state; otherwise ask for or use the user's description.

Start with:

`参考@视频1的已生成内容，向后延长[时长]。完整保留原视频；新增提示词只作用于延长部分。`

### Seamless one-take extension

Add:

`延长自然，动作、视线、速度、镜头运动、环境运动与声音连续；禁止生硬切镜，禁止物体凭空出现。`

Then describe the new action, consequence, and endpoint.

### Extension with a cut or transition

Use:

`transition type + source ending + transition mechanism + destination opening + framing change + continuity locks`

Useful transitions:

- natural cut for ordinary narrative;
- fade for beginnings, endings, or time passage;
- dissolve for memory or gentle time change;
- white/black flash for impact and beat-driven edits;
- wipe for graphic or location shifts;
- occlusion/mask for crossing spaces;
- match shape/color for montage;
- whip/action match for energy;
- motion relay for outfit/location changes;
- extreme push/pull for scale changes;
- ink diffusion for poetic or period material.

Name the physical bridge. “Smooth transition” alone is not a plan.

## Continuity locks

Carry forward only what must persist: identity, costume condition, prop ownership, body direction, movement vector, camera phase, lighting direction, weather, ambience, unfinished dialogue, and the exact endpoint. Do not replay completed action or introduce a later beat early.

