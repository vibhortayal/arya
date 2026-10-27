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
 *   "cloud" — the VGGT point-cloud driver (Three.js). Stub interface
 *             only until the 3D spike lands a store model.
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
const SceneDrivers = {};

function createSceneView(el, driverName) {
  const make = SceneDrivers[driverName] || SceneDrivers.strip;
  return make(el);
}

/* ---- "cloud" — stub for the VGGT point-cloud driver ----------------
 * Mounts the contract (stops, next, taps) over a plain note, so the
 * screen flow is exercisable end-to-end before a model exists. The
 * real driver registers here when the spike lands; nothing else in
 * the app changes. */
SceneDrivers.cloud = function (el) {
  el.innerHTML = `<div class="cloudstub">
    <p class="muted nomargin">The 3D view arrives with this store&rsquo;s model.</p>
    <div class="cloud-dots"></div>
  </div>`;
  const dots = el.querySelector(".cloud-dots");
  let stops = [], nextIdx = -1;
  function render() {
    dots.innerHTML = stops.map((s, i) =>
      `<button type="button" class="cloud-dot${s.checked ? " got" : ""}${i === nextIdx ? " next" : ""}" data-stop="${i}" aria-label="Stop ${i + 1}: ${esc(s.name)}">${i + 1}</button>`).join("");
    dots.querySelectorAll(".cloud-dot").forEach(d =>
      d.addEventListener("click", () => { if (driver.onTapStop) driver.onTapStop(Number(d.dataset.stop)); }));
  }
  const driver = {
    onTapStop: null,
    setStops(list) { stops = list || []; render(); },
    setNext(i) { nextIdx = i; render(); },
    glideTo() {},
    destroy() { el.innerHTML = ""; }
  };
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
