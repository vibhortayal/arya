import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SCAN_NO_POP, ScanView, createScanSampler } from "./Scan";

/* Shelf Scan, as the plain-JS app's node harness ran quest.js
 * (tests/test_shelf_scan.py TestScanLiveNode): the sampling policy,
 * the pops and status copy, and the camera's life. */

const sess = { id: "s1", store: "Trader Joe's", mode: "quest", state: "playing", items: [] } as any;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the live sampler", () => {
  test("a calm scene never sends", () => {
    const s = createScanSampler();
    for (let t = 0; t <= 10000; t += 250) expect(s.noteFrame(0.005, 0.01, t).send).toBe(false);
  });

  test("a change, then a hold of about 1 s, sends at the hold mark; a second settle waits 3 s", () => {
    const s = createScanSampler();
    let first = -1;
    for (let t = 0; t <= 3000; t += 250) if (s.noteFrame(t === 0 ? 0.5 : 0.0, 0.5, t).send && first < 0) first = t;
    expect(first).toBe(1250);
    s.noteSent(1250);
    let second = -1;
    for (let t = 1500; t <= 6000; t += 250) if (s.noteFrame(t === 1500 ? 0.5 : 0.0, 0.5, t).send && second < 0) second = t;
    expect(second).toBe(4250);
  });

  test("continued change sends at most once in 2 s, and only after a first send", () => {
    const s = createScanSampler();
    let changeSends = 0;
    for (let t = 0; t <= 5000; t += 250) if (s.noteFrame(0.3, 0.5, t).send) changeSends++;
    expect(changeSends).toBe(0);
    s.noteFrame(0.0, 0.5, 5250); s.noteFrame(0.0, 0.5, 5500);
    s.noteFrame(0.0, 0.5, 5750); s.noteFrame(0.0, 0.5, 6000);
    expect(s.noteFrame(0.0, 0.5, 6250).send).toBe(true);
    s.noteSent(6250);
    let next = -1;
    for (let t = 6500; t <= 9000; t += 250) if (s.noteFrame(0.3, 0.5, t).send && next < 0) next = t;
    expect(next).toBe(8250);
  });

  test("stale pops clear on a clearly moved view, once per move", () => {
    const s = createScanSampler();
    expect(s.noteFrame(0.4, 0.3, 0).clear).toBe(false);
    expect(s.noteFrame(0.4, 0.3, 250).clear).toBe(true);
    expect(s.noteFrame(0.4, 0.3, 500).clear).toBe(false);
    s.noteFrame(0.0, 0.0, 750);
    expect(s.noteFrame(0.4, 0.3, 1000).clear).toBe(false);
    expect(s.noteFrame(0.4, 0.3, 1250).clear).toBe(true);
  });
});

const mount = (open = true) => render(<ScanView open={open} sess={sess} target={null} onClose={() => {}} collect={async () => true} />);

describe("the scan view", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
  });

  test("pops render and replace; the status copy is exact", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    let answer: any = { pops: [{ item: "Milk", box: [0, 0, 0.5, 0.5], grade: "item" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })));
    const r = mount();
    await waitFor(() => expect(r.container.querySelector("#scan-status")!.textContent).toMatch(/Camera not available/));
    const input = r.container.querySelector("#scan-photo") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(r.container.querySelector("#scan-boxes")!.textContent).toContain("Milk"));
    expect(r.container.querySelector("#scan-status")!.textContent).toBe("1 from your list spotted here — tap one to collect it.");
    answer = { pops: [{ item: "Frozen Pizza", box: [0.1, 0.1, 0.4, 0.4], grade: "region" }] };
    fireEvent.change(input, { target: { files: [new File(["y"], "b.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(r.container.querySelector("#scan-boxes")!.textContent).toContain("Frozen Pizza · this shelf"));
    expect(r.container.querySelector("#scan-boxes")!.textContent).not.toContain("Milk");
    expect(r.container.querySelector(".scanpop.region")).not.toBeNull();
    answer = { pops: [] };
    fireEvent.change(input, { target: { files: [new File(["z"], "c.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(r.container.querySelector("#scan-status")!.textContent).toBe(SCAN_NO_POP));
    expect(SCAN_NO_POP).toBe("Nothing from your list spotted here — that doesn't mean it isn't here. Keep looking.");
  });

  test("live start takes the camera and a wake lock; closing releases both", async () => {
    let stops = 0, releases = 0;
    const stream = { getTracks: () => [{ stop() { stops++; } }, { stop() { stops++; } }] };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
    Object.defineProperty(navigator, "wakeLock", { configurable: true,
      value: { request: async () => ({ release() { releases++; return Promise.resolve(); } }) } });
    HTMLMediaElement.prototype.play = async () => {};
    const r = mount(true);
    await waitFor(() => expect(r.container.querySelector("#scan-status")!.textContent).toBe("Live scan — point the camera at a shelf."));
    expect((r.container.querySelector("#scan-stop") as HTMLButtonElement).hidden).toBe(false);
    await new Promise(res => setTimeout(res, 0)); // the wake lock lands
    r.rerender(<ScanView open={false} sess={sess} target={null} onClose={() => {}} collect={async () => true} />);
    expect(stops).toBe(2);
    expect(releases).toBe(1);
    expect((r.container.querySelector("#scan-usephoto") as HTMLButtonElement).hidden).toBe(false);
  });
});
