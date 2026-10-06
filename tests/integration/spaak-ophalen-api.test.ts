import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";

/** W7: public booking API and the transport to the mechanic's board; meester-owned. */
const NOW = new Date("2026-10-08T08:15:00.000Z");
const RING = "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599";
const FORMAT = "Vul een postcode in zoals 3512 AB.";
const ADDRESS = "Vul een straat en huisnummer in.";
const SHAPE = "Vul postcode en adres in als tekst.";
const state = vi.hoisted(() => ({ store: null as unknown as MemoryStore }));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: () => state.store }));
vi.mock("../../src/lib/spaak/staff", () => ({ getStaff: async () => ({ rol: "monteur" }) }));

import { POST as postBooking } from "../../src/app/api/spaak/afspraken/route";
import { GET as getWorkshopDay } from "../../src/app/api/spaak/werkplaats/dag/route";

const body = { repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00", naam: "Femke de Wit",
  telefoon: "06 1234 5678", email: "femke@example.nl", fiets: "Gazelle, ketting piept" };

function post(payload: unknown, key = "pickup-api-key") {
  return postBooking(new NextRequest("https://spaak.example/api/spaak/afspraken", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload),
  }));
}

beforeEach(() => {
  let n = 0;
  state.store = new MemoryStore({ now: () => NOW, random: () => ((n++ * 7919) % 1000) / 1000 });
});

describe("W7: POST /api/spaak/afspraken", () => {
  // Checks each non-null shape is exactly an object with two string fields and no extras.
  // Catches: coercing numbers, accepting arrays or extra keys, or silently ignoring malformed pick-up.
  it("returns 422 velden.ophalen for every malformed pick-up shape without calling the store", async () => {
    const book = vi.spyOn(state.store, "book");
    for (const ophalen of [false, true, 0, 1000, "3512 AB", [], ["3512 AB", "Oudegracht 1"], {},
      { postcode: "3512 AB" }, { adres: "Oudegracht 1" },
      { postcode: 3512, adres: "Oudegracht 1" }, { postcode: null, adres: "Oudegracht 1" },
      { postcode: "3512 AB", adres: 1 }, { postcode: "3512 AB", adres: null },
      { postcode: ["3512 AB"], adres: "Oudegracht 1" }, { postcode: "3512 AB", adres: {} },
      { postcode: "3512 AB", adres: "Oudegracht 1", toeslagCent: 0 },
      { postcode: "3512 AB", adres: "Oudegracht 1", extra: null }]) {
      const response = await post({ ...body, ophalen });
      expect(response.status, JSON.stringify(ophalen)).toBe(422);
      expect(await response.json(), JSON.stringify(ophalen)).toEqual({ reden: "ongeldig", velden: { ophalen: SHAPE } });
    }
    expect(book).not.toHaveBeenCalled();
    expect(await state.store.dayOverview(body.date)).toEqual([]);
  });

  // Checks the unchanged success status and the complete normalized Booking, not only its code.
  // Catches: changing the existing 201 response, ignoring pick-up, or dropping its surcharge.
  it("returns 201 with a normalized pick-up booking", async () => {
    const response = await post({ ...body, ophalen: { postcode: " 3512  ab ", adres: " Oudegracht 1 " } });
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(json).toEqual({ code: json.code, afspraak: { ...body, code: json.code, end: "11:00", status: "gepland",
      createdAt: NOW.toISOString(), ophalen: { postcode: "3512 AB", adres: "Oudegracht 1" }, toeslagCent: 1000 } });
    expect(await state.store.findByCode(json.code)).toEqual(json.afspraak);
  });

  // Checks both backward-compatible body shapes remain valid and carry explicit defaults in their replies.
  // Catches: requiring ophalen on old callers or charging an explicit opt-out.
  it("returns 201 with null pick-up and zero surcharge for missing and null pick-up", async () => {
    for (const [index, payload] of [body, { ...body, ophalen: null }].entries()) {
      const response = await post(payload, `no-pickup-api-${index}`);
      expect(response.status).toBe(201);
      expect((await response.json()).afspraak).toMatchObject({ ophalen: null, toeslagCent: 0 });
    }
    expect((await state.store.dayOverview(body.date)).flatMap((g) => g.bookings)).toHaveLength(2);
  });

  // Checks well-shaped but invalid data uses the existing velden wire format and consumes no slot.
  // Catches: returning a success, a shape error, or losing fields.postcode when translating the store result.
  it("returns the exact S19 field error and can subsequently book after opting out", async () => {
    const response = await post({ ...body, ophalen: { postcode: "3600 AA", adres: "Oudegracht 1" } });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ reden: "ongeldig", velden: { postcode: RING } });
    expect(await state.store.dayOverview(body.date)).toEqual([]);
    const corrected = await post({ ...body, ophalen: null });
    expect(corrected.status).toBe(201);
    expect((await corrected.json()).afspraak).toMatchObject({ ...body, ophalen: null, toeslagCent: 0 });
    expect((await state.store.dayOverview(body.date)).flatMap((g) => g.bookings)).toHaveLength(1);
  });

  // Checks identical normalized pick-up submissions retry safely with the same key.
  // Catches: comparing raw postcode casing/spacing to stored values or booking twice on retry.
  it("returns the same full response for a normalized equivalent retry", async () => {
    const first = await post({ ...body, ophalen: { postcode: "3512ab", adres: " Oudegracht 1 " } });
    expect(first.status).toBe(201);
    const json = await first.json();
    const again = await post({ ...body, ophalen: { postcode: "3512 AB", adres: "Oudegracht 1" } });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(json);
    expect((await state.store.dayOverview(body.date)).flatMap((g) => g.bookings)).toHaveLength(1);
  });

  // Checks pick-up participates in the existing request-identity protection.
  // Catches: reusing a key with another address/postcode or an opt-out and leaking the first booking.
  it("refuses changed pick-up for a reused key without disclosing booking data", async () => {
    const first = await post({ ...body, ophalen: { postcode: "3512 AB", adres: "Oudegracht 1" } });
    expect(first.status).toBe(201);
    const original = await first.json();
    for (const payload of [body, { ...body, ophalen: null },
      { ...body, ophalen: { postcode: "3513 AB", adres: "Oudegracht 1" } },
      { ...body, ophalen: { postcode: "3512 AB", adres: "Oudegracht 2" } }]) {
      const response = await post(payload);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ reden: "sleutel" });
    }
    expect(await state.store.findByCode(original.code)).toEqual(original.afspraak);
    expect((await state.store.dayOverview(body.date)).flatMap((g) => g.bookings)).toHaveLength(1);
  });

  // Catches: turning well-shaped invalid values into a shape error, dropping one error, or consuming a place.
  it("returns exact 422 postcode and address errors for invalid values without storing a booking", async () => {
    for (const value of [
      { ophalen: { postcode: "", adres: "Oudegracht 1" }, velden: { postcode: FORMAT } },
      { ophalen: { postcode: "0123 AB", adres: "Oudegracht 1" }, velden: { postcode: FORMAT } },
      { ophalen: { postcode: "3512-AB", adres: "Oudegracht 1" }, velden: { postcode: FORMAT } },
      { ophalen: { postcode: "3499 AB", adres: "Oudegracht 1" }, velden: { postcode: RING } },
      { ophalen: { postcode: "3512 AB", adres: "" }, velden: { adres: ADDRESS } },
      { ophalen: { postcode: "3512 AB", adres: " \t\n " }, velden: { adres: ADDRESS } },
      { ophalen: { postcode: "3512 AB", adres: "a".repeat(121) }, velden: { adres: ADDRESS } },
      { ophalen: { postcode: "3600 AA", adres: " " }, velden: { postcode: RING, adres: ADDRESS } },
      { ophalen: { postcode: "3512A", adres: "" }, velden: { postcode: FORMAT, adres: ADDRESS } },
    ]) {
      const response = await post({ ...body, ophalen: value.ophalen });
      expect(response.status, JSON.stringify(value.ophalen)).toBe(422);
      expect(await response.json()).toEqual({ reden: "ongeldig", velden: value.velden });
      expect(await state.store.dayOverview(body.date)).toEqual([]);
    }
  });

  // Catches: returning 422 pick-up field errors for a top-level non-object body or passing it to the store.
  it("keeps 400 fout for every non-object body", async () => {
    const book = vi.spyOn(state.store, "book");
    for (const payload of [null, false, true, 0, "3512 AB", [], [body]]) {
      const response = await post(payload);
      expect(response.status, JSON.stringify(payload)).toBe(400);
      expect(await response.json()).toEqual({ fout: "Stuur een JSON-object met je afspraak." });
    }
    expect(book).not.toHaveBeenCalled();
    expect(await state.store.dayOverview(body.date)).toEqual([]);
  });

  // Catches: treating omitted and explicit null pick-up as different submissions on an ordinary retry.
  it("returns the same 201 booking for missing and null pick-up with the same key", async () => {
    const first = await post(body);
    expect(first.status).toBe(201);
    const original = await first.json();
    const again = await post({ ...body, ophalen: null });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(original);
    expect((await state.store.dayOverview(body.date)).flatMap((g) => g.bookings)).toHaveLength(1);
  });

  // Catches: checking only changes between two addresses and allowing pick-up to be added to a reused key.
  it("returns 409 when adding pick-up to an ordinary booking's reused key", async () => {
    const first = await post(body);
    expect(first.status).toBe(201);
    const original = await first.json();
    const changed = await post({ ...body, ophalen: { postcode: "3512 AB", adres: "Oudegracht 1" } });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ reden: "sleutel" });
    expect(await state.store.findByCode(original.code)).toEqual(original.afspraak);
    expect((await state.store.dayOverview(body.date)).flatMap((g) => g.bookings)).toHaveLength(1);
  });
});

describe("W7: workshop day transport", () => {
  // Checks the real route passes pick-up to DayBoard while retaining ordinary appointments.
  // Catches: new store and UI tests passing separately while werkplaats/dag drops ophalen in its mapper.
  it("carries the normalized pick-up to the mechanic's API", async () => {
    const pickup = await state.store.book({ ...body, ophalen: { postcode: "3512ab", adres: " Oudegracht 1 " } }, "workshop-pickup");
    const ordinary = await state.store.book({ ...body, start: "14:00", naam: "Bas" }, "workshop-ordinary");
    if (!pickup.ok || !ordinary.ok) throw new Error("Expected both bookings.");
    const response = await getWorkshopDay(new NextRequest("https://spaak.example/api/spaak/werkplaats/dag?datum=2026-10-09"));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.tijdvakken.map((g: { start: string }) => g.start)).toEqual(["10:00", "14:00"]);
    expect(json.tijdvakken[0].afspraken[0]).toMatchObject({ code: pickup.booking.code,
      ophalen: { postcode: "3512 AB", adres: "Oudegracht 1" } });
    expect(json.tijdvakken[1].afspraken[0]).toMatchObject({ code: ordinary.booking.code, ophalen: null });
  });
});
