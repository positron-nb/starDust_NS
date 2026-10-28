// Unit tests for manifest validation and walk-area geometry: `npm test` (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { constrainMove, pointInPolygon, validateManifest } from "../../app/manifest.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const valid = { name: "Room", provenance: "reconstruction", file: "models/room.sog", calibrated: true };

test("published manifest is valid and its model file exists", () => {
  const raw = JSON.parse(readFileSync(join(root, "public/models/manifest.json"), "utf8"));
  const { manifest, errors } = validateManifest(raw);
  assert.deepEqual(errors, []);
  assert.ok(existsSync(join(root, "public", manifest.file)), `missing ${manifest.file}`);
});

test("minimal manifest gets defaults, including a deep-merged start", () => {
  const { manifest, errors } = validateManifest({ ...valid, start: { yawDeg: 30 } });
  assert.deepEqual(errors, []);
  assert.deepEqual(manifest.start, { position: [0, 0], yawDeg: 30 });
  assert.equal(manifest.eyeHeight, 1.6);
});

for (const [field, value, expect] of [
  ["scale", -1, /^scale:/],
  ["scale", 0, /^scale:/],
  ["eyeHeight", Number.NaN, /^eyeHeight:/],
  ["rotationDeg", [0, 90], /^rotationDeg:/],
  ["file", "models/room.txt", /^file:/],
  ["provenance", "fake", /^provenance:/],
  ["bounds", { min: [1, 1], max: [0, 2] }, /^bounds: min must be smaller/],
  ["bounds", { min: [0] }, /^bounds:/],
  ["walkPolygon", [[0, 0], [1, 1]], /^walkPolygon:/],
  ["walkPolygon", [[0, 0], [1, 1], [2, 2]], /non-zero area/],
  ["background", "red", /^background:/],
  ["start", { position: [0, "x"] }, /^start.position:/],
]) {
  test(`rejects invalid ${field}: ${JSON.stringify(value)}`, () => {
    const { manifest, errors } = validateManifest({ ...valid, [field]: value });
    assert.equal(manifest, null);
    assert.ok(errors.some((e) => expect.test(e)), errors.join(" | "));
  });
}

test("non-object manifest is rejected", () => {
  assert.equal(validateManifest([]).manifest, null);
  assert.equal(validateManifest(null).manifest, null);
});

test("warns about uncalibrated reconstructions and unknown fields", () => {
  const { warnings } = validateManifest({ ...valid, calibrated: false, extra: 1 });
  assert.ok(warnings.some((w) => w.includes("not marked calibrated")));
  assert.ok(warnings.some((w) => w.includes('"extra"')));
});

const L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]; // L-shaped room

test("pointInPolygon handles a concave room", () => {
  assert.equal(pointInPolygon([1, 1], L), true);
  assert.equal(pointInPolygon([1, 3], L), true);
  assert.equal(pointInPolygon([3, 3], L), false); // the missing corner a rectangle would allow
});

test("constrainMove slides along walls and never leaves the outline", () => {
  const area = { polygon: L };
  assert.deepEqual(constrainMove([1, 1], [1.5, 1.5], area), [1.5, 1.5]);
  assert.deepEqual(constrainMove([3, 1.5], [3, 2.5], area), [3, 1.5]); // blocked by the inner wall
  assert.deepEqual(constrainMove([3, 1.5], [3.5, 2.5], area), [3.5, 1.5]); // slides along x
  assert.deepEqual(constrainMove([5, 5], [4.5, 4.5], area), [4.5, 4.5]); // outside start is not trapped
});

test("constrainMove clamps to rectangle bounds", () => {
  const area = { bounds: { min: [0, 0], max: [2, 2] } };
  assert.deepEqual(constrainMove([1, 1], [3, -1], area), [2, 0]);
  assert.deepEqual(constrainMove([1, 1], [3, -1], null), [3, -1]);
});
