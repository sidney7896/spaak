import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";

/**
 * Werkstuk W4 (route D trial, 05-10): the mechanic's day overview (journey J3) behind staff sign-in. In preview and
 * production staff are signed-in members (Supabase, from the starter); for tests and sandbox runs without Supabase a
 * test-only sign-in exists when APP_ENV is "test" and SPAAK_TEST_SECRET is set, nowhere else. The clock is Thursday
 * 8 October 2026, 10:15 in Amsterdam. Written by the meester; the builder may not change this file.
 */

const NOW = new Date("2026-10-08T08:15:00.000Z");
const state = vi.hoisted(() => ({ store: null as unknown, user: null as null | { id: string; email: string }, member: false }));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: () => state.store }));
vi.mock("../../src/lib/auth/session", () => ({
  getCurrentUser: async () => state.user,
  hasApplicationAccess: async () => state.member,
}));
vi.mock("../../src/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));

import { GET as dayRoute } from "../../src/app/api/spaak/werkplaats/dag/route";
import { POST as statusRoute } from "../../src/app/api/spaak/werkplaats/status/route";
import { POST as testLogin } from "../../src/app/api/spaak/test-login/route";

const input = { repairTypeId: "onderhoud", date: "2026-10-08", start: "11:00", naam: "Femke de Wit",
                telefoon: "06 1234 5678", email: "femke@example.nl", fiets: "Gazelle, ketting piept" };

async function book(over: Partial<typeof input> = {}) {
  const r = await (state.store as MemoryStore).book({ ...input, ...over }, "k-" + Math.random().toString(36).slice(2, 10));
  if (!r.ok) throw new Error(r.reason);
  return r.booking;
}

function req(url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest("https://spaak.example" + url, { method: init.method ?? "GET", headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function loginCookie(rol = "monteur") {
  const response = await testLogin(req("/api/spaak/test-login", { method: "POST", body: { rol } }));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=(Lax|Strict)/i);
  return cookie.split(";")[0];
}

beforeEach(() => {
  state.store = new MemoryStore({ now: () => NOW });
  state.user = null;
  state.member = false;
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("SPAAK_TEST_SECRET", "test-secret-for-spaak-0123456789");
});

afterEach(() => vi.unstubAllEnvs());

describe("staff only", () => {
  it("gives no data without sign-in", async () => {
    await book();
    const response = await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-10-08"));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("Femke");
    const status = await statusRoute(req("/api/spaak/werkplaats/status", { method: "POST", body: { code: "ZZZZZZ", status: "bezig" } }));
    expect(status.status).toBe(401);
  });

  it("accepts a signed-in member in preview and production", async () => {
    vi.stubEnv("APP_ENV", "production");
    state.user = { id: "00000000-0000-0000-0000-000000000001", email: "ahmed@example.nl" };
    state.member = true;
    await book();
    const response = await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-10-08"));
    expect(response.status).toBe(200);
    state.member = false;
    expect((await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-10-08"))).status).toBe(401);
  });

  it("refuses a tampered test cookie", async () => {
    const cookie = await loginCookie();
    const [name, value] = cookie.split("=");
    const tampered = name + "=" + value.slice(0, -2) + (value.endsWith("A") ? "B" : "A") + value.slice(-1);
    expect((await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-10-08", { cookie: tampered }))).status).toBe(401);
  });
});

describe("test-only sign-in", () => {
  it("exists only with APP_ENV=test and a secret", async () => {
    for (const [env, secret] of [["production", "test-secret-for-spaak-0123456789"], ["development", "test-secret-for-spaak-0123456789"],
                                 ["staging", "test-secret-for-spaak-0123456789"], ["test", ""]]) {
      vi.stubEnv("APP_ENV", env);
      vi.stubEnv("SPAAK_TEST_SECRET", secret);
      const response = await testLogin(req("/api/spaak/test-login", { method: "POST", body: { rol: "monteur" } }));
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("knows only the two roles", async () => {
    expect((await testLogin(req("/api/spaak/test-login", { method: "POST", body: { rol: "baas" } }))).status).toBe(400);
  });

  it("is not accepted outside APP_ENV=test even with a valid cookie", async () => {
    const cookie = await loginCookie();
    vi.stubEnv("APP_ENV", "production");
    expect((await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-10-08", { cookie }))).status).toBe(401);
  });
});

describe("the day overview", () => {
  it("groups today's bookings per slot with the details a mechanic needs", async () => {
    await book({ start: "14:00", naam: "Laat" });
    const early = await book({ start: "11:00", naam: "Vroeg" });
    const cookie = await loginCookie();
    const response = await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-10-08", { cookie }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const json = await response.json();
    expect(json.datum).toBe("2026-10-08");
    expect(json.tijdvakken.map((g: { start: string }) => g.start)).toEqual(["11:00", "14:00"]);
    expect(json.tijdvakken[0].afspraken[0]).toMatchObject({ code: early.code, naam: "Vroeg", telefoon: "06 1234 5678",
      fiets: "Gazelle, ketting piept", reparatie: "Onderhoudsbeurt", status: "gepland" });
  });

  it("returns an empty list for an empty day and refuses impossible dates", async () => {
    const cookie = await loginCookie();
    const json = await (await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-10-13", { cookie }))).json();
    expect(json.tijdvakken).toEqual([]);
    expect((await dayRoute(req("/api/spaak/werkplaats/dag?datum=2026-02-30", { cookie }))).status).toBe(400);
  });

  it("moves a repair one step at a time", async () => {
    const b = await book();
    const cookie = await loginCookie();
    const set = (status: string) => statusRoute(req("/api/spaak/werkplaats/status", { method: "POST", cookie, body: { code: b.code, status } }));
    expect((await set("ontvangen")).status).toBe(200);
    const skipped = await set("klaar");
    expect(skipped.status).toBe(409);
    expect((await skipped.json()).reden).toBe("overgang");
    expect((await set("bezig")).status).toBe(200);
    expect((await (state.store as MemoryStore).findByCode(b.code))?.status).toBe("bezig");
    expect((await set("vliegen")).status).toBe(400);
    expect((await statusRoute(req("/api/spaak/werkplaats/status", { method: "POST", cookie, body: { code: "ZZZZZZ", status: "ontvangen" } }))).status).toBe(404);
  });
});
