"""Shared image-quality metrics (numpy + Pillow only, no OpenCV dependency)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ANALYSIS_WIDTH = 640  # metrics are computed on a downscaled copy for speed and scale-invariance


def load_gray(path: Path, width: int = ANALYSIS_WIDTH) -> np.ndarray:
    """Load an image as float32 grayscale in [0, 255], resized to `width`."""
    with Image.open(path) as im:
        im = im.convert("L")
        if im.width > width:
            im = im.resize((width, max(1, round(im.height * width / im.width))), Image.BILINEAR)
        return np.asarray(im, dtype=np.float32)


def laplacian_variance(gray: np.ndarray) -> float:
    """Variance of the 4-neighbour Laplacian: a standard focus / motion-blur measure."""
    lap = (-4.0 * gray[1:-1, 1:-1] + gray[:-2, 1:-1] + gray[2:, 1:-1]
           + gray[1:-1, :-2] + gray[1:-1, 2:])
    return float(lap.var())


def exposure_stats(gray: np.ndarray) -> dict:
    """Mean brightness and fraction of clipped dark / bright pixels."""
    return {
        "brightness": float(gray.mean()),
        "dark_frac": float((gray < 10).mean()),
        "bright_frac": float((gray > 245).mean()),
    }


def texture_score(gray: np.ndarray, block: int = 32) -> float:
    """Fraction of image blocks with meaningful local contrast.

    Low values indicate frames dominated by blank walls/ceiling, which give COLMAP
    few features to match.
    """
    h, w = gray.shape
    h, w = h - h % block, w - w % block
    if h == 0 or w == 0:
        return 0.0
    blocks = gray[:h, :w].reshape(h // block, block, w // block, block).std(axis=(1, 3))
    return float((blocks > 8.0).mean())


def dhash(gray: np.ndarray, size: int = 16) -> np.ndarray:
    """Difference hash used for near-duplicate detection."""
    im = Image.fromarray(gray.astype(np.uint8)).resize((size + 1, size), Image.BILINEAR)
    a = np.asarray(im, dtype=np.int16)
    return (a[:, 1:] > a[:, :-1]).flatten()
