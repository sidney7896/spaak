#!/usr/bin/env node
// Bounded post-promotion health check (the `health:production` script the canonical release
// workflow runs after promotion). It writes health.json in exactly the shape
// ops/release/health-outputs.mjs requires, because an absent or malformed field there is turned
// into an incident rather than into a green run.
//
// The report builder is a pure function and is tested offline; the HTTP round trip is only
// exercised against a real deployment.
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const HEALTH_PATHS = ["/api/health", "/"];

export function parseArguments(argv) {
  const values = { bounded: false, maxRequests: 20, output: "health.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--bounded") { values.bounded = true; continue; }
    if (token === "--max-requests") {
      const raw = Number(argv[++index]);
      if (!Number.isInteger(raw) || raw < 1 || raw > 100) throw new Error("--max-requests must be an integer between 1 and 100");
      values.maxRequests = raw;
      continue;
    }
    if (token === "--output") { values.output = argv[++index]; continue; }
    if (token === "--url") { values.url = argv[++index]; continue; }
    throw new Error(`Invalid argument ${token}`);
  }
  if (!values.output) throw new Error("--output requires a file name");
  return values;
}

export function resolveTarget(values, environment = process.env) {
  const url = values.url ?? environment.PRODUCTION_HEALTH_URL;
  if (!url) throw new Error("health:production requires PRODUCTION_HEALTH_URL (or --url); nothing was checked");
  if (!values.bounded) throw new Error("health:production must be called with --bounded");
  return { url, maxRequests: values.maxRequests, output: values.output };
}

/**
 * Every field ops/release/health-outputs.mjs publishes, always present and always single-line.
 * `previous_release_id` is empty-string-free on purpose: "none" is a value the rollback contract
 * can reason about, an empty output is not.
 */
export function healthReport(results, context = {}) {
  const failed = results.filter((result) => result.status === null || result.status >= 500);
  return {
    failed_checks: failed.length,
    total_checks: results.length,
    consecutive_failures: Number(context.consecutiveFailures ?? failed.length),
    provider_outage: Boolean(context.providerOutage ?? false),
    previous_release_id: String(context.previousReleaseId ?? "none"),
    previous_release_compatible: Boolean(context.previousReleaseCompatible ?? false),
    checks: results,
  };
}

async function main() {
  const target = resolveTarget(parseArguments(process.argv.slice(2)));
  const base = new URL(target.url);
  const results = [];
  for (const path of HEALTH_PATHS.slice(0, target.maxRequests)) {
    const url = new URL(path, base).toString();
    try {
      const response = await fetch(url, { method: "GET", redirect: "manual" });
      results.push({ url, status: response.status });
    } catch (error) {
      results.push({ url, status: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const report = healthReport(results, {
    previousReleaseId: process.env.PREVIOUS_RELEASE_ID,
    previousReleaseCompatible: process.env.PREVIOUS_RELEASE_COMPATIBLE === "true",
    providerOutage: process.env.PROVIDER_OUTAGE === "true",
  });
  await writeFile(target.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`health:production - ${report.total_checks - report.failed_checks}/${report.total_checks} checks healthy, written to ${target.output}\n`);
  if (report.failed_checks > 0) process.exitCode = 1;
}

// R8REL-01: this script decides FOR ITSELF, by real path, whether it was invoked as a script -
// there is no shared helper whose single return value could silence all six project ops scripts at
// once. Real paths, because a plain comparison of `import.meta.url` with `process.argv[1]` is false
// under a symlinked checkout (macOS /var -> /private/var) and the script then exits 0 having run
// nothing. `ops/release/release-controls.test.mjs` runs this script against an input it must refuse.
function invokedAsScript(moduleUrl) {
  const invoked = process.argv[1];
  if (typeof invoked !== "string" || invoked.length === 0) return false;
  const real = (value) => {
    try {
      return realpathSync(value);
    } catch {
      return value;
    }
  };
  return real(fileURLToPath(moduleUrl)) === real(invoked);
}

if (invokedAsScript(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
