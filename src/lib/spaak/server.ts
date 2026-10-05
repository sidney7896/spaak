import { MemoryStore } from "./memory-store";
import type { SpaakStore } from "./store";

// Share the trial store across route bundles and development reloads in this process.
const shared = globalThis as typeof globalThis & { spaakMemoryStore?: MemoryStore };

export function getStore(): SpaakStore {
  const environment = process.env.APP_ENV;
  if (environment !== undefined && environment !== "development" && environment !== "test") {
    throw new Error("Spaak store not configured for this environment");
  }
  shared.spaakMemoryStore ??= new MemoryStore();
  return shared.spaakMemoryStore;
}
