import { describe, expect, it } from "vitest";
import { slotStart, slotsForDate, validateContact } from "../../src/lib/spaak/domain";
import { MemoryStore } from "../../src/lib/spaak/memory-store";
import type { BookingInput } from "../../src/lib/spaak/store";

const NOW = new Date("2026-10-08T08:15:00.000Z");
const INPUT: BookingInput = {
  repairTypeId: "onderhoud", date: "2026-10-09", start: "11:00",
  naam: "Testklant", telefoon: "0612345678", email: "test@example.nl", fiets: "Testfiets",
};

function memory(now: () => Date = () => NOW): MemoryStore {
  let sequence = 0;
  return new MemoryStore({ now, random: () => ((sequence++ * 7919) % 1000) / 1000 });
}

describe("Spaak calendar and contact boundaries", () => {
  it("uses the offset on each side of both DST switches, including the switch day", () => {
    expect(slotStart("2026-03-29", "01:30").toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(slotStart("2026-03-29", "03:30").toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(slotStart("2026-10-25", "01:30").toISOString()).toBe("2026-10-24T23:30:00.000Z");
    expect(slotStart("2026-10-25", "03:30").toISOString()).toBe("2026-10-25T02:30:00.000Z");
    expect(() => slotStart("2026-03-29", "02:30")).toThrow();
  });

  it("validates leap days and strict wall times", () => {
    expect(slotsForDate("2028-02-29", [])).toHaveLength(8);
    expect(() => slotsForDate("2026-02-29", [])).toThrow();
    for (const start of ["9:00", "24:00", "09:60", "09:00:00"]) {
      expect(() => slotStart("2026-10-09", start)).toThrow();
    }
  });

  it("checks the maximum name, phone and bike lengths", () => {
    expect(validateContact({ ...INPUT, naam: ` ${"N".repeat(80)} `, telefoon: "+(123) 456-789012345" })).toEqual({});
    expect(validateContact({ ...INPUT, telefoon: "1234567890123456" })).toHaveProperty("telefoon");
    expect(validateContact({ ...INPUT, telefoon: "0612345678\n" })).toHaveProperty("telefoon");
    expect(validateContact({ ...INPUT, fiets: `${"f".repeat(500)} ` })).toHaveProperty("fiets");
  });
});

describe("Spaak store edge cases", () => {
  it("retries a code collision without reusing a cancelled booking's code", async () => {
    let calls = 0;
    const store = new MemoryStore({ now: () => NOW, random: () => calls++ < 12 ? 0 : 1 / 32 });
    const first = await store.book(INPUT, "first");
    if (!first.ok) throw new Error("Expected first booking.");
    expect(first.booking.code).toBe("AAAAAA");
    expect(await store.cancel(first.booking.code)).toEqual({ ok: true });
    const second = await store.book(INPUT, "second");
    if (!second.ok) throw new Error("Expected second booking.");
    expect(second.booking.code).toBe("BBBBBB");
    expect((await store.findByCode("AAAAAA"))?.status).toBe("geannuleerd");
  });

  it("keeps the first successful submission for a key, even after cancellation", async () => {
    const store = memory();
    expect((await store.book({ ...INPUT, email: "invalid" }, "key")).ok).toBe(false);
    const first = await store.book(INPUT, "key");
    if (!first.ok) throw new Error("Expected booking.");
    await store.cancel(first.booking.code);
    const retry = await store.book({ ...INPUT, naam: "Andere klant", date: "2026-10-13" }, "key");
    if (!retry.ok) throw new Error("Expected original booking.");
    expect(retry.booking).toEqual({ ...first.booking, status: "geannuleerd" });
    expect(await store.dayOverview("2026-10-13")).toEqual([]);
  });

  it("isolates stored data from mutations to input and returned values", async () => {
    const store = memory();
    const submitted = { ...INPUT };
    const result = await store.book(submitted, "key");
    if (!result.ok) throw new Error("Expected booking.");
    const code = result.booking.code;
    expect(result.booking.createdAt).toBe(NOW.toISOString());
    submitted.date = "2026-10-13";
    result.booking.status = "geannuleerd";
    const found = await store.findByCode(code);
    if (!found) throw new Error("Expected lookup.");
    found.naam = "Gewijzigd";
    const overview = await store.dayOverview(INPUT.date);
    overview[0].bookings[0].telefoon = "Gewijzigd";
    const types = await store.listRepairTypes();
    types[0].naam = "Gewijzigd";
    expect(await store.findByCode(code)).toMatchObject({ status: "gepland", naam: INPUT.naam, telefoon: INPUT.telefoon, date: INPUT.date });
    expect((await store.listRepairTypes())[0].naam).toBe("Onderhoudsbeurt");
  });

  it("refuses a slot starting exactly now and returns invalid dates as booking errors", async () => {
    const store = memory(() => slotStart(INPUT.date, INPUT.start));
    expect(await store.book(INPUT, "now")).toEqual({ ok: false, reason: "verleden" });
    const invalid = await store.book({ ...INPUT, date: "2026-02-30" }, "invalid");
    expect(invalid).toMatchObject({ ok: false, reason: "ongeldig" });
    if (invalid.ok) throw new Error("Expected invalid booking.");
    expect(invalid.fields).toHaveProperty("date");
  });

  it("preserves appointments and capacity overrides when a day closes and reopens", async () => {
    const store = memory();
    await store.setCapacity(INPUT.date, INPUT.start, 1);
    await store.book(INPUT, "first");
    await store.setClosedDay(INPUT.date, true);
    expect((await store.dayOverview(INPUT.date))[0].bookings).toHaveLength(1);
    expect(await store.book(INPUT, "second")).toEqual({ ok: false, reason: "gesloten" });
    await store.setClosedDay(INPUT.date, false);
    expect(await store.book(INPUT, "second")).toEqual({ ok: false, reason: "vol" });
  });

  it("includes day 60 in the availability search and stops before day 61", async () => {
    const store = memory();
    const day = new Date("2026-10-10T00:00:00.000Z");
    for (let offset = 0; offset < 60; offset++) {
      await store.setClosedDay(day.toISOString().slice(0, 10), true);
      day.setUTCDate(day.getUTCDate() + 1);
    }
    expect(await store.nextAvailableDate("2026-10-10")).toBe("2026-12-09");
    await store.setClosedDay("2026-12-09", true);
    expect(await store.nextAvailableDate("2026-10-10")).toBeNull();
    expect(await store.nextAvailableDate("2026-12-10")).toBe("2026-12-10");
  });

  it("prevents skipping, reversing and leaving the terminal statuses", async () => {
    const store = memory();
    const result = await store.book(INPUT, "key");
    if (!result.ok) throw new Error("Expected booking.");
    for (const status of ["ontvangen", "bezig", "klaar", "opgehaald"] as const) {
      expect(await store.setStatus(result.booking.code, status)).toEqual({ ok: true });
    }
    expect(await store.setStatus(result.booking.code, "klaar")).toEqual({ ok: false, reason: "overgang" });
    expect(await store.setStatus(result.booking.code, "geannuleerd")).toEqual({ ok: false, reason: "overgang" });
  });

  it("rejects invalid settings without changing availability", async () => {
    const store = memory();
    for (const capacity of [-1, 1.5, NaN, Infinity]) {
      await expect(store.setCapacity(INPUT.date, INPUT.start, capacity)).rejects.toThrow();
    }
    await expect(store.setClosedDay("2026-02-30", true)).rejects.toThrow();
    await expect(store.addRepairType({ naam: "Test", duurMinuten: 30, prijsCent: 1.5 })).rejects.toThrow();
    expect((await store.dayAvailability(INPUT.date)).slots.find((slot) => slot.start === INPUT.start)?.capacity).toBe(2);
  });
});
