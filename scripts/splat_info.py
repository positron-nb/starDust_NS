"""Summarise a 3D Gaussian Splatting .ply and optionally write a draft viewer manifest.

Reports splat count, exact file size, robust bounds, and floor and ceiling estimates
(low and high percentiles of splat centres along the up axis). With
`--manifest-out`, it also writes a *draft* manifest for the viewer. The draft has
the rotation that maps the export's up axis to three.js +Y, plus floor height,
walk bounds and a start point derived from those percentiles. Open the viewer
with `?calibrate&manifest=<draft>` to check it, then copy it over
public/models/manifest.json to publish (see README, "Replacing the model").

Example:
    python scripts/splat_info.py data/room/exports/splat.ply --up z \
        --manifest-out public/models/room.manifest.draft.json --model-file models/room.sog
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

PLY_TYPES = {"float": "f4", "float32": "f4", "double": "f8", "uchar": "u1", "uint8": "u1",
             "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4", "short": "i2", "ushort": "u2"}

# Rotation (degrees, XYZ Euler) the viewer applies so that the export's up axis becomes +Y,
# and the matching mapping of export coordinates to viewer world (x, y, z).
UP_AXIS = {
    "z": ([-90, 0, 0], lambda p: np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1)),
    "y": ([0, 0, 0], lambda p: p),
}


def read_ply_vertices(path: Path) -> np.ndarray:
    with open(path, "rb") as fh:
        if fh.readline().strip() != b"ply":
            raise ValueError("not a PLY file")
        fmt, count, props = None, 0, []
        in_vertex = False
        while True:
            line = fh.readline().decode("ascii", "replace").strip()
            if line == "end_header":
                break
            parts = line.split()
            if not parts:
                continue
            if parts[0] == "format":
                fmt = parts[1]
            elif parts[0] == "element":
                in_vertex = parts[1] == "vertex"
                if in_vertex:
                    count = int(parts[2])
            elif parts[0] == "property" and in_vertex:
                props.append((parts[2], PLY_TYPES[parts[1]]))
        if fmt != "binary_little_endian":
            raise ValueError(f"unsupported PLY format {fmt}")
        dtype = np.dtype([(n, "<" + t) for n, t in props])
        return np.frombuffer(fh.read(dtype.itemsize * count), dtype=dtype, count=count)


def r3(x) -> float:
    return round(float(x), 3)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ply", type=Path)
    ap.add_argument("--up", choices=sorted(UP_AXIS), default="z", help="up axis of the export (nerfstudio: z)")
    ap.add_argument("--json", type=Path, help="write the summary to this file")
    ap.add_argument("--manifest-out", type=Path, help="write a draft viewer manifest to this file")
    ap.add_argument("--model-file", default="models/room.sog", help="model path for the draft manifest")
    ap.add_argument("--name", default="Reconstructed room (uncalibrated draft)")
    args = ap.parse_args()

    v = read_ply_vertices(args.ply)
    xyz = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float64)
    finite = np.isfinite(xyz).all(axis=1)
    xyz = xyz[finite]
    if len(xyz) == 0:
        raise SystemExit("error: no finite splat centres")
    lo, hi = np.percentile(xyz, 2, axis=0), np.percentile(xyz, 98, axis=0)
    up = "xyz".index(args.up)
    info = {
        "file": str(args.ply),
        "size_bytes": args.ply.stat().st_size,
        "splats": int(len(v)),
        "non_finite": int((~finite).sum()),
        "sh_rest_coeffs_per_channel": sum(1 for n in v.dtype.names if n.startswith("f_rest_")) // 3,
        "bounds_p2": [r3(x) for x in lo],
        "bounds_p98": [r3(x) for x in hi],
        "centre_median": [r3(x) for x in np.median(xyz, axis=0)],
        "up_axis": args.up,
        "floor_estimate_p2": r3(lo[up]),
        "ceiling_estimate_p98": r3(hi[up]),
    }
    print(json.dumps(info, indent=2))
    if args.json:
        args.json.write_text(json.dumps(info, indent=2))

    if args.manifest_out:
        rotation, to_world = UP_AXIS[args.up]
        world = to_world(xyz)
        wlo, whi = np.percentile(world, 2, axis=0), np.percentile(world, 98, axis=0)
        pad = 0.05 * min(whi[0] - wlo[0], whi[2] - wlo[2])  # keep the camera off the outer walls
        bmin, bmax = [r3(wlo[0] + pad), r3(wlo[2] + pad)], [r3(whi[0] - pad), r3(whi[2] - pad)]
        height = whi[1] - wlo[1]
        manifest = {
            "name": args.name,
            "provenance": "reconstruction",
            "file": args.model_file,
            "rotationDeg": rotation,
            "scale": 1,
            "floorY": r3(wlo[1]),
            # COLMAP/nerfstudio scale is arbitrary: start at ~62% of floor-to-ceiling height,
            # which is ~1.6 m in a 2.6 m room, until scale is calibrated in the viewer.
            "eyeHeight": r3(max(0.05, 0.62 * height)),
            "walkSpeed": r3(max(0.05, 1.4 * height / 2.6)),
            "sprintMultiplier": 2,
            "start": {"position": [r3((bmin[0] + bmax[0]) / 2), r3((bmin[1] + bmax[1]) / 2)], "yawDeg": 0},
            "bounds": {"min": bmin, "max": bmax},
            "walkPolygon": None,
            "background": "#07080b",
            "calibrated": False,
        }
        args.manifest_out.parent.mkdir(parents=True, exist_ok=True)
        args.manifest_out.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"draft manifest: {args.manifest_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
