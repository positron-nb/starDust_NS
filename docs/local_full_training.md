# Full-frame room2 training (verified 31 Oct 2026)

The current model uses all **1,474 registered cameras** from 1,486 quality-filtered
images, at **1600x900**, for **60,000 iterations**. It replaces the earlier
492-camera Colab subset. No held-out quality score is claimed for this final fit.

The tested environment is WSL2 Ubuntu 22.04, Python 3.10, PyTorch 2.7.1+cu128,
torchvision 0.22.1, Nerfstudio 1.1.5, gsplat 1.4.0, CUDA Toolkit 12.8, and an
RTX 5060 Laptop GPU (8 GB). Install the CUDA toolkit in WSL without installing
a Linux display driver; WSL uses the Windows NVIDIA driver. PyTorch must include
Blackwell support. The older CUDA builds used for T4 are unsuitable for this GPU.

After installing these versions in an isolated Python environment and processing
the existing COLMAP model into a Nerfstudio dataset:

```bash
export CUDA_HOME=/usr/local/cuda-12.8
export PATH="$CUDA_HOME/bin:$PATH"
export TORCH_CUDA_ARCH_LIST=12.0
export MAX_JOBS=2
export OMP_NUM_THREADS=4
export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1

python scripts/train_file_backed.py splatfacto \
  --data data/runs/room2-full/processed \
  --output-dir data/runs/room2-full/outputs \
  --experiment-name room2-full --timestamp run \
  --max-num-iterations 60000 --steps-per-save 1000 \
  --steps-per-eval-batch 0 --steps-per-eval-image 0 --steps-per-eval-all-images 0 \
  --vis tensorboard --viewer.quit-on-train-completion True \
  --pipeline.datamanager.cache-images cpu \
  --pipeline.datamanager.cache-images-type uint8 \
  --pipeline.datamanager.images-on-gpu False \
  nerfstudio-data --downscale-factor 1 --eval-mode all

ns-export gaussian-splat \
  --load-config data/runs/room2-full/outputs/room2-full/splatfacto/run/config.yml \
  --output-dir data/runs/room2-full/exports
```

`train_file_backed.py` preserves Nerfstudio's original undistortion and camera
intrinsic updates, but stores the lossless uint8 image/mask tensors in file-backed
NumPy arrays rather than pinning the entire dataset in RAM. The OS pages the
cache as needed. First-image cache values are checked bit-for-bit. Reserve enough
disk space for images, the cache, checkpoints and export. One-time CUDA compilation
can take several minutes; limit compiler parallelism on a 16 GB laptop.

To resume, add `--load-dir <run>/nerfstudio_models` before the `nerfstudio-data`
subcommand. The stock reconstruction pipeline's train stage clears its output
folder, so use this command directly when resuming a checkpoint.

The run took **6,723 s (112.1 min)** from training launch through PLY export,
excluding one-time CUDA compilation. Checkpoints use zero-based indices, so
`step-000059999.ckpt` is the final checkpoint of the 60,000-step run. Export kept
1,296,805 of 1,495,923 Gaussians, filtering 199,118 low-opacity entries, with no
NaN/Inf values. The 321,609,234-byte PLY compressed to a 30,843,929-byte SPZ.
Exact values and the model SHA-256 are in `submission/room2_full_run.json`.

Calibration uses the saved training transform after removing the preprocessing
`applied_transform` already present in processed camera poses. The 17-vertex
walk outline follows the recovered camera path. Metric scale assumes a 1.3 m
median capture-camera height and remains approximate. Saved browser views are
mapped through this same transform and use the capture camera field of view.
