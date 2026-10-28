#!/usr/bin/env bash
# Namma Space reconstruction pipeline (Linux / Colab). Mirrors scripts/run_reconstruction.ps1.
#
# Usage:
#   scripts/run_reconstruction.sh --video capture/room.mp4 --workspace data/room
#   scripts/run_reconstruction.sh --images data/room/images --workspace data/room --matching exhaustive
#   scripts/run_reconstruction.sh --workspace data/room --skip-to export
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIDEO="" IMAGES="" WORKSPACE="" FPS=2 MAX_WIDTH=1600 MATCHING=sequential
METHOD=splatfacto MAX_ITERS=30000 SKIP_TO=frames MODEL_OUT=public/models MODEL_NAME=room

while [[ $# -gt 0 ]]; do
  case "$1" in
    --video) VIDEO="$2"; shift 2 ;;
    --images) IMAGES="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --max-width) MAX_WIDTH="$2"; shift 2 ;;
    --matching) MATCHING="$2"; shift 2 ;;
    --method) METHOD="$2"; shift 2 ;;
    --max-iters) MAX_ITERS="$2"; shift 2 ;;
    --skip-to) SKIP_TO="$2"; shift 2 ;;
    --model-out) MODEL_OUT="$2"; shift 2 ;;
    --model-name) MODEL_NAME="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$WORKSPACE" ]] || { echo "--workspace is required" >&2; exit 2; }

STAGES=(frames colmap train export web)
idx() { for i in "${!STAGES[@]}"; do [[ "${STAGES[$i]}" == "$1" ]] && echo "$i"; done; }
START=$(idx "$SKIP_TO")
mkdir -p "$WORKSPACE"
IMAGES_DIR="$WORKSPACE/images" PROCESSED="$WORKSPACE/processed"
OUTPUTS="$WORKSPACE/outputs" EXPORTS="$WORKSPACE/exports"
METRICS="$WORKSPACE/run_metrics.json"
[[ -f "$METRICS" ]] || echo '{}' > "$METRICS"

set_metric() {  # set_metric key json_value
  python3 - "$METRICS" "$1" "$2" <<'PY'
import json, sys
path, key, val = sys.argv[1:]
d = json.load(open(path))
try:
    d[key] = json.loads(val)
except json.JSONDecodeError:
    d[key] = val
json.dump(d, open(path, "w"), indent=2)
PY
}

run_stage() {  # run_stage name function
  local name="$1" fn="$2"
  if (( $(idx "$name") < START )); then echo "== skip $name"; return; fi
  echo "== $name"
  local t0=$SECONDS
  "$fn"
  set_metric "${name}_seconds" "$((SECONDS - t0))"
}

stage_frames() {
  if [[ -n "$VIDEO" ]]; then
    python3 "$ROOT/scripts/extract_frames.py" "$VIDEO" "$IMAGES_DIR" --fps "$FPS" --max-width "$MAX_WIDTH" --overwrite
  elif [[ -n "$IMAGES" ]]; then
    if [[ "$(realpath "$IMAGES")" != "$(realpath -m "$IMAGES_DIR")" ]]; then
      mkdir -p "$IMAGES_DIR"; cp "$IMAGES"/*.{jpg,jpeg,JPG,png} "$IMAGES_DIR"/ 2>/dev/null || true
    fi
  else
    echo "pass --video or --images" >&2; exit 2
  fi
  python3 "$ROOT/scripts/check_images.py" "$IMAGES_DIR" --move-rejects
  set_metric frames_used "$(find "$IMAGES_DIR" -maxdepth 1 -type f | wc -l)"
}

stage_colmap() {
  ns-process-data images --data "$IMAGES_DIR" --output-dir "$PROCESSED" --matching-method "$MATCHING"
  [[ -f "$PROCESSED/transforms.json" ]] || { echo "COLMAP produced no transforms.json" >&2; exit 1; }
  set_metric registered_cameras "$(python3 -c "import json;print(len(json.load(open('$PROCESSED/transforms.json'))['frames']))")"
}

stage_train() {
  ns-train "$METHOD" --data "$PROCESSED" --output-dir "$OUTPUTS" --max-num-iterations "$MAX_ITERS" \
    --viewer.quit-on-train-completion True
  set_metric method "\"$METHOD\""
  set_metric max_iterations "$MAX_ITERS"
}

stage_export() {
  local config
  config="$(find "$OUTPUTS" -name config.yml -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
  [[ -n "$config" ]] || { echo "no config.yml under $OUTPUTS" >&2; exit 1; }
  ns-export gaussian-splat --load-config "$config" --output-dir "$EXPORTS"
  set_metric export_ply_mb "$(du -m "$(ls "$EXPORTS"/*.ply | head -1)" | cut -f1)"
}

stage_web() {
  local ply sog
  ply="$(ls "$EXPORTS"/*.ply | head -1)"
  mkdir -p "$MODEL_OUT"
  sog="$MODEL_OUT/$MODEL_NAME.sog"
  npx --yes @playcanvas/splat-transform@3.10.1 "$ply" --filter-nan "$sog" -w
  python3 "$ROOT/scripts/splat_info.py" "$ply" --json "$WORKSPACE/splat_info.json"
  set_metric web_model "\"$sog\""
  set_metric web_model_mb "$(du -m "$sog" | cut -f1)"
}

run_stage frames stage_frames
run_stage colmap stage_colmap
run_stage train stage_train
run_stage export stage_export
run_stage web stage_web
echo "Done. Metrics: $METRICS"
