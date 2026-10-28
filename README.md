# Namma Space: smartphone capture to browser walkthrough

Round 1 submission for **Namma Space, Techfest IIT Bombay 2026–27** (3D Reconstruction & Roaming).

The pipeline turns an ordinary smartphone video of a real indoor room into a photorealistic **3D Gaussian Splatting** model. The model is explored in first person in any desktop browser with **WASD and the mouse**, with nothing to install.

```
phone video ─► frame extraction + quality gate ─► COLMAP SfM poses ─► Splatfacto (nerfstudio/gsplat)
            ─► ns-export gaussian-splat (.ply) ─► splat-transform (.sog, compressed) ─► Spark.js + Three.js viewer ─► static host
```

> **Status (2026-10-27):** pipeline scripts, viewer and docs are implemented and tested on a **synthetic** test scene. The real-room reconstruction has **not** been run yet because no capture file has been provided. Until then, the viewer's default manifest loads a clearly labelled synthetic room. See [`submission/CHECKLIST.md`](submission/CHECKLIST.md).

## Repository layout

| Path | Contents |
|---|---|
| `capture_sop.md` | Capture SOP: room choice, phone settings, route, failure modes, verification |
| `scripts/extract_frames.py` | Video to sharpest-of-N frames (bundled ffmpeg, no system install) |
| `scripts/check_images.py` | Blur, exposure, texture and duplicate gate with CSV/JSON report |
| `scripts/run_reconstruction.ps1` / `.sh` | End-to-end pipeline with per-stage timing in `run_metrics.json` |
| `scripts/splat_info.py` | Splat count, bounds and floor estimate of an exported `.ply` |
| `scripts/make_test_splat.py` | Generates the synthetic test room (viewer/pipeline fixture) |
| `notebooks/namma_space_colab.ipynb` | Same pipeline on a hosted Colab GPU |
| `app/` | Viewer source (`index.html`, `main.js`, `style.css`) |
| `public/models/` | Web model(s) + `manifest.json` (which model to load and how to align it) |
| `test/` | Sample data and the documented test workflow |
| `docs/` | Environment setup, architecture, deployment notes |
| `submission/` | Abstract source, metrics, demo storyboard, links document, checklist |

## 1. Run the viewer (Windows, macOS, Linux)

Requires Node.js ≥ 20 (tested with Node 24.19 and npm 11.17).

```powershell
npm ci          # three 0.186.1, @sparkjsdev/spark 2.3.1, vite 8.3.4 (exact pins)
npm run dev     # http://localhost:5173
```

| Control | Action |
|---|---|
| Click **Start walkthrough** | Locks the mouse pointer |
| `W A S D` / arrows | Walk (1.4 m/s) |
| Mouse | Look |
| `Shift` | Walk faster (2×) |
| `Q` / `E` | Lower or raise eye level (±0.6 m) |
| `R` | Reset to start pose |
| `F` / `I` | Fullscreen / technical HUD |
| `Esc` | Release mouse (pause). The dock's exit button ends the walkthrough. |

If the browser refuses pointer lock (for example inside an iframe), the viewer falls back to drag-to-look. URL options: `?calibrate` opens the alignment panel, `?dpr=1` lowers render resolution on weak GPUs, and `?manifest=models/other.json` loads another manifest.

Production build: `npm run build` writes a static site to `dist/`, and `npm run preview` serves it locally.

## 2. Reconstruct a room

Follow [`capture_sop.md`](capture_sop.md) to record `capture/room.mp4` (the folder is git-ignored). Then run the pipeline using one of the options below.

**Option A, hosted GPU (recommended):** open `notebooks/namma_space_colab.ipynb` in Google Colab ([open in Colab](https://colab.research.google.com/github/positron-nb/starDust_NS/blob/main/notebooks/namma_space_colab.ipynb)) with a GPU runtime, upload the video and run all cells. Download `room.sog` and `namma_outputs.zip`.

**Option B, local:** see [`docs/environment.md`](docs/environment.md) for the CUDA/COLMAP/nerfstudio install, then:

```powershell
.\scripts\run_reconstruction.ps1 -Video capture\room.mp4 -Workspace data\room
# resume from a stage:   -SkipTo colmap | train | export | web
# photos instead:        -Images path\to\photos -Matching exhaustive
```

Stages and the commands they run:

| Stage | Command |
|---|---|
| frames | `python scripts/extract_frames.py <video> data/room/images --fps 2 --max-width 1600` + `check_images.py --move-rejects` |
| colmap | `ns-process-data images --data data/room/images --output-dir data/room/processed --matching-method sequential` |
| train | `ns-train splatfacto --data data/room/processed --output-dir data/room/outputs --max-num-iterations 30000 --viewer.quit-on-train-completion True` |
| export | `ns-export gaussian-splat --load-config <outputs/.../config.yml> --output-dir data/room/exports` |
| web | `npx @playcanvas/splat-transform@3.10.1 data/room/exports/splat.ply --filter-nan public/models/room.sog -w` |

## 3. Replace the model with a newly captured room

1. Put the converted model in `public/models/`, for example `room.sog`. Spark also loads `.ply`, `.spz`, `.splat` and `.ksplat`.
2. Edit `public/models/manifest.json`: set `"file": "models/room.sog"`, `"provenance": "reconstruction"` and `"name"`.
3. Run `npm run dev` and open `http://localhost:5173/?calibrate`:
   - Use **Rotate X/Y/Z** until the floor is level (nerfstudio exports are z-up, so `[-90, 0, 0]` is the usual starting point).
   - Use **Scale** until a known dimension looks right (COLMAP is scale-free; for example, a door should look about 2 m high).
   - **Fit bounds** estimates floor height and the walkable rectangle from splat percentiles.
   - Walk to the entrance and press **Set start here**.
   - **Copy manifest JSON** and paste it into `manifest.json`.
4. Run `npm run build` and redeploy.

## 4. Asset size and deployment strategy

| Model size (web file) | Strategy |
|---|---|
| ≤ 50 MB | Commit to `public/models/` (GitHub warns above 50 MB per file) and deploy `dist/` to Vercel, Netlify or GitHub Pages. |
| 50–90 MB | Keep it out of git and deploy `dist/` straight from the CLI (Vercel Hobby allows 100 MB of uploaded static files in total). Better: shrink it with splat-transform `-H 2` (drop the 3rd SH band) or `--decimate 70%`. |
| > 90 MB | Host the model on object storage with CORS (Cloudflare R2, Hugging Face dataset, GitHub Release asset behind a CORS proxy) and put the absolute URL in `manifest.json → file`. |

SOG compresses a PLY by roughly an order of magnitude. The synthetic 5.1 MB PLY becomes a 0.15 MB SOG, but real scenes compress less because they carry full spherical harmonics, so record the measured ratio in `submission/metrics.md`. Full notes are in [`docs/deployment.md`](docs/deployment.md).

## 5. Tests

See [`test/README.md`](test/README.md). In short:

```powershell
python scripts\make_test_splat.py test\sample_data\synthetic_room.ply   # regenerate fixture
python scripts\splat_info.py test\sample_data\synthetic_room.ply        # 79,102 splats, floor 0.0
npm run build; npm run preview                                            # viewer loads fixture
```

## 6. What this is not

- **No collision detection.** Gaussian splats have no surfaces. The viewer keeps the camera at a fixed eye height above a calibrated floor and inside a rectangle derived from splat extents. That stops you leaving the room but does not stop you walking through furniture. Obstacle-aware navigation (occupancy grid from splats or COLMAP points) is Round 2 scope.
- No POIs, pathfinding or AR in Round 1.

## Credits and licences

This project's code is MIT-licensed (see `LICENSE`). It builds on COLMAP (BSD-3), nerfstudio (Apache-2.0), gsplat (Apache-2.0), Spark (MIT), three.js (MIT), splat-transform (MIT), Vite (MIT) and FFmpeg via imageio-ffmpeg (LGPL/GPL binaries, BSD-2 wrapper). Full citations are in [`references.md`](references.md).
