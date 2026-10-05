"use client";

import posthog from "posthog-js";
import { getBrowserPublicConfig } from "../config/browser";
import { isModuleEnabled } from "../profile";

export function analyticsConsent(): boolean {
  return typeof document !== "undefined" && document.cookie.split(";").some((cookie) => cookie.trim() === "analytics_consent=granted");
}

export function initializePostHogBrowser(): boolean {
  if (!isModuleEnabled("analytics") || !analyticsConsent()) return false;
  const config = getBrowserPublicConfig();
  if (!config.NEXT_PUBLIC_POSTHOG_KEY || !config.NEXT_PUBLIC_POSTHOG_HOST) return false;
  posthog.init(config.NEXT_PUBLIC_POSTHOG_KEY, { api_host: config.NEXT_PUBLIC_POSTHOG_HOST });
  return true;
}
