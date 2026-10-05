import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";

/**
 * Werkstuk W2 (route D trial, 05-10): the public booking API of Spaak. Route handlers read the store through
 * `getStore()` from src/lib/spaak/server.ts; here that is a MemoryStore with a fixed clock (Thursday 8 October 2026,
 * 10:15 in Amsterdam). Written by the meester; the builder may not change this file.
 */

const NOW = new Date("2026-10-08T08:15:00.000Z");
const state = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: () => state.store }));

import { GET as getRepairTypes } from "../../src/app/api/spaak/reparaties/route";
import { GET as getDay } from "../../src/app/api/spaak/dag/route";
import { POST as postBooking } from "../../src/app/api/spaak/afspraken/route";

const body = {
  repairTypeId: "onderhoud",
  date: "2026-10-09",
  start: "10:00",
  naam: "Femke de Wit",
  telefoon: "06 1234 5678",
  email: "femke@example.nl",
  fiets: "Gazelle, ketting piept",
};

function post(payload: unknown, key: string | null = "key-0001", raw?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== null) headers.set("idempotency-key", key);
  return postBooking(new NextRequest("https://spaak.example/api/spaak/afspraken", {
    method: "POST", headers, body: raw ?? JSON.stringify(payload),
  }));
}

beforeEach(() => {
  state.store = new MemoryStore({ now: () => NOW });
});

describe("GET /api/spaak/reparaties", () => {
  it("lists the repair types", async () => {
    const response = await getRepairTypes(new NextRequest("https://spaak.example/api/spaak/reparaties"));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.reparaties.map((r: { naam: string }) => r.naam)).toEqual(["Onderhoudsbeurt", "Remmen afstellen",
      "Band plakken", "Overig"]);
  });
});

describe("GET /api/spaak/dag", () => {
  it("shows the slots of a day with their free places", async () => {
    const response = await getDay(new NextRequest("https://spaak.example/api/spaak/dag?datum=2026-10-09"));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.datum).toBe("2026-10-09");
    expect(json.reden).toBeNull();
    expect(json.tijdvakken[0]).toEqual({ start: "09:00", eind: "10:00", vrij: 2, capaciteit: 2 });
  });

  it("explains a closed day and points to the next free day", async () => {
    const json = await (await getDay(new NextRequest("https://spaak.example/api/spaak/dag?datum=2026-10-11"))).json();
    expect(json.reden).toBe("gesloten");
    expect(json.volgende).toBe("2026-10-13");
  });

  it("refuses a missing or impossible date", async () => {
    for (const query of ["", "?datum=", "?datum=2026-02-30", "?datum=morgen"]) {
      const response = await getDay(new NextRequest("https://spaak.example/api/spaak/dag" + query));
      expect(response.status).toBe(400);
    }
  });
});

describe("POST /api/spaak/afspraken", () => {
  it("books and returns a code", async () => {
    const response = await post(body);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(json.afspraak).toMatchObject({ date: "2026-10-09", start: "10:00", end: "11:00", status: "gepland" });
  });

  it("gives the same booking for a repeated submission with the same key", async () => {
    const first = await (await post(body, "same-key-01")).json();
    const again = await post(body, "same-key-01");
    expect([200, 201]).toContain(again.status);
    expect((await again.json()).code).toBe(first.code);
  });

  it("needs an idempotency key", async () => {
    expect((await post(body, null)).status).toBe(400);
    expect((await post(body, "x")).status).toBe(400);
    expect((await post(body, "k".repeat(201))).status).toBe(400);
  });

  it("names the wrong fields", async () => {
    const response = await post({ ...body, email: "geen-apenstaart", telefoon: "abc" });
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.reden).toBe("ongeldig");
    expect(Object.keys(json.velden).sort()).toEqual(["email", "telefoon"]);
  });

  it("says when a slot is full, the day closed or the slot past", async () => {
    await post(body, "a-000001");
    await post({ ...body, naam: "Ahmed" }, "b-000001");
    const full = await post({ ...body, naam: "Bas" }, "c-000001");
    expect(full.status).toBe(409);
    expect((await full.json()).reden).toBe("vol");
    const closed = await post({ ...body, date: "2026-10-11" }, "d-000001");
    expect(closed.status).toBe(409);
    expect((await closed.json()).reden).toBe("gesloten");
    const past = await post({ ...body, date: "2026-10-08", start: "09:00" }, "e-000001");
    expect(past.status).toBe(409);
    expect((await past.json()).reden).toBe("verleden");
  });

  it("refuses bodies that are not a booking", async () => {
    expect((await post(null, "f-000001", "{not json")).status).toBe(400);
    expect((await post(null, "g-000001", JSON.stringify([1, 2]))).status).toBe(400);
    expect((await post(null, "h-000001", JSON.stringify({ ...body, fiets: "x".repeat(70_000) }))).status).toBe(413);
    const missing = await post({ ...body, repairTypeId: undefined }, "i-000001");
    expect([400, 422]).toContain(missing.status);
  });

  it("never echoes other customers' details", async () => {
    await post({ ...body, naam: "Iemand Anders" }, "j-000001");
    const json = await (await post({ ...body, naam: "Bas" }, "k-000001")).json();
    expect(JSON.stringify(json)).not.toContain("Iemand Anders");
  });
});
