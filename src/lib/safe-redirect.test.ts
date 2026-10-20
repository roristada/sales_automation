import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/products?x=1#a")).toBe("/products?x=1#a");
    expect(safeNext("/studio/abc")).toBe("/studio/abc");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\\/evil.com", "\\\\evil.com", "/\t/evil.com", "/\n/evil.com", "/.//evil.com", "/..//evil.com", "/%2e//evil.com", "/%2E%2E//evil.com", "/a/..//evil.com", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});
