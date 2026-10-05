// Write the single promotion record that a staging run hands to a later production run.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/record-promotion.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R3-06: the required-gate list comes from the standard policy file and from nowhere else. There is
// deliberately no `--required` flag: a caller that could pass a shorter list could record a
// candidate that covers fewer gates than the standard demands.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { buildPromotionRecord } from './promotion-record.mjs';
import { loadReleasePolicy } from './release-policy.mjs';
import { fileURLToPath } from 'node:url';

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

/**
 * R3-03: the record carries the run-time facts that identify its publisher - the repository and its
 * numeric id, the head repository, the triggering event and the workflow FILE reference
 * (`GITHUB_WORKFLOW_REF`, `<owner>/<repo>/<path>@<ref>`). None of these have a fallback: a missing
 * value produces an unusable record instead of a record that claims a provenance it never had.
 * `HEAD_REPOSITORY` is supplied by the workflow from `github.event.repository.full_name`.
 */
export function provenanceFromEnvironment(environment = process.env) {
  return {
    repository: environment.GITHUB_REPOSITORY ?? '',
    repository_id: environment.GITHUB_REPOSITORY_ID ?? '',
    head_repository: environment.HEAD_REPOSITORY ?? '',
    ref: environment.GITHUB_REF ?? '',
    workflow_ref: environment.GITHUB_WORKFLOW_REF ?? '',
    event: environment.GITHUB_EVENT_NAME ?? '',
    commit: environment.GITHUB_SHA ?? '',
    run_id: environment.GITHUB_RUN_ID ?? '',
    run_attempt: environment.GITHUB_RUN_ATTEMPT ?? '',
    workflow: environment.GITHUB_WORKFLOW ?? '',
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
  const args = process.argv.slice(2);
  const candidatePath = argumentValue(args, '--candidate', 'candidate.json');
  const outPath = argumentValue(args, '--out', 'promotion-record.json');
  const gateResults = JSON.parse(argumentValue(args, '--gate-results', '{}'));
  const requiredGates = loadReleasePolicy().requiredGates;
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
  const result = buildPromotionRecord({
    candidate,
    gateResults,
    requiredGates,
    provenance: provenanceFromEnvironment(),
  });
  if (!result.ok) {
    process.stderr.write(`Promotion record refused: ${result.reason}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, reason: result.reason })}\n`);
    process.exitCode = 1;
  } else {
    writeFileSync(outPath, `${JSON.stringify(result.record, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, tree_hash: result.record.tree_hash, run_id: result.record.provenance.run_id })}\n`);
  }
}
