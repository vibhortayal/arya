"use strict";
/* SceneView — the hunt viewport (Stage B).
 *
 * The session engine is the game; the scene is only a viewport. A
 * hunt must complete end-to-end on any rung of the ladder with zero
 * functional difference — same stops, same Next, same COLLECT, same
 * scoring, same receipt finish — because all of that lives in the
 * screen and the engine, never in a driver.
 *
 * The ladder:
 *   "photo" — the photo-walk driver: the mapped store's own
 *             walkthrough frames, crossfaded by path fraction.
 *             The DEFAULT view for a mapped store (Discussion
 *             43). The screen sets el.dataset.photos to the
 *             store's frames directory before creating the view.
 *             Honest naming: these are photos of the store along
 *             the walk path — never a "3D model", never a live
 *             view.
 *   "cloud" — the VGGT point-cloud driver (Three.js): the store
 *             rebuilt from a shopper's walkthrough, walked along the
 *             real camera path. The screen sets el.dataset.model to
 *             the store's manifest URL before creating the view
 *             (assets built by assistant/tools/prep_cloud.py).
 *             shelf-graph.json beside the manifest (Stage D) names
 *             the shelves observed near each path position and is
 *             shown as a chip for the next stop; it is optional —
 *             no graph, no labels, nothing else changes. If
 *             anything fails to load, the driver falls back to
 *             "strip" in place — a hunt never hard-fails on a model.
 *   "aisle" — the stylized aisle scene: what a mapped store shows
 *             before its cloud exists.
 *   "strip" — a first-class 2D driver: stops as shelf cards on a
 *             flat store strip, in walking order. The default when a
 *             store has no model, and the low-battery / low-motion
 *             choice mid-hunt.
 *   "art"   — the illustrated aisle (owner, 2026-10-28): what a
 *             Quest hunt shows when the store — or the focused
 *             stop's section — is not mapped. One cast-style
 *             illustration that drifts forward as the hunt
 *             progresses, dots for stops, and a caption that
 *             invites the player to teach Arya the real store.
 *             Quest mode only; Express keeps the strip.
 *
 * Driver contract:
 *   create(el) -> driver            mount into el (the driver owns el's content)
 *   driver.setStops(stops)          stops in route order:
 *                                   [{name, qty, checked, flagged,
 *                                     shelfLabel, shelfU, shelfSide,
 *                                     unplaced}]
 *                                   flagged = an open "not here" report;
 *                                   shelf* = the stop's matched shelf
 *                                   (item–shelf matching); unplaced =
 *                                   the store has a graph but this
 *                                   item matched no shelf
 *   driver.setNext(index)           highlight the next unchecked stop; -1 = none
 *   driver.glideTo(index)           animate the walk toward a stop
 *   driver.onTapStop = fn(index)    assigned by the screen; the driver
 *                                   calls it when a stop is tapped
 *   driver.destroy()                tear down listeners/timers
 *
 * Motion navigation (Discussion 33) — OPTIONAL driver methods. One
 * motion layer (MotionMath + createMotionLook + createStepDetector,
 * below) serves every rung; drivers only render what they are told:
 *   driver.setLook(yaw, pitch)      look offsets in radians, relative
 *                                   to facing the next stop; the same
 *                                   clamps as drag-look. A photo-style
 *                                   driver implements this as a
 *                                   horizontal pan across its wide
 *                                   frame (MotionMath.panFraction).
 *   driver.setProgress(u)           place the view at path fraction
 *                                   u in [0, 1] (step advance).
 * A driver without them simply does not move; the hunt is unchanged.
 */
const SCENE_BASE = (document.currentScript && document.currentScript.src)
  || document.baseURI;
const THREE_URL = new URL("vendor/three.module.js", SCENE_BASE).href;
const SceneDrivers = {};

function createSceneView(el, driverName) {
  const make = SceneDrivers[driverName] || SceneDrivers.strip;
  return make(el);
}

/* ---- "cloud" — the VGGT point-cloud driver -------------------------
 * Renders the store's rebuilt point cloud (Three.js) and walks the
 * smoothed camera path shipped in the model manifest (prep_cloud.py
 * removed the mislocalized poses, so the path cannot lurch). Stops
 * are numbered markers anchored along the path: a stop matched to a
 * shelf (item–shelf matching) sits at its shelf's path position on
 * the shelf's side; an unmatched stop keeps the even spacing and
 * alternating sides. The next stop pulses; glideTo walks the camera
 * to a stop; tapping a marker fires onTapStop; dragging looks
 * around.
 *
 * The contract is synchronous but loading is not, so this driver is
 * a proxy: it starts on a loading view, adopts the real driver when
 * the model arrives, and adopts "strip" in place if anything fails —
 * the hunt screen never sees an error from this rung. */
SceneDrivers.cloud = function (el) {
  const modelUrl = el.dataset.model || "";
  el.innerHTML = `<div class="cloud-host"></div>`;
  const host = el.querySelector(".cloud-host");
  const queued = { stops: [], next: -1, glide: -1, hasGlide: false, look: null, progress: null };
  let impl = null, dead = false;

  function adopt(next) {
    if (impl) impl.destroy();
    impl = next;
    impl.onTapStop = i => { if (driver.onTapStop) driver.onTapStop(i); };
    impl.setStops(queued.stops);
    impl.setNext(queued.next);
    if (queued.hasGlide) impl.glideTo(queued.glide);
    if (queued.look) impl.setLook(queued.look.yaw, queued.look.pitch);
    if (queued.progress != null) impl.setProgress(queued.progress);
  }
  const driver = {
    onTapStop: null,
    setStops(list) { queued.stops = list || []; if (impl) impl.setStops(queued.stops); },
    setNext(i) { queued.next = i; if (impl) impl.setNext(i); },
    glideTo(i) { queued.glide = i; queued.hasGlide = true; if (impl) impl.glideTo(i); },
    setLook(yaw, pitch) { queued.look = { yaw, pitch }; if (impl) impl.setLook(yaw, pitch); },
    setProgress(u) { queued.progress = u; if (impl) impl.setProgress(u); },
    destroy() { dead = true; if (impl) impl.destroy(); el.innerHTML = ""; }
  };
  adopt(cloudLoadingView(host));
  if (!modelUrl) {
    adopt(SceneDrivers.strip(host));
    return driver;
  }
  buildCloudView(host, modelUrl).then(real => {
    if (!dead) adopt(real);
  }).catch(err => {
    console.warn("cloud driver fell back to strip:", err);
    if (!dead) adopt(SceneDrivers.strip(host));
  });
  return driver;
};

function cloudLoadingView(host) {
  host.innerHTML = `<div class="cloudstub cloud-loading">
    <p class="muted nomargin">Loading the store model&hellip;</p>
    <div class="cloud-dots"><span class="cloud-dot"></span><span class="cloud-dot"></span><span class="cloud-dot"></span></div>
  </div>`;
  return {
    onTapStop: null,
    setStops() {}, setNext() {}, glideTo() {}, setLook() {}, setProgress() {},
    // No teardown: the successor's constructor takes over the host.
    // (Clearing here would wipe the view that replaces this one —
    // adopt() destroys the old impl after the new one is built.)
    destroy() {}
  };
}

async function buildCloudView(host, modelUrl) {
  const THREE = await import(THREE_URL);
  const murl = new URL(modelUrl, SCENE_BASE).href;
  const manifest = await (await fetch(murl)).json();
  const buf = await (await fetch(new URL(manifest.bin, murl))).arrayBuffer();
  const graph = await fetch(new URL("shelf-graph.json", murl))
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  return cloudView(THREE, host, manifest, buf, graph);
}

function cloudView(THREE, host, manifest, buf, graph) {
  const n = manifest.points;
  const mn = manifest.bounds.min, mx = manifest.bounds.max;
  const q = new Uint16Array(buf, 0, n * 3);
  const raw = new Uint8Array(buf, manifest.layout.positionBytes, n * 3);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const axis = i % 3;
    pos[i] = mn[axis] + (q[i] / 65535) * (mx[axis] - mn[axis]);
    col[i] = raw[i] / 255;
  }

  // Hunt v2: inside the contained store view only the presented
  // stop shows — the same one-target rule the DOM drivers get
  // from CSS, applied here because sprites are not DOM.
  const oneTarget = !!(host.closest && host.closest(".storeview"));
  host.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cloud-wrap";
  host.appendChild(wrap);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  wrap.appendChild(renderer.domElement);
  const chip = document.createElement("div");
  chip.className = "cloud-shelf";
  chip.hidden = true;
  wrap.appendChild(chip);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFAFAFA);
  scene.fog = new THREE.Fog(0xFAFAFA, 3.5, 8.0);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.01, 60);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const cloud = new THREE.Points(geo, new THREE.PointsMaterial({
    size: span * 0.007, vertexColors: true, sizeAttenuation: true
  }));
  scene.add(cloud);

  // The walk: manifest path samples with cumulative arc length.
  const path = manifest.path.map(s => ({
    p: new THREE.Vector3(s.p[0], s.p[1], s.p[2]),
    f: new THREE.Vector3(s.f[0], s.f[1], s.f[2]).normalize()
  }));
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(cum[i - 1] + path[i].p.distanceTo(path[i - 1].p));
  const total = cum[cum.length - 1] || 1;
  function pathAt(d) {
    d = Math.max(0, Math.min(total, d));
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const seg = (cum[hi] - cum[lo]) || 1;
    const t = (d - cum[lo]) / seg;
    return {
      p: path[lo].p.clone().lerp(path[hi].p, t),
      f: path[lo].f.clone().lerp(path[hi].f, t).normalize()
    };
  }

  // Stop markers: canvas sprites (number, check, or flag badge),
  // anchored along the path, alternating shelf sides.
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);
  const texCache = new Map();
  function markerTexture(num, state, flagged) {
    const key = `${num}|${state}|${flagged ? 1 : 0}`;
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.beginPath(); g.arc(56, 64, 40, 0, Math.PI * 2);
    g.fillStyle = state === "got" ? "#E4572E" : "#55555C";
    g.fill();
    g.lineWidth = 6; g.strokeStyle = "rgba(255,255,255,0.92)"; g.stroke();
    g.fillStyle = "#fff";
    g.textAlign = "center"; g.textBaseline = "middle";
    if (state === "got") {
      g.lineWidth = 10; g.lineCap = "round"; g.strokeStyle = "#fff";
      g.beginPath(); g.moveTo(36, 66); g.lineTo(52, 82); g.lineTo(78, 48); g.stroke();
    } else {
      g.font = "700 52px -apple-system, sans-serif";
      g.fillText(String(num), 56, 66);
    }
    if (flagged) {
      g.beginPath(); g.arc(98, 30, 22, 0, Math.PI * 2);
      g.fillStyle = "#E8A33D"; g.fill();
      g.lineWidth = 4; g.strokeStyle = "rgba(255,255,255,0.92)"; g.stroke();
      g.fillStyle = "#fff"; g.font = "800 30px -apple-system, sans-serif";
      g.fillText("!", 98, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    texCache.set(key, tex);
    return tex;
  }

  let stops = [], nextIdx = -1, anchorDist = [], markerPos = [];
  function rebuildMarkers() {
    while (markerGroup.children.length) {
      const m = markerGroup.children.pop();
      if (m.material) m.material.dispose();
      markerGroup.remove(m);
    }
    markerPos = []; anchorDist = [];
    const count = stops.length;
    const up = new THREE.Vector3(0, 1, 0);
    // Matched stops share their shelf's path position; spread a
    // shelf's stops a step apart along the path so the markers do
    // not stack on one point. (+ offset is the walker's left, as
    // below: even markers have always sat on the left.)
    const shelfCount = {}, shelfSeen = {};
    stops.forEach(s => {
      if (s.shelfU != null) {
        const k = s.shelfU.toFixed(4);
        shelfCount[k] = (shelfCount[k] || 0) + 1;
      }
    });
    stops.forEach((s, i) => {
      let d, sideSign = i % 2 === 0 ? 1 : -1;
      if (s.shelfU != null) {
        const k = s.shelfU.toFixed(4);
        const j = (shelfSeen[k] = (shelfSeen[k] || 0) + 1) - 1;
        d = s.shelfU * total + (j - (shelfCount[k] - 1) / 2) * total * 0.012;
        d = Math.max(0, Math.min(total, d));
        if (s.shelfSide === "left") sideSign = 1;
        else if (s.shelfSide === "right") sideSign = -1;
      } else {
        d = count <= 1 ? total / 2 : ((i + 0.5) / count) * total;
      }
      anchorDist.push(d);
      const at = pathAt(d);
      const side = new THREE.Vector3().crossVectors(up, at.f);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0); else side.normalize();
      const p = at.p.clone()
        .addScaledVector(side, sideSign * span * 0.13)
        .add(new THREE.Vector3(0, span * 0.03, 0));
      markerPos.push(p);
      const state = s.checked ? "got" : "todo";
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: markerTexture(i + 1, state, s.flagged), depthTest: true,
        transparent: true
      }));
      spr.position.copy(p);
      spr.scale.setScalar(span * 0.055);
      spr.userData.index = i;
      spr.userData.baseScale = span * 0.055;
      markerGroup.add(spr);
    });
    updateChip();
  }

  // Shelf labels: a stop matched to a shelf (item–shelf matching)
  // shows ITS shelf — the chip names the item's shelf, not whatever
  // is nearest. Unmatched stops fall back to the Stage D behavior:
  // the graph stop nearest this stop's path position names the
  // shelves seen there, preferring the marker's own side (even
  // markers sit on the walker's left — see the offsets above).
  // Labels are model proposals carried in the graph; the chip only
  // ever shows one verbatim, never a guess made here.
  function shelfLabel(i) {
    if (stops[i] && stops[i].shelfLabel) return stops[i].shelfLabel;
    if (!graph || !graph.stops || !graph.stops.length) return null;
    if (i < 0 || i >= anchorDist.length) return null;
    const u = anchorDist[i] / total;
    let best = null, bestD = Infinity;
    for (const s of graph.stops) {
      const d = Math.abs(s.u - u);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > 0.055) return null;
    const side = i % 2 === 0 ? "left" : "right";
    const labelled = best.shelves.filter(sh => sh.label);
    const pick = labelled.find(sh => sh.side === side) || labelled[0];
    return pick ? pick.label : null;
  }
  function updateChip() {
    const label = shelfLabel(nextIdx);
    chip.textContent = label || "";
    chip.hidden = !label;
  }

  // Camera state: a cursor on the path, an optional glide, a look
  // target, and drag-look offsets on top of the base direction.
  let cursor = 0, glide = null;
  let lookTarget = pathAt(Math.min(total, 0.8)).p.clone();
  let yaw = 0, pitch = 0;
  function markerLook(i) {
    return i >= 0 && markerPos[i] ? markerPos[i].clone() : null;
  }
  function glideTo(i) {
    const from = cursor;
    let to, look;
    if (i < 0 || !markerPos.length) {
      to = total;
      look = pathAt(total).p.clone().add(pathAt(total).f);
    } else {
      to = Math.max(0, anchorDist[i] - span * 0.2);
      look = markerPos[i].clone();
    }
    const dur = Math.max(0.45, Math.min(1.9, Math.abs(to - from) * 1.1));
    glide = { from, to, lookFrom: lookTarget.clone(), lookTo: look, t: 0, dur };
  }

  // Pointer: a drag looks around; a tap on a marker collects.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pDown = null;
  function onDown(e) {
    pDown = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  }
  function onMove(e) {
    if (!pDown) return;
    const dx = e.clientX - pDown.x, dy = e.clientY - pDown.y;
    if (Math.abs(e.clientX - pDown.x) + Math.abs(e.clientY - pDown.y) > 7) pDown.moved = true;
    if (pDown.moved) {
      yaw = Math.max(-1.15, Math.min(1.15, yaw - dx * 0.004));
      pitch = Math.max(-0.5, Math.min(0.55, pitch - dy * 0.004));
      pDown.x = e.clientX; pDown.y = e.clientY;
    }
  }
  function onUp(e) {
    if (!pDown) return;
    const wasTap = !pDown.moved && performance.now() - pDown.t < 400;
    pDown = null;
    if (!wasTap || !driver.onTapStop) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1,
            -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(markerGroup.children.filter(m => m.visible), false)[0];
    if (hit) driver.onTapStop(hit.object.userData.index);
  }
  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("pointermove", onMove);
  dom.addEventListener("pointerup", onUp);
  dom.addEventListener("pointercancel", () => { pDown = null; });

  function resize() {
    const w = wrap.clientWidth || 320, h = wrap.clientHeight || 240;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  let raf = 0, destroyed = false, lastNow = null;
  const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
  // Time comes from the RAF timestamp (the same clock that paces
  // the frames), not a separate Clock — simpler, and it keeps the
  // animation honest in throttled/headless frame loops too.
  function tick(nowMs) {
    if (destroyed) return;
    raf = requestAnimationFrame(tick);
    const now = (nowMs || 0) / 1000;
    const dt = lastNow === null ? 0 : Math.min(0.05, Math.max(0, now - lastNow));
    lastNow = now;
    if (glide) {
      glide.t += dt / glide.dur;
      const k = ease(Math.min(1, glide.t));
      cursor = glide.from + (glide.to - glide.from) * k;
      lookTarget.lerpVectors(glide.lookFrom, glide.lookTo, k);
      if (glide.t >= 1) glide = null;
    }
    const at = pathAt(cursor);
    camera.position.copy(at.p);
    const dir = lookTarget.clone().sub(camera.position);
    if (dir.lengthSq() < 1e-6) dir.copy(at.f);
    dir.normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    if (right.lengthSq() > 1e-4) dir.applyAxisAngle(right, pitch);
    camera.lookAt(camera.position.clone().add(dir));
    markerGroup.children.forEach((m, i) => {
      m.visible = !oneTarget || i === nextIdx;
      const base = m.userData.baseScale;
      const pulse = i === nextIdx ? 1 + 0.17 * Math.sin(now * 4.2) : 1;
      m.scale.setScalar(base * pulse);
      m.position.y = markerPos[i].y + (i === nextIdx ? Math.sin(now * 2.1) * span * 0.006 : 0);
    });
    renderer.render(scene, camera);
  }
  tick();

  const driver = {
    onTapStop: null,
    setStops(list) {
      stops = list || [];
      rebuildMarkers();
      const look = markerLook(nextIdx);
      if (look && !glide) lookTarget = look;
    },
    setNext(i) {
      nextIdx = i;
      updateChip();
      const look = markerLook(i);
      if (look && !glide) lookTarget = look;
    },
    glideTo,
    // Motion navigation: gyro look writes the same offsets drag
    // writes (same clamps); step progress parks the cursor on the
    // path and faces the next stop (or the path ahead at the end).
    setLook(y, p) {
      yaw = Math.max(-1.15, Math.min(1.15, y));
      pitch = Math.max(-0.5, Math.min(0.55, p));
    },
    setProgress(u) {
      glide = null;
      cursor = Math.max(0, Math.min(1, u)) * total;
      const look = markerLook(nextIdx);
      lookTarget = look || pathAt(Math.min(total, cursor + span * 0.8)).p.clone();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      texCache.forEach(t => t.dispose());
      geo.dispose();
      renderer.dispose();
      host.innerHTML = "";
    }
  };
  return driver;
}

/* ---- "photo" — the photo-walk driver -------------------------------
 * The mapped store's default view (Discussion 43): the
 * walkthrough's frames along the camera path, crossfaded as the
 * hunt's path fraction moves. The treatment is the photo-walk
 * prototype's: the sharp frame rides over a blurred fill of
 * itself (a 16:9 frame in a portrait phone would otherwise
 * letterbox away), a rolling preload window (-2/+5) keeps the
 * walk ahead of the player, and the gyro look pans within the
 * frame. Stops ride as dots on the frame's own track, placed by
 * the same path fraction the localizer answers in — position is
 * driver-independent, so the anchor works here exactly as on
 * the cloud. Presentation only: the session is the game. */
const PHOTO_FRAME_COUNT = 90;
function photoFrameForU(u, n) {
  const c = Math.max(0, Math.min(1, Number(u) || 0));
  return Math.round(c * ((n || PHOTO_FRAME_COUNT) - 1));
}
SceneDrivers.photo = function (el) {
  const base = el.dataset.photos || "";
  if (!base) return SceneDrivers.strip(el);
  el.innerHTML = `
  <div class="photoview">
    <img class="photo-bg" alt="">
    <div class="photo-sharp">
      <img class="photo-frame on" alt="The store, along the walk">
      <img class="photo-frame" alt="">
    </div>
    <div class="cloud-shelf photo-chip" hidden></div>
    <div class="photo-dots"></div>
  </div>`;
  const bg = el.querySelector(".photo-bg");
  const sharp = el.querySelector(".photo-sharp");
  const chip = el.querySelector(".photo-chip");
  const dotsEl = el.querySelector(".photo-dots");
  const frames = [...el.querySelectorAll(".photo-frame")];
  let front = 0;
  let stops = [], nextIdx = -1;
  let curU = 0, curFrame = -1, glide = null, raf = 0, widened = false;

  const cache = new Map();
  function fileFor(i) { return `${base}/f${String(i + 1).padStart(3, "0")}.jpg`; }
  function ensure(i) {
    if (i < 0 || i >= PHOTO_FRAME_COUNT) return null;
    if (!cache.has(i)) {
      const im = new Image();
      im.src = fileFor(i);
      cache.set(i, im);
    }
    return cache.get(i);
  }
  function preloadAround(i, wide) {
    const lo = wide ? -2 : -1, hi = wide ? 5 : 4;
    for (let d = lo; d <= hi; d++) ensure(i + d);
  }
  function show(i) {
    if (i === curFrame) return;
    const im = ensure(i);
    const swap = () => {
      const back = frames[1 - front];
      back.src = fileFor(i);
      back.classList.add("on");
      frames[front].classList.remove("on");
      front = 1 - front;
      bg.src = fileFor(i);
      curFrame = i;
    };
    if (im && im.complete && im.naturalWidth) swap();
    else if (im) im.onload = swap;
    preloadAround(i, widened);
    widened = true;
  }
  function stopU(i) {
    const s = stops[i];
    return s && s.shelfU != null ? s.shelfU : (i + 0.5) / (stops.length || 1);
  }
  function paintChip() {
    const s = nextIdx >= 0 ? stops[nextIdx] : null;
    chip.hidden = !(s && s.shelfLabel);
    if (s && s.shelfLabel) chip.textContent = s.shelfLabel;
  }
  function paintDots() {
    dotsEl.innerHTML = stops.map((s, i) => `
      <button type="button" class="photo-dot${s.checked ? " got" : ""}${i === nextIdx ? " next" : ""}"
        data-stop="${i}" style="left:${(stopU(i) * 100).toFixed(2)}%"
        aria-label="Stop ${i + 1}: ${esc(s.name)}">${s.checked ? "✓" : i + 1}</button>`).join("");
    dotsEl.querySelectorAll(".photo-dot").forEach(d =>
      d.addEventListener("click", () => { if (driver.onTapStop) driver.onTapStop(Number(d.dataset.stop)); }));
  }
  function glideStep(ts) {
    if (!glide) return;
    const t = Math.min(1, (ts - glide.t0) / glide.dur);
    const e = 1 - Math.pow(1 - t, 3);
    curU = glide.from + (glide.to - glide.from) * e;
    show(photoFrameForU(curU));
    if (t < 1) raf = requestAnimationFrame(glideStep);
    else glide = null;
  }
  const driver = {
    onTapStop: null,
    setStops(list) { stops = list || []; paintDots(); paintChip(); },
    setNext(i) { nextIdx = i; paintDots(); paintChip(); },
    glideTo(i) {
      if (i < 0 || !stops.length) return;
      const to = stopU(i);
      const dur = Math.max(450, Math.min(1900, Math.abs(to - curU) * 6000));
      glide = { from: curU, to, t0: performance.now(), dur };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(glideStep);
    },
    setProgress(u) {
      glide = null;
      cancelAnimationFrame(raf);
      curU = Math.max(0, Math.min(1, Number(u) || 0));
      show(photoFrameForU(curU));
    },
    // Gyro look: pan within the frame (the prototype's
    // treatment) — the sharp layer is slightly zoomed so the
    // pan never exposes an edge.
    setLook(yaw) {
      const f = MotionMath.panFraction(yaw);
      const tx = (0.5 - f) * 36;
      sharp.style.transform = Math.abs(tx) < 0.5 ? "" : `translateX(${tx.toFixed(1)}px) scale(1.12)`;
    },
    destroy() {
      glide = null;
      cancelAnimationFrame(raf);
      el.innerHTML = "";
    }
  };
  show(0);
  return driver;
};

/* ---- "aisle" — the stylized aisle scene ----------------------------
 * Two shelf walls, a walk path down the middle, one marker per stop
 * placed along the path (near = large, far = small). The next stop
 * pulses; checked stops dim and carry a check; flagged stops carry a
 * warning badge. Walking = the marker column glides (CSS transition
 * on the group transform) so the next stop comes to the front. */
SceneDrivers.aisle = function (el) {
  el.innerHTML = `
  <svg class="scene" viewBox="0 0 320 210" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Store aisle">
    <defs>
      <linearGradient id="sc-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--fill)"/>
        <stop offset="1" stop-color="var(--group)"/>
      </linearGradient>
    </defs>
    <polygon points="108,26 212,26 300,210 20,210" fill="url(#sc-floor)"/>
    <g class="scene-shelves">
      ${[0, 1, 2, 3].map(r => `
        <g>
          <polygon points="${18 + r * 4},${34 + r * 34} ${118 - r * 6},${30 + r * 34} ${112 - r * 6},${52 + r * 34} ${14 + r * 4},${58 + r * 34}" class="scene-shelf"/>
          <polygon points="${202 + r * 6},${30 + r * 34} ${302 - r * 4},${34 + r * 34} ${306 - r * 4},${58 + r * 34} ${208 + r * 6},${52 + r * 34}" class="scene-shelf"/>
        </g>`).join("")}
    </g>
    <line x1="160" y1="30" x2="160" y2="206" class="scene-path"/>
    <g class="scene-stops"></g>
    <g class="scene-you">
      <circle cx="160" cy="196" r="7"/>
      <text x="160" y="199.5" text-anchor="middle">Y</text>
    </g>
  </svg>`;
  const stopsG = el.querySelector(".scene-stops");
  const svg = el.querySelector(".scene");
  let stops = [], nextIdx = -1;
  // Step advance parks the column at a base shift; glideTo adds a
  // transient nudge on top and settles back to the base.
  let baseShift = 0, shiftTimer = null;
  function applyShift(px) {
    stopsG.style.transition = "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)";
    stopsG.style.transform = `translateY(${px}px)`;
  }

  function pos(i, n) {
    // t runs 0 (far) .. 1 (near); stops spread along the path.
    const t = n <= 1 ? 0.45 : 0.12 + 0.68 * (i / (n - 1));
    return { x: 160, y: 196 - t * 158, r: 6 + t * 8, t };
  }
  function render() {
    const n = stops.length;
    stopsG.innerHTML = stops.map((s, i) => {
      const p = pos(i, n);
      const cls = ["scene-stop", s.checked ? "got" : "", i === nextIdx ? "next" : ""].join(" ");
      return `<g class="${cls}" data-stop="${i}" transform="translate(${p.x} ${p.y})">
        <circle r="${p.r}"/>
        ${s.checked
          ? `<path d="M ${-p.r * 0.45} 0 L ${-p.r * 0.12} ${p.r * 0.38} L ${p.r * 0.5} ${-p.r * 0.34}" class="scene-check"/>`
          : `<text y="${p.r * 0.36}" text-anchor="middle" class="scene-num">${i + 1}</text>`}
        ${s.flagged ? `<g class="scene-flag" transform="translate(${p.r * 0.85} ${-p.r * 0.9})"><circle r="5.5"/><text y="3.4" text-anchor="middle">!</text></g>` : ""}
        ${i === nextIdx ? `<text y="${-p.r - 7}" text-anchor="middle" class="scene-label">${esc(s.name)}</text>` : ""}
      </g>`;
    }).join("");
    stopsG.querySelectorAll(".scene-stop").forEach(g =>
      g.addEventListener("click", () => { if (driver.onTapStop) driver.onTapStop(Number(g.dataset.stop)); }));
  }
  const driver = {
    onTapStop: null,
    setStops(list) { stops = list || []; render(); },
    setNext(i) { nextIdx = i; render(); },
    glideTo(i) {
      // Bring stop i toward the front: shift the column so the walk
      // reads as forward motion, then settle back to the base shift.
      const n = stops.length || 1;
      const target = baseShift + Math.max(0, Math.min(26, (i / n) * 26));
      applyShift(target);
      clearTimeout(shiftTimer);
      shiftTimer = setTimeout(() => applyShift(baseShift), 650);
    },
    // Motion navigation: look pans the whole scene sideways (the
    // slight zoom keeps the pan from exposing the SVG's edges);
    // progress parks the column at the walked fraction.
    setLook(yaw) {
      const f = MotionMath.panFraction(yaw);
      const tx = (0.5 - f) * 44;
      svg.style.transform = Math.abs(tx) < 0.5 ? "" : `translateX(${tx.toFixed(1)}px) scale(1.14)`;
    },
    setProgress(u) {
      baseShift = Math.max(0, Math.min(1, u)) * 26;
      clearTimeout(shiftTimer);
      applyShift(baseShift);
    },
    destroy() { clearTimeout(shiftTimer); el.innerHTML = ""; }
  };
  return driver;
};
// Stage B's first build called this driver "placeholder"; the name
// stays as an alias so nothing referencing it breaks.
SceneDrivers.placeholder = SceneDrivers.aisle;

/* ---- "strip" — the flat aisle strip --------------------------------
 * Stops as shelf cards laid out in walking order on one scrolling
 * strip. The walk animation is the strip scrolling the next card to
 * center. Same taps, same states as every other rung — including the
 * flagged badge for a stop with an open "not here" report. */
SceneDrivers.strip = function (el) {
  el.innerHTML = `<div class="strip-wrap"><div class="strip-track"></div></div>`;
  const wrap = el.querySelector(".strip-wrap");
  const track = el.querySelector(".strip-track");
  let stops = [], nextIdx = -1;

  function scrollToNext(smooth) {
    if (nextIdx < 0) return;
    const card = track.children[nextIdx];
    if (!card) return;
    const target = card.offsetLeft - wrap.clientWidth / 2 + card.clientWidth / 2;
    wrap.scrollTo({ left: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
  }
  function render() {
    track.innerHTML = stops.map((s, i) => `
      <button type="button" class="strip-card${s.checked ? " got" : ""}${i === nextIdx ? " next" : ""}" data-stop="${i}">
        <span class="strip-shelfbar"></span>
        <span class="strip-num">${i + 1}</span>
        <span class="strip-name">${esc(s.name)}</span>
        ${s.shelfLabel ? `<span class="strip-shelf">${esc(s.shelfLabel)}</span>` : s.unplaced ? `<span class="strip-shelf">Not placed on the map</span>` : ""}
        <span class="strip-sub">${s.checked ? "Collected" : i === nextIdx ? "Next" : s.unit ? esc(qtyTag(s)) : s.qty > 1 ? `× ${qtyFmt(s.qty)}` : "On the list"}</span>
        ${s.flagged ? `<span class="strip-flag" title="Reported missing">!</span>` : ""}
      </button>`).join("");
    track.querySelectorAll(".strip-card").forEach(c =>
      c.addEventListener("click", () => { if (driver.onTapStop) driver.onTapStop(Number(c.dataset.stop)); }));
    scrollToNext(false);
  }
  function scrollToFraction(f) {
    const max = wrap.scrollWidth - wrap.clientWidth;
    if (max > 0) wrap.scrollTo({ left: Math.max(0, Math.min(1, f)) * max, behavior: "auto" });
  }
  const driver = {
    onTapStop: null,
    setStops(list) { stops = list || []; render(); },
    setNext(i) { nextIdx = i; render(); },
    glideTo(i) { nextIdx = i; render(); scrollToNext(true); },
    // Motion navigation: look pans the strip (left look = the
    // strip's left end); progress scrolls to the walked fraction.
    setLook(yaw) { scrollToFraction(MotionMath.panFraction(yaw)); },
    setProgress(u) { scrollToFraction(u); },
    destroy() { el.innerHTML = ""; }
  };
  return driver;
};

SceneDrivers.art = function (el) {
  el.innerHTML = `<div class="artview"><img class="art-img" src="assets/scenes/aisle-art.webp" alt="An illustrated grocery aisle — this store is not mapped yet"><div class="photo-dots"></div></div>`;
  const img = el.querySelector(".art-img");
  const dotsEl = el.querySelector(".photo-dots");
  let stops = [], nextIdx = -1;

  function frameAt(t) {
    img.style.transform = `scale(${1.10 + t * 0.14}) translateX(${(0.5 - t) * 10}%)`;
  }
  function paint() {
    const t = stops.length > 1 && nextIdx >= 0 ? nextIdx / (stops.length - 1) : 0;
    frameAt(t);
    dotsEl.innerHTML = stops.map((s, i) => `
      <button type="button" class="photo-dot${s.checked ? " got" : ""}${i === nextIdx ? " next" : ""}" data-stop="${i}"
        style="left:${stops.length > 1 ? 4 + (i / (stops.length - 1)) * 92 : 50}%">${i + 1}</button>`).join("");
    dotsEl.querySelectorAll(".photo-dot").forEach(d =>
      d.addEventListener("click", () => { if (driver.onTapStop) driver.onTapStop(Number(d.dataset.stop)); }));
  }
  const driver = {
    onTapStop: null,
    setStops(list) { stops = list || []; paint(); },
    setNext(i) { nextIdx = i; paint(); },
    glideTo(i) { nextIdx = i; paint(); },
    setProgress(u) { frameAt(Math.max(0, Math.min(1, u))); },
    destroy() { el.innerHTML = ""; }
  };
  return driver;
};

/* ---- Motion navigation (Discussion 33) -----------------------------
 * One motion layer for every rung of the ladder. The math is pure
 * (no DOM), so the suite pins it headless; the controllers own the
 * sensor listeners and feed drivers through setLook / setProgress.
 * Motion is additive: manual drag, tap, and scroll always remain,
 * and a missing sensor changes nothing.
 *
 * Orientation convention (deviceorientation, portrait):
 *   alpha — compass-style heading. It DECREASES as the phone turns
 *     right (north 0 -> east 270), so the wrapped delta from the
 *     baseline is already "positive = turned left".
 *   beta — tilt: ~90 upright, grows as the top tips away (the back
 *     camera pitches up), so beta minus baseline is look-up.
 * The cloud/aisle look offsets use yaw > 0 = look left and
 * pitch > 0 = look up, with the same clamps as drag-look — hence
 * yaw = wrapped alpha delta and pitch = beta delta, both in radians.
 */
const MotionMath = {
  YAW_MAX: 1.15, PITCH_MIN: -0.5, PITCH_MAX: 0.55,
  wrapDelta(deg) { return ((deg % 360) + 540) % 360 - 180; },
  look(alpha, beta, baseAlpha, baseBeta) {
    if (alpha == null || beta == null || baseAlpha == null || baseBeta == null) return null;
    const yaw = MotionMath.wrapDelta(alpha - baseAlpha) * Math.PI / 180;
    const pitch = (beta - baseBeta) * Math.PI / 180;
    return {
      yaw: Math.max(-MotionMath.YAW_MAX, Math.min(MotionMath.YAW_MAX, yaw)),
      pitch: Math.max(MotionMath.PITCH_MIN, Math.min(MotionMath.PITCH_MAX, pitch))
    };
  },
  // Look yaw -> pan position: -1 = looking fully right, +1 = fully
  // left. panFraction maps that to a frame position in [0, 1]
  // where 0 shows the frame's left edge (looking left) and 1 its
  // right edge — what a photo-style driver pans with.
  pan(yaw) { return Math.max(-1, Math.min(1, yaw / MotionMath.YAW_MAX)); },
  panFraction(yaw) { return (1 - MotionMath.pan(yaw)) / 2; },
  // Step advance: a shelf segment is walked in a fixed stride
  // count — calibrated at ~8 strides of ~0.7 m for a ~5-6 m segment.
  // The path's own units are not meters (VGGT scale is arbitrary),
  // so the fraction is what is pinned, not a distance.
  segmentStepU(anchorU, nextU, stepsPerSegment = 8) {
    return Math.max(0, nextU - anchorU) / stepsPerSegment;
  },
  // A step moves u toward the next stop, never past it.
  advance(u, nextU, stepU) { return Math.min(nextU, u + Math.max(0, stepU)); }
};

/* Step detector: a pure state machine over acceleration magnitude
 * (devicemotion accelerationIncludingGravity; ~9.8 at rest). A step
 * is a rise above HI followed by a fall below LO, with a refractory
 * window so one stride's bounce counts once. */
function createStepDetector(onStep) {
  const HI = 12.0, LO = 10.6, REFRACT_MS = 300;
  let armed = false, lastStep = -Infinity;
  function push(x, y, z, nowMs) {
    const m = Math.sqrt(x * x + y * y + z * z);
    if (!armed) {
      if (m > HI) armed = true;
      return false;
    }
    if (m < LO) {
      armed = false;
      if (nowMs - lastStep >= REFRACT_MS) {
        lastStep = nowMs;
        if (onStep) onStep(nowMs);
        return true;
      }
    }
    return false;
  }
  return {
    push,
    sample(a, nowMs) { return a ? push(a.x || 0, a.y || 0, a.z || 0, nowMs) : false; }
  };
}

/* Gyro look controller. getDriver() is read per event, so a driver
 * switch mid-hunt needs no rewiring. start() resolves false when
 * the sensor or its permission is unavailable — the caller keeps
 * today's hunt, no error surface. The first valid event becomes
 * the baseline (the way the phone faces at enable = forward).
 * Touching the scene suspends gyro briefly, so a drag never fights
 * the sensor; when the sensor reports nothing at all (a desktop),
 * the controller stops itself and reports onUnavailable. */
function createMotionLook(getDriver, mount) {
  let on = false, base = null, suspendUntil = 0;
  function onOrient(e) {
    if (!on) return;
    if (e.alpha == null && e.beta == null) {
      stop();
      if (ctl.onUnavailable) ctl.onUnavailable();
      return;
    }
    if (performance.now() < suspendUntil) return;
    if (base === null) { base = { a: e.alpha, b: e.beta }; return; }
    const look = MotionMath.look(e.alpha, e.beta, base.a, base.b);
    const d = getDriver();
    if (look && d && d.setLook) d.setLook(look.yaw, look.pitch);
  }
  function onPointer() { suspendUntil = performance.now() + 2500; }
  function stop() {
    if (!on) return;
    on = false;
    window.removeEventListener("deviceorientation", onOrient);
    if (mount) mount.removeEventListener("pointerdown", onPointer);
    const d = getDriver();
    if (d && d.setLook) d.setLook(0, 0);
  }
  const ctl = {
    onUnavailable: null,
    get on() { return on; },
    async start() {
      if (typeof DeviceOrientationEvent === "undefined") return false;
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const res = await DeviceOrientationEvent.requestPermission().catch(() => "denied");
        if (res !== "granted") return false;
      }
      base = null;
      on = true;
      window.addEventListener("deviceorientation", onOrient);
      if (mount) mount.addEventListener("pointerdown", onPointer);
      return true;
    },
    stop
  };
  return ctl;
}
