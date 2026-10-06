import { describe, expect, it, vi } from "vitest";
import { normalizePostcode } from "../../src/lib/spaak/domain";
import { MemoryStore } from "../../src/lib/spaak/memory-store";
import { SupabaseStore } from "../../src/lib/spaak/supabase-store";
import type { BookingInput } from "../../src/lib/spaak/store";

const NOW = new Date("2026-10-08T08:15:00Z");
const INPUT: BookingInput = {
  repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00",
  naam: "Femke", telefoon: "0612345678", email: "femke@example.nl", fiets: "Gazelle",
};
const PICKUP = { postcode: "3512 AB", adres: "Oudegracht 1" };

describe("pick-up edge cases", () => {
  it("removes Unicode whitespace but keeps zero-width non-whitespace invalid", () => {
    expect(normalizePostcode("\ufeff3\u20285\u20031\u30002 a\u202fb\ufeff")).toBe("3512 AB");
    expect(normalizePostcode("3512\u200bAB")).toBeNull();
  });

  // New nested data must not let a caller alter the stored booking through a returned reference.
  it("isolates input, booking, lookup, day overview and retry pick-up objects", async () => {
    const store = new MemoryStore({ now: () => NOW });
    const ophalen = { ...PICKUP };
    const result = await store.book({ ...INPUT, ophalen }, "isolated-pickup");
    if (!result.ok || !result.booking.ophalen) throw new Error("Expected pick-up.");
    const code = result.booking.code;
    ophalen.adres = "Changed input";
    result.booking.ophalen.adres = "Changed reply";
    const found = await store.findByCode(code);
    expect(found?.ophalen).toEqual(PICKUP);
    if (!found?.ophalen) throw new Error("Expected lookup pick-up.");
    found.ophalen.postcode = "3600 AA";
    const overview = await store.dayOverview(INPUT.date);
    expect(overview[0].bookings[0].ophalen).toEqual(PICKUP);
    overview[0].bookings[0].ophalen!.adres = "Changed overview";
    const retry = await store.book({ ...INPUT, ophalen: null }, "isolated-pickup");
    if (!retry.ok || !retry.booking.ophalen) throw new Error("Expected retry pick-up.");
    expect(retry.booking.ophalen).toEqual(PICKUP);
    retry.booking.ophalen.adres = "Changed retry";
    expect((await store.findByCode(code))?.ophalen).toEqual(PICKUP);
  });

  it("collects contact and pick-up errors together without making an RPC", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const stores = [new MemoryStore({ now: () => NOW }),
      new SupabaseStore({ client: { schema: () => ({ rpc }) }, schema: "app_spaak_dev", now: () => NOW })];
    for (const store of stores) {
      expect(await store.book({ ...INPUT, email: "invalid", ophalen: { postcode: "3600 AA", adres: " " } }, "combined-errors"))
        .toEqual({ ok: false, reason: "ongeldig", fields: {
          email: "Vul een geldig e-mailadres in.",
          postcode: "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599",
          adres: "Vul een straat en huisnummer in.",
        } });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("trims Unicode whitespace from the stored address without changing entered input", async () => {
    const store = new MemoryStore({ now: () => NOW });
    const ophalen = { postcode: "3\t512a\nb", adres: "\ufeff\tOudegracht 1\n\u00a0" };
    const original = { ...ophalen };
    const result = await store.book({ ...INPUT, ophalen }, "unicode-pickup");
    expect(result).toMatchObject({ ok: true, booking: { ophalen: PICKUP, toeslagCent: 1000 } });
    expect(ophalen).toEqual(original);
  });

  it.each([
    { ophaal_postcode: "3512 AB", ophaal_adres: null, toeslag_cent: 1000 },
    { ophaal_postcode: null, ophaal_adres: "Oudegracht 1", toeslag_cent: 1000 },
    { ophaal_postcode: null, ophaal_adres: null, toeslag_cent: 1000 },
    { ophaal_postcode: "3512 AB", ophaal_adres: "Oudegracht 1", toeslag_cent: 0 },
    { ophaal_postcode: "3512ab", ophaal_adres: "Oudegracht 1", toeslag_cent: 1000 },
    { ophaal_postcode: "3512 AB", ophaal_adres: " Oudegracht 1 ", toeslag_cent: 1000 },
  ])("rejects inconsistent RPC pick-up data: %j", async (pickup) => {
    const row = { code: "ABCDEF", reparatie_id: INPUT.repairTypeId, datum: INPUT.date, start: "10:00", eind: "11:00",
      naam: INPUT.naam, telefoon: INPUT.telefoon, email: INPUT.email, fiets: INPUT.fiets,
      status: "gepland", aangemaakt: NOW.toISOString(), ...pickup };
    const store = new SupabaseStore({ client: { schema: () => ({ rpc: async () => ({ data: row, error: null }) }) },
      schema: "app_spaak_dev", now: () => NOW });
    await expect(store.findByCode("ABCDEF")).rejects.toThrow("Ongeldig antwoord van de Spaak database.");
  });
});
