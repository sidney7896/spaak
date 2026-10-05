import { describe, expect, it } from "vitest";
import { ownerStoragePath, validateUpload } from "../../src/lib/storage";
import { isModuleEnabled } from "../../src/lib/profile";

describe("upload validation and owner-prefixed storage paths", () => {
  it("accepts only the allowed types and sizes", () => {
    expect(() => validateUpload({ type: "image/png", size: 1024 })).not.toThrow();
    expect(() => validateUpload({ type: "text/html", size: 1024 })).toThrow("Unsupported upload type.");
    expect(() => validateUpload({ type: "image/png", size: 0 })).toThrow("Upload exceeds the 10 MB limit.");
    expect(() => validateUpload({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toThrow("Upload exceeds the 10 MB limit.");
  });

  it("puts every object under the owner's own prefix and refuses traversal", () => {
    const owner = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(ownerStoragePath(owner, "report.pdf")).toBe(`${owner}/report.pdf`);
    expect(ownerStoragePath(owner, "re port#.pdf")).toBe(`${owner}/re-port-.pdf`);
    for (const name of ["../escape.pdf", "nested/file.pdf", "..\\escape.pdf", ".", ".."]) {
      expect(() => ownerStoragePath(owner, name)).toThrow("Invalid storage path.");
    }
    expect(() => ownerStoragePath("not-a-uuid", "report.pdf")).toThrow("Invalid storage path.");
  });

  it("treats an unknown or disabled module as disabled", () => {
    const profile = { modules: { fileUpload: { enabled: true }, payments: { enabled: false } } } as never;
    expect(isModuleEnabled("fileUpload", profile)).toBe(true);
    expect(isModuleEnabled("payments", profile)).toBe(false);
    expect(isModuleEnabled("nothingLikeThis", profile)).toBe(false);
  });
});
