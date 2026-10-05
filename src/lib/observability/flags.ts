type FlagClient = { getFeatureFlag?: (key: string, distinctId?: string) => Promise<unknown> | unknown };

export async function getFeatureFlag(key: string, fallback: boolean, client?: FlagClient, distinctId?: string): Promise<boolean> {
  if (!client?.getFeatureFlag) return fallback;
  try { const value = await client.getFeatureFlag(key, distinctId); return typeof value === "boolean" ? value : fallback; } catch { return fallback; }
}
