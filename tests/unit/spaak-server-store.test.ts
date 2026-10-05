import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";
import { SupabaseStore } from "../../src/lib/spaak/supabase-store";

const state = vi.hoisted(() => ({
  create: vi.fn(() => ({ schema: () => ({ rpc: async () => ({ data: null, error: null }) }) })),
}));
vi.mock("../../src/lib/spaak/supabase-client", () => ({ createSpaakSupabaseClient: state.create }));

import { getStore } from "../../src/lib/spaak/server";

const shared = globalThis as typeof globalThis & { spaakMemoryStore?: MemoryStore; spaakSupabaseStore?: SupabaseStore };

beforeEach(() => {
  delete shared.spaakMemoryStore;
  delete shared.spaakSupabaseStore;
  state.create.mockClear();
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  vi.stubEnv("SUPABASE_DB_SCHEMA", "app_spaak_prod");
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete shared.spaakMemoryStore;
  delete shared.spaakSupabaseStore;
});

describe("Spaak process store selection", () => {
  it("shares the test MemoryStore even when database credentials are configured", () => {
    vi.stubEnv("APP_ENV", "test");
    const store = getStore();
    expect(store).toBeInstanceOf(MemoryStore);
    expect(getStore()).toBe(store);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("uses memory for development without a service key", () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(getStore()).toBeInstanceOf(MemoryStore);
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each(["development", "preview", "staging", "production"])("shares a database store in %s with credentials", (env) => {
    vi.stubEnv("APP_ENV", env);
    const store = getStore();
    expect(store).toBeInstanceOf(SupabaseStore);
    expect(getStore()).toBe(store);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create).toHaveBeenCalledWith("https://example.supabase.co", "fixture-service-key");
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_SCHEMA"])("names the missing %s value", (name) => {
    vi.stubEnv(name, "");
    expect(() => getStore()).toThrow(name);
    expect(state.create).not.toHaveBeenCalled();
  });
});
