import type { ProjectProfile } from "../profile";

/**
 * Identity binding for this generated project.
 *
 * The Supabase schema and the private Storage bucket carry the application
 * identity. Accepting another application's valid-looking schema or bucket
 * would route every server client and every upload into that application's
 * namespace, so both are derived from the canonical slug in
 * `project.profile.json` plus `APP_ENV` and any configured value must match.
 */

const suffixByEnvironment: Record<string, "dev" | "stg" | "prod"> = {
  dev: "dev",
  development: "dev",
  test: "dev",
  stg: "stg",
  staging: "stg",
  prod: "prod",
  production: "prod",
};

export const SCHEMA_IDENTITY_SETTINGS = ["SUPABASE_DB_SCHEMA", "NEXT_PUBLIC_SUPABASE_DB_SCHEMA"] as const;
export const BUCKET_IDENTITY_SETTINGS = ["SUPABASE_STORAGE_BUCKET", "NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET"] as const;

/**
 * R4S-09: a plain object literal answers for every `Object.prototype` name, so `__proto__` or
 * `toString` used to look like a configured environment. Only an own key is an environment.
 */
export function environmentSuffix(appEnv: unknown): "dev" | "stg" | "prod" | null {
  if (typeof appEnv !== "string") return null;
  const name = appEnv.trim();
  return Object.hasOwn(suffixByEnvironment, name) ? suffixByEnvironment[name] : null;
}

/** The canonical underscore slug the generator writes into the profile, or null when the template is unconfigured. */
export function registrySlug(profile: ProjectProfile): string | null {
  const slug = profile.slug?.trim().replaceAll("-", "_") ?? "";
  return /^[a-z][a-z0-9_]{1,30}$/.test(slug) ? slug : null;
}

/** The hyphenated slug used in Storage bucket names. */
export function storageSlug(profile: ProjectProfile): string | null {
  const slug = registrySlug(profile);
  return slug === null ? null : slug.replaceAll("_", "-");
}

export function expectedSchemaName(profile: ProjectProfile, appEnv: unknown): string | null {
  if (profile.topology === "dedicated") return "public";
  const slug = registrySlug(profile);
  const suffix = environmentSuffix(appEnv);
  return slug === null || suffix === null ? null : `app_${slug}_${suffix}`;
}

export function expectedBucketName(profile: ProjectProfile, appEnv: unknown): string | null {
  const slug = storageSlug(profile);
  const suffix = environmentSuffix(appEnv);
  return slug === null || suffix === null ? null : `${slug}-${suffix}-private`;
}

/** Returns the exact rejection message for a schema that does not belong to this project, or null when acceptable. */
export function schemaBindingError(name: string, value: unknown, profile: ProjectProfile, appEnv: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (profile.topology === "dedicated") return null;
  const slug = registrySlug(profile);
  if (slug === null) return null;
  const expected = expectedSchemaName(profile, appEnv);
  if (expected !== null) {
    return value === expected ? null : `${name} must be ${expected} for project ${slug} in ${String(appEnv)}; received ${value}.`;
  }
  return new RegExp(`^app_${slug}_(dev|stg|prod)$`).test(value)
    ? null
    : `${name} must match app_${slug}_<dev|stg|prod> for project ${slug}; received ${value}.`;
}

/** Returns the exact rejection message for a bucket that does not belong to this project, or null when acceptable. */
export function bucketBindingError(name: string, value: unknown, profile: ProjectProfile, appEnv: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const project = registrySlug(profile);
  const slug = storageSlug(profile);
  if (project === null || slug === null) return null;
  const expected = expectedBucketName(profile, appEnv);
  if (expected !== null) {
    return value === expected ? null : `${name} must be ${expected} for project ${project} in ${String(appEnv)}; received ${value}.`;
  }
  return new RegExp(`^${slug}-(dev|stg|prod)-private$`).test(value)
    ? null
    : `${name} must match ${slug}-<dev|stg|prod>-private for project ${project}; received ${value}.`;
}

/**
 * R3-06: `NEXT_PUBLIC_APP_ENV` is the build-stamped copy of `APP_ENV` that the browser bundle and
 * the middleware can see. It is optional, but a value that disagrees with the server's `APP_ENV`
 * means the public bundle was built for another environment, which is never acceptable.
 */
export function publicEnvironmentError(publicAppEnv: unknown, appEnv: unknown): string | null {
  if (typeof publicAppEnv !== "string" || publicAppEnv.length === 0) return null;
  const publicSuffix = environmentSuffix(publicAppEnv);
  if (publicSuffix === null) return `NEXT_PUBLIC_APP_ENV must be development, test, staging, or production; received ${publicAppEnv}.`;
  const serverSuffix = environmentSuffix(appEnv);
  if (serverSuffix === null) return null;
  return publicSuffix === serverSuffix ? null : `NEXT_PUBLIC_APP_ENV and APP_ENV must describe the same environment; received ${publicAppEnv} and ${String(appEnv)}.`;
}

/** Every identity error for the given raw settings: cross-app values and public/server disagreement. */
export function identityBindingErrors(values: Record<string, unknown>, profile: ProjectProfile, appEnv: unknown): string[] {
  const errors: string[] = [];
  const publicEnvironment = publicEnvironmentError(values.NEXT_PUBLIC_APP_ENV, appEnv);
  if (publicEnvironment !== null) errors.push(publicEnvironment);
  for (const name of SCHEMA_IDENTITY_SETTINGS) {
    const error = schemaBindingError(name, values[name], profile, appEnv);
    if (error !== null) errors.push(error);
  }
  for (const name of BUCKET_IDENTITY_SETTINGS) {
    const error = bucketBindingError(name, values[name], profile, appEnv);
    if (error !== null) errors.push(error);
  }
  for (const [server, browser] of [SCHEMA_IDENTITY_SETTINGS, BUCKET_IDENTITY_SETTINGS]) {
    const serverValue = values[server];
    const browserValue = values[browser];
    if (typeof serverValue === "string" && typeof browserValue === "string" && serverValue !== browserValue) {
      errors.push(`${server} and ${browser} must be identical; received ${serverValue} and ${browserValue}.`);
    }
  }
  return errors;
}

/** Fills absent identity settings from the profile so a generated project cannot silently start on a foreign namespace. */
export function withDerivedIdentity(values: Record<string, unknown>, profile: ProjectProfile, appEnv: unknown): Record<string, unknown> {
  if (registrySlug(profile) === null) return values;
  const derived = { ...values };
  const schema = expectedSchemaName(profile, appEnv);
  const bucket = expectedBucketName(profile, appEnv);
  if (schema !== null) for (const name of SCHEMA_IDENTITY_SETTINGS) if (derived[name] === undefined) derived[name] = schema;
  if (bucket !== null) for (const name of BUCKET_IDENTITY_SETTINGS) if (derived[name] === undefined) derived[name] = bucket;
  return derived;
}
