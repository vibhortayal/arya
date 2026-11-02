import { render, screen } from "@testing-library/react";
import { ReceiptJobCard } from "./ReceiptJobCard";

/* A copy of Arya with no Meta key (local Docker): a paused job showed
 * the server's raw "MODEL_API_KEY not provisioned on this runtime".
 * It shows the same plain sentence as Ask (Tester, after #432). */
vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return {
    ...real,
    get: async () => ({ jobs: [{ id: "j1", status: "paused", total: 1, received: 1, done: 0, filed: 0, duplicate: 0, failed: 0,
      failures: [], reason: "MODEL_API_KEY not provisioned on this runtime", seen: false, at: "" }] }),
  };
});

test("a job paused for want of a key says where the key goes", async () => {
  render(<ReceiptJobCard sending={null} onChange={() => {}} onCheck={() => {}} tick={0} />);
  expect(await screen.findByText(/This copy of Arya has no Meta key/)).toBeTruthy();
  expect(screen.queryByText(/not provisioned on this runtime/)).toBeNull();
});
