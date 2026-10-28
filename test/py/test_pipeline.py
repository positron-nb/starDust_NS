"""Pipeline tests (no GPU, no capture needed): `python -m unittest discover -s test/py -v`."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
FIXTURE = ROOT / "test" / "sample_data" / "synthetic_room.ply"


def run(script: str, *args) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / script), *map(str, args)],
                          capture_output=True, text=True)


class FramesAndGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        video = cls.dir / "test.mp4"
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
                        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6",
                        "-pix_fmt", "yuv420p", str(video)], check=True)
        cls.images = cls.dir / "ws" / "images"
        cls.extract = run("extract_frames.py", video, cls.images, "--fps", 2, "--max-width", 960)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_extract_keeps_one_frame_per_group(self):
        self.assertEqual(self.extract.returncode, 0, self.extract.stderr)
        report = json.loads((self.images.parent / "extract_report.json").read_text())
        self.assertEqual(report["candidates"], 36)
        self.assertEqual(report["kept_frames"], 12)
        with Image.open(next(self.images.glob("*.jpg"))) as im:
            self.assertEqual(im.size, (960, 540))

    def test_gate_passes_with_enough_frames(self):
        r = run("check_images.py", self.images, "--min-frames", 10)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_gate_fails_below_minimum(self):
        r = run("check_images.py", self.images, "--min-frames", 1000)
        self.assertEqual(r.returncode, 3)
        self.assertIn("usable frames", r.stderr)

    def test_gate_fails_when_every_frame_is_rejected(self):
        blank = self.dir / "blank"
        blank.mkdir()
        for i in range(5):  # uniform grey: no texture, no sharpness
            Image.fromarray(np.full((360, 640, 3), 128, np.uint8)).save(blank / f"f{i}.jpg")
        r = run("check_images.py", blank, "--min-frames", 0, "--move-rejects")
        self.assertEqual(r.returncode, 3, r.stdout)
        summary = json.loads((self.dir / "quality_summary.json").read_text())
        self.assertEqual(summary["kept"], 0)
        self.assertEqual(len(list(blank.iterdir())), 0)  # rejects were moved aside


class SplatInfo(unittest.TestCase):
    def test_fixture_summary_and_draft_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            info_path, draft = Path(tmp) / "info.json", Path(tmp) / "draft.json"
            r = run("splat_info.py", FIXTURE, "--up", "z", "--json", info_path,
                    "--manifest-out", draft, "--model-file", "models/test.sog")
            self.assertEqual(r.returncode, 0, r.stderr)
            info = json.loads(info_path.read_text())
            self.assertEqual(info["splats"], 79102)
            self.assertEqual(info["non_finite"], 0)
            self.assertEqual(info["size_bytes"], FIXTURE.stat().st_size)
            self.assertAlmostEqual(info["floor_estimate_p2"], 0.0, places=2)
            m = json.loads(draft.read_text())
            self.assertEqual(m["provenance"], "reconstruction")
            self.assertFalse(m["calibrated"])
            self.assertEqual(m["rotationDeg"], [-90, 0, 0])
            self.assertAlmostEqual(m["floorY"], 0.0, places=2)
            # z-up export -> viewer world: x stays, world z = -export y (room is 0..4 x 0..3)
            self.assertTrue(0 < m["bounds"]["min"][0] < 0.5 and 3.5 < m["bounds"]["max"][0] < 4)
            self.assertTrue(-3 < m["bounds"]["min"][1] < -2.5 and -0.5 < m["bounds"]["max"][1] < 0)
            self.assertAlmostEqual(m["eyeHeight"], 0.62 * 2.6, places=1)


if __name__ == "__main__":
    unittest.main()
