import { describe, expect, it } from "vitest";
import { validateServerConfig } from "../../src/lib/config";

// Roadmap 11G: a Vercel preview has a new address on every deployment, so without an explicit
// NEXT_PUBLIC_APP_URL the auth callback sent people to http://localhost:3000. A non-production
// deployment now falls back to its own Vercel address (VERCEL_URL is set by Vercel, never by a request).
const alpha = { topology: "shared", slug: "alpha_app", modules: {} } as never;
const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-placeholder",
};

describe("the application's own address", () => {
  it("uses the deployment's Vercel address outside production when none is configured", () => {
    const config = validateServerConfig({ ...base, APP_ENV: "staging", VERCEL_URL: "alpha-abc123-team.vercel.app" }, alpha);
    expect(config.NEXT_PUBLIC_APP_URL).toBe("https://alpha-abc123-team.vercel.app");
  });

  it("keeps an explicitly configured address", () => {
    const config = validateServerConfig({ ...base, APP_ENV: "staging", VERCEL_URL: "alpha-abc123-team.vercel.app", NEXT_PUBLIC_APP_URL: "https://alpha.example.nl" }, alpha);
    expect(config.NEXT_PUBLIC_APP_URL).toBe("https://alpha.example.nl");
  });

  it("never guesses production's address", () => {
    const config = validateServerConfig({ ...base, APP_ENV: "production", VERCEL_URL: "alpha-abc123-team.vercel.app" }, alpha);
    expect(config.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("stays local without Vercel", () => {
    expect(validateServerConfig({ ...base, APP_ENV: "development" }, alpha).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });
});
