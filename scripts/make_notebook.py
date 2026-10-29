"""Generate notebooks/namma_space_colab.ipynb (edit cells here, then run).

Usage: python scripts/make_notebook.py notebooks/namma_space_colab.ipynb
"""
import json, sys

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n").splitlines(True)})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n").splitlines(True)})

md("""
# Namma Space: hosted-GPU reconstruction (Google Colab)

Runs the same pipeline as `scripts/run_reconstruction.ps1` on a Colab GPU:
**frames, quality check, COLMAP (`ns-process-data`), Splatfacto training, `ns-export gaussian-splat`, SOG conversion.**

1. *Runtime → Change runtime type → GPU* (T4 or better; Splatfacto needs about 6 GB).
2. Upload your capture video (or a zip of photos) when prompted.
3. Download `room.sog`, `splat.ply` and `run_metrics.json` at the end and copy them into the repo (`public/models/`, `data/<room>/`).

Every cell prints versions and timings so the run can be reported faithfully in `submission/metrics.md`.
""")
code("""
!nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
import torch, sys
print("python", sys.version.split()[0], "| torch", torch.__version__, "| cuda", torch.version.cuda, "| gpu ok:", torch.cuda.is_available())
""")
md("## 1. Get the code\nSet `REPO_URL` to your public GitHub repository. Alternatively upload a zip of the repo and unzip it to `/content/namma-space`.")
code("""
REPO_URL = "https://github.com/positron-nb/starDust_NS.git"
import os
if not os.path.exists("/content/namma-space"):
    !git clone --depth 1 {REPO_URL} /content/namma-space
%cd /content/namma-space
""")
md("## 2. Install COLMAP, nerfstudio and Node (for SOG conversion)\nnerfstudio 1.1.5 pins `gsplat==1.4.0`; gsplat compiles its CUDA kernels on the first training step (a few minutes, once).")
code("""
%%time
!apt-get -qq update && apt-get -qq install -y colmap > /dev/null
!colmap -h | head -n 3
!pip -q install nerfstudio==1.1.5 imageio-ffmpeg
!ns-train --help > /dev/null && echo "nerfstudio OK"
!node --version || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null && apt-get -qq install -y nodejs > /dev/null && node --version)
""")
md("## 3. Upload the capture\nUpload one video (`.mp4`/`.mov`) **or** one `.zip` of photos. Faster: run `extract_frames.py` + `check_images.py` locally and upload a zip of the kept `frame_*.jpg` files (tens of MB instead of hundreds).")
code("""
from google.colab import files
import pathlib, zipfile, shutil
cap = pathlib.Path("/content/capture"); cap.mkdir(exist_ok=True)
up = files.upload()
name = next(iter(up))
shutil.move(name, cap / name)
CAPTURE = cap / name
if CAPTURE.suffix.lower() == ".zip":
    with zipfile.ZipFile(CAPTURE) as z: z.extractall(cap / "photos")
    print("photos:", len(list((cap / "photos").rglob("*.jp*g"))))
print("capture:", CAPTURE)
""")
md("## 4. Run the pipeline\nEach run gets its own folder `data/runs/<RUN_ID>`. The pipeline **stops** if fewer than 40 frames pass the quality gate or fewer than 70 % register in COLMAP, so no GPU time is spent on bad data. Sequential matching suits a continuous video walk; for an unordered photo set use `--matching exhaustive`.")
code("""
%%time
import datetime
RUN_ID = "room-" + datetime.datetime.now().strftime("%Y%m%d-%H%M")
WORKSPACE = f"data/runs/{RUN_ID}"
if CAPTURE.suffix.lower() == ".zip":
    src = next((cap / "photos").rglob("*.jp*g")).parent
    # Frames from scripts/extract_frames.py (frame_00001.jpg, ...) are in video order: sequential
    # matching is much faster on Colab's CPU COLMAP. An unordered photo set needs exhaustive.
    ordered = all(p.name.startswith("frame_") for p in src.glob("*.jp*g"))
    MATCHING = "sequential" if ordered else "exhaustive"
    print("matching:", MATCHING)
    !bash scripts/run_reconstruction.sh --images "{src}" --run-id {RUN_ID} --matching {MATCHING}
else:
    !bash scripts/run_reconstruction.sh --video "{CAPTURE}" --run-id {RUN_ID} --fps 2
""")
md("## 5. Inspect the results")
code("""
import json
print(json.dumps(json.load(open(f"{WORKSPACE}/run_metrics.json")), indent=2))
print(open(f"{WORKSPACE}/quality_summary.json").read())
!ls -la public/models {WORKSPACE}/exports
!cat public/models/{RUN_ID}.manifest.json
""")
md("## 6. Download outputs\nCopy `<RUN_ID>.sog` and `<RUN_ID>.manifest.json` into `public/models/` of your local repo, calibrate with `npm run dev` → `http://localhost:5173/?calibrate&manifest=models/<RUN_ID>.manifest.json`, then publish (README, *Replacing the model*).")
code("""
!cd {WORKSPACE} && zip -q -r /content/{RUN_ID}_outputs.zip run_metrics.json quality_summary.json quality_report.csv splat_info.json extract_report.json processed/transforms.json exports
!cd public/models && zip -q /content/{RUN_ID}_web.zip {RUN_ID}.sog {RUN_ID}.manifest.json
files.download(f"/content/{RUN_ID}_web.zip")
files.download(f"/content/{RUN_ID}_outputs.zip")
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []},
      "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
open(sys.argv[1], "w", encoding="utf-8").write(json.dumps(nb, indent=1))
print("ok")
