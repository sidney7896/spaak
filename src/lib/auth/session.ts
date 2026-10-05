import { createServerSupabaseClient } from "../supabase/server";
import { projectProfile, type ProjectProfile } from "../profile";
import { registrySlug } from "../config/identity";

const ENVIRONMENT_CODES: Record<string, string> = { dev: "dev", development: "dev", stg: "stg", staging: "stg", prod: "prod", production: "prod", test: "dev" };

/** R4S-09: only an own key is an environment; `__proto__` and `toString` are not configuration. */
function environmentCode(appEnv: unknown): string | null {
  return typeof appEnv === "string" && Object.hasOwn(ENVIRONMENT_CODES, appEnv) ? ENVIRONMENT_CODES[appEnv] : null;
}

/**
 * One membership surface for both topologies (decision D-013).
 *
 * `public.launch_is_member(slug text, env text)` is SECURITY DEFINER with a pinned
 * search_path and reads `auth.uid()` itself, so a caller can only ever ask about
 * itself and the control-plane `registry` schema stays off the Data API. PostgREST
 * binds RPC arguments by name, so `slug` and `env` are part of the contract.
 *
 * - shared topology: the wrapper ships in the registry
 *   (`packages/registry/migrations/0009_adoption_enforcement_and_membership_wrapper.sql`)
 *   over `registry.app_memberships`.
 * - dedicated topology: the identical wrapper plus an application-owned
 *   `app_memberships` table ship in this project's own rendered migration
 *   (`supabase/migrations/0001_notes_and_private_storage.sql`).
 *
 * The wrapper lives in `public`, while the Supabase client is bound to the
 * application schema, so the call must select the schema explicitly. There is no
 * claim-based path: an `app_metadata` claim that nothing in the platform writes
 * used to make `--topology dedicated` deny every user (R3-01).
 */
export const MEMBERSHIP_SCHEMA = "public";
export const MEMBERSHIP_FUNCTION = "launch_is_member";

type MembershipClient = {
  schema: (schema: string) => { rpc: (name: string, args: Record<string, string>) => unknown };
};

export async function hasApplicationAccess(
  supabase: MembershipClient,
  user: { id: string } | null | undefined,
  profile: ProjectProfile = projectProfile,
): Promise<boolean> {
  if (profile.signupMode === "self-service") return true;
  if (!user?.id) return false;
  const slug = registrySlug(profile);
  if (slug === null) return false;
  const appEnv = environmentCode(process.env.APP_ENV ?? "");
  if (appEnv === null) return false;
  const { data, error } = await supabase
    .schema(MEMBERSHIP_SCHEMA)
    .rpc(MEMBERSHIP_FUNCTION, { slug, env: appEnv }) as { data: unknown; error: unknown };
  return error == null && data === true;
}

export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  return user;
}
