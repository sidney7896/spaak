import { describe, expect, it } from "vitest";
import { validatePublicConfig, validateServerConfig } from "../../src/lib/config";
import { expectedBucketName, expectedSchemaName, identityBindingErrors, publicEnvironmentError } from "../../src/lib/config/identity";

const alpha = { topology: "shared", slug: "alpha_app", modules: {} } as never;
const base = {
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-placeholder",
};

describe("this project's environment settings belong to this project", () => {
  it("derives the schema and bucket from the profile slug plus APP_ENV", () => {
    expect(expectedSchemaName(alpha, "production")).toBe("app_alpha_app_prod");
    expect(expectedBucketName(alpha, "staging")).toBe("alpha-app-stg-private");
    const derived = validateServerConfig(base, alpha);
    expect(derived.SUPABASE_DB_SCHEMA).toBe("app_alpha_app_prod");
    expect(derived.NEXT_PUBLIC_SUPABASE_DB_SCHEMA).toBe("app_alpha_app_prod");
  });

  it("rejects another application's and another environment's schema", () => {
    expect(() => validateServerConfig({ ...base, SUPABASE_DB_SCHEMA: "app_beta_app_prod", NEXT_PUBLIC_SUPABASE_DB_SCHEMA: "app_beta_app_prod" }, alpha))
      .toThrow("SUPABASE_DB_SCHEMA must be app_alpha_app_prod for project alpha_app in production; received app_beta_app_prod.");
    expect(() => validateServerConfig({ ...base, APP_ENV: "staging", SUPABASE_DB_SCHEMA: "app_alpha_app_prod", NEXT_PUBLIC_SUPABASE_DB_SCHEMA: "app_alpha_app_prod" }, alpha))
      .toThrow("SUPABASE_DB_SCHEMA must be app_alpha_app_stg for project alpha_app in staging; received app_alpha_app_prod.");
  });

  it("requires the server and public copies of an identity setting to agree", () => {
    expect(() => validateServerConfig({ ...base, SUPABASE_DB_SCHEMA: "app_alpha_app_prod", NEXT_PUBLIC_SUPABASE_DB_SCHEMA: "app_alpha_app_stg" }, alpha))
      .toThrow("must be identical");
  });

  it("refuses a public bundle stamped for another environment than the server", () => {
    expect(publicEnvironmentError("production", "production")).toBeNull();
    expect(publicEnvironmentError("prod", "production")).toBeNull();
    expect(publicEnvironmentError("staging", "production"))
      .toBe("NEXT_PUBLIC_APP_ENV and APP_ENV must describe the same environment; received staging and production.");
    expect(identityBindingErrors({ NEXT_PUBLIC_APP_ENV: "qa" }, alpha, "production"))
      .toContain("NEXT_PUBLIC_APP_ENV must be development, test, staging, or production; received qa.");
    expect(() => validatePublicConfig({ ...base, NEXT_PUBLIC_APP_ENV: "staging" }, alpha))
      .toThrow("NEXT_PUBLIC_APP_ENV and APP_ENV must describe the same environment; received staging and production.");
  });

  it("keeps the shared and dedicated schema rules apart", () => {
    expect(() => validateServerConfig({ ...base, SUPABASE_DB_SCHEMA: "public", NEXT_PUBLIC_SUPABASE_DB_SCHEMA: "public" }, alpha))
      .toThrow("SUPABASE_DB_SCHEMA must be app_alpha_app_prod for project alpha_app in production; received public.");
    expect(() => validateServerConfig({ ...base, SUPABASE_DB_SCHEMA: "public", NEXT_PUBLIC_SUPABASE_DB_SCHEMA: "public" }, { topology: "shared", slug: null, modules: {} } as never))
      .toThrow("must be an app_<slug>_<dev|stg|prod> schema for shared topology");
    const dedicated = { topology: "dedicated", slug: "alpha_app", modules: {} } as never;
    expect(validateServerConfig(base, dedicated).SUPABASE_DB_SCHEMA).toBe("public");
  });
});
