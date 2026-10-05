import { beforeEach, describe, expect, it } from "vitest";
import { checkLookup, resetLookupLimits } from "../../src/lib/spaak/rate-limit";

beforeEach(() => resetLookupLimits());

describe("lookup sliding window boundaries", () => {
  it("expires each lookup separately, including the exact ten-minute boundary", () => {
    expect(checkLookup("client", 0)).toBe(true);
    for (let index = 0; index < 19; index++) expect(checkLookup("client", 1_000)).toBe(true);
    expect(checkLookup("client", 599_999)).toBe(false);
    expect(checkLookup("client", 600_000)).toBe(true);
    expect(checkLookup("client", 600_000)).toBe(false);
    for (let index = 0; index < 19; index++) expect(checkLookup("client", 601_000)).toBe(true);
    expect(checkLookup("client", 601_000)).toBe(false);
  });

  it("does not extend the window when rejecting a lookup", () => {
    for (let index = 0; index < 20; index++) expect(checkLookup("client", 0)).toBe(true);
    expect(checkLookup("client", 599_999)).toBe(false);
    expect(checkLookup("client", 600_000)).toBe(true);
  });

  it("keeps clients independent and resets all state", () => {
    for (let index = 0; index < 20; index++) checkLookup("first", 0);
    expect(checkLookup("first", 0)).toBe(false);
    expect(checkLookup("second", 0)).toBe(true);
    resetLookupLimits();
    expect(checkLookup("first", 0)).toBe(true);
  });

  it("drops the oldest key at 10,000 keys without evicting a newer key", () => {
    for (let index = 0; index < 20; index++) checkLookup("oldest", 0);
    for (let index = 0; index < 20; index++) checkLookup("second", 0);
    for (let index = 2; index < 10_000; index++) checkLookup(`client-${index}`, 0);
    expect(checkLookup("oldest", 0)).toBe(false);
    expect(checkLookup("overflow", 0)).toBe(true);
    expect(checkLookup("second", 0)).toBe(false);
    expect(checkLookup("oldest", 0)).toBe(true);
  });
});
