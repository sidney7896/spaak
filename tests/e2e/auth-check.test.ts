import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-in with the emailed code (roadmap 11H): the browser verifies the code itself, then lands on
 * /auth/check, which applies the same membership gate as /auth/callback. A code works on any
 * device, unlike a PKCE magic link that only opens in the browser that asked for it.
 */
const state = vi.hoisted(() => ({
  user: { id: "00000000-0000-0000-0000-000000000001" } as { id: string } | null,
  access: true,
  signOutCalls: 0,
  configFails: false,
}));

vi.mock("../../src/lib/config", () => ({
  getServerConfig: () => {
    if (state.configFails) throw new Error("missing");
    return { NEXT_PUBLIC_APP_URL: "https://app.example" };
  },
}));
vi.mock("../../src/lib/auth/session", () => ({ hasApplicationAccess: vi.fn(async () => state.access) }));
vi.mock("../../src/lib/profile", () => ({ projectProfile: { signupMode: "invite-only", slug: "alpha_app", topology: "shared", modules: {} } }));
vi.mock("../../src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      signOut: async () => { state.signOutCalls += 1; return { error: null }; },
    },
  }),
}));

import { GET as check } from "../../src/app/auth/check/route";

const call = (query: string) => check(new NextRequest(`https://app.example/auth/check${query}`));

beforeEach(() => {
  state.user = { id: "00000000-0000-0000-0000-000000000001" };
  state.access = true;
  state.signOutCalls = 0;
  state.configFails = false;
});

describe("/auth/check", () => {
  it("lets a signed-in member through to the requested page", async () => {
    const response = await call("?next=/notes");
    expect(response.headers.get("location")).toBe("https://app.example/notes");
    expect(state.signOutCalls).toBe(0);
  });

  it("signs out a non-member and sends them back with invite_required", async () => {
    state.access = false;
    const response = await call("?next=/dashboard");
    expect(response.headers.get("location")).toBe("https://app.example/sign-in?error=invite_required");
    expect(state.signOutCalls).toBe(1);
  });

  it("sends a visitor without a session back to sign in", async () => {
    state.user = null;
    const response = await call("");
    expect(response.headers.get("location")).toBe("https://app.example/sign-in?error=callback_failed");
    expect(state.signOutCalls).toBe(0);
  });

  it("never honours an off-origin next parameter", async () => {
    const response = await call("?next=https://evil.example/steal");
    expect(response.headers.get("location")).toBe("https://app.example/dashboard");
  });

  it("answers 503 when the configuration is unavailable", async () => {
    state.configFails = true;
    const response = await call("");
    expect(response.status).toBe(503);
  });
});
