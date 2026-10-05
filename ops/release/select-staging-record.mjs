// Resolve which PRIOR staging run owns the content-addressed promotion record for this tree.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/select-staging-record.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// The network call (`gh api .../actions/artifacts?name=...`) happens in the workflow; this CLI only
// selects from the returned listing, so the selection rules are deterministic and testable offline.
// R3-03: the selection now refuses an artifact that was not produced by THIS repository's own
// staging branch (fork runs report `head_repository_id !== repository_id`) and publishes the
// selected run id, head commit and artifact id so the production check can bind the downloaded
// record to the artifact that was actually chosen.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { selectStagingRecord } from './promotion-record.mjs';
import { fileURLToPath } from 'node:url';

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
  const listingPath = argumentValue(args, '--listing', null);
  const listing = JSON.parse(readFileSync(listingPath ?? 0, 'utf8'));
  const result = selectStagingRecord(listing, {
    treeHash: argumentValue(args, '--tree-hash', process.env.TREE_HASH ?? ''),
    stagingBranch: argumentValue(args, '--staging-branch', 'staging'),
    currentRunId: argumentValue(args, '--current-run-id', process.env.GITHUB_RUN_ID ?? ''),
    repositoryId: argumentValue(args, '--repository-id', process.env.GITHUB_REPOSITORY_ID ?? ''),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) {
    process.stderr.write(`No promotable staging record: ${result.reason}\n`);
    process.exitCode = 1;
  } else {
    const outputPath = argumentValue(args, '--github-output', process.env.GITHUB_OUTPUT ?? null);
    if (outputPath) {
      appendFileSync(outputPath, `run_id=${result.run_id}\nartifact_name=${result.name}\nartifact_id=${result.artifact_id}\nhead_sha=${result.head_sha}\n`);
    }
  }
}
