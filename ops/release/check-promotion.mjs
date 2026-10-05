// Generated-project copy. Behaviourally identical to the monorepo ops/release/check-promotion.mjs;
// only the import of the core promotion contract differs (a generated project has no packages/core).
// ops/release/release.test.mjs runs both CLIs over the same fixtures and compares stdout and exit code.
import { readFileSync, realpathSync } from 'node:fs';
import { canPromote } from './core-can-promote.mjs';
import { verifyPromotionRecord } from './promotion-record.mjs';
import { loadReleasePolicy } from './release-policy.mjs';
import { fileURLToPath } from 'node:url';

// The canonical release workflow is the only workflow allowed to record a promotion candidate
// (D-014); its path is what `GITHUB_WORKFLOW_REF` must name in the record's provenance.
export const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';

export function checkPromotion(input) {
  return canPromote(input);
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
  const readJson = (name) => {
    const path = argumentValue(args, name, null);
    return path ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  };
  let result;
  if (args.includes('--record')) {
    // Cross-run promotion check: the production checkout (`--target`) is compared against the
    // record a PRIOR staging run produced (`--record`). Never a value against itself.
    // R3-03: the artifact selection's run id and head commit are required, so the record cannot
    // claim an origin other than the artifact this job actually downloaded. R3-06: the required
    // gates come from the standard policy file; there is no way to ask for a shorter list.
    const selectedRunId = argumentValue(args, '--selected-run-id', null);
    const selectedCommit = argumentValue(args, '--selected-head-sha', null);
    if (!selectedRunId || !selectedCommit) {
      result = { ok: false, reason: 'selected_artifact_unknown' };
    } else {
      result = verifyPromotionRecord({
        record: readJson('--record'),
        target: readJson('--target'),
        requiredGates: loadReleasePolicy().requiredGates,
        stagingRef: argumentValue(args, '--staging-ref', 'refs/heads/staging'),
        currentRunId: argumentValue(args, '--current-run-id', process.env.GITHUB_RUN_ID ?? ''),
        repository: argumentValue(args, '--repository', process.env.GITHUB_REPOSITORY ?? ''),
        repositoryId: argumentValue(args, '--repository-id', process.env.GITHUB_REPOSITORY_ID ?? ''),
        workflowPath: argumentValue(args, '--workflow-path', RELEASE_WORKFLOW_PATH),
        selectedRunId,
        selectedCommit,
      });
    }
  } else {
    const payload = args[0]?.startsWith('{')
      ? JSON.parse(args[0])
      : {
          candidate: readJson('--candidate'),
          staging_evidence: readJson('--staging'),
          target_tree_hash: readJson('--target')?.tree_hash,
        };
    result = checkPromotion(payload);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) {
    process.stderr.write(`Promotion check failed: ${result.reason}\n`);
    process.exitCode = 1;
  }
}
