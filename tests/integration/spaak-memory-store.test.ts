import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";
import type { BookingInput } from "../../src/lib/spaak/store";

/**
 * Werkstuk W1a (route D trial, 05-10): the in-memory store that tests, local runs and sandbox checks use. It must
 * behave like the real database: a slot never takes more bookings than its capacity, also when two customers confirm
 * at the same moment; one form submission gives one booking even when it is sent twice. Written by the meester; the
 * builder may not change this file. The clock is fixed at Thursday 8 October 2026, 10:15 in Amsterdam.
 */

const NOW = new Date("2026-10-08T08:15:00.000Z");
let store: MemoryStore;

function input(over: Partial<BookingInput> = {}): BookingInput {
  return {
    repairTypeId: "onderhoud",
    date: "2026-10-09",
    start: "10:00",
    naam: "Femke de Wit",
    telefoon: "06 1234 5678",
    email: "femke@example.nl",
    fiets: "Gazelle, ketting piept",
    ...over,
  };
}

beforeEach(() => {
  let n = 0;
  store = new MemoryStore({ now: () => NOW, random: () => ((n++ * 7919) % 1000) / 1000 });
});

describe("repair types", () => {
  it("starts with the shop's four repair types", async () => {
    const types = await store.listRepairTypes();
    expect(types.map((t) => [t.id, t.naam, t.duurMinuten, t.prijsCent])).toEqual([
      ["onderhoud", "Onderhoudsbeurt", 60, 6900],
      ["remmen", "Remmen afstellen", 30, 2500],
      ["band", "Band plakken", 20, 1500],
      ["overig", "Overig", 60, null],
    ]);
  });

  it("adds a repair type that can be booked at once", async () => {
    const added = await store.addRepairType({ naam: "Banden wisselen", duurMinuten: 30, prijsCent: 2500 });
    expect((await store.listRepairTypes()).map((t) => t.naam)).toContain("Banden wisselen");
    const result = await store.book(input({ repairTypeId: added.id }), "k-new-type");
    expect(result.ok).toBe(true);
  });

  it("refuses an invalid repair type", async () => {
    for (const bad of [
      { naam: " ", duurMinuten: 30, prijsCent: 100 },
      { naam: "X", duurMinuten: 0, prijsCent: 100 },
      { naam: "X", duurMinuten: 30, prijsCent: -1 },
      { naam: "X", duurMinuten: 30.5, prijsCent: 100 },
    ]) {
      await expect(store.addRepairType(bad)).rejects.toThrow();
    }
  });
});

describe("booking", () => {
  it("books a free slot and shows it in the availability", async () => {
    const result = await store.book(input(), "k1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(result.booking).toMatchObject({ date: "2026-10-09", start: "10:00", end: "11:00", status: "gepland",
                                           repairTypeId: "onderhoud", naam: "Femke de Wit" });
    const day = await store.dayAvailability("2026-10-09");
    const slot = day.slots.find((s) => s.start === "10:00");
    expect(slot).toMatchObject({ capacity: 2, booked: 1, free: 1 });
    expect(day.closed).toBe(false);
  });

  it("never books more than the capacity", async () => {
    expect((await store.book(input(), "a")).ok).toBe(true);
    expect((await store.book(input({ naam: "Ahmed" }), "b")).ok).toBe(true);
    const third = await store.book(input({ naam: "Bas" }), "c");
    expect(third).toEqual({ ok: false, reason: "vol" });
    expect((await store.dayAvailability("2026-10-09")).slots.find((s) => s.start === "10:00")?.free).toBe(0);
  });

  it("gives the last place to exactly one of two customers confirming at once", async () => {
    await store.book(input({ naam: "Eerste" }), "first");
    const results = await Promise.all([store.book(input({ naam: "Anna" }), "anna"), store.book(input({ naam: "Bram" }), "bram")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "vol" }]);
    expect((await store.dayOverview("2026-10-09")).flatMap((g) => g.bookings)).toHaveLength(2);
  });

  it("turns a repeated submission into one booking with one code", async () => {
    const [a, b] = await Promise.all([store.book(input(), "same-key"), store.book(input(), "same-key")]);
    const again = await store.book(input(), "same-key");
    expect(a.ok && b.ok && again.ok).toBe(true);
    if (!a.ok || !b.ok || !again.ok) return;
    expect(new Set([a.booking.code, b.booking.code, again.booking.code]).size).toBe(1);
    expect((await store.dayOverview("2026-10-09")).flatMap((g) => g.bookings)).toHaveLength(1);
  });

  it("refuses wrong details without storing anything", async () => {
    const result = await store.book(input({ email: "geen-apenstaart", telefoon: "abc" }), "bad");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ongeldig");
    expect(Object.keys(result.fields ?? {}).sort()).toEqual(["email", "telefoon"]);
    expect((await store.dayOverview("2026-10-09")).flatMap((g) => g.bookings)).toHaveLength(0);
  });

  it("refuses closed days, past slots, unknown slots and unknown repair types", async () => {
    expect(await store.book(input({ date: "2026-10-11" }), "sun")).toEqual({ ok: false, reason: "gesloten" });
    expect(await store.book(input({ date: "2026-10-08", start: "09:00" }), "past")).toEqual({ ok: false, reason: "verleden" });
    expect(await store.book(input({ start: "10:30" }), "odd")).toMatchObject({ ok: false, reason: "ongeldig" });
    expect(await store.book(input({ repairTypeId: "vliegen" }), "type")).toMatchObject({ ok: false, reason: "ongeldig" });
    await store.setClosedDay("2026-10-09", true);
    expect(await store.book(input(), "closed")).toEqual({ ok: false, reason: "gesloten" });
  });

  it("finds the next day with a free slot", async () => {
    expect(await store.nextAvailableDate("2026-10-11")).toBe("2026-10-13");
    for (const start of ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]) {
      await store.setCapacity("2026-10-09", start, 0);
    }
    expect(await store.nextAvailableDate("2026-10-09")).toBe("2026-10-10");
    const day = await store.dayAvailability("2026-10-09");
    expect(day.slots.every((s) => s.free === 0)).toBe(true);
  });

  it("explains why a day has nothing free", async () => {
    expect((await store.dayAvailability("2026-10-11")).reason).toBe("gesloten");
    for (const start of ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]) {
      await store.setCapacity("2026-10-09", start, 0);
    }
    expect((await store.dayAvailability("2026-10-09")).reason).toBe("vol");
    expect((await store.dayAvailability("2026-10-13")).reason).toBeNull();
  });
});

describe("status and cancelling", () => {
  async function booked(date = "2026-10-09", start = "10:00", key = "k") {
    const result = await store.book(input({ date, start }), key);
    if (!result.ok) throw new Error("booking failed");
    return result.booking;
  }

  it("finds a booking by its code, forgiving case and spaces, and nothing for an unknown code", async () => {
    const b = await booked();
    expect((await store.findByCode(" " + b.code.toLowerCase() + " "))?.code).toBe(b.code);
    expect(await store.findByCode("ZZZZZZ")).toBeNull();
    expect(await store.findByCode("")).toBeNull();
  });

  it("cancels more than 24 hours ahead and frees the place", async () => {
    const b = await booked("2026-10-09", "11:00");
    expect(await store.cancel(b.code)).toEqual({ ok: true });
    expect((await store.findByCode(b.code))?.status).toBe("geannuleerd");
    expect((await store.dayAvailability("2026-10-09")).slots.find((s) => s.start === "11:00")?.free).toBe(2);
    expect(await store.cancel(b.code)).toEqual({ ok: false, reason: "status" });
  });

  it("refuses to cancel within 24 hours, and unknown codes", async () => {
    const b = await booked("2026-10-09", "09:00");
    expect(await store.cancel(b.code)).toEqual({ ok: false, reason: "te-laat" });
    expect(await store.cancel("ZZZZZZ")).toEqual({ ok: false, reason: "onbekend" });
  });

  it("moves the status forward one step at a time and shows it to the customer", async () => {
    const b = await booked();
    expect((await store.setStatus(b.code, "ontvangen")).ok).toBe(true);
    expect(await store.setStatus(b.code, "klaar")).toEqual({ ok: false, reason: "overgang" });
    expect((await store.setStatus(b.code, "bezig")).ok).toBe(true);
    expect((await store.findByCode(b.code))?.status).toBe("bezig");
    expect(await store.setStatus("ZZZZZZ", "bezig")).toEqual({ ok: false, reason: "onbekend" });
  });

  it("does not let a started repair be cancelled", async () => {
    const b = await booked("2026-10-13", "10:00");
    await store.setStatus(b.code, "ontvangen");
    expect(await store.cancel(b.code)).toEqual({ ok: false, reason: "status" });
  });
});

describe("the mechanic's day and the owner's settings", () => {
  it("groups the day's active bookings per slot in time order", async () => {
    await store.book(input({ start: "14:00", naam: "Laat" }), "1");
    await store.book(input({ start: "10:00", naam: "Vroeg" }), "2");
    const cancelled = await store.book(input({ start: "11:00", naam: "Weg" }), "3");
    if (cancelled.ok) await store.cancel(cancelled.booking.code);
    const overview = await store.dayOverview("2026-10-09");
    expect(overview.map((g) => g.slot.start)).toEqual(["10:00", "14:00"]);
    expect(overview[0].bookings[0].naam).toBe("Vroeg");
    expect(await store.dayOverview("2026-10-13")).toEqual([]);
  });

  it("keeps existing bookings when the capacity drops below them", async () => {
    await store.setCapacity("2026-10-09", "10:00", 3);
    await store.book(input({ naam: "A" }), "a");
    await store.book(input({ naam: "B" }), "b");
    await store.setCapacity("2026-10-09", "10:00", 1);
    const slot = (await store.dayAvailability("2026-10-09")).slots.find((s) => s.start === "10:00");
    expect(slot).toMatchObject({ capacity: 1, booked: 2, free: 0 });
    expect((await store.dayOverview("2026-10-09"))[0].bookings).toHaveLength(2);
    expect(await store.book(input({ naam: "C" }), "c")).toEqual({ ok: false, reason: "vol" });
    await expect(store.setCapacity("2026-10-09", "10:00", -1)).rejects.toThrow();
    await expect(store.setCapacity("2026-10-09", "10:30", 2)).rejects.toThrow();
  });

  it("keeps two stores apart", async () => {
    const other = new MemoryStore({ now: () => NOW });
    await store.book(input(), "x");
    expect(await other.dayOverview("2026-10-09")).toEqual([]);
  });
});
