#!/usr/bin/env python3
# Depth-Anything V2 深度 worker：读取一批帧 PNG，输出同名灰度深度 PNG。
# 由 studio.mjs 的 `depth` 命令调用；ffmpeg 负责后续上色(灰度/熔岩/光谱)与合成。
# 依赖：transformers + timm + pillow + torch（CPU 即可）。
import sys, os, glob, time

def main():
    if len(sys.argv) < 3:
        print("usage: depth_video.py <frames_dir> <out_dir> [model_id]")
        sys.exit(2)
    frames_dir, out_dir = sys.argv[1], sys.argv[2]
    model = sys.argv[3] if len(sys.argv) > 3 else "depth-anything/Depth-Anything-V2-Small-hf"
    os.makedirs(out_dir, exist_ok=True)
    try:
        from transformers import pipeline
        from PIL import Image
    except Exception as e:
        print("DEPTH_DEPS_MISSING: " + str(e))
        sys.exit(3)
    imgs = sorted(glob.glob(os.path.join(frames_dir, "*.png")))
    if not imgs:
        print("no frames in " + frames_dir)
        sys.exit(4)
    t0 = time.time()
    pipe = pipeline("depth-estimation", model=model, device=-1)
    print("[depth] model=%s loaded %.1fs, frames=%d" % (model.split('/')[-1], time.time() - t0, len(imgs)))
    t1 = time.time()
    for i, p in enumerate(imgs, 1):
        img = Image.open(p).convert("RGB")
        depth = pipe(img)["depth"]  # PIL 'L' 灰度，近=亮
        depth.save(os.path.join(out_dir, os.path.basename(p)))
        if i % 10 == 0 or i == len(imgs):
            print("[depth] %d/%d  %.2fs/frame" % (i, len(imgs), (time.time() - t1) / i))
    print("[depth] done -> " + out_dir)

if __name__ == "__main__":
    main()
