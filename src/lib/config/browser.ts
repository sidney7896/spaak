import { z } from "zod";
import { projectProfile, type ProjectProfile } from "../profile";
import { bucketBindingError, environmentSuffix, schemaBindingError } from "./identity";

const required = (name: string) => z.string({ error: `${name} is required.` }).min(1, { error: `${name} is required.` });
const schemaName = (name: string) => z.string({ error: `${name} must be a valid Supabase schema name.` }).regex(/^app_[a-z][a-z0-9_]{1,30}_(dev|stg|prod)$/, { error: `${name} must match app_<slug>_<dev|stg|prod>.` });
const browserSchema = z.object({
  // R3-06: APP_ENV is server-only, so the browser bundle and the middleware need their own
  // build-stamped copy to bind the ENVIRONMENT as well as the application. It is optional so that
  // an older deployment keeps working, and the server config rejects any value that disagrees
  // with APP_ENV.
  NEXT_PUBLIC_APP_ENV: z.string().min(1).refine((value) => environmentSuffix(value) !== null, { error: "NEXT_PUBLIC_APP_ENV must be development, test, staging, or production." }).optional(),
  NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL").url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL." }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  NEXT_PUBLIC_SUPABASE_DB_SCHEMA: z.union([z.literal("public"), schemaName("NEXT_PUBLIC_SUPABASE_DB_SCHEMA")]).default("public"),
  NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url({ error: "NEXT_PUBLIC_POSTHOG_HOST must be a valid URL." }).optional(),
});

export type BrowserPublicConfig = z.infer<typeof browserSchema>;

export function getBrowserPublicConfig(profile: ProjectProfile = projectProfile): BrowserPublicConfig {
  const result = browserSchema.safeParse({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_DB_SCHEMA: process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA,
    NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
  if (!result.success) throw new Error(`Configuration validation failed: ${result.error.issues.map((issue) => issue.message).join(" ")}`);
  if (profile.topology === "shared" && result.data.NEXT_PUBLIC_SUPABASE_DB_SCHEMA === "public") throw new Error("Configuration validation failed: NEXT_PUBLIC_SUPABASE_DB_SCHEMA must be an app_<slug>_<dev|stg|prod> schema for shared topology.");
  if (profile.topology === "dedicated" && result.data.NEXT_PUBLIC_SUPABASE_DB_SCHEMA !== "public") throw new Error("Configuration validation failed: NEXT_PUBLIC_SUPABASE_DB_SCHEMA must be public for dedicated topology.");
  // With NEXT_PUBLIC_APP_ENV the browser bundle binds the application AND the environment; without
  // it the binding falls back to the application alone (documented in docs/auth-setup.md).
  const appEnv = result.data.NEXT_PUBLIC_APP_ENV;
  const bindingErrors = [
    schemaBindingError("NEXT_PUBLIC_SUPABASE_DB_SCHEMA", result.data.NEXT_PUBLIC_SUPABASE_DB_SCHEMA, profile, appEnv),
    bucketBindingError("NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET", result.data.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET, profile, appEnv),
  ].filter((message): message is string => message !== null);
  if (bindingErrors.length > 0) throw new Error(`Configuration validation failed: ${bindingErrors.join(" ")}`);
  return result.data;
}
