# Measured metrics

Rule: only numbers that were actually measured go here. Every value has a source file or measurement method. `PENDING` means the measurement has not been made yet.

## A. Real-room reconstruction: PENDING (no capture processed yet)

| Metric | Value | Source |
|---|---|---|
| Space captured (room, approx. area) | PENDING | capture notes |
| Phone, lens, video mode | PENDING | phone metadata |
| Video duration / resolution / fps | PENDING | `data/room/extract_report.json` |
| Candidate frames → kept by sharpness selection | PENDING | `extract_report.json` |
| Frames after quality gate (rejected: blur / dark / bright / low-texture / duplicate) | PENDING | `quality_summary.json` |
| Registered cameras (COLMAP) / frames used | PENDING | `run_metrics.json → registered_cameras, frames_used` |
| COLMAP time | PENDING | `run_metrics.json → colmap_seconds` |
| Training method / iterations / time | PENDING | `run_metrics.json → method, max_iterations, train_seconds` |
| GPU (local or Colab) | PENDING | `nvidia-smi` |
| Exported splat count / PLY size | PENDING | `splat_info.json`, `run_metrics.json → export_ply_mb` |
| Web model (SOG) size and compression ratio | PENDING | `run_metrics.json → web_model_mb` |
| Viewer load time (deployed, incognito, cold cache) | PENDING | viewer HUD "Load" |
| Viewer FPS (desktop, 60 s walk), GPU and browser | PENDING | viewer HUD "FPS" |

## B. Pipeline and viewer verification on test data (measured 2026-10-27)

Machine: Windows 11, Ryzen 9 270, RTX 5060 Laptop 8 GB, Python 3.12.10, Node 24.19.0.

| Test | Result |
|---|---|
| `extract_frames.py` on a 10 s, 1080p30 generated video, `--fps 2` | 60 candidates → 20 kept, output 1600×900 |
| `check_images.py` on those frames | 20 kept / 0 rejected, median sharpness 137.45, blur threshold 48.11 |
| Synthetic splat fixture | 79,102 splats, 5.1 MB PLY |
| `splat-transform` PLY → SOG / SPZ | 151.5 KB / 144.0 KB (synthetic, SH degree 0, not representative of real scenes) |
| Viewer: load of synthetic SOG on local dev server | 0.03–0.25 s, 79,102 splats |
| Viewer: `W` for 1.5 s | 2.11 m travelled (expected 1.4 m/s × 1.5 s, about 2.1 m) |
| Viewer: production bundle | JS 3.06 MB (1.03 MB gzip), CSS 7 KB, HTML 6.5 KB |
| Viewer: error paths (missing manifest, missing model) | Correct error card shown, Start disabled |
| Viewer: 375 px mobile width | No horizontal scroll, overlay card 343 px |

FPS was **not** measured, because the embedded test browser runs as a background page and its timings are not representative.
