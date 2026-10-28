// Namma Space walkthrough viewer: Three.js + Spark (Gaussian splat renderer).
// The model and its alignment come from public/models/manifest.json, so a new room
// can be swapped in without touching this file (see README "Replacing the model").
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const params = new URLSearchParams(location.search);
const CALIBRATE = params.has("calibrate");
const MANIFEST_URL = params.get("manifest") || "models/manifest.json";
const MAX_DPR = Number(params.get("dpr")) || 1.5;

const DEFAULTS = {
  name: "Untitled room",
  provenance: "unknown", // "reconstruction" | "synthetic"
  file: "models/room.sog",
  rotationDeg: [-90, 0, 0], // nerfstudio exports are z-up; three.js is y-up
  scale: 1,
  floorY: 0,
  eyeHeight: 1.6,
  walkSpeed: 1.4, // m/s, typical indoor walking pace
  sprintMultiplier: 2,
  start: { position: [0, 0], yawDeg: 0 },
  bounds: null, // { min: [x, z], max: [x, z] } in world metres; null = derived from splats
  background: "#07080b",
};

const LOOK_SENSITIVITY = 0.0022; // radians per pixel
const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
const EYE_OFFSET_RANGE = [-0.8, 0.6];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $("viewport"), overlay: $("overlay"), title: $("overlay-title"), sub: $("overlay-sub"),
  loader: $("loader"), barFill: $("bar-fill"), status: $("load-status"), pct: $("load-pct"),
  error: $("error"), errorTitle: $("error-title"), errorDetail: $("error-detail"), retry: $("retry"),
  start: $("start"), modelName: $("model-name"), provenance: $("provenance"),
  hud: $("hud"), fps: $("hud-fps"), splats: $("hud-splats"), size: $("hud-size"), load: $("hud-load"),
  pos: $("hud-pos"), mode: $("hud-mode"), toast: $("toast"),
  btnReset: $("btn-reset"), btnExit: $("btn-exit"), btnFull: $("btn-fullscreen"), btnHud: $("btn-hud"),
};

// ---------- State ----------
const state = {
  manifest: { ...DEFAULTS },
  mode: "loading", // loading | ready | walk | drag | error
  keys: new Set(),
  yaw: 0,
  pitch: 0,
  eyeOffset: 0,
  velocity: new THREE.Vector3(),
  fly: false,
  bounds: null,
  loaded: false,
  dragging: false,
};

// ---------- Renderer ----------
if (!hasWebGL2()) {
  fatal("WebGL 2 is not available", "This viewer needs a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari) and hardware acceleration enabled.");
  throw new Error("WebGL2 unavailable");
}

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 300);
camera.rotation.order = "YXZ";
scene.add(camera);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

const modelRoot = new THREE.Group();
scene.add(modelRoot);
let splatMesh = null;

ui.canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  fatal("Graphics context lost", "The GPU reset or ran out of memory. Reload the page; on low-memory devices try ?dpr=1.");
});

// ---------- Loading ----------
async function boot() {
  setLoading("Fetching scene manifest…", null);
  ui.error.hidden = true;
  ui.start.disabled = true;
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) throw new LoadError(`Manifest ${MANIFEST_URL} returned HTTP ${res.status}.`);
    if ((res.headers.get("content-type") || "").includes("text/html")) {
      throw new LoadError(`${MANIFEST_URL} was not found (the server returned an HTML page). Check public/models/manifest.json.`);
    }
    state.manifest = { ...DEFAULTS, ...(await res.json()) };
  } catch (err) {
    return fail("Scene manifest missing", err);
  }
  const m = state.manifest;
  ui.modelName.textContent = m.name;
  ui.provenance.hidden = false;
  ui.provenance.textContent = m.provenance === "reconstruction" ? "Real capture" : m.provenance === "synthetic" ? "Synthetic test scene" : m.provenance;
  ui.provenance.className = `badge ${m.provenance === "reconstruction" ? "real" : "synthetic"}`;
  if (m.provenance !== "reconstruction") {
    ui.sub.textContent = "Procedurally generated test scene used to verify the viewer. It is not a reconstruction of a real room.";
  }
  scene.background = new THREE.Color(m.background);
  applyTransform();
  resetCamera();

  const t0 = performance.now();
  let bytes;
  try {
    bytes = await fetchWithProgress(m.file, (loaded, total) => {
      const mb = (loaded / 2 ** 20).toFixed(1);
      if (total) setLoading(`Downloading model · ${mb} / ${(total / 2 ** 20).toFixed(1)} MB`, loaded / total);
      else setLoading(`Downloading model · ${mb} MB`, null);
    });
  } catch (err) {
    return fail("Model file could not be downloaded", err);
  }
  ui.size.textContent = `${(bytes.byteLength / 2 ** 20).toFixed(1)} MB`;

  setLoading("Decoding Gaussian splats…", null);
  try {
    if (splatMesh) { modelRoot.remove(splatMesh); splatMesh.dispose?.(); }
    splatMesh = new SplatMesh({ fileBytes: bytes, fileName: m.file.split("/").pop() });
    modelRoot.add(splatMesh);
    await splatMesh.initialized;
  } catch (err) {
    return fail("Model file could not be decoded", err);
  }
  const loadSeconds = (performance.now() - t0) / 1000;
  const count = splatMesh.packedSplats?.numSplats ?? splatMesh.extSplats?.numSplats ?? splatMesh.numSplats;
  ui.splats.textContent = Number.isFinite(count) ? count.toLocaleString() : "–";
  ui.load.textContent = `${loadSeconds.toFixed(1)} s`;
  console.info(`[namma-space] loaded ${m.file}: ${count} splats, ${(bytes.byteLength / 2 ** 20).toFixed(1)} MB in ${loadSeconds.toFixed(2)} s`);

  state.loaded = true;
  updateBounds();
  resetCamera();
  setLoading("Ready", 1);
  ui.loader.hidden = true;
  ui.start.disabled = false;
  setMode("ready");
  ui.start.focus({ preventScroll: true });
  if (CALIBRATE) initCalibration();
}

async function fetchWithProgress(url, onProgress) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new LoadError(`Network error while requesting ${url}: ${err.message}`);
  }
  if (!res.ok) throw new LoadError(`${url} returned HTTP ${res.status} ${res.statusText}. Check that the file exists in public/models and the path in manifest.json.`);
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new LoadError(`${url} returned an HTML page instead of a splat file (likely a host fallback/404 page).`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total > loaded ? total : 0);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

class LoadError extends Error {}

function setLoading(text, fraction) {
  ui.loader.hidden = false;
  ui.status.textContent = text;
  ui.barFill.classList.toggle("indeterminate", fraction == null);
  ui.barFill.style.width = fraction == null ? "" : `${Math.round(fraction * 100)}%`;
  ui.pct.textContent = fraction == null ? "" : `${Math.round(fraction * 100)}%`;
}

function fail(title, err) {
  console.error(`[namma-space] ${title}:`, err);
  state.mode = "error";
  ui.loader.hidden = true;
  ui.error.hidden = false;
  ui.errorTitle.textContent = title;
  ui.errorDetail.textContent = err?.message || String(err);
  ui.start.disabled = true;
  showOverlay();
}

function fatal(title, detail) {
  ui.loader.hidden = true;
  ui.error.hidden = false;
  ui.retry.hidden = true;
  ui.errorTitle.textContent = title;
  ui.errorDetail.textContent = detail;
  ui.start.disabled = true;
  state.mode = "error";
}

function hasWebGL2() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

// ---------- Model transform, bounds, camera ----------
function applyTransform() {
  const m = state.manifest;
  const [rx, ry, rz] = m.rotationDeg.map(THREE.MathUtils.degToRad);
  modelRoot.rotation.set(rx, ry, rz, "XYZ");
  modelRoot.scale.setScalar(m.scale);
  modelRoot.updateMatrixWorld(true);
}

// Robust world-space extents of splat centres (percentiles ignore stray floaters).
function splatStats() {
  if (!splatMesh) return null;
  modelRoot.updateMatrixWorld(true);
  const mat = splatMesh.matrixWorld;
  const xs = [], ys = [], zs = [];
  const v = new THREE.Vector3();
  splatMesh.forEachSplat((i, center, _s, _q, opacity) => {
    if (opacity < 0.2) return;
    v.copy(center).applyMatrix4(mat);
    xs.push(v.x); ys.push(v.y); zs.push(v.z);
  });
  if (!xs.length) return null;
  const pct = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return {
    min: [pct(xs, 0.02), pct(zs, 0.02)], max: [pct(xs, 0.98), pct(zs, 0.98)],
    floor: pct(ys, 0.02), ceiling: pct(ys, 0.98),
  };
}

function updateBounds() {
  const b = state.manifest.bounds;
  if (b) { state.bounds = { min: b.min, max: b.max }; return; }
  const s = splatStats();
  const pad = 0.15;
  state.bounds = s ? { min: [s.min[0] + pad, s.min[1] + pad], max: [s.max[0] - pad, s.max[1] - pad] } : null;
}

function eyeY() {
  return state.manifest.floorY + state.manifest.eyeHeight + state.eyeOffset;
}

function resetCamera() {
  const { start } = state.manifest;
  state.eyeOffset = 0;
  state.velocity.set(0, 0, 0);
  state.yaw = THREE.MathUtils.degToRad(start.yawDeg || 0);
  state.pitch = 0;
  camera.position.set(start.position[0], eyeY(), start.position[1]);
  applyLook();
}

function applyLook() {
  camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
}

// ---------- Modes & overlay ----------
function setMode(mode) {
  state.mode = mode;
  ui.mode.textContent = state.fly ? `${mode} · fly` : mode;
  document.body.classList.toggle("walking", mode === "walk" || mode === "drag");
}

function showOverlay(paused = false) {
  ui.overlay.classList.remove("hidden");
  ui.overlay.removeAttribute("aria-hidden");
  if (state.loaded) {
    ui.title.textContent = paused ? "Paused" : "Walk through the room";
    ui.start.textContent = paused ? "Resume walkthrough" : "Start walkthrough";
  }
}

function hideOverlay() {
  ui.overlay.classList.add("hidden");
  ui.overlay.setAttribute("aria-hidden", "true");
}

function startWalk() {
  if (!state.loaded) return;
  hideOverlay();
  ui.canvas.focus({ preventScroll: true });
  // requestPointerLock returns a promise in modern browsers and undefined in older ones.
  try {
    const p = ui.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p?.catch) p.catch(() => ui.canvas.requestPointerLock()?.catch?.(enterDragMode));
    else if (!ui.canvas.requestPointerLock) enterDragMode();
  } catch {
    enterDragMode();
  }
}

// Fallback for embedded frames or browsers that refuse pointer lock: drag to look.
function enterDragMode() {
  if (document.pointerLockElement) return;
  setMode("drag");
  hideOverlay();
  toast("Pointer lock unavailable: drag with the mouse to look");
}

function exitWalk(paused = false) {
  if (document.pointerLockElement) document.exitPointerLock();
  state.keys.clear();
  state.dragging = false;
  setMode("ready");
  showOverlay(paused);
}

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === ui.canvas) {
    setMode("walk");
    hideOverlay();
  } else if (state.mode === "walk") {
    exitWalk(true); // Esc or focus loss released the mouse
  }
});
document.addEventListener("pointerlockerror", () => {
  // Chrome blocks re-locking for ~1 s after Esc; fall back instead of silently failing.
  if (state.mode !== "walk") enterDragMode();
});

// ---------- Input ----------
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight", "Space", "KeyC"]);

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const active = state.mode === "walk" || state.mode === "drag";
  if (MOVE_KEYS.has(e.code) && active) {
    state.keys.add(e.code);
    e.preventDefault();
  }
  if (e.repeat) return;
  switch (e.code) {
    case "KeyR": if (state.loaded) { resetCamera(); toast("Camera reset to start point"); } break;
    case "KeyF": toggleFullscreen(); break;
    case "KeyI": toggleHud(); break;
    case "Escape": if (state.mode === "drag") exitWalk(true); break;
    case "Enter": if (state.mode === "ready" && document.activeElement !== ui.start) startWalk(); break;
  }
});
window.addEventListener("keyup", (e) => state.keys.delete(e.code));
window.addEventListener("blur", () => { state.keys.clear(); state.dragging = false; });

document.addEventListener("mousemove", (e) => {
  const locked = document.pointerLockElement === ui.canvas;
  if (!locked && !(state.mode === "drag" && state.dragging)) return;
  // Ignore occasional huge spikes some browsers emit right after locking.
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  state.yaw -= e.movementX * LOOK_SENSITIVITY;
  state.pitch = THREE.MathUtils.clamp(state.pitch - e.movementY * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  applyLook();
});
ui.canvas.addEventListener("mousedown", () => { if (state.mode === "drag") state.dragging = true; });
window.addEventListener("mouseup", () => { state.dragging = false; });

ui.start.addEventListener("click", startWalk);
ui.retry.addEventListener("click", () => { ui.error.hidden = true; boot(); });
ui.btnReset.addEventListener("click", () => { if (state.loaded) { resetCamera(); toast("Camera reset to start point"); } });
ui.btnExit.addEventListener("click", () => exitWalk(false));
ui.btnFull.addEventListener("click", toggleFullscreen);
ui.btnHud.addEventListener("click", toggleHud);

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => toast("Fullscreen was blocked by the browser"));
  else document.exitFullscreen?.();
}
function toggleHud() {
  ui.hud.hidden = !ui.hud.hidden;
  ui.btnHud.setAttribute("aria-pressed", String(!ui.hud.hidden));
}

let toastTimer;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2200);
}

// ---------- Resize ----------
function onResize() {
  const w = window.innerWidth, h = Math.max(1, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", onResize);

// ---------- Simulation ----------
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const wish = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function step(dt) {
  if (state.mode !== "walk" && state.mode !== "drag") {
    state.velocity.multiplyScalar(Math.exp(-dt * 12));
    return;
  }
  const k = state.keys;
  const m = state.manifest;
  forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  right.crossVectors(forward, UP);
  wish.set(0, 0, 0);
  if (k.has("KeyW") || k.has("ArrowUp")) wish.add(forward);
  if (k.has("KeyS") || k.has("ArrowDown")) wish.sub(forward);
  if (k.has("KeyD") || k.has("ArrowRight")) wish.add(right);
  if (k.has("KeyA") || k.has("ArrowLeft")) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize();
  const sprint = k.has("ShiftLeft") || k.has("ShiftRight") ? m.sprintMultiplier : 1;
  wish.multiplyScalar(m.walkSpeed * sprint);
  // Exponential smoothing gives gentle acceleration without overshoot.
  state.velocity.lerp(wish, 1 - Math.exp(-dt * 10));
  camera.position.addScaledVector(state.velocity, dt);

  const vertical = (k.has("KeyE") || k.has("Space") ? 1 : 0) - (k.has("KeyQ") || k.has("KeyC") ? 1 : 0);
  if (state.fly) {
    camera.position.y += vertical * m.walkSpeed * sprint * dt;
  } else {
    state.eyeOffset = THREE.MathUtils.clamp(state.eyeOffset + vertical * 0.8 * dt, ...EYE_OFFSET_RANGE);
    camera.position.y = eyeY();
    // Soft navigation boundary derived from the splat extents. This is NOT collision
    // detection: it only stops the visitor walking out of the reconstructed volume.
    if (state.bounds) {
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, state.bounds.min[0], state.bounds.max[0]);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, state.bounds.min[1], state.bounds.max[1]);
    }
  }
}

// ---------- Loop ----------
let lastTime = performance.now();
let fpsFrames = 0, fpsTime = 0, hudTime = 0;
renderer.setAnimationLoop((now) => {
  const rawDt = Math.max((now - lastTime) / 1000, 0);
  const dt = Math.min(rawDt, 0.05);
  lastTime = now;
  step(dt);
  renderer.render(scene, camera);
  fpsFrames++; fpsTime += rawDt; hudTime += rawDt;
  if (fpsTime >= 0.5) {
    ui.fps.textContent = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
  }
  if (hudTime >= 0.1) {
    hudTime = 0;
    const p = camera.position;
    ui.pos.textContent = `${p.x.toFixed(2)}, ${p.z.toFixed(2)} @ ${p.y.toFixed(2)}`;
  }
});

window.addEventListener("unhandledrejection", (e) => console.error("[namma-space] unhandled:", e.reason));

// ---------- Calibration panel (?calibrate) ----------
function initCalibration() {
  const panel = $("calib");
  panel.hidden = false;
  const m = state.manifest;
  const fields = [
    ["c-rx", "o-rx", () => m.rotationDeg[0], (v) => (m.rotationDeg[0] = v), "°"],
    ["c-ry", "o-ry", () => m.rotationDeg[1], (v) => (m.rotationDeg[1] = v), "°"],
    ["c-rz", "o-rz", () => m.rotationDeg[2], (v) => (m.rotationDeg[2] = v), "°"],
    ["c-scale", "o-scale", () => m.scale, (v) => (m.scale = v), "×"],
    ["c-floor", "o-floor", () => m.floorY, (v) => (m.floorY = v), " m"],
    ["c-eye", "o-eye", () => m.eyeHeight, (v) => (m.eyeHeight = v), " m"],
  ];
  m.rotationDeg = [...m.rotationDeg];
  for (const [inputId, outId, get, set, unit] of fields) {
    const input = $(inputId), out = $(outId);
    input.value = get();
    out.textContent = `${get()}${unit}`;
    input.addEventListener("input", () => {
      set(Number(input.value));
      out.textContent = `${input.value}${unit}`;
      applyTransform();
      if (!state.fly) camera.position.y = eyeY();
      renderJson();
    });
  }
  $("c-fly").addEventListener("change", (e) => { state.fly = e.target.checked; setMode(state.mode); });
  $("c-start").addEventListener("click", () => {
    m.start = { position: [round(camera.position.x), round(camera.position.z)], yawDeg: round(THREE.MathUtils.radToDeg(state.yaw)) };
    renderJson(); toast("Start point set to current camera");
  });
  $("c-bounds").addEventListener("click", () => {
    const s = splatStats();
    if (!s) return;
    m.bounds = { min: s.min.map((v) => round(v + 0.15)), max: s.max.map((v) => round(v - 0.15)) };
    m.floorY = round(s.floor);
    $("c-floor").value = m.floorY; $("o-floor").textContent = `${m.floorY} m`;
    updateBounds(); camera.position.y = eyeY(); renderJson();
    toast(`Floor ${m.floorY} m, ceiling ${round(s.ceiling)} m (2nd/98th percentile)`);
  });
  $("c-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(manifestJson()); toast("Manifest JSON copied"); }
    catch { toast("Clipboard blocked: copy from the box below"); }
  });
  renderJson();
}
const round = (v) => Math.round(v * 1000) / 1000;
function manifestJson() {
  const m = state.manifest;
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = m[key];
  for (const key of Object.keys(m)) if (!(key in out)) out[key] = m[key];
  return JSON.stringify(out, null, 2);
}
function renderJson() { $("c-json").textContent = manifestJson(); }

boot();
