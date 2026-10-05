#!/usr/bin/env node
// Promote an already verified build to production (the `promote:production` script the canonical
// release workflow runs, and the single production promotion owner).
//
// This script refuses to create anything: it promotes a build the release workflow already gated
// and verified. Without --verified-build, without a deployment provider token, or with domain
// assignment requested it stops and applies nothing, so a misconfigured job can never promote.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function parseArguments(argv) {
  const values = { verifiedBuild: false, noDomainAssignment: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--verified-build") { values.verifiedBuild = true; continue; }
    if (token === "--no-domain-assignment") { values.noDomainAssignment = true; continue; }
    if (token === "--deployment") { values.deployment = argv[++index]; continue; }
    throw new Error(`Invalid argument ${token}`);
  }
  return values;
}

/** The promotion this run would perform, or an exception naming exactly what is missing. */
export function promotionRequest(values, environment = process.env) {
  if (!values.verifiedBuild) throw new Error("promote:production must be called with --verified-build; nothing was promoted");
  if (!values.noDomainAssignment) throw new Error("promote:production must be called with --no-domain-assignment; domain assignment is an operator action");
  const token = environment.VERCEL_TOKEN;
  const projectId = environment.VERCEL_PROJECT_ID;
  if (!token) throw new Error("promote:production requires VERCEL_TOKEN; nothing was promoted");
  if (!projectId) throw new Error("promote:production requires VERCEL_PROJECT_ID; nothing was promoted");
  const deployment = values.deployment ?? environment.VERCEL_DEPLOYMENT_ID;
  if (!deployment) throw new Error("promote:production requires --deployment or VERCEL_DEPLOYMENT_ID identifying the verified build; nothing was promoted");
  return {
    method: "PATCH",
    url: `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deployment)}`,
    projectId,
    deployment,
    assignsDomain: false,
  };
}

async function main() {
  const request = promotionRequest(parseArguments(process.argv.slice(2)));
  const response = await fetch(request.url, { method: request.method, headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } });
  if (!response.ok) throw new Error(`promote:production failed with provider status ${response.status}; the previous production release is unchanged`);
  process.stdout.write(`promote:production ok - deployment ${request.deployment} promoted for project ${request.projectId} without domain assignment\n`);
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
