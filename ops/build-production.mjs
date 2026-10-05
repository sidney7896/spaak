#!/usr/bin/env node
// Production-configured build without domain assignment, and the CANDIDATE deployment the release
// path promotes (the `build:production` script the canonical release workflow runs).
//
// `next build` does not know --no-domain-assignment, so the workflow's flag needs an owner: this
// wrapper consumes it, asserts that the build really is the production one, and only then runs the
// ordinary build. Promotion and domain assignment stay with promote:production.
//
// R4-03 (release lane request #1). `production-build` calls this script with
// `--deployment-url-file candidate-deployment.json` and then runs `ops/release/record-deployment.mjs`
// over that file to publish `deployment_url` / `deployment_id` as job outputs; `smoke` targets that
// URL and `promote-production` promotes that id. Until this script created the deployment there was
// no such deployment at all: the smoke gate exercised the still-live previous production and
// `promote:production` was called without the `--deployment` it requires.
//
// The record this script writes is the contract at the top of `ops/release/record-deployment.mjs`:
//   { "url": "https://<candidate deployment host>", "id": "<provider deployment id>" }
//
// Three properties hold by construction here:
//   - the candidate is created by the project's documented deploy command, behind an injectable
//     runner, so the offline tests drive a fake runner and no test ever contacts a provider;
//   - without a deploy credential the script fails closed with a named error and writes NO record,
//     so a build that could not deploy fails the release instead of handing the smoke gate a URL
//     nobody verified;
//   - the deploy command carries `--skip-domain` and never promotes: assigning production traffic
//     is promote:production's decision, taken after the smoke gate, and nowhere else.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The documented deploy command: a production-configured deployment that assigns no domain. */
export const DEPLOY_ARGUMENTS = ["deploy", "--prod", "--skip-domain", "--yes"];
/** The documented lookup that turns the deployment URL into the id promote:production needs. */
export const INSPECT_ARGUMENTS = ["inspect"];
/** A provider deployment id as the deploy provider spells it. */
const DEPLOYMENT_ID = /\bdpl_[A-Za-z0-9]{6,}\b/;
const HOSTNAME = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

export function parseArguments(argv) {
  const values = { noDomainAssignment: false, deploymentUrlFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--no-domain-assignment") { values.noDomainAssignment = true; continue; }
    if (token === "--deployment-url-file") {
      const path = argv[index + 1];
      if (typeof path !== "string" || path.trim() === "" || path.startsWith("--")) {
        throw new Error("build:production --deployment-url-file requires a path; no candidate deployment was created");
      }
      values.deploymentUrlFile = path;
      index += 1;
      continue;
    }
    throw new Error(`Invalid argument ${token}`);
  }
  return values;
}

export function buildPlan(values, environment = process.env) {
  if (!values.noDomainAssignment) throw new Error("build:production must be called with --no-domain-assignment; this build never assigns a domain");
  if (environment.APP_ENV !== "production") throw new Error(`build:production requires APP_ENV=production; received ${environment.APP_ENV ?? "nothing"}`);
  return { command: environment.LAUNCH_NEXT ?? "next", args: ["build"], assignsDomain: false };
}

/**
 * The deployment this run would create, or an exception naming exactly which credential is missing.
 * The token is NEVER placed in the argument list (R4S-10: argv is readable by every other process
 * on the host); the deploy command reads it from the environment it inherits.
 */
export function deploymentPlan(values, environment = process.env) {
  if (!values.noDomainAssignment) throw new Error("build:production must be called with --no-domain-assignment; this build never assigns a domain");
  for (const name of ["VERCEL_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID"]) {
    const value = environment[name];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`build:production requires ${name} to create the candidate deployment; nothing was deployed and no deployment record was written`);
    }
  }
  const command = environment.LAUNCH_VERCEL ?? "vercel";
  return {
    command,
    deployArguments: [...DEPLOY_ARGUMENTS],
    inspectArguments: [...INSPECT_ARGUMENTS],
    assignsDomain: false,
    promotes: false,
  };
}

/**
 * The candidate deployment URL the deploy command reported. The documented behaviour is that the
 * deployment URL is the command's stdout; progress goes to stderr. A stdout this cannot read as an
 * https URL is a refusal, never a guess: the smoke gate must target the deployment that was just
 * created or nothing at all.
 */
export function deploymentUrlFrom(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const last = lines[lines.length - 1];
  if (last === undefined) throw new Error("build:production: the deploy command printed no deployment URL; no deployment record was written");
  // A line that carries a scheme is parsed as written, so an http candidate is refused as "not
  // https" rather than as "not a URL"; a bare host is the other documented spelling.
  const spelled = /^[a-z][a-z0-9+.-]*:\/\//i.test(last) ? last : (HOSTNAME.test(last) ? `https://${last}` : null);
  if (spelled === null) throw new Error(`build:production: the deploy command's last output line is not a deployment URL (${last.slice(0, 60)}); no deployment record was written`);
  let url;
  try {
    url = new URL(spelled);
  } catch {
    throw new Error(`build:production: the deploy command's last output line is not a deployment URL (${last.slice(0, 60)}); no deployment record was written`);
  }
  if (url.protocol !== "https:") throw new Error(`build:production: the candidate deployment URL must be https (${url.protocol}//); no deployment record was written`);
  return url.origin;
}

/** The provider deployment id promote:production promotes, read from the documented lookup. */
export function deploymentIdFrom(output) {
  const match = DEPLOYMENT_ID.exec(String(output ?? ""));
  if (match === null) throw new Error("build:production: the deployment lookup reported no deployment id; promote:production would have nothing to promote, so no deployment record was written");
  return match[0];
}


const spawnRunner = (command, args, options) => spawnSync(command, args, { encoding: "utf8", shell: false, ...options });

/**
 * Create the candidate deployment and return the record. Every failure - a runner that cannot
 * start, a non-zero exit, unreadable output - throws, so the caller never writes a record for a
 * deployment that may not exist.
 */
export function createCandidateDeployment(values, environment = process.env, run = spawnRunner) {
  const plan = deploymentPlan(values, environment);
  const deployed = run(plan.command, plan.deployArguments, { env: environment });
  if (deployed.error) throw new Error(`build:production could not start ${plan.command} (${deployed.error.message}); no candidate deployment was created`);
  if (deployed.status !== 0) throw new Error(`build:production could not create the candidate deployment (${plan.command} exited ${deployed.status}); nothing was deployed and no deployment record was written`);
  const url = deploymentUrlFrom(deployed.stdout);
  const inspected = run(plan.command, [...plan.inspectArguments, url], { env: environment });
  if (inspected.error) throw new Error(`build:production could not start ${plan.command} (${inspected.error.message}); the candidate deployment exists but was not recorded`);
  if (inspected.status !== 0) throw new Error(`build:production could not identify the candidate deployment (${plan.command} exited ${inspected.status}); no deployment record was written`);
  // R7REL-04: this writes BOTH halves of the pair, and the `smoke` job re-binds them before it
  // smokes anything (`ops/release/record-deployment.mjs --verify-binding` resolves the id through
  // the provider CLI and refuses a URL the provider does not report for it). Resolving the id back
  // to its URL here as well would be one lookup stronger; it needs a fixture change in
  // starter/tests/ops-scripts.test.mjs, which is outside this packet's owned paths, so
  // ops/release/WORKER-REPORT.md carries it as a request to the orchestrator rather than a claim.
  return { url, id: deploymentIdFrom(`${inspected.stdout ?? ""}\n${inspected.stderr ?? ""}`) };
}

/**
 * Write the record `ops/release/record-deployment.mjs` reads. A record left behind by an earlier
 * attempt is removed BEFORE the deploy command runs, so a failed run can never leave a previous
 * candidate in place for the smoke gate to verify and the promotion to promote.
 */
export function writeCandidateDeployment(path, record) {
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

// R7REL-02: this CLI decides FOR ITSELF, by real path, whether it was invoked as a script, instead
// of importing a shared helper whose single return value could switch it - and every other guarded
// CLI - to a silent exit 0.
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
    const values = parseArguments(process.argv.slice(2));
    const plan = buildPlan(values);
    const recordPath = values.deploymentUrlFile === null ? null : resolve(values.deploymentUrlFile);
    if (recordPath !== null && existsSync(recordPath)) rmSync(recordPath, { force: true });
    const result = spawnSync(plan.command, plan.args, { stdio: "inherit", shell: false });
    if (result.error) throw new Error(`build:production could not start ${plan.command} (${result.error.message})`);
    if (result.status !== 0) throw new Error(`build:production failed (${plan.command} exited ${result.status})`);
    if (recordPath === null) {
      process.stdout.write("build:production ok - production build finished without domain assignment\n");
    } else {
      const deployment = createCandidateDeployment(values);
      writeCandidateDeployment(recordPath, deployment);
      process.stdout.write(`build:production ok - production build finished without domain assignment; candidate deployment ${deployment.id} recorded at ${values.deploymentUrlFile}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
