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
    if (!inside) warnings.push("start.position is outside the walkable area; the camera will spawn at the nearest point inside");
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

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p, a, b) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
  && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

/** True if segments ab and cd intersect, including touching endpoints and collinear overlap. */
export function segmentsIntersect(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(a, c, d)) || (d2 === 0 && onSegment(b, c, d))
    || (d3 === 0 && onSegment(c, a, b)) || (d4 === 0 && onSegment(d, a, b));
}

/** True if the straight path a→b stays inside the polygon (end inside, no wall crossed or touched). */
export function segmentInsidePolygon(a, b, poly) {
  if (!pointInPolygon(b, poly)) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(a, b, poly[j], poly[i])) return false;
  }
  return true;
}

/**
 * Nearest point to `p` inside the walk area. Outside a polygon, it is the closest boundary
 * point nudged `inset` metres inward (tried along the edge normal, then towards p's neighbourhood).
 */
export function nearestInside(p, area, inset = 0.05) {
  if (!area) return p;
  if (area.bounds) {
    const b = area.bounds;
    return [Math.min(Math.max(p[0], b.min[0]), b.max[0]), Math.min(Math.max(p[1], b.min[1]), b.max[1])];
  }
  const poly = area.polygon;
  if (pointInPolygon(p, poly)) return p;
  let best = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez;
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / len2));
    const q = [a[0] + t * ex, a[1] + t * ez];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (!best || d < best.d) best = { d, q, n: [-ez / Math.sqrt(len2), ex / Math.sqrt(len2)], a, b };
  }
  for (const s of [1, -1]) {
    for (const k of [1, 2, 4]) {
      const c = [best.q[0] + s * k * inset * best.n[0], best.q[1] + s * k * inset * best.n[1]];
      if (pointInPolygon(c, poly)) return c;
    }
  }
  // Closest point is a convex corner where the normal misses: step towards the edge midpoint.
  const mid = [(best.a[0] + best.b[0]) / 2, (best.a[1] + best.b[1]) / 2];
  for (let f = 0.1; f <= 1; f += 0.1) {
    const c = [best.q[0] + f * (mid[0] - best.q[0]), best.q[1] + f * (mid[1] - best.q[1])];
    for (const s of [1, -1]) {
      const cc = [c[0] + s * inset * best.n[0], c[1] + s * inset * best.n[1]];
      if (pointInPolygon(cc, poly)) return cc;
    }
  }
  return polygonCentroidInside(poly);
}

function polygonCentroidInside(poly) {
  const n = poly.length;
  const c = [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  return pointInPolygon(c, poly) ? c : [...poly[0]];
}

/**
 * Resolve a move from `from` to `to` (both [x, z]) against the walk area.
 * Tries the full move, then each axis alone (so the camera slides along walls), else stays put.
 * For a polygon the whole path is checked, so a diagonal step cannot cut a concave corner.
 * A camera that is somehow outside is projected back inside. This is a navigation boundary,
 * not physical collision: splats have no surfaces.
 */
export function constrainMove(from, to, area) {
  if (!area) return to;
  if (area.polygon) {
    const poly = area.polygon;
    if (!pointInPolygon(from, poly)) return nearestInside(from, area);
    const ok = (p) => segmentInsidePolygon(from, p, poly);
    if (ok(to)) return to;
    const xOnly = [to[0], from[1]];
    if (ok(xOnly)) return xOnly;
    const zOnly = [from[0], to[1]];
    if (ok(zOnly)) return zOnly;
    return from;
  }
  return nearestInside(to, area);
}

/** Value at fraction `p` (0..1) of an already-sorted typed array. */
export function percentileSorted(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}
