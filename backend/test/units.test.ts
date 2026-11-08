import { describe, expect, it } from "vitest";
import { sampleDistinct } from "../src/services/draw.js";
import { detectImage } from "../src/services/image.js";
import { createProjectorToken, verifyProjectorToken } from "../src/services/projector.js";
import { safeCell, toCsv } from "../src/routes/exports.js";

describe("sampleDistinct", () => {
  it("returns k distinct items from the input", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    for (let n = 0; n < 200; n++) {
      const s = sampleDistinct(items, 5);
      expect(new Set(s).size).toBe(5);
      for (const x of s) expect(items).toContain(x);
    }
  });
  it("does not mutate the input and rejects k larger than the pool", () => {
    const items = [1, 2, 3];
    sampleDistinct(items, 2);
    expect(items).toEqual([1, 2, 3]);
    expect(() => sampleDistinct(items, 4)).toThrow(RangeError);
  });
  it("is unbiased: every item is picked about equally often (chi-square)", () => {
    const n = 20, k = 5, trials = 40000;
    const counts = new Array(n).fill(0);
    for (let t = 0; t < trials; t++) for (const x of sampleDistinct([...counts.keys()], k)) counts[x]++;
    const expected = (trials * k) / n;
    const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(60); // df=19, p≈1e-5: practically never a false alarm, while any real bias gives hundreds
  });
  it("is positionally unbiased as well", () => {
    const n = 5, trials = 25000;
    const first = new Array(n).fill(0);
    for (let t = 0; t < trials; t++) first[sampleDistinct([0, 1, 2, 3, 4], 5)[0]!]++;
    const expected = trials / n;
    const chi = first.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(33); // df=4, p≈1e-6
  });
  it("takes its randomness from the injected source", () => {
    expect(sampleDistinct([1, 2, 3, 4], 2, () => 0)).toEqual([1, 2]);
  });
});

describe("projector token", () => {
  it("accepts a fresh token and rejects tampering, expiry and other secrets", () => {
    const { token } = createProjectorToken("s3cret", 60);
    expect(verifyProjectorToken("s3cret", token)).toBe(true);
    expect(verifyProjectorToken("other", token)).toBe(false);
    expect(verifyProjectorToken("s3cret", undefined)).toBe(false);
    expect(verifyProjectorToken("s3cret", token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"))).toBe(false);
    const [exp, sig] = token.split(".");
    expect(verifyProjectorToken("s3cret", `${Number(exp) + 100}.${sig}`)).toBe(false);
    expect(verifyProjectorToken("s3cret", token, Date.now() + 120_000)).toBe(false);
    expect(verifyProjectorToken("s3cret", "garbage")).toBe(false);
  });
});

describe("image detection", () => {
  it("recognises JPEG, PNG and WebP by content, not by name", () => {
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(detectImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))?.mime).toBe("image/png");
    expect(detectImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))?.mime).toBe("image/webp");
    expect(detectImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImage(Buffer.from("GIF89a"))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("export safety", () => {
  it("neutralises spreadsheet formulas", () => {
    for (const v of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx"]) expect(String(safeCell(v)).startsWith("'")).toBe(true);
    expect(safeCell("Normal Name")).toBe("Normal Name");
    expect(safeCell(5)).toBe(5);
  });
  it("quotes CSV fields", () => {
    const csv = toCsv([{ key: "a", header: "A" }], [{ a: 'He said "hi", ok' }, { a: "=HYPERLINK(1)" }]);
    expect(csv).toContain('"He said ""hi"", ok"');
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
