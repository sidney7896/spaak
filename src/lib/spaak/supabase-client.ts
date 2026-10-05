import { createClient } from "@supabase/supabase-js";
import type { RpcClient } from "./supabase-store";

// Server use only: the service key must never enter a browser client or component.
export function createSpaakSupabaseClient(url: string, serviceKey: string): RpcClient {
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    schema: (name) => ({
      rpc: async (fn, args) => {
        const { data, error } = await client.schema(name).rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
    }),
  };
}
