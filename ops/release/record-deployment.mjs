// Publish the CANDIDATE deployment the production build produced (R4-03).
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/record-deployment.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R4-03: `production-build` declared no outputs and `smoke` read `PRODUCTION_SMOKE_URL` from a
// static repository variable, so the pre-promotion smoke test exercised the STILL-LIVE previous
// production - the deployment the promotion was about to replace - and `promote:production` was
// invoked without the `--deployment` it requires. There was no channel by which the identity of the
// just-built, un-promoted deployment could reach either job.
//
// The channel is this file. `build:production` writes a small JSON record of the deployment it
// created; this CLI validates it and publishes `deployment_url` / `deployment_id` as job outputs.
// Every failure mode is a refusal, never a fallback: a build that recorded nothing fails the
// release here instead of producing a green smoke result about the previous release.
//
// R7REL-03. The production-alias guard used to apply only when `--production-url` was non-empty,
// and the value the canonical workflow passes is `vars.PRODUCTION_URL`, which renders to the empty
// string when the repository variable does not exist. Nothing created, required or documented that
// variable, so R4-03 came back as a configuration omission with no diff anywhere: the smoke gate
// received the live production alias and reported green about the release it was meant to verify.
// An absent production URL is now a REFUSAL (`deployment_production_url_unknown`) - the release
// fails until the variable exists - and `docs/release/ENVIRONMENT_MAPPING.md` lists it with the
// other repository variables the canonical workflow reads.
//
// R7REL-04. The candidate is also refused when its host IS the production host, a PARENT of it or
// a CHILD of it, and the record's id and URL are bound to one another: `--verify-binding` resolves
// the recorded id through the provider CLI (behind an injectable runner) and refuses a URL the
// provider does not report for that id. The smoke job runs that check before it smokes anything,
// so "verify one host, promote another artefact" needs the provider to lie rather than just a
// wrong-but-well-formed line in a deploy banner. OFFLINE ASSUMPTION: the tests drive a fake runner,
// no test contacts a provider, and the real shape of `vercel inspect` output is AT-16, still open.
//
// R7REL-06. What reaches `$GITHUB_OUTPUT` is `url.origin`, not the raw trimmed string: the WHATWG
// URL parser strips ASCII tab/LF/CR before parsing, so an embedded newline used to validate and
// then inject an extra output line. The `health-outputs.mjs` newline guard is applied here too.
//
// CONTRACT for `build:production --deployment-url-file <path>` (starter lane owns the writer):
//   { "url": "https://<candidate deployment host>", "id": "<provider deployment id>" }
// `url` must be https and must not be the production alias; `id` must be a plain token.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class DeploymentRecordError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const DEPLOYMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

function origin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new DeploymentRecordError('deployment_url_insecure', `the candidate deployment URL must be https (${url.protocol}//)`);
  return url.origin.toLowerCase();
}

/** Is `host` the same host as `production`, a parent domain of it, or a subdomain of it? */
export function sharesProductionDomain(host, production) {
  const a = String(host ?? '').trim().toLowerCase();
  const b = String(production ?? '').trim().toLowerCase();
  if (a === '' || b === '') return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Validate the record `build:production` wrote. `productionUrl` is the project's production alias
 * and is REQUIRED (R7REL-03): a candidate that is the alias, a parent of it or a subdomain of it
 * means the build published into production's own domain, which is the promotion job's decision
 * and not the build's - and an unconfigured alias means the guard cannot be applied at all, which
 * is a refusal rather than a pass.
 */
export function candidateDeployment(record, productionUrl = '') {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new DeploymentRecordError('deployment_record_malformed', 'the candidate deployment record must be a JSON object');
  }
  const { url, id } = record;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new DeploymentRecordError('deployment_url_missing', 'the candidate deployment record carries no "url"; build:production must write the URL of the deployment it created');
  }
  let candidateOrigin;
  try {
    candidateOrigin = origin(url.trim());
  } catch (error) {
    if (error instanceof DeploymentRecordError) throw error;
    throw new DeploymentRecordError('deployment_url_invalid', `the candidate deployment URL is not a URL (${url.trim().slice(0, 60)})`);
  }
  if (typeof id !== 'string' || !DEPLOYMENT_ID.test(id.trim())) {
    throw new DeploymentRecordError('deployment_id_invalid', 'the candidate deployment record carries no plain-token "id"; promote:production promotes that exact deployment');
  }
  // R7REL-03: no production alias, no guard - and no guard is a refusal, never a fallback.
  const production = String(productionUrl ?? '').trim();
  if (production === '') {
    throw new DeploymentRecordError('deployment_production_url_unknown', 'the project\'s production alias is not configured (repository variable PRODUCTION_URL); without it the candidate cannot be proved NOT to be production, and the smoke test would risk exercising the release it is meant to verify');
  }
  let productionOrigin;
  try {
    productionOrigin = origin(production);
  } catch {
    throw new DeploymentRecordError('deployment_production_url_invalid', `the configured production alias is not an https URL (${production.slice(0, 60)}); the candidate cannot be compared with it`);
  }
  if (productionOrigin === candidateOrigin) {
    throw new DeploymentRecordError('deployment_url_is_production_alias', `the recorded candidate deployment is the production alias (${candidateOrigin}); the smoke test would exercise the release it is meant to verify`);
  }
  // R7REL-04: a parent or child of the production host is the same blast radius - `app.acme.example`
  // and `preview.app.acme.example` share cookies, certificates and, in most edge configurations,
  // the alias itself.
  if (sharesProductionDomain(new URL(candidateOrigin).hostname, new URL(productionOrigin).hostname)) {
    throw new DeploymentRecordError('deployment_url_shares_production_domain', `the recorded candidate deployment (${candidateOrigin}) is a parent or subdomain of the production alias (${productionOrigin}); it is not an independent deployment the smoke test can verify`);
  }
  // R7REL-06: the ORIGIN is what travels onwards, so a tab/LF/CR the URL parser silently dropped
  // cannot reappear in a job output.
  return { url: candidateOrigin, id: id.trim(), origin: candidateOrigin, recordedUrl: url.trim() };
}

/**
 * The deployment origin the provider reports for `id`, read from ONE documented field.
 *
 * R8REL-06. This used to harvest every `https://…` match and every bare `host.tld`-shaped token
 * from the lookup's stdout AND stderr, so it answered "does the output mention this host at all?"
 * rather than "is this the deployment that id names". Measured by the eighth review: the CLI's own
 * `Inspect: https://vercel.com/acme/proj/dpl_abc` banner line made `https://vercel.com` an accepted
 * origin, and any alias the lookup happened to list bound too - including a PREVIOUS release's.
 * That is the narrow form of exactly the failure R7REL-04 exists to stop.
 *
 * The lookup is now asked for JSON and only its `url` - the deployment's own URL, the artefact
 * `promote:production` promotes - is read. Aliases are deliberately NOT accepted: an alias can
 * point at another deployment, and binding to one would re-open the same hole. Anything this
 * function cannot read as a documented field returns an empty list, which is a refusal upstream:
 * a lookup that cannot be understood never binds.
 *
 * OFFLINE ASSUMPTION (AT-16, still open): that `vercel inspect <id> --json` prints a JSON object
 * carrying `url` is taken from the provider's documentation and has not been run against a
 * provider in this lane. It fails CLOSED if wrong - the release stops, nothing is promoted.
 */
export function deploymentOriginsFrom(output) {
  const text = String(output ?? '').trim();
  if (text === '') return [];
  let parsed = null;
  for (const candidate of [text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!candidate || !candidate.startsWith('{')) continue;
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      parsed = null;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const reported = parsed.url;
  if (typeof reported !== 'string' || reported.trim() === '') return [];
  const value = reported.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== 'https:') return [];
    return [url.origin.toLowerCase()];
  } catch {
    return [];
  }
}

const spawnRunner = (command, args, options) => spawnSync(command, args, { encoding: 'utf8', shell: false, ...options });

/**
 * R7REL-04. Bind the recorded id to the recorded URL through the provider CLI. `smoke` verifies a
 * URL and `promote-production` promotes an id; this is the step that requires them to describe one
 * deployment. The runner is injectable so the offline tests drive a fake and no test ever contacts
 * a provider; the real output shape of the lookup is AT-16 and still open.
 */
export function verifyDeploymentBinding(deployment, environment = process.env, run = spawnRunner) {
  const command = environment.LAUNCH_VERCEL ?? 'vercel';
  // R8REL-06: `--json`, and only stdout. The documented machine-readable answer is what binds; the
  // human banner on stderr is exactly what used to make `https://vercel.com` an accepted origin.
  const result = run(command, ['inspect', deployment.id, '--json'], { env: environment });
  if (!result || result.error) {
    throw new DeploymentRecordError('deployment_binding_unverifiable', `the deployment lookup could not be started (${command}); the candidate's id and URL were not bound to one another`);
  }
  if (result.status !== 0) {
    throw new DeploymentRecordError('deployment_binding_unverifiable', `the deployment lookup for ${deployment.id} exited ${result.status}; the candidate's id and URL were not bound to one another`);
  }
  const origins = deploymentOriginsFrom(result.stdout ?? '');
  if (!origins.includes(deployment.origin)) {
    throw new DeploymentRecordError('deployment_binding_mismatch', `the deployment lookup for ${deployment.id} names ${origins.length ? origins.join(', ') : 'no deployment URL'}, not the recorded candidate ${deployment.origin}; the smoke test would verify a different deployment than promote:production promotes`);
  }
  return { ...deployment, boundOrigins: origins };
}

export function readCandidateDeployment(path, productionUrl = '') {
  if (!existsSync(path)) {
    throw new DeploymentRecordError('deployment_record_missing', `${path}: build:production wrote no candidate deployment record; the pre-promotion smoke test has no target`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new DeploymentRecordError('deployment_record_malformed', `${path}: is not valid JSON (${error instanceof Error ? error.message : 'parse error'})`);
  }
  return candidateDeployment(parsed, productionUrl);
}

function argumentValue(args, name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

// R7REL-02: this CLI decides FOR ITSELF, by real path, whether it was invoked as a script. There
// is no shared helper any more: one `return false` in a common module turned every release CLI
// into a silent exit 0, in a file no delivered branch-protection plan reviewed and no delivered
// test covered. `ops/release/release-controls.test.mjs` runs every delivered CLI against a
// tampered fixture and requires exit 1, so a CLI that stops checking turns this project's CI red.
function invokedAsScript(moduleUrl) {
  const invoked = process.argv[1];
  if (typeof invoked !== 'string' || invoked.length === 0) return false;
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
  const args = process.argv.slice(2);
  const valued = new Set(['--production-url', '--github-output', '--expect-url', '--expect-id']);
  const path = args.find((argument, index) => !argument.startsWith('--') && !valued.has(args[index - 1]));
  try {
    let deployment = readCandidateDeployment(path ?? 'candidate-deployment.json', argumentValue(args, '--production-url'));
    // R7REL-04: when the caller already holds the pair the build published as job outputs, the
    // record on disk must be that same pair - otherwise the artefact and the outputs disagree.
    const expectedUrl = argumentValue(args, '--expect-url');
    const expectedId = argumentValue(args, '--expect-id');
    if (expectedUrl && origin(expectedUrl.trim()) !== deployment.origin) {
      throw new DeploymentRecordError('deployment_url_unexpected', `the candidate deployment record names ${deployment.origin}, not the ${origin(expectedUrl.trim())} the production build published`);
    }
    if (expectedId && expectedId.trim() !== deployment.id) {
      throw new DeploymentRecordError('deployment_id_unexpected', `the candidate deployment record names id ${deployment.id}, not the ${expectedId.trim()} the production build published`);
    }
    if (args.includes('--verify-binding')) deployment = verifyDeploymentBinding(deployment);
    const output = argumentValue(args, '--github-output');
    if (output) {
      // R7REL-06: the sibling guard from health-outputs.mjs. `deployment.url` is an origin, so this
      // can only fire on a programming error here - which is the point of a belt-and-braces guard.
      for (const value of [deployment.url, deployment.id]) {
        if (value.includes('\n') || value.includes('\r')) {
          throw new DeploymentRecordError('deployment_record_malformed', 'a candidate deployment value spans more than one line and cannot be published as a job output');
        }
      }
      appendFileSync(output, `deployment_url=${deployment.url}\ndeployment_id=${deployment.id}\n`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...deployment })}\n`);
  } catch (error) {
    const reason = error instanceof DeploymentRecordError ? error.reason : 'deployment_record_unavailable';
    process.stdout.write(`${JSON.stringify({ ok: false, reason })}\n`);
    process.stderr.write(`${reason}: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
