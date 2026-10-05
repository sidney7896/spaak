import { MemoryStore } from "./memory-store";
import type { SpaakStore } from "./store";
import { createSpaakSupabaseClient } from "./supabase-client";
import { SupabaseStore } from "./supabase-store";

// Share stores across route bundles and development reloads in this process.
const shared = globalThis as typeof globalThis & { spaakMemoryStore?: MemoryStore; spaakSupabaseStore?: SupabaseStore };

function required(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_DB_SCHEMA"): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Spaak database store requires ${name}.`);
  return value;
}

export function getStore(): SpaakStore {
  const environment = process.env.APP_ENV;
  if (environment === "test" || (environment === "development" && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())) {
    shared.spaakMemoryStore ??= new MemoryStore();
    return shared.spaakMemoryStore;
  }
  if (!shared.spaakSupabaseStore) {
    const url = required("NEXT_PUBLIC_SUPABASE_URL");
    const key = required("SUPABASE_SERVICE_ROLE_KEY");
    const schema = required("SUPABASE_DB_SCHEMA");
    shared.spaakSupabaseStore = new SupabaseStore({ client: createSpaakSupabaseClient(url, key), schema });
  }
  return shared.spaakSupabaseStore;
}
