# Capture SOP: smartphone to Gaussian-splat room

This standard operating procedure (SOP) defines how a non-expert captures an indoor space with only a smartphone so that the Namma Space pipeline (COLMAP followed by Splatfacto) can reconstruct it without any manual 3D modelling. Each rule says why it exists, because each one maps to a known failure mode of Structure-from-Motion or Gaussian splatting.

---

## 1. Choose the space

| Choose | Avoid | Why |
|---|---|---|
| One room of 10–30 m² (bedroom, study, living room) for Round 1 | Whole flats or several rooms in one take | COLMAP registers one well-connected room far more reliably. Multi-room capture is a Round 3 extension (§9). |
| Furnished, with posters, books, rugs and plants | Bare white rooms, glass walls, large mirrors | SfM needs distinctive texture to match features. Reflections create "phantom rooms" behind mirrors. |
| A room you can light evenly and keep still for about 5 min | Rooms with people, pets, ceiling fans or TVs playing | Anything that moves breaks multi-view consistency and produces floaters. |
| A space with no private material on show | Visible documents, family photos, screens with personal data | The model is published publicly. |

**Before capture (2 min):** switch on all lights, close curtains if direct sun creates hard patches, turn off fans and screens, and put away or turn face-down anything private, including photos, documents and mail. Tidy cables. Keep doors in the pose they will have in the model. Mirrors can be partially covered with a cloth.

## 2. Phone settings

| Setting | Value | Reason |
|---|---|---|
| Lens | Main **1×** wide lens. Do not switch lenses mid-capture | One consistent intrinsic camera model. The ultra-wide has strong distortion and lower sharpness. |
| Mode | **Video, 4K at 30 fps** (1080p at 60 fps acceptable) | Video gives dense, overlapping viewpoints. 4K leaves room to downsample. |
| Stabilisation | Standard OIS or EIS **on**. Avoid "Action/Super steady" modes | Super-steady crops and warps frames, which changes the effective intrinsics. |
| HDR / exposure | Lock exposure and focus (long-press on a mid-grey wall). Disable auto-HDR if possible | Frame-to-frame brightness changes appear as colour flicker in the splats. |
| Zoom | None | Changing focal length breaks the single-camera assumption. |
| Orientation | Hold the phone in one orientation (landscape preferred) for the whole capture | Mixed resolutions are rejected by `check_images.py`. |
| Photos alternative | 120–250 photos, main lens, same settings, ≥ 70 % overlap | Use for very low light, where video blurs. Run with `-Matching exhaustive`. |

## 3. Movement rules

1. **Walk slowly:** about 0.3 m/s, or roughly one small step per second. Rotate slowly, taking at least 6 s per 90°.
2. **Translate, don't pivot.** Pure rotation on the spot gives COLMAP no parallax. Always move sideways while turning.
3. **Keep the phone at chest height (≈ 1.3 m),** pointed slightly downward (≈ 10–15°) so that floor and furniture stay in frame. The floor anchors the up axis.
4. **Keep 1–3 m from surfaces.** Very close shots lose context, and far shots lose detail.
5. **Overlap:** every surface must appear in at least 3 viewpoints from different positions.
6. Hold **3–5 s still at each corner** while slowly tilting up to the ceiling line and down to the floor.

## 4. Capture route (repeatable, about 2–3 min for a 15 m² room)

```
      wall C
   ┌───────────┐
   │ 3 ◄─── 2  │       Loop 1 (outer): perimeter, camera facing the room centre
 D │ │      ▲  │ B     Loop 2 (inner): half-way to the centre, camera facing the walls
   │ ▼      │  │       Loop 3: details. Furniture at two heights, door and entrance
   │ 4 ───► 1  │
   └──[door]───┘
      wall A (entrance)
```

1. **Start at the entrance (0:00–0:10).** Stand in the doorway and record the whole room from outside in. This frame becomes the natural start pose of the walkthrough.
2. **Loop 1, outer perimeter (≈ 60 s).** Walk the walls clockwise 1–4, about 0.5 m from the walls, with the camera facing the room centre. Pause at each corner (§3.6).
3. **Loop 2, inner loop (≈ 60 s).** Walk a smaller loop half-way to the centre, now facing outward toward the walls. This captures the walls head-on and closes the loop for COLMAP.
4. **Loop 3, furniture and occluded areas (≈ 30–45 s).** Arc around large furniture (sofa, bed, table) at chest height, then once lower (≈ 0.8 m) to see under and around them.
5. **Finish where you started**, facing the entrance. This revisits early frames, which helps loop closure.

## 5. Avoiding common failures

| Problem | Symptom in the model | Prevention |
|---|---|---|
| Motion blur | Smeared texture, missing cameras | Move slowly. Light the room well. `extract_frames.py` keeps the sharpest of every 3 frames, and `check_images.py` rejects the rest. |
| Reflections (mirror, glass, glossy TV) | Ghost geometry behind the surface | Cover or angle away from mirrors. Turn off the TV. Accept some view-dependent shine. |
| Textureless regions (plain walls, ceiling) | Holes, floaters or COLMAP failure | Include furniture or edges in every frame. Never film a blank wall alone. Tape a few A4 printouts to large blank walls if needed. |
| Moving objects (people, pets, curtains, fans) | Semi-transparent ghosts | Clear the room. Close windows. Turn off fans. |
| Exposure changes (window light) | Colour flicker, blotches | Lock AE/AF. Avoid filming directly into bright windows. |
| Pure rotation | Unregistered frames | Always translate while turning (§3.2). |

## 6. Extract, inspect and downsample frames

```powershell
# 1) Put the video in capture\ (git-ignored), e.g. capture\room.mp4
# 2) Extract 2 fps, keeping the sharpest of each 3 candidates, max width 1600 px
python scripts\extract_frames.py capture\room.mp4 data\room\images --fps 2 --max-width 1600
# 3) Quality-check; move blurred, dark, textureless or duplicate frames aside
python scripts\check_images.py data\room\images --move-rejects
```

```bash
python3 scripts/extract_frames.py capture/room.mp4 data/room/images --fps 2 --max-width 1600
python3 scripts/check_images.py data/room/images --move-rejects
```

**Targets:** 150–400 usable frames. A rejection rate below 20 % is good. If more than 30 % are rejected for blur, re-capture more slowly or in better light. Open `data/room/images_rejected/` and spot-check that the rejects really are bad, and adjust `--blur-rel` if not. Width 1600 px balances COLMAP accuracy against the Splatfacto memory budget (8 GB GPU).

## 7. Run reconstruction and verify

```powershell
# Local (needs nerfstudio + COLMAP on PATH, see docs\environment.md)
.\scripts\run_reconstruction.ps1 -Video capture\room.mp4 -Workspace data\room
# or hosted GPU: open notebooks\namma_space_colab.ipynb in Google Colab
```

**Verification checklist:**

- [ ] `data/room/processed/transforms.json` exists. **Registered cameras ÷ frames used ≥ 0.8.** Below that, check the COLMAP log and re-capture weak areas.
- [ ] Training finished at the configured iteration count, with no NaN loss.
- [ ] `exports/splat.ply` opens. `python scripts/splat_info.py data/room/exports/splat.ply` reports a plausible splat count (typically 0.3–3 M) and `non_finite` close to 0.
- [ ] In the viewer (`npm run dev`, then `/?calibrate`), the walls are vertical, the floor is level, the room is not mirrored, and furniture is recognisable from the entrance view and from each corner.
- [ ] A known dimension (door ≈ 2.0 m high) roughly matches after setting `scale`, which makes walking speed and eye height feel natural.

## 8. Record the run (fill `submission/metrics.md`)

`run_reconstruction.ps1` and `run_reconstruction.sh` write `data/<room>/run_metrics.json` automatically. Copy the measured values; do not estimate them.

| Metric | Source |
|---|---|
| Video duration and resolution | `extract_report.json` and phone metadata |
| Frames extracted, kept, rejected (with reasons) | `extract_report.json`, `quality_summary.json` |
| Registered cameras | `run_metrics.json → registered_cameras` |
| COLMAP, training and export times | `run_metrics.json → *_seconds` |
| GPU used | `nvidia-smi` output (local or Colab) |
| Splat count; PLY and web model size | `splat_info.json`, `run_metrics.json` |
| Viewer load time and FPS | Viewer HUD (Load, FPS), measured on the deployed URL |
| Quality observations | Screenshots from entrance, each corner, and furniture close-ups |

## 9. Scaling up (Round 3 and later)

For larger venues, capture each room with this SOP plus one **linking pass** through every doorway (walk through slowly, filming both sides). Then use COLMAP vocabulary-tree matching (`-Matching vocab_tree`) on the combined frames, or reconstruct rooms separately and align them by shared doorway frames.
