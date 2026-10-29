# Round 1 submission checklist (deadline 31 Oct 2026)

Legend: ✅ done and verified · 🟡 in progress or needs your action · ⛔ blocked

Updated 2026-10-29.

| # | Deliverable | Status | What remains | Owner |
|---|---|---|---|---|
| 0 | Real room capture | ✅ | `capture/room.mp4` (3:31, 2560×1440 at 60 fps). 423 frames extracted, 345 passed the quality gate. | |
| 1 | Pre-processing scripts | ✅ | Automated tests in `test/py`. The quality gate fails hard below `--min-frames`. | |
| 2 | Reconstruction pipeline | ✅ | Ran end to end on Colab T4 (run `room-20261029-1220`): frames → COLMAP 221/328 → Splatfacto 30k → export → SPZ. Fixes found during the run are pushed: CPU COLMAP fallback, gsplat `MAX_JOBS`, torch 2.6 load, SPZ fallback. | |
| 2b | Local GPU COLMAP | ✅ | `scripts/colmap_gpu.ps1` on the RTX 5060 registers **326/328** frames in ~33 min. | |
| 2c | Improved model from GPU COLMAP (`room-gpu-v1`) | 🟡 | Train on Colab with `--colmap-model`, then calibrate (`calibrate_from_poses.py`) and swap in if it covers more of the room. | You run Colab, I calibrate |
| 3 | Web viewer | ✅ | WASD, pointer lock, loading, errors, reset, exit, resize, walk outline, local file open. Real pointer lock and FPS are still to be confirmed on a normal desktop browser. | **You**: open the link and walk around |
| 4 | Real model loaded and calibrated | ✅ | 1.949 m/unit from camera height. Renders at recovered poses match the original photos. | |
| 5 | Public deployment URL | ✅ | **https://stardust-ns.vercel.app/**. Public, no login. Cold load 10.0 s. Auto-deploys on every push to `main`. | |
| 6 | Technical abstract PDF (≤ 5 pages) | 🟡 | Draft renders at 4 pages. Still needed: team name/ID, URLs, real screenshots, final metrics. | Me + your team name |
| 7 | Demo video (3–5 min) | 🟡 | `submission/demo_storyboard.md` has the shot list. Record the capture footage, Colab, the live URL and the walkthrough. | **You** record |
| 8 | Code repository (public GitHub) | ✅ | https://github.com/positron-nb/starDust_NS. CI green. Teammates invited. | |
| 9 | Sample data in `test/` | 🟡 | Synthetic fixture present. Add about 30 real frames with nothing private visible. | Me |
| 10 | Additional links PDF | 🟡 | Viewer and repo links are filled. The demo video and Drive links are still missing. | Me after video |
| 11 | Google Drive folder ("Anyone with the link can view") | ⛔ | Create the folder, upload items 6, 7 and 10 plus the code zip and outputs, set sharing, and test while logged out. | **You** |
| 12 | Team name/ID in documents | ⛔ | Not known yet. | **You** |
| 13 | CI (GitHub Actions) | ✅ | Install, tests, build, dist check and a bash pipeline smoke test run on every push. | |

## Critical path (deadline 31 Oct)

1. Open https://stardust-ns.vercel.app/ on your laptop, walk around, and note the FPS from the HUD (press `I` if it is hidden).
2. Optional: train `room-gpu-v1` on Colab. I calibrate it and swap it in if it covers more of the room.
3. Send your team name/ID. I take screenshots and finalise the abstract and links PDFs.
4. Record and edit the demo (about 2 h).
5. Assemble the Drive folder and submit by **30 Oct** to keep a day of buffer.
