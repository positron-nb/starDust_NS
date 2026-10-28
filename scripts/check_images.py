"""Quality-check a folder of frames before running COLMAP.

Flags each image for:
  * blur         - variance of Laplacian below an absolute floor or a fraction of the set median
  * exposure     - too dark / too bright / heavy clipping
  * low texture  - few high-contrast blocks (blank walls, ceiling)
  * duplicate    - near-identical to the previously kept frame (camera stood still)

Writes `quality_report.csv` and `quality_summary.json` next to the image folder.
With `--move-rejects` the flagged images are moved to `<images>_rejected/` so the
folder can be fed straight into `ns-process-data`.

Example (PowerShell):
    python scripts/check_images.py data/room/images --move-rejects
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from image_metrics import dhash, exposure_stats, laplacian_variance, load_gray, texture_score  # noqa: E402

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("images", type=Path, help="folder of frames")
    ap.add_argument("--blur-abs", type=float, default=40.0, help="absolute sharpness floor (default 40)")
    ap.add_argument("--blur-rel", type=float, default=0.35, help="reject if sharpness < rel * median (default 0.35)")
    ap.add_argument("--min-brightness", type=float, default=35.0)
    ap.add_argument("--max-brightness", type=float, default=225.0)
    ap.add_argument("--max-clip", type=float, default=0.25, help="max fraction of clipped pixels (default 0.25)")
    ap.add_argument("--min-texture", type=float, default=0.15, help="min fraction of textured blocks (default 0.15)")
    ap.add_argument("--dup-bits", type=int, default=6, help="dHash Hamming distance <= this is a duplicate (default 6)")
    ap.add_argument("--move-rejects", action="store_true", help="move flagged frames to <images>_rejected/")
    args = ap.parse_args()

    files = sorted(p for p in args.images.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not files:
        print(f"error: no images in {args.images}", file=sys.stderr)
        return 2

    rows = []
    resolutions = set()
    for p in files:
        with Image.open(p) as im:
            resolutions.add(im.size)
        g = load_gray(p)
        rows.append({"file": p.name, "sharpness": laplacian_variance(g), "texture": texture_score(g),
                     "_hash": dhash(g), **exposure_stats(g)})

    median_sharp = statistics.median(r["sharpness"] for r in rows)
    blur_threshold = max(args.blur_abs, args.blur_rel * median_sharp)
    last_kept_hash = None
    for r in rows:
        reasons = []
        if r["sharpness"] < blur_threshold:
            reasons.append("blur")
        if r["brightness"] < args.min_brightness or r["dark_frac"] > args.max_clip:
            reasons.append("dark")
        if r["brightness"] > args.max_brightness or r["bright_frac"] > args.max_clip:
            reasons.append("bright")
        if r["texture"] < args.min_texture:
            reasons.append("low_texture")
        if not reasons and last_kept_hash is not None:
            if int(np.count_nonzero(r["_hash"] != last_kept_hash)) <= args.dup_bits:
                reasons.append("duplicate")
        if not reasons:
            last_kept_hash = r["_hash"]
        r["reasons"] = ";".join(reasons)
        r["keep"] = not reasons

    out_dir = args.images.parent
    with open(out_dir / "quality_report.csv", "w", newline="") as fh:
        cols = ["file", "keep", "reasons", "sharpness", "texture", "brightness", "dark_frac", "bright_frac"]
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})

    rejected = [r for r in rows if not r["keep"]]
    reason_counts: dict[str, int] = {}
    for r in rejected:
        for reason in r["reasons"].split(";"):
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
    summary = {
        "folder": str(args.images),
        "total": len(rows),
        "kept": len(rows) - len(rejected),
        "rejected": len(rejected),
        "reject_reasons": reason_counts,
        "median_sharpness": round(median_sharp, 2),
        "blur_threshold": round(blur_threshold, 2),
        "resolutions": sorted(f"{w}x{h}" for w, h in resolutions),
        "moved_rejects": args.move_rejects,
    }
    (out_dir / "quality_summary.json").write_text(json.dumps(summary, indent=2))

    if args.move_rejects and rejected:
        rej_dir = args.images.parent / f"{args.images.name}_rejected"
        rej_dir.mkdir(exist_ok=True)
        for r in rejected:
            shutil.move(str(args.images / r["file"]), rej_dir / r["file"])

    print(json.dumps(summary, indent=2))
    if summary["kept"] < 40:
        print("warning: fewer than 40 usable frames; COLMAP may fail to register the room. Re-capture or lower --fps thresholds.")
    if len(resolutions) > 1:
        print("warning: mixed resolutions; nerfstudio expects a single camera model per capture.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
