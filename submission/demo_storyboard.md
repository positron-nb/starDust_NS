# Demo video: storyboard, narration and recording guide (target 4:00, allowed 3–5 min)

Rule: every shot shows the real system and the real room. No stock footage, no synthetic scene presented as the result, and no sped-up footage without an on-screen "×N speed" label.

## Recording setup

- **Screen:** OBS Studio (free) or Xbox Game Bar (`Win+Alt+R`), 1920×1080 at 30 fps (60 fps for the walkthrough segment if the machine allows). Hide personal bookmarks and notifications (Focus Assist on).
- **Phone footage:** record a second phone filming you capturing the room (or a screen recording of the capture app), plus a few seconds of the raw capture video itself.
- **Audio:** record narration separately in a quiet room with headphones and a phone mic, then lay it over the video. Speak about 140 words per minute.
- **Edit:** Clipchamp (built into Windows) or DaVinci Resolve. Export H.264 MP4 at 1080p.
- **Assets to prepare first:** deployed URL working in incognito, the Colab run (or local terminal) with timings visible, `run_metrics.json`, and 4–6 viewpoint screenshots.

## Shot list

| Time | Shot | On screen | Narration (draft; adjust numbers to measured values) |
|---|---|---|---|
| 0:00–0:25 | 1. Problem and capture | Title card "Namma Space"; then phone footage of walking the room following the SOP route | "Floor plans don't tell you what a space feels like. Namma Space turns one smartphone walkthrough of a real room into a photorealistic 3D twin you can walk through in any browser. This is my room, captured with a phone in about [N] minutes." |
| 0:25–0:55 | 2. SOP and pipeline | `capture_sop.md` route diagram; pipeline diagram from the abstract; terminal running `extract_frames.py` and `check_images.py` with the summary JSON | "Our capture SOP fixes the lens, exposure and a three-loop route so COLMAP always has overlap. Frames are extracted at two per second, keeping the sharpest of every three, and a quality gate rejects blurred, dark, textureless and duplicate frames. Here [kept] of [total] passed." |
| 0:55–1:40 | 3. Reconstruction quality | COLMAP sparse cameras (nerfstudio viewer or screenshot); training progress; then the model from the entrance, each corner and furniture close-ups | "COLMAP registered [R] of [F] cameras. Splatfacto trained [I] iterations in [T] minutes on a [GPU]. The result has [S] Gaussians. Notice the [specific detail: book spines, rug texture, light on the wall]. Here's a weak spot, [e.g. the window glare], which we discuss later." |
| 1:40–2:55 | 4. Live web walkthrough | Browser with the **public URL visible in the address bar**, incognito. Show the loading bar, Start, WASD walk around the room, mouse-look up and down, Shift, Q/E, R reset, Esc pause and resume, the HUD with FPS, and a window resize | "This is the public link, with nothing to install. The model loads in [L] seconds. Click start: WASD to walk at normal walking speed, mouse to look. The eye height stays fixed above the calibrated floor. R resets to the entrance, Esc releases the mouse. It runs at about [FPS] frames per second on this laptop." |
| 2:55–3:30 | 5. Repository and reproducibility | GitHub repo page, README sections, `run_reconstruction.ps1` stages, Colab notebook, `test/` folder, `manifest.json` and the `?calibrate` panel | "Everything is reproducible. One script runs extraction, COLMAP, training, export and web compression, and logs timings. A Colab notebook runs the same pipeline without a local GPU setup. A new room is swapped in by editing one manifest file and aligning it with the calibration panel." |
| 3:30–4:00 | 6. Results, limits, future | Metrics table; a limitation shot (e.g. walking through a sofa); roadmap slide | "Measured end to end: [capture] minutes capture, [processing] minutes processing, [size] megabytes online. Gaussian splats have no surfaces, so there is no collision yet. That, POI tagging and obstacle-aware paths from an occupancy grid are our Round 2 plan, followed by AR guidance." |

## Checklist before export

- [ ] Every bracketed number replaced with a value from `submission/metrics.md`
- [ ] URL visible during the walkthrough segment
- [ ] Duration between 3:00 and 5:00
- [ ] No private information visible in the room or on screen
- [ ] Uploaded to Drive (and optionally YouTube unlisted), playback tested logged out
