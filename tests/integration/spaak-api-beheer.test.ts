import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";

/**
 * Werkstuk W5 (route D trial, 05-10): the owner's settings (journey J4, scenarios S15 and S16). Only the owner may
 * change repair types, capacity and closed days; a mechanic may not. Staff come from `getStaff()` (W4), mocked here.
 * The clock is Thursday 8 October 2026, 10:15 in Amsterdam. Written by the meester; the builder may not change this
 * file.
 */

const NOW = new Date("2026-10-08T08:15:00.000Z");
const state = vi.hoisted(() => ({ store: null as unknown, staff: null as null | { rol: string } }));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: () => state.store }));
vi.mock("../../src/lib/spaak/staff", () => ({ getStaff: async () => state.staff }));

import { GET as listTypes, POST as addType } from "../../src/app/api/spaak/beheer/reparaties/route";
import { POST as setCapacity } from "../../src/app/api/spaak/beheer/capaciteit/route";
import { POST as setClosed } from "../../src/app/api/spaak/beheer/gesloten/route";
import { GET as ownerDay } from "../../src/app/api/spaak/beheer/dag/route";

function req(url: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new NextRequest("https://spaak.example" + url, { method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
}

const store = () => state.store as MemoryStore;
const booking = { repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00", naam: "Femke", telefoon: "06 1234 5678",
                  email: "femke@example.nl", fiets: "Gazelle" };

beforeEach(() => {
  state.store = new MemoryStore({ now: () => NOW });
  state.staff = { rol: "eigenaar" };
});

afterEach(() => vi.unstubAllEnvs());

describe("only the owner", () => {
  it("refuses everyone else without changing anything", async () => {
    for (const staff of [null, { rol: "monteur" }]) {
      state.staff = staff;
      const expected = staff === null ? 401 : 403;
      expect((await listTypes(req("/api/spaak/beheer/reparaties"))).status).toBe(expected);
      expect((await addType(req("/api/spaak/beheer/reparaties", { naam: "X", duurMinuten: 30, prijsCent: 100 }))).status).toBe(expected);
      expect((await setCapacity(req("/api/spaak/beheer/capaciteit", { datum: "2026-10-09", start: "10:00", capaciteit: 0 }))).status).toBe(expected);
      expect((await setClosed(req("/api/spaak/beheer/gesloten", { datum: "2026-10-09", gesloten: true }))).status).toBe(expected);
      expect((await ownerDay(req("/api/spaak/beheer/dag?datum=2026-10-09"))).status).toBe(expected);
    }
    expect((await store().listRepairTypes()).map((t) => t.naam)).not.toContain("X");
    expect((await store().dayAvailability("2026-10-09")).closed).toBe(false);
  });
});

describe("repair types (S15)", () => {
  it("adds a repair type a customer can book at once", async () => {
    const response = await addType(req("/api/spaak/beheer/reparaties", { naam: "Banden wisselen", duurMinuten: 30, prijsCent: 2500 }));
    expect(response.status).toBe(201);
    const { reparatie } = await response.json();
    expect(reparatie).toMatchObject({ naam: "Banden wisselen", duurMinuten: 30, prijsCent: 2500 });
    const listed = await (await listTypes(req("/api/spaak/beheer/reparaties"))).json();
    expect(listed.reparaties.map((t: { naam: string }) => t.naam)).toContain("Banden wisselen");
    expect((await store().book({ ...booking, repairTypeId: reparatie.id }, "k-0000001")).ok).toBe(true);
  });

  it("names wrong input", async () => {
    for (const body of [{ naam: " ", duurMinuten: 30, prijsCent: 100 }, { naam: "X", duurMinuten: 0, prijsCent: 100 },
                        { naam: "X", duurMinuten: 30, prijsCent: -5 }, { naam: "X", duurMinuten: "30", prijsCent: 100 },
                        { naam: "X".repeat(81), duurMinuten: 30, prijsCent: null }]) {
      const response = await addType(req("/api/spaak/beheer/reparaties", body));
      expect(response.status).toBe(422);
      expect(Object.keys((await response.json()).velden ?? {}).length).toBeGreaterThan(0);
    }
  });
});

describe("capacity and closed days (S16)", () => {
  it("keeps bookings when the capacity drops below them and shows the slot as full", async () => {
    await setCapacity(req("/api/spaak/beheer/capaciteit", { datum: "2026-10-09", start: "10:00", capaciteit: 3 }));
    await store().book(booking, "k-a000001");
    await store().book({ ...booking, naam: "Bas" }, "k-b000001");
    const response = await setCapacity(req("/api/spaak/beheer/capaciteit", { datum: "2026-10-09", start: "10:00", capaciteit: 1 }));
    expect(response.status).toBe(200);
    const day = await (await ownerDay(req("/api/spaak/beheer/dag?datum=2026-10-09"))).json();
    expect(day.tijdvakken.find((s: { start: string }) => s.start === "10:00")).toMatchObject({ capaciteit: 1, geboekt: 2, vrij: 0 });
    expect((await store().book({ ...booking, naam: "Cor" }, "k-c000001")).ok).toBe(false);
  });

  it("refuses impossible capacity input", async () => {
    for (const body of [{ datum: "2026-10-09", start: "10:30", capaciteit: 2 }, { datum: "2026-10-09", start: "10:00", capaciteit: -1 },
                        { datum: "2026-13-09", start: "10:00", capaciteit: 2 }, { datum: "2026-10-09", start: "10:00", capaciteit: 2.5 },
                        { datum: "2026-10-09", start: "10:00", capaciteit: 1000 }]) {
      expect((await setCapacity(req("/api/spaak/beheer/capaciteit", body))).status).toBe(400);
    }
  });

  it("closes and reopens a day", async () => {
    expect((await setClosed(req("/api/spaak/beheer/gesloten", { datum: "2026-10-09", gesloten: true }))).status).toBe(200);
    expect((await store().dayAvailability("2026-10-09")).reason).toBe("gesloten");
    await setClosed(req("/api/spaak/beheer/gesloten", { datum: "2026-10-09", gesloten: false }));
    expect((await store().dayAvailability("2026-10-09")).reason).toBeNull();
    expect((await setClosed(req("/api/spaak/beheer/gesloten", { datum: "2026-10-09", gesloten: "ja" }))).status).toBe(400);
  });
});
