"""Derive viewer calibration (metric scale, floor, walk outline, start pose) from camera poses.

COLMAP reconstructions have no metric scale. The capture SOP fixes the phone at chest height
(~1.3 m), so the cameras' height above the reconstructed floor gives the scale. The path the
cameras travelled is, by construction, walkable floor: its outline becomes the walk polygon.

The exported splats live in nerfstudio's dataparser frame, which `ns-train` derives from
transforms.json (orientation "up", centre "poses", auto-scale to max |position| = 1). If the run's
`dataparser_transforms.json` is available pass it with --dataparser; otherwise that transform is
recomputed here with the same formulas as nerfstudio 1.1.5 (camera_utils.auto_orient_and_center_poses
and rotation_matrix_between).

Example:
    python scripts/calibrate_from_poses.py data/runs/room-x/outputs/processed/transforms.json \
        --splat-info data/runs/room-x/outputs/splat_info.json \
        --manifest public/models/room-x.manifest.json --out public/models/room-x.manifest.json
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np


def rotation_matrix_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Minimal rotation taking unit vector a to unit vector b (nerfstudio's Rodrigues form)."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    if np.abs(v).sum() < 1e-6:
        x = np.array([1.0, 0, 0]) if abs(a[0]) < 1e-6 else np.array([0, 1.0, 0])
        v = np.cross(a, x)
    v = v / np.linalg.norm(v)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    theta = math.acos(float(np.clip(np.dot(a, b), -1, 1)))
    return np.eye(3) + math.sin(theta) * k + (1 - math.cos(theta)) * (k @ k)


def dataparser_transform(poses: np.ndarray) -> tuple[np.ndarray, float]:
    """Return (3x4 transform, scale) exactly as nerfstudio's dataparser computes them."""
    origins = poses[:, :3, 3]
    translation = origins.mean(axis=0)
    up = poses[:, :3, 1].mean(axis=0)
    up = up / np.linalg.norm(up)
    rot = rotation_matrix_between(up, np.array([0, 0, 1.0]))
    transform = np.concatenate([rot, (rot @ -translation)[:, None]], axis=1)
    oriented = transform @ poses
    scale = 1.0 / float(np.abs(oriented[:, :3, 3]).max())
    return transform, scale


def processed_pose_transform(dataparser: dict, metadata: dict) -> np.ndarray:
    """Map processed poses to training coordinates without applying preprocessing twice.

    Nerfstudio saves its transform composed with transforms.json's applied_transform,
    while the frame matrices in that JSON already include applied_transform.
    """
    transform = np.array(dataparser["transform"], dtype=np.float64)
    if "applied_transform" in metadata:
        applied = np.eye(4)
        applied[:3] = np.array(metadata["applied_transform"], dtype=np.float64)
        transform = transform @ np.linalg.inv(applied)
    return transform


def convex_hull(points: np.ndarray) -> np.ndarray:
    """Andrew's monotone chain; returns hull vertices counter-clockwise."""
    pts = sorted(map(tuple, points))
    if len(pts) < 3:
        return np.array(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def offset_polygon(poly: np.ndarray, d: float) -> np.ndarray:
    """Push each vertex of a convex CCW polygon outwards by d along its averaged normal."""
    centre = poly.mean(axis=0)
    out = []
    for p in poly:
        v = p - centre
        n = np.linalg.norm(v)
        out.append(p + (v / n) * d if n > 0 else p)
    return np.array(out)


def r3(x) -> float:
    return round(float(x), 3)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("transforms", type=Path, help="processed/transforms.json of the run")
    ap.add_argument("--splat-info", type=Path, required=True, help="splat_info.json written by the web stage")
    ap.add_argument("--manifest", type=Path, required=True, help="draft manifest to update")
    ap.add_argument("--out", type=Path, help="write the calibrated manifest here (default: print only)")
    ap.add_argument("--dataparser", type=Path, help="dataparser_transforms.json from the training run (optional)")
    ap.add_argument("--camera-height", type=float, default=1.3, help="phone height during capture, metres (SOP: 1.3)")
    ap.add_argument("--margin", type=float, default=0.25, help="grow the walk outline by this many metres")
    args = ap.parse_args()

    metadata = json.loads(args.transforms.read_text())
    frames = metadata["frames"]
    frames.sort(key=lambda f: f["file_path"])  # capture order (frame_00001, ...)
    poses = np.array([f["transform_matrix"] for f in frames], dtype=np.float64)

    if args.dataparser:
        dp = json.loads(args.dataparser.read_text())
        transform, scale = processed_pose_transform(dp, metadata), float(dp["scale"])
        source = "dataparser_transforms.json"
    else:
        transform, scale = dataparser_transform(poses)
        source = "recomputed (nerfstudio 1.1.5 formulas)"
    cams = (transform @ poses)  # 3x4 per camera, still unscaled
    pos = cams[:, :3, 3] * scale  # dataparser frame, z up (same frame as the exported splats)

    info = json.loads(args.splat_info.read_text())
    floor_z, ceil_z = float(info["floor_estimate_p2"]), float(info["ceiling_estimate_p98"])
    lo, hi = np.array(info["bounds_p2"]), np.array(info["bounds_p98"])
    cam_h = float(np.median(pos[:, 2]) - floor_z)
    if cam_h <= 0:
        raise SystemExit(f"cameras are not above the splat floor (median height {cam_h:.3f}); check inputs")
    metres_per_unit = args.camera_height / cam_h

    # Viewer world (rotation -90 deg about X): world x = x, world y = z, world z = -y.
    to_world = lambda p: np.array([p[0], -p[1]]) * metres_per_unit  # noqa: E731  (x, z) on the floor
    path = np.array([to_world(p) for p in pos])
    # The outline is the camera path grown by a margin. It is deliberately not clipped to the splat
    # footprint: weakly reconstructed areas have few splats but were still walked through.
    hull = offset_polygon(convex_hull(path), args.margin)
    box_x = [hull[:, 0].min(), hull[:, 0].max()]
    box_z = [hull[:, 1].min(), hull[:, 1].max()]

    # Start at the camera nearest the middle of the path (well covered from all sides), facing the
    # way the first frame looked (the SOP's entrance view looks into the room).
    centre = path.mean(axis=0)
    start = path[int(np.argmin(np.linalg.norm(path - centre, axis=1)))]
    fwd = cams[0, :3, :3] @ np.array([0, 0, -1.0])  # OpenGL camera looks down -Z
    dx, dz = fwd[0], -fwd[1]
    yaw = math.degrees(math.atan2(-dx, -dz))

    m = json.loads(args.manifest.read_text())
    m.update({
        "name": m["name"].replace(" (uncalibrated draft)", ""),
        "scale": r3(metres_per_unit),
        "floorY": r3(floor_z * metres_per_unit),
        "eyeHeight": 1.6,
        "walkSpeed": 1.4,
        "start": {"position": [r3(start[0]), r3(start[1])], "yawDeg": r3(yaw)},
        "bounds": {"min": [r3(box_x[0]), r3(box_z[0])], "max": [r3(box_x[1]), r3(box_z[1])]},
        "walkPolygon": [[r3(x), r3(z)] for x, z in hull],
        "calibrated": True,
    })
    report = {
        "transform_source": source,
        "cameras": len(pos),
        "camera_height_units_median": r3(cam_h),
        "metres_per_unit": r3(metres_per_unit),
        "implied_floor_to_ceiling_m": r3((ceil_z - floor_z) * metres_per_unit),
        "implied_footprint_m": [r3(box_x[1] - box_x[0]), r3(box_z[1] - box_z[0])],
        "camera_path_extent_m": [r3(np.ptp(path[:, 0])), r3(np.ptp(path[:, 1]))],
        "camera_height_spread_m": r3(np.std(pos[:, 2]) * metres_per_unit),
        "walk_polygon_vertices": len(hull),
    }
    print(json.dumps(report, indent=2))
    if args.out:
        args.out.write_text(json.dumps(m, indent=2) + "\n")
        print(f"calibrated manifest: {args.out}")
    else:
        print(json.dumps(m, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
