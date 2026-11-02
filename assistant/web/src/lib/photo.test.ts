import { fitPhoto, photoScale } from "./photo";

describe("photo compression before upload", () => {
  test("a 48 MP photo comes down to about 6 MP; a small one stays", () => {
    const k = photoScale(6048, 8064);
    expect(Math.round(6048 * k) * Math.round(8064 * k)).toBeLessThanOrEqual(6_000_100);
    expect(photoScale(1200, 1600)).toBe(1);
  });
  test("a long receipt keeps its long side at most 4096 px", () => {
    const k = photoScale(1000, 9000);
    expect(Math.round(9000 * k)).toBeLessThanOrEqual(4096);
  });
  test("PDFs and small JPEGs go up unchanged", async () => {
    const pdf = new File([new Uint8Array(3_000_000)], "r.pdf", { type: "application/pdf" });
    expect(await fitPhoto(pdf)).toBe(pdf);
    const jpg = new File([new Uint8Array(10_000)], "r.jpg", { type: "image/jpeg" });
    expect(await fitPhoto(jpg)).toBe(jpg);
  });
  test("a photo the browser cannot draw goes up unchanged", async () => {
    const big = new File([new Uint8Array(4_000_000)], "r.heic", { type: "image/heic" });
    expect(await fitPhoto(big)).toBe(big);
  });
});
