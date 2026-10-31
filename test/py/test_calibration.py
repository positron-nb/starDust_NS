"""Regression coverage for Nerfstudio's composed dataparser transform."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location(
    "calibrate", Path(__file__).resolve().parents[2] / "scripts/calibrate_from_poses.py"
)
calibrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(calibrate)


class ComposedDataparserTransform(unittest.TestCase):
    def test_processed_pose_does_not_apply_axis_conversion_twice(self):
        applied = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1.]])
        training = np.array([[0, -1, 0, 2], [1, 0, 0, -3], [0, 0, 1, 4.]])
        raw_pose = np.eye(4)
        raw_pose[:3, 3] = [3, 5, 7]
        dp = {"transform": (training @ applied).tolist()}
        actual = calibrate.processed_pose_transform(dp, {"applied_transform": applied[:3].tolist()})
        np.testing.assert_allclose(actual @ (applied @ raw_pose), training @ applied @ raw_pose)

    def test_poses_without_preprocessing_use_saved_transform(self):
        transform = np.array([[1, 0, 0, 2], [0, 1, 0, 3], [0, 0, 1, 4.]])
        np.testing.assert_allclose(
            calibrate.processed_pose_transform({"transform": transform.tolist()}, {}), transform
        )
