import { PostHog } from "posthog-node";
import { getServerConfig } from "../config";
import { isModuleEnabled } from "../profile";
import type { ProjectProfile } from "../profile";

export function createPostHogServer(consent: boolean, profile?: ProjectProfile) {
  const environmentKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (consent === false || !isModuleEnabled("analytics", profile) || typeof environmentKey !== "string" || environmentKey.length === 0) return null;
  const config = getServerConfig();
  const configuredKey = config.NEXT_PUBLIC_POSTHOG_KEY;
  if (typeof configuredKey !== "string" || configuredKey.length === 0) return null;
  return new PostHog(configuredKey, { host: config.NEXT_PUBLIC_POSTHOG_HOST });
}

export function analyticsAllowed(consent: boolean): boolean { return consent && isModuleEnabled("analytics"); }
