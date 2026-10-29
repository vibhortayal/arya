import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Sheet } from "./Sheet";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Snap the date">
        <button>Use it</button>
      </Sheet>
    </>
  );
}

test("sheet opens, traps Escape, closes on scrim and restores focus", () => {
  render(<Harness />);
  const opener = screen.getByText("Open");
  opener.focus();
  fireEvent.click(opener);
  const dlg = screen.getByRole("dialog");
  expect(dlg.className).toBe("sheetwrap");
  expect(screen.getByText("Snap the date").tagName).toBe("H3");
  fireEvent.keyDown(dlg, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
