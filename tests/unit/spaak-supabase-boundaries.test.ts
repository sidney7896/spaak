import { describe, expect, it, vi } from "vitest";
import { slotStart, slotsForDate } from "../../src/lib/spaak/domain";
import { SupabaseStore, type RpcClient } from "../../src/lib/spaak/supabase-store";
import type { BookingInput } from "../../src/lib/spaak/store";

const INPUT: BookingInput = {
  repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00",
  naam: "Femke", telefoon: "0612345678", email: "femke@example.nl", fiets: "Gazelle",
};
const NOW = new Date("2026-10-08T08:15:00.000Z");

function fixture(data: unknown, now: () => Date = () => NOW) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  const schema = vi.fn(() => ({ rpc }));
  const client: RpcClient = { schema };
  return { store: new SupabaseStore({ client, schema: "app_spaak_dev", now }), rpc, schema };
}

describe("Spaak RPC boundaries", () => {
  it("rejects invalid input locally without an RPC", async () => {
    const { store, rpc } = fixture(null);
    for (const change of [
      { email: "invalid" }, { telefoon: "abc" }, { naam: " " }, { fiets: "x".repeat(501) },
      { date: "2026-02-30" }, { start: "10:30" }, { email: "invalid", repairTypeId: "unknown" },
    ]) {
      expect(await store.book({ ...INPUT, ...change }, "valid-key-01")).toMatchObject({ ok: false, reason: "ongeldig" });
    }
    expect(await store.book(INPUT, "short")).toMatchObject({ ok: false, reason: "ongeldig" });
    await expect(store.setCapacity(INPUT.date, "10:30", 2)).rejects.toThrow();
    await expect(store.setCapacity(INPUT.date, INPUT.start, 51)).rejects.toThrow();
    await expect(store.setClosedDay("2026-02-30", true)).rejects.toThrow();
    await expect(store.addRepairType({ naam: " ", duurMinuten: 30, prijsCent: 10 })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets the database reject an unknown repair type", async () => {
    const failure = { ok: false, reason: "ongeldig", fields: { repairTypeId: "Kies een geldig reparatietype." } };
    const { store, rpc } = fixture(failure);
    expect(await store.book({ ...INPUT, repairTypeId: "unknown" }, "valid-key-01")).toEqual(failure);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("spaak_boek", { p: expect.objectContaining({ repairTypeId: "unknown" }) });
  });

  it("rejects null, incomplete or inconsistent RPC results across every method", async () => {
    const { store } = fixture(null);
    await expect(store.listRepairTypes()).rejects.toThrow();
    await expect(store.addRepairType({ naam: "Nieuw", duurMinuten: 30, prijsCent: null })).rejects.toThrow();
    await expect(store.book(INPUT, "valid-key-01")).rejects.toThrow();
    await expect(store.dayAvailability(INPUT.date)).rejects.toThrow();
    await expect(store.cancel("ABCDEF")).rejects.toThrow();
    await expect(store.setStatus("ABCDEF", "ontvangen")).rejects.toThrow();
    await expect(store.dayOverview(INPUT.date)).rejects.toThrow();
    await expect(store.setCapacity(INPUT.date, INPUT.start, 2)).rejects.toThrow();
    await expect(store.setClosedDay(INPUT.date, true)).rejects.toThrow();
    await expect(fixture({}).store.findByCode("ABCDEF")).rejects.toThrow();
    await expect(fixture({ ok: true, booking: {} }).store.book(INPUT, "valid-key-01")).rejects.toThrow();
    await expect(fixture({ ok: false, reason: "unknown" }).store.cancel("ABCDEF")).rejects.toThrow();
    await expect(fixture("2026-10-11").store.nextAvailableDate("2026-10-09")).rejects.toThrow();
    const defaults = slotsForDate(INPUT.date, []);
    const slots = defaults.map((slot) => ({ ...slot, booked: 1, free: slot.capacity - 1 }));
    slots[0].free = 10;
    await expect(fixture({ closed: false, slots }).store.dayAvailability(INPUT.date)).rejects.toThrow();
  });

  it("uses the store clock at the exact boundary while preserving counts", async () => {
    let now = new Date("2026-10-09T07:59:59.999Z");
    const defaults = slotsForDate(INPUT.date, []);
    const slots = defaults.map((slot) => ({ ...slot, capacity: 3, booked: 1, free: 2 }));
    const { store } = fixture({ closed: false, slots }, () => now);
    expect((await store.dayAvailability(INPUT.date)).slots.find((slot) => slot.start === INPUT.start))
      .toMatchObject({ capacity: 3, booked: 1, free: 2, past: false });
    now = slotStart(INPUT.date, INPUT.start);
    expect((await store.dayAvailability(INPUT.date)).slots.find((slot) => slot.start === INPUT.start))
      .toMatchObject({ capacity: 3, booked: 1, free: 0, past: true });
    now = slotStart(INPUT.date, "16:00");
    expect((await store.dayAvailability(INPUT.date)).reason).toBe("verleden");
  });

  it("normalizes Postgres times and timestamps into the MemoryStore shape", async () => {
    const raw = {
      code: "ABCDEF", reparatie_id: INPUT.repairTypeId, datum: INPUT.date, start: "10:00:00", eind: "11:00:00",
      naam: INPUT.naam, telefoon: INPUT.telefoon, email: INPUT.email, fiets: INPUT.fiets,
      status: "gepland", aangemaakt: "2026-10-08T08:15:00+00:00",
    };
    const { store } = fixture(raw);
    expect(await store.findByCode(" abcdef ")).toEqual({
      ...INPUT, code: "ABCDEF", end: "11:00", status: "gepland", createdAt: NOW.toISOString(),
    });
  });

  it("uses the selected schema and rejects database errors", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const schema = vi.fn(() => ({ rpc }));
    const store = new SupabaseStore({ client: { schema }, schema: "app_spaak_prod", now: () => NOW });
    expect(schema).toHaveBeenCalledWith("app_spaak_prod");
    await expect(store.book(INPUT, "valid-key-01")).rejects.toThrow("boom");
    await expect(store.findByCode("ABCDEF")).rejects.toThrow("boom");
  });

  it("includes day 60 and filters every candidate with one clock snapshot", async () => {
    const rpc = vi.fn(async (fn: string, args: { p: unknown }) => {
      expect(fn).toBe("spaak_volgende_vrije_dag");
      expect(args).toHaveProperty("p");
      return { data: null, error: null };
    });
    const store = new SupabaseStore({ client: { schema: () => ({ rpc }) }, schema: "public",
      now: () => slotStart("2026-10-10", "15:00") });
    expect(await store.nextAvailableDate("2026-10-10")).toBeNull();
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("spaak_volgende_vrije_dag");
    const p = args.p as { dagen: { datum: string; slots: unknown[] }[] };
    expect(p.dagen).toHaveLength(61);
    expect(p.dagen[0]).toEqual({ datum: "2026-10-10", slots: [] });
    expect(p.dagen[60].datum).toBe("2026-12-09");
  });
});
