import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";

/**
 * Werkstuk W3 (route D trial, 05-10): looking up a booking with its code and cancelling it (journey J2). A code is
 * the only key a customer has, so a wrong guess must reveal nothing and guessing must be slowed down. The clock is
 * fixed at Thursday 8 October 2026, 10:15 in Amsterdam. Written by the meester; the builder may not change this file.
 */

const NOW = new Date("2026-10-08T08:15:00.000Z");
const state = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: () => state.store }));

import { GET as lookup } from "../../src/app/api/spaak/afspraken/[code]/route";
import { POST as cancel } from "../../src/app/api/spaak/afspraken/[code]/annuleren/route";
import { resetLookupLimits } from "../../src/lib/spaak/rate-limit";

const input = { repairTypeId: "onderhoud", date: "2026-10-09", start: "11:00", naam: "Femke de Wit",
                telefoon: "06 1234 5678", email: "femke@example.nl", fiets: "Gazelle" };

async function book(over: Partial<typeof input> = {}, key = "key-" + Math.random().toString(36).slice(2, 10)) {
  const result = await (state.store as MemoryStore).book({ ...input, ...over }, key);
  if (!result.ok) throw new Error("booking failed: " + result.reason);
  return result.booking;
}

function req(code: string, ip = "203.0.113.7", method = "GET") {
  const suffix = method === "POST" ? "/annuleren" : "";
  return new NextRequest(`https://spaak.example/api/spaak/afspraken/${encodeURIComponent(code)}${suffix}`,
                         { method, headers: { "x-forwarded-for": ip } });
}

const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

beforeEach(() => {
  state.store = new MemoryStore({ now: () => NOW });
  resetLookupLimits();
});

describe("GET /api/spaak/afspraken/[code]", () => {
  it("shows status, day, slot and repair, and nothing personal", async () => {
    const b = await book();
    await (state.store as MemoryStore).setStatus(b.code, "ontvangen");
    await (state.store as MemoryStore).setStatus(b.code, "bezig");
    const response = await lookup(req(b.code.toLowerCase()), ctx(b.code.toLowerCase()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const json = await response.json();
    expect(json).toMatchObject({ code: b.code, status: "bezig", date: "2026-10-09", start: "11:00", end: "12:00",
                                 reparatie: "Onderhoudsbeurt" });
    const text = JSON.stringify(json);
    for (const personal of ["Femke", "06 1234", "femke@example.nl", "Gazelle"]) expect(text).not.toContain(personal);
  });

  it("says the same thing for an unknown and a malformed code", async () => {
    for (const code of ["ZZZZZZ", "0O1I00", "abc", "x".repeat(300)]) {
      const response = await lookup(req(code), ctx(code));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ fout: "Geen afspraak gevonden met deze code" });
    }
  });

  it("slows down guessing per address", async () => {
    for (let i = 0; i < 20; i++) expect((await lookup(req("ZZZZZZ"), ctx("ZZZZZZ"))).status).toBe(404);
    expect((await lookup(req("ZZZZZZ"), ctx("ZZZZZZ"))).status).toBe(429);
    expect((await lookup(req("ZZZZZZ", "198.51.100.9"), ctx("ZZZZZZ"))).status).toBe(404);
  });
});

describe("POST /api/spaak/afspraken/[code]/annuleren", () => {
  it("cancels more than a day ahead", async () => {
    const b = await book();
    const response = await cancel(req(b.code, undefined, "POST"), ctx(b.code));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "geannuleerd" });
    expect((await (state.store as MemoryStore).findByCode(b.code))?.status).toBe("geannuleerd");
  });

  it("refuses within 24 hours and gives the shop's phone number", async () => {
    const b = await book({ start: "09:00" });
    const response = await cancel(req(b.code, undefined, "POST"), ctx(b.code));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ reden: "te-laat", telefoon: "010-555 01 42" });
  });

  it("refuses unknown codes and started repairs", async () => {
    expect((await cancel(req("ZZZZZZ", undefined, "POST"), ctx("ZZZZZZ"))).status).toBe(404);
    const b = await book({ date: "2026-10-13" });
    await (state.store as MemoryStore).setStatus(b.code, "ontvangen");
    const response = await cancel(req(b.code, undefined, "POST"), ctx(b.code));
    expect(response.status).toBe(409);
    expect((await response.json()).reden).toBe("status");
  });
});
