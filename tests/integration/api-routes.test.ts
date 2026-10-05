import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Offline route-handler tests: the Supabase client, the configuration and the session helpers are
 * fixtures, so these prove the handlers' own decisions (status codes and gates), never anything
 * about a live Supabase project.
 */
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  access: true,
  notesError: null as { message: string } | null,
  fileUploadEnabled: true,
  uploadError: null as { message: string } | null,
}));

vi.mock("../../src/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => state.user),
  requireUser: vi.fn(async () => { if (!state.user) throw new Error("Authentication required."); return state.user; }),
  hasApplicationAccess: vi.fn(async () => state.access),
}));

vi.mock("../../src/lib/config", () => ({
  getServerConfig: () => ({ APP_ENV: "test", NEXT_PUBLIC_APP_URL: "https://app.example" }),
  privateStorageBucketName: () => "alpha-app-dev-private",
}));

vi.mock("../../src/lib/profile", () => ({
  projectProfile: { modules: { fileUpload: { enabled: true } } },
  isModuleEnabled: (name: string) => (name === "fileUpload" ? state.fileUploadEnabled : false),
}));

vi.mock("../../src/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({ select: () => ({ limit: async () => ({ error: state.notesError }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: state.uploadError }) }) },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); },
}));

import { GET as ready } from "../../src/app/api/ops/ready/route";
import { POST as upload } from "../../src/app/api/uploads/route";
import ProtectedLayout from "../../src/app/(protected)/layout";

const anyRequest = () => ({ formData: async () => new FormData() }) as never;

beforeEach(() => {
  state.user = { id: "00000000-0000-0000-0000-000000000001" };
  state.access = true;
  state.notesError = null;
  state.fileUploadEnabled = true;
  state.uploadError = null;
});

describe("/api/ops/ready", () => {
  it("answers 401 without a session", async () => {
    state.user = null;
    expect((await ready()).status).toBe(401);
  });

  it("answers 403 for a signed-in non-member (the S-08 gate)", async () => {
    state.access = false;
    const response = await ready();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("answers 200 for a member and 503 when the database cannot be read", async () => {
    expect((await ready()).status).toBe(200);
    state.notesError = { message: "relation notes does not exist" };
    const degraded = await ready();
    expect(degraded.status).toBe(503);
    expect((await degraded.json()).database).toBe("unreachable");
  });
});

describe("/api/uploads", () => {
  it("answers 404 while the fileUpload module is disabled", async () => {
    state.fileUploadEnabled = false;
    const response = await upload(anyRequest());
    expect(response.status).toBe(404);
  });

  it("answers 401 without a session even when the module is enabled", async () => {
    state.user = null;
    expect((await upload(anyRequest())).status).toBe(401);
  });

  /**
   * R4S-11: `/api/ops/ready` gated on membership and `/api/uploads` did not. In the shared topology
   * one Auth pool serves every application, so a signed-in non-member reached the handler and was
   * stopped by the Storage RLS predicate - surfacing as `502 Upload failed`, a refusal reported as
   * a provider error. The membership refusal must be the application's own 403.
   */
  it("answers 403 for a signed-in non-member instead of letting RLS refuse it as a 502", async () => {
    state.access = false;
    const response = await upload(anyRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("answers 400 when no file is supplied", async () => {
    expect((await upload(anyRequest())).status).toBe(400);
  });
});

describe("the (protected) segment", () => {
  it("sends an anonymous visitor to /sign-in instead of rendering its children", async () => {
    state.user = null;
    await expect(ProtectedLayout({ children: "secret" })).rejects.toThrow("NEXT_REDIRECT:/sign-in");
  });

  it("renders its children for a signed-in visitor", async () => {
    expect(await ProtectedLayout({ children: "secret" })).toBe("secret");
  });
});
