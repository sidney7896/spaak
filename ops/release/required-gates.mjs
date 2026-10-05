// Print the required-gate list of the standard policy file as JSON.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/required-gates.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R3-06: the release workflow used to carry a hard-coded thirteen-entry list, so the gate set the
// promotion record was built and checked against was the workflow's opinion rather than the
// standard's. The workflow now asks this CLI, which reads `standard/policy/global-policy.yaml`
// (or the generated project's delivered copy).
import { loadReleasePolicy } from './release-policy.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  const policy = loadReleasePolicy();
  process.stdout.write(`${JSON.stringify(policy.requiredGates)}\n`);
}
