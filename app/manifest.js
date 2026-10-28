// Scene manifest: defaults, validation and walk-area geometry.
// Kept free of three.js/DOM imports so it can be unit-tested with `node --test`.

export const DEFAULTS = Object.freeze({
  name: "Untitled room",
  provenance: "unknown", // "reconstruction" | "synthetic" | "unknown"
  file: "models/room.sog",
  rotationDeg: [-90, 0, 0], // nerfstudio exports are z-up; three.js is y-up
  scale: 1,
  floorY: 0,
  eyeHeight: 1.6,
  walkSpeed: 1.4, // m/s, typical indoor walking pace
  sprintMultiplier: 2,
  start: { position: [0, 0], yawDeg: 0 },
  bounds: null, // { min: [x, z], max: [x, z] } in world metres; null = derived from splats
  walkPolygon: null, // [[x, z], ...] floor outline (>= 3 points); overrides bounds when set
  background: "#07080b",
  calibrated: false,
});

const PROVENANCE = ["reconstruction", "synthetic", "unknown"];
const MODEL_EXT = /\.(sog|spz|ply|splat|ksplat)(\?.*)?$/i;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);

/**
 * Merge `raw` over DEFAULTS and validate every field.
 * Returns { manifest, errors, warnings }; `errors` non-empty means the scene must not load.
 */
export function validateManifest(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { manifest: null, errors: ["manifest must be a JSON object"], warnings };
  }
  const m = { ...DEFAULTS, ...raw };
  m.start = { ...DEFAULTS.start, ...(raw.start && typeof raw.start === "object" ? raw.start : {}) };
  const err = (field, msg) => errors.push(`${field}: ${msg}`);

  for (const key of Object.keys(raw)) if (!(key in DEFAULTS)) warnings.push(`unknown field "${key}" ignored`);
  if (typeof m.name !== "string" || !m.name.trim()) err("name", "must be a non-empty string");
  if (!PROVENANCE.includes(m.provenance)) err("provenance", `must be one of ${PROVENANCE.join(", ")}`);
  if (typeof m.file !== "string" || !m.file.trim()) err("file", "must be a non-empty path or URL");
  else if (!MODEL_EXT.test(m.file)) err("file", "must end in .sog, .spz, .ply, .splat or .ksplat");
  if (!isVec(m.rotationDeg, 3)) err("rotationDeg", "must be [x, y, z] finite degrees");
  if (!isNum(m.scale) || m.scale <= 0) err("scale", "must be a finite number > 0");
  if (!isNum(m.floorY)) err("floorY", "must be a finite number");
  if (!isNum(m.eyeHeight) || m.eyeHeight <= 0) err("eyeHeight", "must be a finite number > 0");
  if (!isNum(m.walkSpeed) || m.walkSpeed <= 0) err("walkSpeed", "must be a finite number > 0");
  if (!isNum(m.sprintMultiplier) || m.sprintMultiplier < 1) err("sprintMultiplier", "must be a finite number >= 1");
  if (raw.start != null && (typeof raw.start !== "object" || Array.isArray(raw.start))) err("start", "must be an object");
  if (!isVec(m.start.position, 2)) err("start.position", "must be [x, z] finite numbers");
  if (!isNum(m.start.yawDeg)) err("start.yawDeg", "must be a finite number");
  if (m.bounds !== null) {
    const b = m.bounds;
    if (!b || !isVec(b.min, 2) || !isVec(b.max, 2)) err("bounds", "must be null or { min: [x, z], max: [x, z] }");
    else if (!(b.min[0] < b.max[0] && b.min[1] < b.max[1])) err("bounds", "min must be smaller than max on both axes");
  }
  if (m.walkPolygon !== null) {
    const p = m.walkPolygon;
    if (!Array.isArray(p) || p.length < 3 || !p.every((pt) => isVec(pt, 2))) {
      err("walkPolygon", "must be null or an array of at least 3 [x, z] points");
    } else if (Math.abs(polygonArea(p)) < 1e-6) {
      err("walkPolygon", "points must enclose a non-zero area");
    }
  }
  if (typeof m.background !== "string" || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(m.background)) {
    err("background", 'must be a hex colour such as "#07080b"');
  }
  if (typeof m.calibrated !== "boolean") err("calibrated", "must be true or false");
  if (errors.length === 0) {
    const inside = m.walkPolygon ? pointInPolygon(m.start.position, m.walkPolygon)
      : !m.bounds || insideBounds(m.start.position, m.bounds);
    if (!inside) warnings.push("start.position is outside the walkable area; it will be clamped");
    if (m.provenance === "reconstruction" && !m.calibrated) warnings.push("reconstruction is not marked calibrated");
  }
  return { manifest: errors.length ? null : m, errors, warnings };
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return a / 2;
}

/** Even-odd ray-casting test for a point [x, z] against a polygon [[x, z], ...]. */
export function pointInPolygon([x, z], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function insideBounds([x, z], b) {
  return x >= b.min[0] && x <= b.max[0] && z >= b.min[1] && z <= b.max[1];
}

/**
 * Resolve a move from `from` to `to` (both [x, z]) against the walk area.
 * Tries the full move, then each axis alone (so the camera slides along edges), else stays put.
 * This is a navigation boundary, not physical collision: splats have no surfaces.
 */
export function constrainMove(from, to, area) {
  if (!area) return to;
  if (area.polygon) {
    const ok = (p) => pointInPolygon(p, area.polygon);
    if (ok(to) || !ok(from)) return to; // never trap a camera that starts outside the outline
    if (ok([to[0], from[1]])) return [to[0], from[1]];
    if (ok([from[0], to[1]])) return [from[0], to[1]];
    return from;
  }
  const b = area.bounds;
  return [Math.min(Math.max(to[0], b.min[0]), b.max[0]), Math.min(Math.max(to[1], b.min[1]), b.max[1])];
}

/** Value at fraction `p` (0..1) of an already-sorted typed array. */
export function percentileSorted(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}
