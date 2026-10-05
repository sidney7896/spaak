import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";
import { resetLookupLimits } from "../../src/lib/spaak/rate-limit";

const state = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: () => state.store }));

import { GET } from "../../src/app/api/spaak/afspraken/[code]/route";
import { POST } from "../../src/app/api/spaak/afspraken/[code]/annuleren/route";

const context = (code: string) => ({ params: Promise.resolve({ code }) });
function request(method: "GET" | "POST", address?: string): NextRequest {
  return new NextRequest("https://spaak.example/api/spaak/afspraken/ZZZZZZ", {
    method, headers: address === undefined ? {} : { "x-forwarded-for": address },
  });
}

beforeEach(() => {
  state.store = new MemoryStore({ now: () => new Date("2026-10-08T08:15:00Z") });
  resetLookupLimits();
});

describe("public lookup and cancellation boundaries", () => {
  it("shares the quota across methods and trims the first forwarded address", async () => {
    for (let index = 0; index < 10; index++) {
      expect((await GET(request("GET", " 203.0.113.7 , 198.51.100.1"), context("ZZZZZZ"))).status).toBe(404);
      expect((await POST(request("POST", "203.0.113.7, 198.51.100.2"), context("0O1I00"))).status).toBe(404);
    }
    for (const response of [
      await GET(request("GET", "203.0.113.7"), context("ZZZZZZ")),
      await POST(request("POST", "203.0.113.7"), context("ZZZZZZ")),
    ]) {
      expect(response.status).toBe(429);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ fout: "Te veel pogingen. Probeer het over een paar minuten opnieuw." });
    }
    expect((await GET(request("GET", "198.51.100.8"), context("ZZZZZZ"))).status).toBe(404);
  });

  it("uses the unknown client quota when no usable address is present", async () => {
    for (let index = 0; index < 20; index++) {
      expect((await GET(request("GET"), context("ZZZZZZ"))).status).toBe(404);
    }
    expect((await POST(request("POST", " , 198.51.100.8"), context("ZZZZZZ"))).status).toBe(429);
  });

  it("returns exactly the public fields and normalizes both methods", async () => {
    const store = state.store as MemoryStore;
    const result = await store.book({
      repairTypeId: "onderhoud", date: "2026-10-09", start: "11:00", naam: "Femke de Wit",
      telefoon: "06 1234 5678", email: "femke@example.nl", fiets: "Gazelle",
    }, "status-test");
    if (!result.ok) throw new Error("Booking failed");
    const code = ` ${result.booking.code.toLowerCase()} `;
    const found = await GET(request("GET"), context(code));
    expect(await found.json()).toEqual({
      code: result.booking.code, status: "gepland", date: "2026-10-09", start: "11:00", end: "12:00",
      reparatie: "Onderhoudsbeurt",
    });
    const cancelled = await POST(request("POST"), context(code));
    expect(cancelled.status).toBe(200);
    expect(cancelled.headers.get("cache-control")).toContain("no-store");
    expect(await cancelled.json()).toEqual({ status: "geannuleerd" });
    const repeated = await POST(request("POST"), context(code));
    expect(repeated.status).toBe(409);
    expect(repeated.headers.get("cache-control")).toContain("no-store");
    expect(await repeated.json()).toEqual({ reden: "status" });
  });

  it("makes malformed and unknown cancellation codes indistinguishable", async () => {
    for (const code of ["ZZZZZZ", "0O1I00", "abc", "x".repeat(300)]) {
      const response = await POST(request("POST"), context(code));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ fout: "Geen afspraak gevonden met deze code" });
    }
  });
});
