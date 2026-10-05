"use client";

import { useEffect } from "react";
import { isModuleEnabled } from "../lib/profile";

function analyticsConsent(): boolean {
  return typeof document !== "undefined" && document.cookie.split(";").some((cookie) => cookie.trim() === "analytics_consent=granted");
}

export function AnalyticsBootstrap() {
  useEffect(() => {
    if (!isModuleEnabled("analytics")) return;
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (!analyticsConsent()) return;

    void import("../lib/observability/posthog-browser")
      .then(({ initializePostHogBrowser }) => initializePostHogBrowser())
      .catch(() => undefined);
  }, []);
  return null;
}
