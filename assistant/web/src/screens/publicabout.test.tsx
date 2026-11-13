import { render, cleanup } from "@testing-library/react";
import "../i18n";
import { PublicAbout, isAboutPath } from "./PublicAbout";

/* The public About page (owner approved the mockup 2026-11-13). */

afterEach(cleanup);

test("only /about is the public About page", () => {
  expect(isAboutPath("/about")).toBe(true);
  expect(isAboutPath("/about/")).toBe(true);
  expect(isAboutPath("/")).toBe(false);
  expect(isAboutPath("/about/x")).toBe(false);
});

test("shows the note, the links and a way back, with no Settings rows", () => {
  const { container } = render(<PublicAbout />);
  const text = container.textContent ?? "";
  expect(text).toContain("It's free.");
  expect(text).toContain("It's a work in progress.");
  expect(container.querySelector("#about-story")).toBeTruthy();
  expect(container.querySelector('a[href="https://x.com/VibTayal"]')).toBeTruthy();
  expect(container.querySelector("#pubabout-back")?.getAttribute("href")).toBe("/");
  expect(container.querySelector("#btn-powers")).toBeNull();
  expect(document.title).toBe("About");
});
