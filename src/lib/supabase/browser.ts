import { createBrowserClient } from "@supabase/ssr";
import { getBrowserPublicConfig } from "../config/browser";

export function createBrowserSupabaseClient() {
  const config = getBrowserPublicConfig();
  return createBrowserClient(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY, { db: { schema: config.NEXT_PUBLIC_SUPABASE_DB_SCHEMA } });
}
