import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R3-07: the POST redirect must be built from the validated NEXT_PUBLIC_APP_URL, not from the
 * incoming request URL, for the same reason S-16 moved the auth callback off it. Offline: the
 * notes store and the observability clients are fixtures.
 */
const state = vi.hoisted(() => ({ user: { id: "00000000-0000-0000-0000-000000000001" } as { id: string } | null, created: [] as string[], fails: false }));

vi.mock("../../src/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => state.user) }));
vi.mock("../../src/lib/config", () => ({ getServerConfig: () => ({ NEXT_PUBLIC_APP_URL: "https://app.example" }) }));
vi.mock("../../src/lib/observability/logger", () => ({ createLogger: () => ({ correlationId: "test", info() {}, error() {} }) }));
vi.mock("../../src/lib/observability/posthog", () => ({ createPostHogServer: () => null }));
vi.mock("../../src/lib/notes", () => ({
  listNotes: async () => [],
  createNote: async (title: string) => { if (state.fails) throw new Error("denied"); state.created.push(title); return { id: "1" }; },
  updateNote: async (_id: string, title: string) => { if (state.fails) throw new Error("denied"); state.created.push(title); return { id: _id }; },
}));

import { POST } from "../../src/app/api/notes/route";

function post(url: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return POST(new NextRequest(url, { method: "POST", body: form }));
}

beforeEach(() => {
  state.user = { id: "00000000-0000-0000-0000-000000000001" };
  state.created = [];
  state.fails = false;
});

describe("POST /api/notes", () => {
  it("redirects to the configured application origin, never to the request's own host", async () => {
    const response = await post("https://attacker.example/api/notes", { title: "A note", body: "text" });
    expect(response.headers.get("location")).toBe("https://app.example/notes");
    expect(state.created).toEqual(["A note"]);
  });

  /**
   * R4S-05: the form posts to `/api/notes` and the handler answered with the NextResponse.redirect
   * default of 307, which preserves the method and the body (RFC 7231 6.4.7). The browser therefore
   * re-issued the create as a POST to `/notes`, an App Router page with no route handler and no
   * Server Action, so the form could not complete. This test asserted the `location` header only.
   */
  it("completes the form with the POST/redirect/GET status, so the browser re-issues a GET", async () => {
    const created = await post("https://app.example/api/notes", { title: "A note", body: "text" });
    expect(created.status, "307/308 would re-issue the create as a POST to /notes").toBe(303);
    expect(created.headers.get("location")).toBe("https://app.example/notes");
    const updated = await post("https://app.example/api/notes", { title: "A note", body: "text", id: "1" });
    expect(updated.status).toBe(303);
  });

  it("refuses an anonymous writer and an invalid note", async () => {
    state.user = null;
    expect((await post("https://app.example/api/notes", { title: "A", body: "b" })).status).toBe(401);
    state.user = { id: "00000000-0000-0000-0000-000000000001" };
    expect((await post("https://app.example/api/notes", { title: "   ", body: "b" })).status).toBe(400);
    expect((await post("https://app.example/api/notes", { title: "A", body: "b".repeat(10001) })).status).toBe(400);
    expect(state.created).toEqual([]);
  });

  it("reports a row the database refused as 403 rather than pretending it was written", async () => {
    state.fails = true;
    expect((await post("https://app.example/api/notes", { title: "A", body: "b" })).status).toBe(403);
  });
});
