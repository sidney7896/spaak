import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-in journey end to end at the boundary the application owns: the OAuth/magic-link
 * callback. Supabase Auth itself is a fixture here, so this proves what the route does with an
 * exchanged session, not that a real provider issues one.
 */
const state = vi.hoisted(() => ({
  exchangeError: null as { message: string } | null,
  user: { id: "00000000-0000-0000-0000-000000000001" } as { id: string } | null,
  access: true,
  signOutCalls: 0,
}));

vi.mock("../../src/lib/config", () => ({ getServerConfig: () => ({ NEXT_PUBLIC_APP_URL: "https://app.example" }) }));
vi.mock("../../src/lib/auth/session", () => ({ hasApplicationAccess: vi.fn(async () => state.access) }));
vi.mock("../../src/lib/profile", () => ({ projectProfile: { signupMode: "invite-only", slug: "alpha_app", topology: "shared", modules: {} } }));
vi.mock("../../src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: state.exchangeError }),
      getUser: async () => ({ data: { user: state.user } }),
      signOut: async () => { state.signOutCalls += 1; return { error: null }; },
    },
  }),
}));

import { GET as callback } from "../../src/app/auth/callback/route";

const call = (query: string) => callback(new NextRequest(`https://app.example/auth/callback${query}`));

beforeEach(() => {
  state.exchangeError = null;
  state.user = { id: "00000000-0000-0000-0000-000000000001" };
  state.access = true;
  state.signOutCalls = 0;
});

describe("/auth/callback", () => {
  it("lets a member in and does not sign them out", async () => {
    const response = await call("?code=valid&next=/notes");
    expect(response.headers.get("location")).toBe("https://app.example/notes");
    expect(state.signOutCalls).toBe(0);
  });

  it("signs out a signed-in non-member and sends them back with invite_required (AT-14)", async () => {
    state.access = false;
    const response = await call("?code=valid");
    expect(response.headers.get("location")).toBe("https://app.example/sign-in?error=invite_required");
    expect(state.signOutCalls).toBe(1);
  });

  it("never honours an off-origin next parameter", async () => {
    const response = await call("?code=valid&next=https://evil.example/steal");
    expect(response.headers.get("location")).toBe("https://app.example/dashboard");
  });

  it("reports a failed exchange instead of letting the visitor through", async () => {
    state.exchangeError = { message: "invalid grant" };
    const response = await call("?code=stale");
    expect(response.headers.get("location")).toBe("https://app.example/sign-in?error=callback_failed");
  });
});
