# Measured metrics

Rule: only numbers that were actually measured go here. Every value has a source file or measurement method. `PENDING` means the measurement has not been made yet.

## A. Real-room reconstruction (run `room-20261029-1220`, measured 2026-10-29)

| Metric | Value | Source |
|---|---|---|
| Space captured | Team member's room (window, desk, wall hooks, wardrobe); area PENDING | capture notes |
| Phone, lens, video mode | PENDING | phone metadata |
| Video duration / resolution / fps | 211.4 s (3:31), 2560×1440, 59.99 fps, HEVC, 611 MB | ffmpeg probe of `capture/room.mp4` |
| Candidate frames → kept by sharpness selection | 1,269 candidates (6 fps) → 423 frames (2 fps, sharpest of 3), 1600×900 | `data/runs/room-check/extract_report.json` |
| Frames after quality gate | 345 kept / 78 rejected (18.4 %): 77 blur, 2 low-texture, 1 duplicate. Median sharpness 263.3, threshold 92.2. The worst rejects are tilts up at the bare ceiling or wall. | `data/runs/room-check/quality_summary.json` |
| Registered cameras (COLMAP) / frames used / ratio | **221 / 328 = 0.674**, one model, 67,737 points, mean reprojection error 0.54 px. Below our 0.7 gate; training was resumed manually with `--skip-to train` after inspecting the model. | `run_metrics.json`; `colmap model_analyzer` |
| COLMAP time (CPU, Colab: apt build has no CUDA) | feature extraction ≈ 13 min, sequential matching 40.3 min, mapping 29.5 min (≈ 83 min total) | COLMAP timers and process start times (stage stopped at the gate, so `colmap_seconds` was not written) |
| Training method / iterations / time | splatfacto, 30,000 iterations, 7,204 s total, of which ≈ 60 min was gsplat's one-time CUDA JIT build (`MAX_JOBS=2`); ≈ 185 ms/iteration, ≈ 7.7 M rays/s | `run_metrics.json → train_seconds`; training log |
| GPU | Google Colab NVIDIA T4; 90 % utilisation, 5.6 GB used during training | `nvidia-smi` |
| Exported splat count / PLY size (bytes) | 2,133,204 of 2,267,954 Gaussians (134,750 low-opacity dropped, 0 NaN); SH degree 3; 529,036,186 bytes; export 122 s | `splat_info.json`, `run_metrics.json` |
| Web model size and compression ratio | SPZ v3: 44,983,678 bytes (42.9 MiB), **11.8×** smaller than the PLY; conversion 31 s. (SOG failed on Colab: no WebGPU adapter.) | `run_metrics.json` |
| Metric calibration | 1.949 m per model unit, from median camera height 0.667 units = 1.3 m (SOP chest height); footprint ≈ 2.8 × 4.1 m; walk outline = camera path hull + 0.3 m. **Verified**: renders from the recovered poses of frames 77 and 250 match the original photos. | `scripts/calibrate_from_poses.py` |
| Viewer load on local dev server (not a deployment measurement) | 2,133,204 splats loaded in 1.2–2.7 s | viewer HUD |
| Viewer cold load time (deployed, incognito, DevTools cache disabled) and peak JS heap | PENDING | viewer HUD "Load"; DevTools Performance/Memory |
| Viewer FPS: average and minimum over a 60 s walk, with browser, GPU and window resolution | PENDING | viewer HUD "FPS" (sampled every 0.5 s) |

## B. Pipeline and viewer verification on test data (measured 2026-10-27 and 2026-10-29)

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
| Automated tests (`npm test`, 2026-10-29) | 19/19 JS (manifest validation, polygon walk area) and 5/5 Python (extraction, quality gate pass/fail/zero-frames, splat info and draft manifest) |
| Windows pipeline gates (2026-10-29) | Quality gate stops the run at exit code 3; re-using a run folder is refused; resuming an unknown run is refused; a missing COLMAP or nerfstudio tool stops the run with a clear message |
| Windows `web` stage on the synthetic PLY (simulated export) | 155,108-byte SOG plus a draft manifest whose floor (0.0) and bounds ([0.15, −2.85]–[3.85, −0.15]) match the room's known geometry |

FPS was **not** measured, because the embedded test browser runs as a background page and its timings are not representative.
