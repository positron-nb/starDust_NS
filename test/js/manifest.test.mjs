// Unit tests for manifest validation and walk-area geometry: `npm test` (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  constrainMove, nearestInside, pointInPolygon, segmentInsidePolygon, segmentsIntersect, validateManifest,
} from "../../app/manifest.js";

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
});

test("regression: a diagonal step cannot cut the concave corner", () => {
  // Both ends are inside the L, but the middle of the step (2.005, 2.005) is outside.
  const from = [1.99, 2.02], to = [2.02, 1.99];
  assert.equal(pointInPolygon(from, L), true);
  assert.equal(pointInPolygon(to, L), true);
  assert.equal(segmentInsidePolygon(from, to, L), false);
  const got = constrainMove(from, to, { polygon: L });
  assert.notDeepEqual(got, to);
  assert.ok(segmentInsidePolygon(from, got, L) || (got[0] === from[0] && got[1] === from[1]));
});

test("random walks never leave a concave outline", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const area = { polygon: L };
  for (let walk = 0; walk < 200; walk++) {
    let p = [0.5 + rnd(), 0.5 + rnd()];
    for (let i = 0; i < 300; i++) {
      const next = constrainMove(p, [p[0] + (rnd() - 0.5) * 0.2, p[1] + (rnd() - 0.5) * 0.2], area);
      for (const f of [0.25, 0.5, 0.75, 1]) {
        const q = [p[0] + f * (next[0] - p[0]), p[1] + f * (next[1] - p[1])];
        assert.ok(pointInPolygon(q, L), `left the room at ${q} (step ${p} -> ${next})`);
      }
      p = next;
    }
  }
});

test("segmentsIntersect handles crossing, touching and disjoint segments", () => {
  assert.equal(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0]), true);
  assert.equal(segmentsIntersect([0, 0], [1, 1], [1, 1], [2, 0]), true); // touching endpoint
  assert.equal(segmentsIntersect([0, 0], [1, 0], [0, 1], [1, 1]), false);
  assert.equal(segmentsIntersect([0, 0], [2, 0], [1, 0], [3, 0]), true); // collinear overlap
});

test("outside spawn is projected to the nearest point inside", () => {
  const area = { polygon: L };
  const inside = nearestInside([3, 3], area); // in the missing corner of the L
  assert.ok(pointInPolygon(inside, L));
  assert.ok(Math.hypot(inside[0] - 3, inside[1] - 3) < 1.2);
  const far = nearestInside([10, -5], area);
  assert.ok(pointInPolygon(far, L));
  assert.deepEqual(nearestInside([1, 1], area), [1, 1]); // already inside: unchanged
  // A camera that is somehow outside is pulled back in rather than moving freely.
  assert.ok(pointInPolygon(constrainMove([5, 5], [4.5, 4.5], area), L));
  assert.deepEqual(nearestInside([5, -1], { bounds: { min: [0, 0], max: [2, 2] } }), [2, 0]);
});

test("constrainMove clamps to rectangle bounds", () => {
  const area = { bounds: { min: [0, 0], max: [2, 2] } };
  assert.deepEqual(constrainMove([1, 1], [3, -1], area), [2, 0]);
  assert.deepEqual(constrainMove([1, 1], [3, -1], null), [3, -1]);
});
