"""Nerfstudio 1.1.5 launcher with file-backed full-image caches for this 8 GB WSL VM.

Uses the installed Nerfstudio undistortion routine and camera updates unchanged.
Only cache storage changes: writable .npy memory maps replace pinned CPU tensors.
"""
from pathlib import Path
import json
import numpy as np
import torch
from nerfstudio.data.datamanagers.full_images_datamanager import (
    FullImageDatamanager, _undistort_image,
)
from nerfstudio.scripts.train import entrypoint


def load_file_backed_images(self, split, cache_images_device):
    if cache_images_device != "cpu":
        raise ValueError("This launcher requires --pipeline.datamanager.cache-images cpu")
    dataset = self.train_dataset if split == "train" else self.eval_dataset
    root = Path(self.config.data) / "disk_cache" / split
    root.mkdir(parents=True, exist_ok=True)
    cached = []
    for idx in range(len(dataset)):
        data = dataset.get_data(idx, image_type=self.config.cache_images_type)
        camera = dataset.cameras[idx].reshape(())
        assert tuple(data["image"].shape[:2]) == (camera.height.item(), camera.width.item())
        if camera.distortion_params is not None and torch.any(camera.distortion_params != 0):
            K, image, mask = _undistort_image(
                camera, camera.distortion_params.numpy(), data,
                data["image"].numpy(), camera.get_intrinsics_matrices().numpy(),
            )
            data["image"] = torch.from_numpy(image)
            if mask is not None:
                data["mask"] = mask
            dataset.cameras.fx[idx] = float(K[0, 0])
            dataset.cameras.fy[idx] = float(K[1, 1])
            dataset.cameras.cx[idx] = float(K[0, 2])
            dataset.cameras.cy[idx] = float(K[1, 2])
            dataset.cameras.width[idx] = image.shape[1]
            dataset.cameras.height[idx] = image.shape[0]
        for key in ("image", "mask", "depth"):
            if key not in data:
                continue
            value = data[key]
            array = value.detach().cpu().numpy() if isinstance(value, torch.Tensor) else np.asarray(value)
            path = root / f"{idx:05d}-{key}.npy"
            np.save(path, array, allow_pickle=False)
            mapped = np.load(path, mmap_mode="r+", allow_pickle=False)
            if idx == 0:
                assert np.array_equal(array, mapped), f"Cache verification failed: {key}"
            data[key] = torch.from_numpy(mapped)
        cached.append(data)
        if idx % 100 == 0 or idx + 1 == len(dataset):
            print(f"File-backed {split} cache: {idx + 1}/{len(dataset)}", flush=True)
    self.train_cameras = self.train_dataset.cameras
    (root / "summary.json").write_text(json.dumps({
        "frames": len(cached), "image_type": self.config.cache_images_type,
        "storage": "numpy writable memory maps", "undistortion": "nerfstudio original",
    }, indent=2))
    return cached


FullImageDatamanager._load_images = load_file_backed_images
if __name__ == "__main__":
    entrypoint()
