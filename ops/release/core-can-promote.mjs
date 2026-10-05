const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.length > 0;

export function canPromote(input) {
  if (!plain(input) || !plain(input.candidate) || !plain(input.staging_evidence)) return { ok: false, reason: 'malformed_input' };
  const { candidate, staging_evidence: staging } = input;
  if (!text(candidate.tree_hash) || !text(candidate.lockfile_hash) || !Array.isArray(candidate.migrations) || !Number.isSafeInteger(candidate.policy_revision) || candidate.policy_revision < 0) return { ok: false, reason: 'malformed_input' };
  if (!text(staging.tree_hash) || !text(staging.lockfile_hash) || !Array.isArray(staging.migrations) || !Number.isSafeInteger(staging.policy_revision) || staging.policy_revision < 0 || !text(input.target_tree_hash)) return { ok: false, reason: 'malformed_input' };
  if (candidate.tree_hash !== staging.tree_hash) return { ok: false, reason: 'tree_hash_mismatch' };
  if (candidate.lockfile_hash !== staging.lockfile_hash) return { ok: false, reason: 'lockfile_mismatch' };
  if (JSON.stringify(candidate.migrations) !== JSON.stringify(staging.migrations)) return { ok: false, reason: 'migrations_mismatch' };
  if (candidate.policy_revision !== staging.policy_revision) return { ok: false, reason: 'policy_revision_mismatch' };
  if (staging.gates_pass !== true) return { ok: false, reason: 'gates_not_passed' };
  if (input.target_tree_hash !== candidate.tree_hash) return { ok: false, reason: 'target_tree_mismatch' };
  return { ok: true, reason: null };
}
