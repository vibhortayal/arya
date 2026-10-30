import { act, render } from "@testing-library/react";
import { NavProvider, useBackHandler, useNav } from "./nav";

let nav!: ReturnType<typeof useNav>;
function Probe() { nav = useNav(); return <p>{nav.view}</p>; }
const mount = () => render(<NavProvider initial="home"><Probe /></NavProvider>);

test("re-showing the view on top replaces it, so one Back leaves it", () => {
  mount();
  act(() => nav.show("mapper"));
  act(() => nav.show("capture", { n: 1 }));
  act(() => nav.show("capture", { n: 2 }));
  expect(nav.view).toBe("capture");
  expect(nav.params.n).toBe(2);
  act(() => nav.back());
  expect(nav.view).toBe("mapper");
});

test("reset drops the set-up screens: Back from a new hunt lands on the Quest tab", () => {
  mount();
  for (const v of ["community", "newlist", "optimize", "mode"] as const) act(() => nav.show(v));
  act(() => nav.reset("hunt", { session: { id: "s1" } }));
  expect(nav.view).toBe("hunt");
  expect((nav.params.session as { id: string }).id).toBe("s1");
  act(() => nav.back());
  expect(nav.view).toBe("community");
  act(() => nav.back());
  expect(nav.view).toBe("home");
});

/* The phone's Back (QA 2026-10-30): it left the app because nothing was
 * in the history. Now Back closes what is open first, then goes back
 * one view. */
test("phone Back runs the newest open handler, then goes back a view", () => {
  let open = true;
  function Sheetish() { useBackHandler(() => { open = false; return true; }, open); return null; }
  const r = render(<NavProvider initial="home"><Probe /><Sheetish /></NavProvider>);
  act(() => nav.show("list"));
  act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(open).toBe(false);
  expect(nav.view).toBe("list");
  r.rerender(<NavProvider initial="home"><Probe /></NavProvider>);
  act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(nav.view).toBe("home");
});
