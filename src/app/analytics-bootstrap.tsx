"use client";

import { useEffect } from "react";
import { initializePostHogBrowser } from "../lib/observability/posthog-browser";

export function AnalyticsBootstrap() {
  useEffect(() => { initializePostHogBrowser(); }, []);
  return null;
}
