#!/usr/bin/env bash
# Namma Space reconstruction pipeline (Linux / Colab). Mirrors scripts/run_reconstruction.ps1:
# same stages, the same per-run folder layout and the same run_metrics.json schema (sizes in exact bytes).
#
# Usage:
#   scripts/run_reconstruction.sh --video capture/room.mp4
#   scripts/run_reconstruction.sh --images capture/photos --matching exhaustive --run-id bedroom-v2
#   scripts/run_reconstruction.sh --run-id bedroom-v2 --skip-to export
set -euo pipefail
trap 'echo "error: pipeline stopped at line $LINENO (exit $?) while running: $BASH_COMMAND" >&2' ERR

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIDEO="" IMAGES="" RUN_ID="$(date +%Y%m%d-%H%M%S)" RUNS_ROOT=data/runs FPS=2 MAX_WIDTH=1600
MIN_FRAMES=40 MIN_REGISTERED=0.7 MATCHING=sequential METHOD=splatfacto MAX_ITERS=30000
SKIP_TO=frames MODEL_OUT=public/models FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --video) VIDEO="$2"; shift 2 ;;
    --images) IMAGES="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --runs-root) RUNS_ROOT="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --max-width) MAX_WIDTH="$2"; shift 2 ;;
    --min-frames) MIN_FRAMES="$2"; shift 2 ;;
    --min-registered) MIN_REGISTERED="$2"; shift 2 ;;
    --matching) MATCHING="$2"; shift 2 ;;
    --method) METHOD="$2"; shift 2 ;;
    --max-iters) MAX_ITERS="$2"; shift 2 ;;
    --skip-to) SKIP_TO="$2"; shift 2 ;;
    --model-out) MODEL_OUT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ ! "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ || "$RUN_ID" =~ ^\.+$ ]]; then
  echo "run id may only contain letters, digits, . _ - and cannot be only dots" >&2; exit 2
fi

STAGES=(frames colmap train export web)
idx() { for i in "${!STAGES[@]}"; do if [[ "${STAGES[$i]}" == "$1" ]]; then echo "$i"; fi; done; return 0; }
START=$(idx "$SKIP_TO")
[[ -n "$START" ]] || { echo "bad --skip-to: $SKIP_TO" >&2; exit 2; }

WORKSPACE="$RUNS_ROOT/$RUN_ID"
IMAGES_DIR="$WORKSPACE/images" PROCESSED="$WORKSPACE/processed"
OUTPUTS="$WORKSPACE/outputs" EXPORTS="$WORKSPACE/exports"
METRICS="$WORKSPACE/run_metrics.json"

# The run folder must be a direct child of the runs root; checked before anything is deleted.
RUNS_ROOT_FULL="$(realpath -m "$RUNS_ROOT")"
WORKSPACE_FULL="$(realpath -m "$WORKSPACE")"
if [[ "$(dirname "$WORKSPACE_FULL")" != "$RUNS_ROOT_FULL" || "$(basename "$WORKSPACE_FULL")" != "$RUN_ID" ]]; then
  echo "run folder $WORKSPACE_FULL does not resolve inside $RUNS_ROOT_FULL; refusing to continue" >&2; exit 2
fi

if (( START == 0 )) && [[ -d "$WORKSPACE" ]] && [[ -n "$(ls -A "$WORKSPACE")" ]]; then
  (( FORCE )) || { echo "run folder $WORKSPACE exists; use a new --run-id, --skip-to, or --force" >&2; exit 2; }
  rm -rf -- "$WORKSPACE_FULL"
fi
if (( START > 0 )) && [[ ! -f "$METRICS" ]]; then echo "no $METRICS; cannot resume run $RUN_ID" >&2; exit 2; fi
mkdir -p "$WORKSPACE"
[[ -f "$METRICS" ]] || echo '{}' > "$METRICS"

metric() {  # metric key json_value   (sets)   |   metric key   (prints)
  python3 - "$METRICS" "$@" <<'PY'
import json, sys
path, key, *val = sys.argv[1:]
d = json.load(open(path))
if not val:
    print(d.get(key, ""))
    raise SystemExit
try:
    d[key] = json.loads(val[0])
except json.JSONDecodeError:
    d[key] = val[0]
json.dump(d, open(path, "w"), indent=2)
PY
}
reset_dir() { rm -rf "$1"; mkdir -p "$1"; }
assert_fresh() {  # assert_fresh path stage_start_epoch what
  [[ -f "$1" ]] || { echo "$3 was not produced: $1" >&2; exit 1; }
  (( $(stat -c %Y "$1") >= $2 )) || { echo "$3 is stale: $1" >&2; exit 1; }
}
bytes() { stat -c %s "$1"; }

STAGE_START=0
run_stage() {  # run_stage name function
  local name="$1" fn="$2"
  if (( $(idx "$name") < START )); then echo "== skip $name"; return; fi
  echo "== $name ($RUN_ID)"
  STAGE_START=$(date +%s)
  "$fn"
  metric "${name}_seconds" "$(( $(date +%s) - STAGE_START ))"
}

stage_frames() {
  metric run_id "\"$RUN_ID\""
  reset_dir "$IMAGES_DIR"
  if [[ -n "$VIDEO" ]]; then
    python3 "$ROOT/scripts/extract_frames.py" "$VIDEO" "$IMAGES_DIR" --fps "$FPS" --max-width "$MAX_WIDTH" --overwrite
    metric input "\"$(realpath "$VIDEO")\""
  elif [[ -n "$IMAGES" ]]; then
    shopt -s nullglob nocaseglob
    local src=("$IMAGES"/*.jpg "$IMAGES"/*.jpeg "$IMAGES"/*.png)
    shopt -u nullglob nocaseglob
    (( ${#src[@]} )) || { echo "no images in $IMAGES" >&2; exit 2; }
    cp "${src[@]}" "$IMAGES_DIR"/
    metric input "\"$(realpath "$IMAGES")\""
  else
    echo "pass --video or --images" >&2; exit 2
  fi
  python3 "$ROOT/scripts/check_images.py" "$IMAGES_DIR" --move-rejects --min-frames "$MIN_FRAMES"
  metric frames_used "$(find "$IMAGES_DIR" -maxdepth 1 -type f | wc -l)"
}

stage_colmap() {
  reset_dir "$PROCESSED"
  # Headless servers (Colab) have no display: Qt must run offscreen or COLMAP aborts.
  export QT_QPA_PLATFORM=offscreen
  # Distribution COLMAP builds (apt) lack CUDA; GPU SIFT then crashes, so fall back to CPU.
  local gpu_flag=()
  if ! colmap -h 2>&1 | grep -qi "with CUDA"; then
    echo "COLMAP was built without CUDA: running feature extraction/matching on CPU (--no-gpu)"
    gpu_flag=(--no-gpu)
  fi
  if ! ns-process-data images --data "$IMAGES_DIR" --output-dir "$PROCESSED" \
      --matching-method "$MATCHING" --verbose "${gpu_flag[@]}"; then
    echo "error: ns-process-data / COLMAP failed (see the log above)" >&2
    exit 1
  fi
  assert_fresh "$PROCESSED/transforms.json" "$STAGE_START" transforms.json
  python3 - "$PROCESSED/transforms.json" "$IMAGES_DIR" "$METRICS" "$MIN_REGISTERED" <<'PY'
import json, os, sys
tf, images, metrics, min_ratio = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
registered = len(json.load(open(tf))["frames"])
used = len([f for f in os.listdir(images) if os.path.isfile(os.path.join(images, f))])
ratio = round(registered / used, 3) if used else 0.0
d = json.load(open(metrics)); d.update(registered_cameras=registered, registration_ratio=ratio)
json.dump(d, open(metrics, "w"), indent=2)
print(f"registered {registered}/{used} (ratio {ratio})")
if ratio < min_ratio:
    sys.exit(f"registration ratio {ratio} < {min_ratio}: check the COLMAP log, re-capture, or try --matching exhaustive")
PY
}

stage_train() {
  reset_dir "$OUTPUTS"
  # gsplat JIT-compiles its CUDA kernels on first use; each nvcc job needs >1 GB RAM, and an
  # unbounded parallel build exhausts Colab's ~13 GB and thrashes. Cap it unless set explicitly.
  export MAX_JOBS="${MAX_JOBS:-2}"
  # A build killed mid-way leaves torch's lock file behind, which makes the next build wait forever.
  rm -f "$HOME"/.cache/torch_extensions/*/gsplat*/lock 2>/dev/null || true
  # Full log goes to train.log; gsplat's build spinner (one line per frame in Colab) is dropped
  # from the console because thousands of lines make the notebook unusable. pipefail keeps
  # ns-train's exit status (tee and sed always succeed).
  echo "training log: $WORKSPACE/train.log"
  ns-train "$METHOD" --data "$PROCESSED" --output-dir "$OUTPUTS" --experiment-name "$RUN_ID" --timestamp run \
    --max-num-iterations "$MAX_ITERS" --viewer.quit-on-train-completion True 2>&1 \
    | tee "$WORKSPACE/train.log" | sed -u '/Setting up CUDA/d'
  mapfile -t configs < <(find "$OUTPUTS" -name config.yml)
  (( ${#configs[@]} == 1 )) || { echo "expected one config.yml under $OUTPUTS, found ${#configs[@]}" >&2; exit 1; }
  metric config_path "\"$(realpath "${configs[0]}")\""
  metric method "\"$METHOD\""
  metric max_iterations "$MAX_ITERS"
}

stage_export() {
  local config; config="$(metric config_path)"
  [[ -f "$config" ]] || { echo "training config for run $RUN_ID not found: $config" >&2; exit 1; }
  reset_dir "$EXPORTS"
  # PyTorch >= 2.6 defaults torch.load to weights_only=True; nerfstudio 1.1.5 checkpoints contain a
  # numpy scalar and fail to load. The checkpoint was written by this run's own training, so the
  # legacy (full) load is safe here.
  export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1
  ns-export gaussian-splat --load-config "$config" --output-dir "$EXPORTS"
  mapfile -t plys < <(find "$EXPORTS" -maxdepth 1 -name '*.ply')
  (( ${#plys[@]} == 1 )) || { echo "expected one .ply in $EXPORTS, found ${#plys[@]}" >&2; exit 1; }
  assert_fresh "${plys[0]}" "$STAGE_START" "exported PLY"
  metric export_ply "\"$(realpath "${plys[0]}")\""
  metric export_ply_bytes "$(bytes "${plys[0]}")"
}

stage_web() {
  local ply sog draft
  ply="$(metric export_ply)"
  [[ -f "$ply" ]] || { echo "exported PLY for run $RUN_ID not found: $ply" >&2; exit 1; }
  mkdir -p "$MODEL_OUT"
  local sog="$MODEL_OUT/$RUN_ID.sog" spz="$MODEL_OUT/$RUN_ID.spz" model
  draft="$MODEL_OUT/$RUN_ID.manifest.json"
  rm -f "$sog" "$spz" "$draft"
  # SOG's k-means compression needs a WebGPU adapter, which headless servers (Colab) lack.
  # Fall back to SPZ (CPU-only; v3 for broad loader support). Spark loads both.
  if npx --yes @playcanvas/splat-transform@3.10.1 "$ply" --filter-nan "$sog" -w && [[ -s "$sog" ]]; then
    model="$sog"
  else
    rm -f "$sog"
    echo "SOG compression unavailable (no WebGPU adapter): writing SPZ instead"
    npx --yes @playcanvas/splat-transform@3.10.1 "$ply" --filter-nan "$spz" --spz-version 3 -w
    model="$spz"
  fi
  assert_fresh "$model" "$STAGE_START" "web model"
  python3 "$ROOT/scripts/splat_info.py" "$ply" --up z --json "$WORKSPACE/splat_info.json" \
    --manifest-out "$draft" --model-file "models/$(basename "$model")" --name "Reconstructed room $RUN_ID (uncalibrated draft)"
  assert_fresh "$draft" "$STAGE_START" "draft manifest"
  metric web_model "\"$model\""
  metric web_model_bytes "$(bytes "$model")"
  metric draft_manifest "\"$draft\""
  echo "Calibrate: npm run dev, then http://localhost:5173/?calibrate&manifest=models/$RUN_ID.manifest.json"
}

run_stage frames stage_frames
run_stage colmap stage_colmap
run_stage train stage_train
run_stage export stage_export
run_stage web stage_web
echo "Done. Metrics: $METRICS"
