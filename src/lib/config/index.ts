import { z } from "zod";
import { isModuleEnabled, projectProfile, type ProjectProfile } from "../profile";
import { getBrowserPublicConfig, type BrowserPublicConfig } from "./browser";
import { identityBindingErrors, withDerivedIdentity } from "./identity";

export { getBrowserPublicConfig } from "./browser";
export type { BrowserPublicConfig } from "./browser";
export { expectedBucketName, expectedSchemaName } from "./identity";

const required = (name: string) => z.string({ error: `${name} is required.` }).min(1, { error: `${name} is required.` });
const schemaName = (name: string) => z.string({ error: `${name} must be a valid Supabase schema name.` }).regex(/^app_[a-z][a-z0-9_]{1,30}_(dev|stg|prod)$/, { error: `${name} must match app_<slug>_<dev|stg|prod>.` });
const schemaSetting = (name: string) => z.union([z.literal("public"), schemaName(name)]).default("public");

const publicSchema = z.object({
  APP_ENV: required("APP_ENV").refine((value) => ["development", "test", "staging", "production"].includes(value), { error: "APP_ENV must be development, test, staging, or production." }),
  NEXT_PUBLIC_APP_ENV: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url({ error: "NEXT_PUBLIC_APP_URL must be a valid URL." }).default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL").url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL." }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  NEXT_PUBLIC_SUPABASE_DB_SCHEMA: schemaSetting("NEXT_PUBLIC_SUPABASE_DB_SCHEMA"),
  NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url({ error: "NEXT_PUBLIC_POSTHOG_HOST must be a valid URL." }).optional(),
});

const serverSchema = publicSchema.extend({
  SUPABASE_DB_SCHEMA: schemaSetting("SUPABASE_DB_SCHEMA"),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url({ error: "SENTRY_DSN must be a valid URL." }).optional(),
  RESEND_API_KEY: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  PAYMENTS_API_KEY: z.string().optional(),
});

export type PublicConfig = z.infer<typeof publicSchema>;
export type ServerConfig = z.infer<typeof serverSchema>;

const environmentSuffix: Record<string, string> = { development: "dev", staging: "stg", production: "prod", test: "dev" };

type StorageConfig = Pick<PublicConfig, "APP_ENV" | "NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET"> & { SUPABASE_STORAGE_BUCKET?: string };

export function privateStorageBucketName(config: StorageConfig = getServerConfig()): string {
  if (config.SUPABASE_STORAGE_BUCKET) return config.SUPABASE_STORAGE_BUCKET;
  if (config.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET) return config.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET;
  const slug = projectProfile.slug?.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").replaceAll("_", "-") || "project-starter";
  return `${slug}-${environmentSuffix[config.APP_ENV] ?? "dev"}-private`;
}

function enabledModuleRequirements(values: Record<string, unknown>, profile: ProjectProfile): Record<string, string> {
  const required: Record<string, string> = {};
  if (isModuleEnabled("analytics", profile)) {
    if (!values.NEXT_PUBLIC_POSTHOG_KEY) required.NEXT_PUBLIC_POSTHOG_KEY = "NEXT_PUBLIC_POSTHOG_KEY is required when analytics is enabled.";
    if (!values.NEXT_PUBLIC_POSTHOG_HOST) required.NEXT_PUBLIC_POSTHOG_HOST = "NEXT_PUBLIC_POSTHOG_HOST is required when analytics is enabled.";
  }
  if (isModuleEnabled("sentry", profile) && !values.SENTRY_DSN) required.SENTRY_DSN = "SENTRY_DSN is required when sentry is enabled.";
  if (isModuleEnabled("email", profile) && !values.RESEND_API_KEY) required.RESEND_API_KEY = "RESEND_API_KEY is required when email is enabled.";
  if (isModuleEnabled("ai", profile) && !values.AI_API_KEY) required.AI_API_KEY = "AI_API_KEY is required when ai is enabled.";
  if (isModuleEnabled("payments", profile) && !values.PAYMENTS_API_KEY) required.PAYMENTS_API_KEY = "PAYMENTS_API_KEY is required when payments is enabled.";
  return required;
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: Record<string, unknown>, profile: ProjectProfile): T {
  const appEnv = input.APP_ENV === "dev" ? "development" : input.APP_ENV;
  // A Vercel preview gets a new address per deployment; outside production it falls back to its own
  // VERCEL_URL (set by Vercel, never by a request). Production always needs an explicit NEXT_PUBLIC_APP_URL.
  const ownUrl = !input.NEXT_PUBLIC_APP_URL && appEnv !== "production" && typeof input.VERCEL_URL === "string" && input.VERCEL_URL
    ? { NEXT_PUBLIC_APP_URL: `https://${input.VERCEL_URL}` }
    : {};
  const normalizedInput = withDerivedIdentity({ ...input, ...ownUrl, APP_ENV: appEnv }, profile, appEnv);
  const result = schema.safeParse(normalizedInput);
  const moduleErrors = enabledModuleRequirements(input, profile);
  const bindingErrors = identityBindingErrors(normalizedInput, profile, appEnv);
  if (!result.success || Object.keys(moduleErrors).length > 0 || bindingErrors.length > 0) {
    const errors = result.success ? [] : result.error.issues.map((issue) => issue.message);
    errors.push(...bindingErrors, ...Object.values(moduleErrors));
    throw new Error(`Configuration validation failed: ${errors.join(" ")}`);
  }
  const parsed = result.data as T & Record<string, unknown>;
  for (const name of ["SUPABASE_DB_SCHEMA", "NEXT_PUBLIC_SUPABASE_DB_SCHEMA"]) {
    const value = parsed[name];
    if (value === undefined) continue;
    if (profile.topology === "shared" && value === "public") throw new Error(`Configuration validation failed: ${name} must be an app_<slug>_<dev|stg|prod> schema for shared topology.`);
    if (profile.topology === "dedicated" && value !== "public") throw new Error(`Configuration validation failed: ${name} must be public for dedicated topology.`);
  }
  return parsed;
}

export function validatePublicConfig(input: Record<string, unknown> = process.env, profile: ProjectProfile = projectProfile): PublicConfig {
  return parseOrThrow(publicSchema, input, profile);
}

export function validateServerConfig(input: Record<string, unknown> = process.env, profile: ProjectProfile = projectProfile): ServerConfig {
  return parseOrThrow(serverSchema, input, profile);
}

export function getPublicConfig(profile: ProjectProfile = projectProfile): PublicConfig {
  return validatePublicConfig(process.env, profile);
}

export function getServerConfig(profile: ProjectProfile = projectProfile): ServerConfig {
  return validateServerConfig(process.env, profile);
}
