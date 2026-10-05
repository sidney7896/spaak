import { describe, expect, it, vi } from "vitest";
import { SupabaseStore, type RpcClient } from "../../src/lib/spaak/supabase-store";
import type { BookingInput } from "../../src/lib/spaak/store";

const INPUT: BookingInput = {
  repairTypeId: "unknown", date: "2026-10-09", start: "10:00",
  naam: "Femke", telefoon: "0612345678", email: "femke@example.nl", fiets: "Gazelle",
};

function fixture(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  const client: RpcClient = { schema: () => ({ rpc }) };
  return { store: new SupabaseStore({ client, schema: "public", now: () => new Date("2026-10-08T08:15:00.000Z") }), rpc };
}

describe("Spaak database repair type authority", () => {
  it("preserves database field errors for unknown and formerly seeded repair types", async () => {
    const failure = { ok: false, reason: "ongeldig", fields: { repairTypeId: "Dit reparatietype bestaat niet meer." } };
    const { store, rpc } = fixture(failure);
    for (const repairTypeId of ["unknown", "onderhoud"]) {
      expect(await store.book({ ...INPUT, repairTypeId }, "repair-key-01")).toEqual(failure);
    }
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("spaak_boek", { p: expect.objectContaining({ repairTypeId: "unknown" }) });
    expect(rpc).toHaveBeenCalledWith("spaak_boek", { p: expect.objectContaining({ repairTypeId: "onderhoud" }) });
  });

  it("still rejects contact and schedule errors before an RPC for an uncached type", async () => {
    const { store, rpc } = fixture(null);
    for (const change of [{ email: "invalid" }, { date: "2026-02-30" }, { start: "10:30" }]) {
      expect(await store.book({ ...INPUT, ...change }, "repair-key-02"))
        .toMatchObject({ ok: false, reason: "ongeldig" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed database repair type errors", async () => {
    for (const fields of [undefined, null, {}, { repairTypeId: 1 }]) {
      const { store } = fixture({ ok: false, reason: "ongeldig", fields });
      await expect(store.book(INPUT, "repair-key-03")).rejects.toThrow("Ongeldig antwoord");
    }
  });
});
