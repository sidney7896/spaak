import { describe, expect, it } from "vitest";
import { pageDate } from "../../src/lib/spaak/datum";

describe("pageDate", () => {
  it.each(["2026-10-13", "2024-02-29", "2000-02-29", "0099-01-01"])("accepts the calendar date %s", (date) => {
    expect(pageDate(date)).toBe(date);
  });

  const invalid: readonly unknown[] = [
    undefined, null, 20261013, {}, [], [null], [["2026-10-13"]],
    "2026-02-30", "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-13", "2026-13-01", "2026-10-00",
    "2026-10-32", "13-10-2026", "morgen", "", "2026-1-3", " 2026-10-13", "2026-10-13\n", "2026-10-13T00:00:00Z",
  ];
  it.each(invalid.map((value) => ({ value })))("ignores invalid input %j", ({ value }: { value: unknown }) => {
    expect(pageDate(value)).toBeUndefined();
  });

  it("uses only the first repeated query value", () => {
    expect(pageDate(["2024-02-29", "2026-10-13"])).toBe("2024-02-29");
    expect(pageDate(["2026-02-30", "2026-10-13"])).toBeUndefined();
  });
});
