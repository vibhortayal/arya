import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { EndOfDemo, openEndOfDemo } from "./EndOfDemo";

const leave = vi.fn(async () => {});
vi.mock("../app/session", () => ({ useSession: () => ({ leave }) }));
const post = vi.fn();
vi.mock("../lib/api", () => ({ post: (...a: unknown[]) => post(...a) }));

beforeEach(() => { post.mockReset(); leave.mockClear(); });

describe("EndOfDemo", () => {
  it("is closed until opened, then sends text and email", async () => {
    post.mockResolvedValue({ ok: true });
    render(<EndOfDemo />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openEndOfDemo());
    const send = await screen.findByRole("button", { name: "Send feedback" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Your feedback/), { target: { value: "nice" } });
    fireEvent.change(screen.getByLabelText(/Your email/), { target: { value: "a@x.com" } });
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/demo/feedback", { text: "nice", email: "a@x.com", website: "" }));
    expect(await screen.findByText(/You're on the list/)).toBeTruthy();
  });

  it("shows the server's message when the send is refused", async () => {
    post.mockRejectedValue(new Error("that is enough for today, thank you"));
    render(<EndOfDemo />);
    act(() => openEndOfDemo());
    fireEvent.change(await screen.findByLabelText(/Your feedback/), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/Your email/), { target: { value: "a@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("links to LinkedIn, GitHub and the repo, and Keep exploring closes it", async () => {
    render(<EndOfDemo />);
    act(() => openEndOfDemo());
    const hrefs = (await screen.findAllByRole("link")).map(a => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://www.linkedin.com/in/vibhortayal", "https://github.com/vibhortayal", "https://github.com/vibhortayal/arya"]);
    fireEvent.click(screen.getByRole("button", { name: "Keep exploring" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Leave the demo signs out of the demo and shows the start page", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    render(<EndOfDemo />);
    act(() => openEndOfDemo());
    fireEvent.click(await screen.findByRole("button", { name: "Leave the demo" }));
    await waitFor(() => expect(leave).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
    expect(screen.queryByRole("dialog")).toBeNull();
    vi.unstubAllGlobals();
  });
});
