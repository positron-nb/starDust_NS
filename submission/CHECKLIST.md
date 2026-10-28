# Round 1 submission checklist (deadline 31 Oct 2026)

Legend: ✅ done and verified · 🟡 implemented, needs real data or your action · ⛔ blocked

| # | Deliverable | Status | What remains | Owner |
|---|---|---|---|---|
| 0 | **Real room capture** | ⛔ blocked | No capture file has been provided. Record per `capture_sop.md` and save it as `capture/room.mp4` (or a folder of photos in `capture/photos/`). | **You** |
| 1 | Pre-processing scripts (`extract_frames.py`, `check_images.py`, `splat_info.py`) | ✅ | Automated tests in `test/py`; the quality gate fails hard below `--min-frames` | |
| 2 | Reconstruction pipeline (`run_reconstruction.ps1` / `.sh`, Colab notebook) | 🟡 | Per-run folders, fail-fast gates, exact-byte metrics, draft manifest. Gates and the `web` stage are tested locally; the COLMAP, training and export stages are **not yet executed** (no GPU toolchain here, no capture). The first real run is on Colab with your capture. | You run Colab (about 1 h), or I run it locally if the CUDA toolchain gets installed |
| 3 | Web viewer (three.js + Spark, WASD, pointer lock, loading, errors, reset, exit, resize) | ✅ | Pointer-lock and Esc behaviour still to be confirmed on a normal desktop browser (the test pane blocks pointer lock) | |
| 4 | Real model loaded in viewer and calibrated | ⛔ blocked on 0, 2 | Copy `<RunId>.sog` and `<RunId>.manifest.json` to `public/models/`, calibrate (including the walk outline), then publish to `manifest.json` | Me/You |
| 5 | Public deployment URL | 🟡 | Config ready (`vercel.json`, `netlify.toml`). Deploy **after** the real model is in, then verify in incognito. A Vercel login or approval is needed. | You approve |
| 6 | Technical abstract PDF (≤ 5 pages) | 🟡 draft | `submission/drafts/technical_abstract_DRAFT.pdf` renders at 3 pages. Fill team name, URLs, measured metrics and real screenshots, then render the final version with `scripts/render_pdf.ps1`. | Me after data |
| 7 | Demo video (3–5 min) | 🟡 plan | `submission/demo_storyboard.md` has the shot list and narration. Recording needs the real model and the live URL. | **You** record |
| 8 | Code repository (public GitHub) | ✅ | https://github.com/positron-nb/starDust_NS. Teammates can clone it now; add them as collaborators for push access. | |
| 9 | Sample data in `test/` | 🟡 | Synthetic fixture present. Add about 30 real frames (nothing private visible) after capture. | Me after data |
| 10 | Additional links PDF | 🟡 template | `submission/abstract/additional_links_and_prototypes.html`. Render only once every link is live and tested. | Me after data |
| 11 | Google Drive folder ("Anyone with the link can view") | ⛔ | Create the folder, upload items 6, 7 and 10, the code zip and outputs, set sharing, and test logged out | **You** (or me via Drive connector with your approval) |
| 12 | Team name/ID in documents | ⛔ | Not known yet | **You** |
| 13 | CI (GitHub Actions) | 🟡 | `.github/workflows/ci.yml` runs install, tests and build on every push. Check the first run is green. | |

## Critical path (about 4 days left)

1. **Today/tomorrow:** capture the room (15 min, see the SOP), then run Colab (about 45–90 min).
2. Load the model, calibrate it, deploy it, and verify in incognito.
3. Take screenshots, fill `metrics.md`, finalise the abstract and links PDFs.
4. Record and edit the demo (about 2 h).
5. Assemble the Drive folder and submit by **30 Oct** to leave a day of buffer.
