#!/usr/bin/env python3
# 多人姿态骨架 worker（武打/动作反推用）：读一批帧 PNG，用 YOLO-pose 检测多人 17 关键点，
# 输出 ①骨架叠加原帧(overlay/) ②纯黑底骨架(skeleton/)。由 studio.mjs 的 `depth --mode action` 调用。
# 依赖：ultralytics + opencv（CPU 即可）。多人=能同时框两名对打者。
import sys, os, glob, time

# COCO-17 骨架连线
SK = [(5,7),(7,9),(6,8),(8,10),(11,13),(13,15),(12,14),(14,16),
      (5,6),(11,12),(5,11),(6,12),(0,1),(0,2),(1,3),(2,4),(0,5),(0,6)]
# 每名选手一种颜色(BGR)，最多区分 6 人
PCOL = [(60,220,60),(60,120,255),(255,180,40),(200,60,255),(40,220,220),(255,90,160)]

def main():
    if len(sys.argv) < 4:
        print("usage: pose_video.py <frames_dir> <overlay_dir> <skeleton_dir> [model]")
        sys.exit(2)
    frames_dir, overlay_dir, skel_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    model_name = sys.argv[4] if len(sys.argv) > 4 else "yolo11n-pose.pt"
    os.makedirs(overlay_dir, exist_ok=True); os.makedirs(skel_dir, exist_ok=True)
    try:
        import cv2, numpy as np
        from ultralytics import YOLO
    except Exception as e:
        print("POSE_DEPS_MISSING: " + str(e)); sys.exit(3)
    imgs = sorted(glob.glob(os.path.join(frames_dir, "*.png")))
    if not imgs:
        print("no frames in " + frames_dir); sys.exit(4)
    t0 = time.time()
    try:
        model = YOLO(model_name)
    except Exception as e:
        print("POSE_MODEL_LOAD_FAIL: " + str(e)); sys.exit(5)
    print("[pose] model=%s loaded %.1fs, frames=%d" % (model_name, time.time()-t0, len(imgs)))
    t1 = time.time(); total_people = 0
    for i, p in enumerate(imgs, 1):
        img = cv2.imread(p)
        if img is None:
            continue
        h, w = img.shape[:2]
        black = (img * 0).copy()
        res = model(img, verbose=False)[0]
        kps = res.keypoints
        n = 0
        if kps is not None and kps.xy is not None:
            xy = kps.xy.cpu().numpy()            # (P,17,2)
            cf = kps.conf.cpu().numpy() if kps.conf is not None else None  # (P,17)
            n = xy.shape[0]
            for pi in range(n):
                col = PCOL[pi % len(PCOL)]
                pts = xy[pi]; conf = cf[pi] if cf is not None else [1.0]*17
                for a, b in SK:
                    if conf[a] > 0.3 and conf[b] > 0.3:
                        pa = (int(pts[a][0]), int(pts[a][1])); pb = (int(pts[b][0]), int(pts[b][1]))
                        cv2.line(img,   pa, pb, col, 3, cv2.LINE_AA)
                        cv2.line(black, pa, pb, col, 3, cv2.LINE_AA)
                for k in range(17):
                    if conf[k] > 0.3:
                        c = (int(pts[k][0]), int(pts[k][1]))
                        cv2.circle(img,   c, 4, (255,255,255), -1, cv2.LINE_AA)
                        cv2.circle(black, c, 4, (255,255,255), -1, cv2.LINE_AA)
        total_people += n
        base = os.path.basename(p)
        cv2.imwrite(os.path.join(overlay_dir, base), img)
        cv2.imwrite(os.path.join(skel_dir, base), black)
        if i % 10 == 0 or i == len(imgs):
            print("[pose] %d/%d  %.2fs/frame  avg_people=%.1f" % (i, len(imgs), (time.time()-t1)/i, total_people/i))
    print("[pose] done -> overlay:%s  skeleton:%s" % (overlay_dir, skel_dir))

if __name__ == "__main__":
    main()
