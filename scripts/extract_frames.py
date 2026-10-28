"""Extract sharp, evenly spaced frames from a smartphone walkthrough video.

Uses the ffmpeg binary bundled with `imageio-ffmpeg`, so no system ffmpeg is needed.

Strategy: decode the video at `fps * oversample` frames per second, then keep the
sharpest frame (highest variance of Laplacian) from each consecutive group of
`oversample` frames. This keeps temporal spacing even while discarding the
motion-blurred frames that hurt COLMAP feature matching.

Example (PowerShell):
    python scripts/extract_frames.py capture/room.mp4 data/room/images --fps 2 --max-width 1600
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from image_metrics import laplacian_variance, load_gray  # noqa: E402


def probe_duration(ffmpeg: str, video: Path) -> float | None:
    """Return video duration in seconds by parsing ffmpeg's stderr banner."""
    proc = subprocess.run([ffmpeg, "-i", str(video)], capture_output=True, text=True, errors="replace")
    for line in proc.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            hms = line.split(",")[0].split("Duration:")[1].strip()
            h, m, s = hms.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path, help="input video (mp4/mov)")
    ap.add_argument("out_dir", type=Path, help="output directory for JPEG frames")
    ap.add_argument("--fps", type=float, default=2.0, help="frames kept per second of video (default 2)")
    ap.add_argument("--oversample", type=int, default=3, help="candidates decoded per kept frame (default 3)")
    ap.add_argument("--max-width", type=int, default=1600, help="downscale so width <= this (default 1600)")
    ap.add_argument("--quality", type=int, default=2, help="ffmpeg JPEG qscale, 2=best (default 2)")
    ap.add_argument("--overwrite", action="store_true", help="clear out_dir first")
    args = ap.parse_args()

    if not args.video.is_file():
        print(f"error: video not found: {args.video}", file=sys.stderr)
        return 2
    if args.out_dir.exists() and any(args.out_dir.iterdir()):
        if not args.overwrite:
            print(f"error: {args.out_dir} is not empty (use --overwrite)", file=sys.stderr)
            return 2
        shutil.rmtree(args.out_dir)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    duration = probe_duration(ffmpeg, args.video)
    t0 = time.time()
    oversample = max(1, args.oversample)
    decode_fps = args.fps * oversample

    with tempfile.TemporaryDirectory(prefix="ns_frames_") as tmp:
        tmp_dir = Path(tmp)
        vf = f"fps={decode_fps},scale='min({args.max_width},iw)':-2"
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(args.video),
               "-vf", vf, "-qscale:v", str(args.quality), str(tmp_dir / "cand_%06d.jpg")]
        print("running:", " ".join(cmd))
        subprocess.run(cmd, check=True)
        candidates = sorted(tmp_dir.glob("cand_*.jpg"))
        if not candidates:
            print("error: ffmpeg produced no frames", file=sys.stderr)
            return 1

        kept = []
        for i in range(0, len(candidates), oversample):
            group = candidates[i:i + oversample]
            scored = [(laplacian_variance(load_gray(p)), p) for p in group]
            score, best = max(scored, key=lambda x: x[0])
            dst = args.out_dir / f"frame_{len(kept) + 1:05d}.jpg"
            shutil.move(str(best), dst)
            kept.append({"file": dst.name, "sharpness": round(score, 2), "source": best.name})

    report = {
        "video": str(args.video),
        "video_duration_s": round(duration, 2) if duration else None,
        "decode_fps": decode_fps,
        "candidates": len(candidates),
        "kept_frames": len(kept),
        "max_width": args.max_width,
        "elapsed_s": round(time.time() - t0, 1),
        "frames": kept,
    }
    (args.out_dir.parent / "extract_report.json").write_text(json.dumps(report, indent=2))
    print(f"kept {len(kept)} of {len(candidates)} candidate frames -> {args.out_dir}")
    print(f"report: {args.out_dir.parent / 'extract_report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
