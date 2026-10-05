// The single recorded promotion candidate that travels from the staging run to the production run.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/promotion-record.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge. Keep it self-contained.
//
// The production job never compares a value against itself: it recomputes the identity of the
// production checkout (`target`) and compares that against the artifact a PRIOR staging run
// recorded (`record`). `gates_pass` is never trusted on its own - the recorded per-gate results
// must cover every required gate.
//
// R3-03: WHO published the record is now checked, not only what the record says about itself.
// A record is trusted only when, on the artifact side, the producing run belongs to THIS repository
// (`repository_id`) and was not produced from a fork (`head_repository_id === repository_id`), its
// head branch is the staging branch and its run id is strictly PRIOR to the production run; and, on
// the record side, the provenance repository, repository id, head repository, triggering event and
// workflow reference all match, and the run id and commit are the ones the artifact selection
// resolved. A hand-written record, a record uploaded by a different workflow on the staging branch,
// and a fork whose branch is literally named `staging` are all refused.

const PASSED_GATE_STATUSES = new Set(['success', 'passed']);
const IDENTITY_FIELDS = ['tree_hash', 'lockfile_hash', 'migrations', 'migration_hash', 'policy_revision'];

// The only trigger a promotion record may be produced by. A `pull_request` run reports the base
// repository in GITHUB_REPOSITORY while executing the fork's workflow file, so the event is checked
// rather than inferred.
const TRUSTED_RECORD_EVENT = 'push';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isMigrationList = (value) => Array.isArray(value) && value.every((entry) => isText(entry));
const isPolicyRevision = (value) => Number.isSafeInteger(value) && value >= 0;
const isRunId = (value) => isText(String(value ?? '')) && /^\d+$/.test(String(value).trim());

export function isIdentity(value) {
  return isPlainObject(value)
    && isText(value.tree_hash)
    && isText(value.lockfile_hash)
    && isMigrationList(value.migrations)
    && isText(value.migration_hash)
    && isPolicyRevision(value.policy_revision);
}

/** Compare two independently computed identities field by field. */
export function compareIdentities(recorded, target) {
  if (recorded.tree_hash !== target.tree_hash) return 'tree_hash_mismatch';
  if (recorded.lockfile_hash !== target.lockfile_hash) return 'lockfile_mismatch';
  if (recorded.migrations.length !== target.migrations.length) return 'migrations_mismatch';
  for (let index = 0; index < recorded.migrations.length; index += 1) {
    if (recorded.migrations[index] !== target.migrations[index]) return 'migrations_mismatch';
  }
  // R3-11: migration_hash was recorded but never compared, so it read as a check that was not one.
  if (recorded.migration_hash !== target.migration_hash) return 'migration_hash_mismatch';
  if (recorded.policy_revision !== target.policy_revision) return 'policy_revision_mismatch';
  return null;
}

export function gateEvidenceFailure(gateResults, requiredGates) {
  if (!Array.isArray(requiredGates) || requiredGates.length === 0) return 'required_gates_unknown';
  if (!isPlainObject(gateResults)) return 'gate_results_missing';
  for (const gate of requiredGates) {
    const result = gateResults[gate];
    if (!isPlainObject(result)) return `gate_result_missing:${gate}`;
    if (!PASSED_GATE_STATUSES.has(String(result.status))) return `gate_not_passed:${gate}`;
    if (!isText(result.evidence_ref)) return `gate_evidence_missing:${gate}`;
  }
  return null;
}

const PROVENANCE_FIELDS = [
  'repository',
  'repository_id',
  'head_repository',
  'ref',
  'workflow_ref',
  'event',
  'commit',
  'run_id',
  'run_attempt',
  'workflow',
];

/**
 * `GITHUB_WORKFLOW_REF` is `<owner>/<repo>/<path>@<ref>` - the only run-time value that names the
 * workflow FILE that produced the record. Splitting on the last `@` keeps a ref that contains `/`.
 */
export function parseWorkflowRef(value) {
  const text = String(value ?? '');
  const at = text.lastIndexOf('@');
  if (at <= 0 || at === text.length - 1) return null;
  const left = text.slice(0, at);
  const ref = text.slice(at + 1);
  const parts = left.split('/');
  if (parts.length < 3) return null;
  return { repository: `${parts[0]}/${parts[1]}`, path: parts.slice(2).join('/'), ref };
}

function provenanceProblem(provenance) {
  if (!isPlainObject(provenance) || PROVENANCE_FIELDS.some((field) => !isText(provenance[field]))) return 'missing_provenance';
  if (provenance.head_repository !== provenance.repository) return 'fork_provenance';
  if (provenance.event !== TRUSTED_RECORD_EVENT) return 'untrusted_event';
  if (!isRunId(provenance.run_id)) return 'malformed_run_id';
  return null;
}

export function buildPromotionRecord({ candidate, gateResults, requiredGates, provenance } = {}) {
  if (!isIdentity(candidate)) return { ok: false, reason: 'malformed_candidate', record: null };
  const provenanceFailure = provenanceProblem(provenance);
  if (provenanceFailure) return { ok: false, reason: provenanceFailure, record: null };
  const gateFailure = gateEvidenceFailure(gateResults, requiredGates);
  if (gateFailure) return { ok: false, reason: gateFailure, record: null };
  return {
    ok: true,
    reason: null,
    record: {
      tree_hash: candidate.tree_hash,
      lockfile_hash: candidate.lockfile_hash,
      migrations: [...candidate.migrations],
      migration_hash: candidate.migration_hash,
      policy_revision: candidate.policy_revision,
      required_gates: [...requiredGates],
      gate_results: gateResults,
      gates_pass: true,
      provenance: Object.fromEntries(PROVENANCE_FIELDS.map((field) => [field, String(provenance[field])])),
    },
  };
}

/**
 * Verify that the production checkout may be promoted on the strength of a recorded staging
 * candidate. `currentRunId` is the production run: evidence produced by that same run is rejected,
 * and the staging run id must be strictly earlier, which is what makes this a cross-run provenance
 * check rather than a tautology. `selectedRunId`/`selectedCommit` come from the artifact selection,
 * so the record cannot claim a different origin than the artifact it was downloaded from.
 */
export function verifyPromotionRecord({
  record,
  target,
  requiredGates,
  stagingRef,
  currentRunId,
  repository,
  repositoryId,
  workflowPath,
  selectedRunId,
  selectedCommit,
} = {}) {
  if (!isPlainObject(record) || !isIdentity(record)) return { ok: false, reason: 'malformed_record' };
  if (!isIdentity(target)) return { ok: false, reason: 'malformed_target' };
  const provenance = record.provenance;
  const provenanceFailure = provenanceProblem(provenance);
  if (provenanceFailure) return { ok: false, reason: provenanceFailure };
  if (!isText(repository)) return { ok: false, reason: 'repository_unknown' };
  if (provenance.repository !== repository) return { ok: false, reason: 'repository_mismatch' };
  if (!isText(repositoryId)) return { ok: false, reason: 'repository_id_unknown' };
  if (String(provenance.repository_id) !== String(repositoryId)) return { ok: false, reason: 'repository_id_mismatch' };
  if (!isText(workflowPath)) return { ok: false, reason: 'workflow_path_unknown' };
  if (!isText(stagingRef)) return { ok: false, reason: 'staging_ref_unknown' };
  const workflowRef = parseWorkflowRef(provenance.workflow_ref);
  if (!workflowRef) return { ok: false, reason: 'malformed_workflow_ref' };
  if (workflowRef.repository !== repository) return { ok: false, reason: 'workflow_repository_mismatch' };
  if (workflowRef.path !== workflowPath) return { ok: false, reason: 'workflow_path_mismatch' };
  if (workflowRef.ref !== stagingRef) return { ok: false, reason: 'workflow_ref_not_from_staging' };
  if (provenance.ref !== stagingRef) return { ok: false, reason: 'evidence_not_from_staging' };
  if (!isRunId(currentRunId)) return { ok: false, reason: 'current_run_unknown' };
  if (String(provenance.run_id) === String(currentRunId)) return { ok: false, reason: 'same_run_evidence' };
  if (Number(provenance.run_id) > Number(currentRunId)) return { ok: false, reason: 'evidence_not_from_prior_run' };
  if (selectedRunId !== undefined && String(provenance.run_id) !== String(selectedRunId)) return { ok: false, reason: 'selected_run_mismatch' };
  if (selectedCommit !== undefined && String(provenance.commit) !== String(selectedCommit)) return { ok: false, reason: 'selected_commit_mismatch' };
  if (record.gates_pass !== true) return { ok: false, reason: 'gates_not_passed' };
  const recordedRequired = Array.isArray(record.required_gates) ? record.required_gates : [];
  const missingRequired = (Array.isArray(requiredGates) ? requiredGates : []).filter((gate) => !recordedRequired.includes(gate));
  if (missingRequired.length) return { ok: false, reason: `required_gate_not_recorded:${missingRequired[0]}` };
  const gateFailure = gateEvidenceFailure(record.gate_results, requiredGates);
  if (gateFailure) return { ok: false, reason: gateFailure };
  const mismatch = compareIdentities(record, target);
  if (mismatch) return { ok: false, reason: mismatch };
  return { ok: true, reason: null };
}

/**
 * Pick the prior staging run that owns the content-addressed promotion record. The artifact name
 * carries the tree hash, so a record can only be found for a tree staging actually recorded - and
 * the artifact's own `workflow_run` decides whether the publisher is trusted (R3-03):
 *
 * - `repository_id` must be THIS repository, so another repository's artifact is never considered;
 * - `head_repository_id` must equal `repository_id`, so a fork - including a fork whose branch is
 *   literally named `staging` - can never publish the record production trusts;
 * - the run id must be strictly PRIOR to the production run, so evidence cannot be manufactured by
 *   a run started after the production run began.
 */
export function selectStagingRecord(listing, { treeHash, stagingBranch, currentRunId, repositoryId } = {}) {
  if (!isText(treeHash)) return { ok: false, reason: 'tree_hash_unknown' };
  if (!isText(stagingBranch)) return { ok: false, reason: 'staging_branch_unknown' };
  if (!isRunId(currentRunId)) return { ok: false, reason: 'current_run_unknown' };
  if (!isText(repositoryId)) return { ok: false, reason: 'repository_id_unknown' };
  const name = `staging-promotion-record-${treeHash}`;
  const artifacts = isPlainObject(listing) && Array.isArray(listing.artifacts) ? listing.artifacts : null;
  if (!artifacts) return { ok: false, reason: 'malformed_listing' };
  const usable = artifacts.filter((artifact) => {
    if (!isPlainObject(artifact) || artifact.name !== name || artifact.expired === true) return false;
    const run = artifact.workflow_run;
    if (!isPlainObject(run) || !isRunId(run.id) || !isText(run.head_sha)) return false;
    if (run.head_branch !== stagingBranch) return false;
    if (!isText(String(run.repository_id ?? '')) || String(run.repository_id) !== String(repositoryId)) return false;
    if (String(run.head_repository_id ?? '') !== String(run.repository_id)) return false;
    return Number(run.id) < Number(currentRunId);
  });
  if (!usable.length) return { ok: false, reason: 'no_staging_record', name };
  const selected = usable.reduce((best, artifact) => (Number(artifact.workflow_run.id) > Number(best.workflow_run.id) ? artifact : best));
  return {
    ok: true,
    reason: null,
    name,
    run_id: String(selected.workflow_run.id),
    artifact_id: String(selected.id ?? ''),
    head_sha: String(selected.workflow_run.head_sha),
    candidates: usable.length,
  };
}

export { IDENTITY_FIELDS, PROVENANCE_FIELDS, TRUSTED_RECORD_EVENT };
