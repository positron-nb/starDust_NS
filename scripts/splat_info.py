"""Summarise a 3D Gaussian Splatting .ply: splat count, bounds, floor estimate.

The floor estimate (a low percentile of splat centres along the up axis) is a
starting value for `floorHeight` in public/models/manifest.json; always confirm it
visually in the viewer's calibration panel (`?calibrate`).

Example:
    python scripts/splat_info.py data/room/exports/splat.ply --up z
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

PLY_TYPES = {"float": "f4", "float32": "f4", "double": "f8", "uchar": "u1", "uint8": "u1",
             "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4", "short": "i2", "ushort": "u2"}


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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ply", type=Path)
    ap.add_argument("--up", choices=["x", "y", "z"], default="z", help="up axis of the export (nerfstudio: z)")
    ap.add_argument("--json", type=Path, help="write the summary to this file")
    args = ap.parse_args()

    v = read_ply_vertices(args.ply)
    xyz = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float64)
    finite = np.isfinite(xyz).all(axis=1)
    xyz = xyz[finite]
    lo, hi = np.percentile(xyz, 1, axis=0), np.percentile(xyz, 99, axis=0)
    up = "xyz".index(args.up)
    info = {
        "file": str(args.ply),
        "size_mb": round(args.ply.stat().st_size / 2**20, 1),
        "splats": int(len(v)),
        "non_finite": int((~finite).sum()),
        "sh_coeffs": sum(1 for n in v.dtype.names if n.startswith("f_rest_")) // 3,
        "bounds_p1": [round(float(x), 3) for x in lo],
        "bounds_p99": [round(float(x), 3) for x in hi],
        "centre_median": [round(float(x), 3) for x in np.median(xyz, axis=0)],
        "up_axis": args.up,
        "floor_estimate_p2": round(float(np.percentile(xyz[:, up], 2)), 3),
        "ceiling_estimate_p98": round(float(np.percentile(xyz[:, up], 98)), 3),
    }
    print(json.dumps(info, indent=2))
    if args.json:
        args.json.write_text(json.dumps(info, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
