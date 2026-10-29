import { act, render } from "@testing-library/react";
import { NavProvider, useNav } from "./nav";

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
  for (const v of ["community", "store", "newlist", "optimize", "mode"] as const) act(() => nav.show(v));
  act(() => nav.reset("hunt", { session: { id: "s1" } }));
  expect(nav.view).toBe("hunt");
  expect((nav.params.session as { id: string }).id).toBe("s1");
  act(() => nav.back());
  expect(nav.view).toBe("community");
  act(() => nav.back());
  expect(nav.view).toBe("home");
});
