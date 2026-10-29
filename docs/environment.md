# Environment and configuration

## Machine used for development (measured 2026-10-27)

| Item | Value |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| CPU / RAM | AMD Ryzen 9 270 / 15.3 GB |
| GPU | NVIDIA GeForce RTX 5060 Laptop GPU, 8151 MiB, driver 610.74 (Blackwell, compute capability 12.0) |
| Python | 3.12.10 (numpy 2.5.3, Pillow 12.3.0, imageio-ffmpeg 0.6.0 with bundled ffmpeg 7.1) |
| Node / npm | 24.19.0 / 11.17.0 |
| CUDA toolkit, MSVC, COLMAP, nerfstudio | **not installed** |

## Viewer and pre-processing (always local)

```powershell
python -m pip install -r requirements.txt   # numpy, Pillow, imageio-ffmpeg
npm ci
```

## Reconstruction: why a hosted GPU is the default

nerfstudio 1.1.5 pins `gsplat==1.4.0`, which **compiles CUDA kernels on first use**. On this Windows laptop that needs:

1. CUDA Toolkit **12.8 or newer** (the first version that supports Blackwell `sm_120`),
2. Visual Studio 2022 Build Tools (MSVC) on PATH for `nvcc`,
3. a PyTorch build for cu128 or newer,
4. COLMAP on PATH.

None of these are present, and installation is several GB plus a JIT build that commonly fails on Windows. With the Round 1 deadline on 31 Oct 2026, the documented primary path is the **Colab notebook** (`notebooks/namma_space_colab.ipynb`). It uses Linux, `apt` COLMAP, `pip install nerfstudio==1.1.5`, and an NVIDIA T4 (16 GB) or better. Splatfacto's documented requirement is about 6 GB, and about 12 GB for `splatfacto-big`.

## Local GPU COLMAP (tested on this machine, 2026-10-29)

Colab's apt COLMAP has no CUDA, so SIFT extraction and matching run on its 2 CPU cores
(≈ 83 min for 328 frames with sequential matching). The official COLMAP Windows CUDA build runs
directly on the laptop's RTX 5060 without compiling anything:

```powershell
# official release asset, 395 MB: https://github.com/colmap/colmap/releases/tag/4.2.1
curl.exe -L -o tools\colmap-x64-windows-cuda.zip https://github.com/colmap/colmap/releases/download/4.2.1/colmap-x64-windows-cuda.zip
Expand-Archive tools\colmap-x64-windows-cuda.zip tools\colmap      # tools/ is git-ignored
tools\colmap\bin\colmap.exe -h                                       # "COLMAP 4.2.1 ... with CUDA"
.\scripts\colmap_gpu.ps1 -Images data\runs\<run>\images -Workspace data\runs\<run>            # exhaustive + incremental
.\scripts\colmap_gpu.ps1 -Images data\runs\<run>\images -Workspace data\runs\<run> -Mapper global -ReuseFeatures
```

`colmap_gpu.ps1` writes `colmap_gpu_metrics.json` (timings, registered images per model). Upload the
best `colmap\sparse_*\0` folder with the images to Colab and train from it (README, "Reconstruct a room").

## Optional: local Windows nerfstudio install (untested on this machine)

```powershell
# 1. CUDA 12.8+ toolkit and VS 2022 Build Tools ("Desktop development with C++")
winget install Nvidia.CUDA
winget install Microsoft.VisualStudio.2022.BuildTools
# 2. Python env (uv is already installed)
uv venv .venv-ns --python 3.11; .\.venv-ns\Scripts\Activate.ps1
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install nerfstudio==1.1.5
# 3. COLMAP: download the Windows CUDA release zip from https://github.com/colmap/colmap/releases and add its bin folder to PATH
colmap -h; ns-train --help
```

Run training from an *x64 Native Tools* prompt so that `cl.exe` is visible to the gsplat JIT build. An alternative is WSL2 Ubuntu with the CUDA-on-WSL driver, following the Linux instructions.

## Configuration

| Where | What |
|---|---|
| `public/models/manifest.json` | Model file, provenance label, rotation, scale, floor height, eye height, walk speed, start pose, walk bounds |
| `run_reconstruction.ps1` parameters | `-Fps`, `-MaxWidth`, `-Matching`, `-Method`, `-MaxIters`, `-SkipTo`, `-ModelName` |
| Viewer URL | `?calibrate`, `?dpr=<n>`, `?manifest=<path>` |
