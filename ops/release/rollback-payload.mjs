// Build the rollback decision payload from the post-promotion health job's outputs.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/rollback-payload.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R3-08: the workflow used to build this payload inline with `Number(process.env.FAILED_CHECKS)`.
// When the health step failed before it could write its outputs, every output was the empty string,
// `Number('')` is 0, and the pipeline concluded `{"action":"none","reason":"healthy"}` - after a
// genuine production health failure it performed no rollback and raised no incident. Here an empty
// or non-numeric value becomes NaN and an unparseable flag becomes null, which the rollback
// contract refuses as `malformed_input` and therefore turns into an incident. Unknown is never
// healthy.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function healthNumber(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

export function healthFlag(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

/**
 * The environment the post-promotion health job publishes for this CLI. R7REL-02: a CLI that can
 * only ever exit 0 cannot be told apart from a CLI that was switched off, so the one state that is
 * certainly not a health report - NONE of these variables set at all, not even empty - is a
 * refusal. In the canonical workflow every one of them is always present (the last three carry a
 * literal default), so this can only fire when the CLI is invoked outside its job.
 */
export const HEALTH_INPUTS = [
  'FAILED_CHECKS',
  'TOTAL_CHECKS',
  'CONSECUTIVE_FAILURES',
  'PROVIDER_OUTAGE',
  'PREVIOUS_RELEASE_ID',
  'PREVIOUS_RELEASE_COMPATIBLE',
  'RECENT_ROLLBACKS',
  'MAX_ROLLBACKS',
  'CONFIRM_THRESHOLD',
];

export function buildRollbackPayload(environment = process.env) {
  if (!HEALTH_INPUTS.some((name) => environment[name] !== undefined)) {
    throw new Error(`rollback_payload_without_health: none of ${HEALTH_INPUTS.join(', ')} is set, so there is no post-promotion health report to decide on; refusing to emit a payload that would read as a healthy production`);
  }
  const previousReleaseId = String(environment.PREVIOUS_RELEASE_ID ?? '').trim();
  return {
    health: {
      failed_checks: healthNumber(environment.FAILED_CHECKS),
      total_checks: healthNumber(environment.TOTAL_CHECKS),
      consecutive_failures: healthNumber(environment.CONSECUTIVE_FAILURES),
    },
    provider_outage: healthFlag(environment.PROVIDER_OUTAGE),
    previous_release: previousReleaseId
      ? { id: previousReleaseId, compatible_with_current_schema: healthFlag(environment.PREVIOUS_RELEASE_COMPATIBLE) === true }
      : null,
    recent_rollbacks: healthNumber(environment.RECENT_ROLLBACKS),
    max_rollbacks: healthNumber(environment.MAX_ROLLBACKS),
    confirm_threshold: healthNumber(environment.CONFIRM_THRESHOLD),
  };
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
  try {
    process.stdout.write(`${JSON.stringify(buildRollbackPayload())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
