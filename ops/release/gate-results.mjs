// Turn the per-gate job results a workflow exposes as `<GATE>_STATUS` environment variables into
// the gate-result map that evaluate-gates and record-promotion consume.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/gate-results.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// This used to be an inline `node --input-type=module` heredoc in three places in two workflows,
// which meant the translation was neither tested nor identical between them. A gate whose status
// variable is absent yields an empty status, which evaluate-gates fails - unknown is never a pass.
import { loadReleasePolicy } from './release-policy.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function statusVariableName(gate) {
  return `${String(gate).toUpperCase().replaceAll('-', '_')}_STATUS`;
}

export function gateResultsFromEnvironment(gates, environment = process.env) {
  const runId = String(environment.GITHUB_RUN_ID ?? '').trim();
  if (!runId) throw new Error('gate evidence needs GITHUB_RUN_ID; refusing to write a reference that points nowhere');
  return Object.fromEntries((Array.isArray(gates) ? gates : []).map((gate) => [gate, {
    status: String(environment[statusVariableName(gate)] ?? ''),
    evidence_ref: `github/${runId}/${gate}`,
  }]));
}

function argumentValue(args, name, fallback) {
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
  const supplied = argumentValue(args, '--required', null);
  const gates = supplied ? JSON.parse(supplied) : loadReleasePolicy().requiredGates;
  try {
    process.stdout.write(`${JSON.stringify(gateResultsFromEnvironment(gates))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
