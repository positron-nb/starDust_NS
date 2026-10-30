# New room: from video to live walkthrough (runbook)

The tested path is Path A (about 3 h, mostly waiting). Path B is faster, but its training step is
not proven yet (see the warning in step 4B).

## 1. Record (about 15 min)

Follow `capture_sop.md`:

- **Settings:** 4K at 60 fps, main 1× lens, AE/AF lock (long-press a wall), landscape.
- **Movement:** walk slowly, always moving sideways while turning. Keep 1–2 m from surfaces and always keep furniture or edges in frame (never a blank wall alone).
- **Route:** entrance → outer loop → inner loop → furniture arcs → back to the entrance.

Copy the video to the laptop by USB, Drive or Nearby Share (not WhatsApp) as `capture\room2.mp4`.

## 2. Frames and quality check (laptop, about 3 min)

```powershell
cd C:\Users\raiab\techfest\namma_space
python scripts\extract_frames.py capture\room2.mp4 data\runs\room2\images --fps 2 --max-width 1600
python scripts\check_images.py data\runs\room2\images --move-rejects
```

- **Good:** 150–400 frames kept and under 20 % rejected.
- **More than 30 % rejected for blur:** record again, slower.

## 3. COLMAP on the laptop GPU (Path B only, about 30 min)

```powershell
.\scripts\colmap_gpu.ps1 -Images data\runs\room2\images -Workspace data\runs\room2
Get-Content data\runs\room2\colmap_gpu_metrics.json      # best_registered should be close to the frame count
```

Package the frames and the largest model, replacing `<N>` with the folder that has the most registered images:

```powershell
$w="data\runs\room2"; $m=(Get-Content "$w\colmap_gpu_metrics.json" | ConvertFrom-Json).models[0].path
python -c "import zipfile,glob,os,sys; w,m=sys.argv[1],sys.argv[2]; z=zipfile.ZipFile(os.path.expanduser('~/Downloads/room2_gpu.zip'),'w'); [z.write(f,'images/'+os.path.basename(f)) for f in glob.glob(w+'/images/*.jpg')]; [z.write(m+'/'+b,'sparse/'+b) for b in ('cameras.bin','images.bin','points3D.bin')]; z.close()" $w $m
```

(Python's zipfile writes `/` paths, which avoids the backslash problem of `Compress-Archive`.)

## 4. Train on Colab (T4 GPU)

Open https://colab.research.google.com/github/positron-nb/starDust_NS/blob/main/notebooks/namma_space_colab.ipynb
and set **Runtime → Change runtime type → T4 GPU**.

**Cell 1, install (about 10 min):**
```
%cd /content
!git clone --depth 1 https://github.com/positron-nb/starDust_NS.git /content/namma-space
!apt-get -qq update && apt-get -qq install -y colmap > /dev/null
!pip -q install nerfstudio==1.1.5 imageio-ffmpeg
!ns-train --help > /dev/null && echo "nerfstudio OK"
!node --version || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null && apt-get -qq install -y nodejs > /dev/null && node --version)
```

**Cell 2A, Path A: upload a zip of the frames from step 2; COLMAP runs on Colab's CPU (≈ 80 min):**
```
import os, zipfile
from google.colab import files
os.chdir("/content"); up = files.upload()
z = zipfile.ZipFile("/content/" + next(iter(up)))
os.makedirs("/content/frames", exist_ok=True)
for i in z.infolist():
    n = os.path.basename(i.filename.replace("\\", "/"))
    if n: open("/content/frames/" + n, "wb").write(z.read(i))
%cd /content/namma-space
!bash scripts/run_reconstruction.sh --images /content/frames --run-id room2 --matching sequential --min-registered 0.6
```

**Cell 2B, Path B: upload `room2_gpu.zip` from step 3; no COLMAP on Colab:**
```
import os, zipfile
from google.colab import files
os.chdir("/content"); files.upload()
with zipfile.ZipFile("/content/room2_gpu.zip") as z: z.extractall("/content/gpu")
%cd /content/namma-space
!bash scripts/run_reconstruction.sh --images /content/gpu/images --colmap-model /content/gpu/sparse --run-id room2
```

> **Warning (Path B):** the first run with COLMAP 4.2 poses converted fine (326/328 registered), but the Gaussian count
> stayed at the SfM point count (no densification). Check the log at about step 2,000: "GSs duplicated/split" must be
> greater than 0. If it stays 0, stop the run and use Path A.

**While it runs** (Colab → Terminal):
```
ls /content/namma-space/data/runs/room2/outputs/*/*/run/nerfstudio_models/; free -m | grep Mem
```

- The first training in a fresh runtime spends about 1 h compiling gsplat; then training takes about 1 h.
- Keep the tab open and click in it now and then, because free Colab disconnects idle sessions.
- Done when the cell prints `Done. Metrics: …`.

**Cell 3, download:**
```
import os
from google.colab import files
os.chdir("/content/namma-space"); RUN_ID = "room2"; W = f"data/runs/{RUN_ID}"
!cat {W}/run_metrics.json
!cd {W} && zip -q -r /content/{RUN_ID}_outputs.zip run_metrics.json splat_info.json processed/transforms.json outputs/*/*/run/dataparser_transforms.json
!cd public/models && zip -q /content/{RUN_ID}_web.zip {RUN_ID}.*
files.download(f"/content/{RUN_ID}_web.zip"); files.download(f"/content/{RUN_ID}_outputs.zip")
```

## 5. Calibrate (laptop, 1 min)

```powershell
$d="data\runs\room2"; Expand-Archive -Force "$env:USERPROFILE\Downloads\room2_web.zip" "$d\web"; Expand-Archive -Force "$env:USERPROFILE\Downloads\room2_outputs.zip" "$d\outputs"
Copy-Item "$d\web\room2.*" public\models\
$dp = Get-ChildItem "$d\outputs" -Recurse -Filter dataparser_transforms.json | Select-Object -First 1
python scripts\calibrate_from_poses.py "$d\outputs\processed\transforms.json" --splat-info "$d\outputs\splat_info.json" `
  --manifest public\models\room2.manifest.json --out public\models\room2.manifest.json --margin 0.3 --dataparser $dp.FullName
```

This prints the metric scale, the implied room size and the walk outline. Check that the room size is believable.

## 6. View locally

```powershell
npm run dev
```

- Open `http://localhost:5173/?manifest=models/room2.manifest.json`, click Start, and walk with WASD.
- To fine-tune, use `http://localhost:5173/?calibrate&manifest=models/room2.manifest.json`, then **Copy manifest JSON** into the file.

## 7. Publish (live site)

```powershell
Copy-Item public\models\room2.manifest.json public\models\manifest.json -Force
npm test; npm run build
git add public/models; git commit -m "Publish room2"; git push
```

Vercel redeploys https://stardust-ns.vercel.app/ automatically in about 1 minute. Keep the web model under about 90 MB
(the Vercel Hobby limit is 100 MB in total).
