import { initializeSentry } from "./lib/observability/sentry";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") initializeSentry();
}
