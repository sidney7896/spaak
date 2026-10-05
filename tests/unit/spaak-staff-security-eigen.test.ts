import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null, member: false, cookie: undefined as string | undefined,
}));
vi.mock("../../src/lib/auth/session", () => ({
  getCurrentUser: async () => state.user, hasApplicationAccess: async () => state.member,
}));
vi.mock("../../src/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => name === "spaak_test_staff" && state.cookie ? { value: state.cookie } : undefined,
}) }));

import { getStaff } from "../../src/lib/spaak/staff";
import { POST as login } from "../../src/app/api/spaak/test-login/route";

const SECRET = "spaak-test-only-secret-0123456789";
const NOW = new Date("2026-10-08T08:15:00Z");
function signedCookie(role: string, expires: number): string {
  const value = `${role}.${expires}`;
  return `${value}.${createHmac("sha256", SECRET).update(value).digest("base64url")}`;
}
function request(cookie?: string): NextRequest {
  return new NextRequest("https://spaak.example/api/spaak/werkplaats/dag", {
    headers: cookie ? { cookie: `spaak_test_staff=${cookie}` } : {},
  });
}
function loginRequest(url: string, rol: unknown = "monteur"): NextRequest {
  return new NextRequest(url, { method: "POST", body: JSON.stringify({ rol }),
    headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  state.user = null;
  state.member = false;
  state.cookie = undefined;
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("SPAAK_TEST_SECRET", SECRET);
  vi.stubEnv("SPAAK_EIGENAAR_EMAILS", "");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("staff cookie and membership boundaries", () => {
  it.each(["monteur", "eigenaar"] as const)("signs %s for exactly twelve hours and reads server cookies", async (rol) => {
    const response = await login(loginRequest("https://spaak.example/api/spaak/test-login", rol));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rol });
    const value = response.cookies.get("spaak_test_staff")?.value;
    expect(value).toBe(signedCookie(rol, NOW.getTime() / 1000 + 43_200));
    const header = response.headers.get("set-cookie");
    expect(header).toMatch(/Path=\//i);
    expect(header).toMatch(/Max-Age=43200/i);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/; Secure/i);
    expect(await getStaff(request(value))).toEqual({ rol });
    state.cookie = value;
    expect(await getStaff()).toEqual({ rol });
    vi.advanceTimersByTime(43_200_000);
    expect(await getStaff(request(value))).toBeNull();
  });

  it("allows an insecure cookie only on http localhost", async () => {
    for (const [url, secure] of [
      ["http://localhost:3000/api/spaak/test-login", false],
      ["https://localhost/api/spaak/test-login", true],
      ["http://spaak.example/api/spaak/test-login", true],
    ] as const) {
      const response = await login(loginRequest(url));
      expect(/; Secure/i.test(response.headers.get("set-cookie") ?? "")).toBe(secure);
    }
  });

  it.each(["", "123456789012345"])("hides login and ignores test cookies with an insufficient secret", async (secret) => {
    vi.stubEnv("SPAAK_TEST_SECRET", secret);
    const response = await login(loginRequest("https://spaak.example/api/spaak/test-login"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await getStaff(request(signedCookie("eigenaar", NOW.getTime() / 1000 + 100)))).toBeNull();
  });

  it("rejects expired, overly long, unknown-role and malformed signatures", async () => {
    const now = NOW.getTime() / 1000;
    for (const value of [signedCookie("monteur", now), signedCookie("eigenaar", now - 1),
      signedCookie("monteur", now + 43_201), signedCookie("baas", now + 100),
      "monteur.not-a-date.signature", signedCookie("monteur", now + 100) + "x"]) {
      expect(await getStaff(request(value))).toBeNull();
    }
  });

  it.each(["preview", "production", "development", "staging"])("uses membership and owner emails in %s", async (env) => {
    vi.stubEnv("APP_ENV", env);
    vi.stubEnv("SPAAK_EIGENAAR_EMAILS", " someone@example.nl, LOTTE@EXAMPLE.NL, ");
    const cookie = signedCookie("eigenaar", NOW.getTime() / 1000 + 100);
    expect(await getStaff(request(cookie))).toBeNull();
    state.user = { id: "staff-id", email: "ahmed@example.nl" };
    state.member = true;
    expect(await getStaff(request(cookie))).toEqual({ rol: "monteur" });
    state.user.email = "Lotte@example.nl";
    expect(await getStaff(request(cookie))).toEqual({ rol: "eigenaar" });
    state.member = false;
    expect(await getStaff(request(cookie))).toBeNull();
  });
});
