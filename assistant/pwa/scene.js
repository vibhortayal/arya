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
 *   "cloud" — the VGGT point-cloud driver (Three.js): the store
 *             rebuilt from a shopper's walkthrough, walked along the
 *             real camera path. The screen sets el.dataset.model to
 *             the store's manifest URL before creating the view
 *             (assets built by assistant/tools/prep_cloud.py). If
 *             anything fails to load, the driver falls back to
 *             "strip" in place — a hunt never hard-fails on a model.
 *   "aisle" — the stylized aisle scene: what a mapped store shows
 *             before its cloud exists.
 *   "strip" — a first-class 2D driver: stops as shelf cards on a
 *             flat store strip, in walking order. The default when a
 *             store has no model, and the low-battery / low-motion
 *             choice mid-hunt.
 *
 * Driver contract:
 *   create(el) -> driver            mount into el (the driver owns el's content)
 *   driver.setStops(stops)          stops in route order:
 *                                   [{name, qty, checked, flagged}]
 *                                   flagged = an open "not here" report
 *   driver.setNext(index)           highlight the next unchecked stop; -1 = none
 *   driver.glideTo(index)           animate the walk toward a stop
 *   driver.onTapStop = fn(index)    assigned by the screen; the driver
 *                                   calls it when a stop is tapped
 *   driver.destroy()                tear down listeners/timers
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
 * are numbered markers anchored along the path, alternating shelf
 * sides; the next stop pulses; glideTo walks the camera to a stop;
 * tapping a marker fires onTapStop; dragging looks around.
 *
 * The contract is synchronous but loading is not, so this driver is
 * a proxy: it starts on a loading view, adopts the real driver when
 * the model arrives, and adopts "strip" in place if anything fails —
 * the hunt screen never sees an error from this rung. */
SceneDrivers.cloud = function (el) {
  const modelUrl = el.dataset.model || "";
  el.innerHTML = `<div class="cloud-host"></div>`;
  const host = el.querySelector(".cloud-host");
  const queued = { stops: [], next: -1, glide: -1, hasGlide: false };
  let impl = null, dead = false;

  function adopt(next) {
    if (impl) impl.destroy();
    impl = next;
    impl.onTapStop = i => { if (driver.onTapStop) driver.onTapStop(i); };
    impl.setStops(queued.stops);
    impl.setNext(queued.next);
    if (queued.hasGlide) impl.glideTo(queued.glide);
  }
  const driver = {
    onTapStop: null,
    setStops(list) { queued.stops = list || []; if (impl) impl.setStops(queued.stops); },
    setNext(i) { queued.next = i; if (impl) impl.setNext(i); },
    glideTo(i) { queued.glide = i; queued.hasGlide = true; if (impl) impl.glideTo(i); },
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
    setStops() {}, setNext() {}, glideTo() {},
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
  return cloudView(THREE, host, manifest, buf);
}

function cloudView(THREE, host, manifest, buf) {
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

  host.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cloud-wrap";
  host.appendChild(wrap);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  wrap.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101318);
  scene.fog = new THREE.Fog(0x101318, 3.5, 8.0);
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
    g.fillStyle = state === "got" ? "#30c759" : "#2f7cf6";
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
      g.fillStyle = "#ff9f0a"; g.fill();
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
    stops.forEach((s, i) => {
      const d = count <= 1 ? total / 2 : ((i + 0.5) / count) * total;
      anchorDist.push(d);
      const at = pathAt(d);
      const side = new THREE.Vector3().crossVectors(up, at.f);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0); else side.normalize();
      const p = at.p.clone()
        .addScaledVector(side, (i % 2 === 0 ? 1 : -1) * span * 0.13)
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
    const hit = ray.intersectObjects(markerGroup.children, false)[0];
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
      const look = markerLook(i);
      if (look && !glide) lookTarget = look;
    },
    glideTo,
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

/* ---- "aisle" — the stylized aisle scene ----------------------------
 * Two shelf walls, a walk path down the middle, one marker per stop
 * placed along the path (near = large, far = small). The next stop
 * pulses; checked stops dim and carry a check; flagged stops carry a
 * warning badge. Walking = the marker column glides (CSS transition
 * on the group transform) so the next stop comes to the front. */
SceneDrivers.aisle = function (el) {
  el.innerHTML = `
  <svg class="scene" viewBox="0 0 320 210" role="img" aria-label="Store aisle">
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
  let stops = [], nextIdx = -1;

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
      // reads as forward motion, then settle back.
      const n = stops.length || 1;
      const target = Math.max(0, Math.min(26, (i / n) * 26));
      stopsG.style.transition = "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)";
      stopsG.style.transform = `translateY(${target}px)`;
      setTimeout(() => { stopsG.style.transform = ""; }, 650);
    },
    destroy() { el.innerHTML = ""; }
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
        <span class="strip-sub">${s.checked ? "Collected" : i === nextIdx ? "Next" : s.qty > 1 ? `× ${qtyFmt(s.qty)}` : "On the list"}</span>
        ${s.flagged ? `<span class="strip-flag" title="Reported missing">!</span>` : ""}
      </button>`).join("");
    track.querySelectorAll(".strip-card").forEach(c =>
      c.addEventListener("click", () => { if (driver.onTapStop) driver.onTapStop(Number(c.dataset.stop)); }));
    scrollToNext(false);
  }
  const driver = {
    onTapStop: null,
    setStops(list) { stops = list || []; render(); },
    setNext(i) { nextIdx = i; render(); },
    glideTo(i) { nextIdx = i; render(); scrollToNext(true); },
    destroy() { el.innerHTML = ""; }
  };
  return driver;
};
