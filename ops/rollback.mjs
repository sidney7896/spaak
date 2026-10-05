#!/usr/bin/env node
// Application-only rollback to a known good deployment (the `rollback:app` script the canonical
// release workflow runs after a failed post-promotion health check).
//
// It never restores a database: --preserve-database is mandatory, and there is no code path here
// that touches Supabase, a snapshot or a migration. A rollback without a known good deployment id
// is refused, because rolling back to nothing is an incident, not a recovery.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEPLOYMENT_ID = /^[A-Za-z0-9_-]{6,128}$/;

export function parseArguments(argv) {
  const values = { preserveDatabase: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preserve-database") { values.preserveDatabase = true; continue; }
    if (token === "--deployment") { values.deployment = argv[++index]; continue; }
    throw new Error(`Invalid argument ${token}`);
  }
  return values;
}

/** The rollback this run would perform, or an exception naming exactly what is missing. */
export function rollbackRequest(values, environment = process.env) {
  if (!values.preserveDatabase) throw new Error("rollback:app must be called with --preserve-database; this lane never restores a database");
  const deployment = values.deployment;
  if (!deployment || deployment === "none") throw new Error("rollback:app requires --deployment <known good deployment id>; nothing was rolled back");
  if (!DEPLOYMENT_ID.test(deployment)) throw new Error(`rollback:app refused an implausible deployment id ${deployment}; nothing was rolled back`);
  if (!environment.VERCEL_TOKEN) throw new Error("rollback:app requires VERCEL_TOKEN; nothing was rolled back");
  return {
    method: "POST",
    url: `https://api.vercel.com/v9/deployments/${encodeURIComponent(deployment)}/promote`,
    deployment,
    preservesDatabase: true,
  };
}

async function main() {
  const request = rollbackRequest(parseArguments(process.argv.slice(2)));
  const response = await fetch(request.url, { method: request.method, headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } });
  if (!response.ok) throw new Error(`rollback:app failed with provider status ${response.status}; production is unchanged and this is an incident`);
  process.stdout.write(`rollback:app ok - production serves deployment ${request.deployment} again; the database was not touched\n`);
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
