import * as Sentry from "@sentry/nextjs";
import { getServerConfig } from "../config";
import { isModuleEnabled } from "../profile";

export function initializeSentry() {
  if (!isModuleEnabled("sentry") || !process.env.SENTRY_DSN) return false;
  const config = getServerConfig();
  Sentry.init({ dsn: config.SENTRY_DSN, tracesSampleRate: 0.1 });
  return true;
}
