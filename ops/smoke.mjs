#!/usr/bin/env node
// Bounded, read-only smoke check against a deployed environment (the `smoke:production` script the
// canonical release workflow runs before promotion).
//
// The request plan and the verdict are pure functions and are tested offline; the HTTP round trip
// itself is only exercised against a real deployment. Nothing here writes: a run without
// --read-only is refused rather than silently performing writes.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SMOKE_PATHS = ["/api/health", "/", "/sign-in"];

export function parseArguments(argv) {
  const values = { readOnly: false, maxRequests: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--read-only") { values.readOnly = true; continue; }
    if (token === "--max-requests") {
      const raw = Number(argv[++index]);
      if (!Number.isInteger(raw) || raw < 1 || raw > 100) throw new Error("--max-requests must be an integer between 1 and 100");
      values.maxRequests = raw;
      continue;
    }
    if (token === "--url") { values.url = argv[++index]; continue; }
    throw new Error(`Invalid argument ${token}`);
  }
  return values;
}

/** The exact request list a run will make: read-only, bounded, and never off the target origin. */
export function smokePlan(baseUrl, maxRequests = 20) {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("the smoke target must be an http(s) URL");
  return SMOKE_PATHS.slice(0, maxRequests).map((path) => ({ method: "GET", url: new URL(path, base).toString() }));
}

/** A check passes on any non-server-error status: a 401 from a protected path is a working app. */
export function evaluateSmoke(results) {
  const failures = results.filter((result) => result.status === null || result.status >= 500);
  return { total: results.length, failed: failures.length, ok: failures.length === 0 && results.length > 0, failures: failures.map((failure) => failure.url) };
}

export function resolveTarget(values, environment = process.env) {
  const url = values.url ?? environment.PRODUCTION_SMOKE_URL;
  if (!url) throw new Error("smoke:production requires PRODUCTION_SMOKE_URL (or --url); nothing was checked");
  if (!values.readOnly) throw new Error("smoke:production must be called with --read-only");
  return { url, maxRequests: values.maxRequests };
}

async function main() {
  const target = resolveTarget(parseArguments(process.argv.slice(2)));
  const plan = smokePlan(target.url, target.maxRequests);
  const results = [];
  for (const request of plan) {
    try {
      const response = await fetch(request.url, { method: request.method, redirect: "manual" });
      results.push({ url: request.url, status: response.status });
    } catch (error) {
      results.push({ url: request.url, status: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const verdict = evaluateSmoke(results);
  process.stdout.write(`smoke:production ${verdict.ok ? "ok" : "failed"} - ${verdict.total - verdict.failed}/${verdict.total} read-only checks passed\n`);
  if (!verdict.ok) {
    for (const failure of verdict.failures) process.stderr.write(`unhealthy: ${failure}\n`);
    process.exitCode = 1;
  }
}

// R8REL-01: this script decides FOR ITSELF, by real path, whether it was invoked as a script.
// Until the eighth review all six project ops scripts imported one shared helper, so a single
// `return false` in that one module silenced the pre-promotion smoke, the post-promotion
// health, the promotion, the rollback and the `migrations` and `operational_readiness` gates in one
// diff, in a file under no code-owner path and covered by no delivered test. There is no shared
// helper any more, `ops/` is a code-owner path of the delivered branch-protection plan, and
// `ops/release/release-controls.test.mjs` runs every project ops script against an input it must
// refuse - so a script that stops checking turns this project's own CI red.
//
// It compares REAL paths: `import.meta.url === file://${process.argv[1]}` silently evaluates to
// false when the checkout path contains a symlink (macOS /var -> /private/var, a symlinked worktree
// or CI workspace), because import.meta.url is the resolved real path while argv[1] is the path as
// typed. A script guarded that way runs nothing and exits 0.
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
