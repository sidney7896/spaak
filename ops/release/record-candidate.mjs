// Release identity of one checkout: the tracked tree, the lockfile and the migration set.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/record-candidate.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R4-02: this used to run `git ls-files -z` through `execFileSync` and return `[]` on ANY
// exception. That is not only the "no git" case - `execFileSync`'s default maxBuffer is 1 MiB and
// it throws ENOBUFS above it, which a real repository reaches on size alone (a 7,001-file tree
// produces about 1.25 MiB of listing). The identity then collapsed to sha256('') for both hashes
// and an empty migration list, with exit 0, so `compareIdentities` compared two constants and the
// staging-equivalence layer verified nothing - silently, and more likely as a project grows.
// Every degenerate outcome is now fatal and named: the listing has an explicit, large maxBuffer and
// an explicit overflow error, a failed or empty listing is refused, an unreadable tracked file is
// refused, a missing lockfile is refused, and an empty-input hash can never be written.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// sha256 of the empty input. No real tree and no real lockfile hashes to this; if one ever does,
// the identity is degenerate and two unrelated checkouts would compare equal.
const EMPTY_SHA256 = sha256('');

// `git ls-files -z` of a 7,001-file tree is about 1.25 MiB; 64 MiB covers roughly 350,000 paths.
// The point is not the number: it is that the limit is explicit and overflow is an error, never a
// truncated or empty listing that still exits 0.
const MAX_LISTING_BYTES = 64 * 1024 * 1024;

/** A refusal with a machine-readable reason, so the CLI can print it and exit non-zero. */
export class ReleaseIdentityError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Compute release identities from supplied data. This function has no clock,
 * randomness, network, or global state and is the test seam used by CI.
 */
export function computeCandidateIdentity({ treeEntries = [], lockfile = '', migrations = [], policyRevision = 0 } = {}) {
  const entries = Array.isArray(treeEntries)
    ? treeEntries
        .filter((entry) => entry && typeof entry.path === 'string')
        .map((entry) => ({ path: entry.path, sha256: entry.sha256 || sha256(String(entry.content ?? '')) }))
        .sort((a, b) => a.path.localeCompare(b.path))
    : [];
  const migrationEntries = Array.isArray(migrations)
    ? migrations
        .filter((entry) => entry && typeof entry.path === 'string')
        .map((entry) => ({ path: entry.path, sha256: entry.sha256 || sha256(String(entry.content ?? '')) }))
        .sort((a, b) => a.path.localeCompare(b.path))
    : [];
  const treeHash = sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\0`).join(''));
  const lockfileHash = sha256(String(lockfile));
  const migrationListHash = sha256(JSON.stringify(migrationEntries));
  const numericPolicyRevision = Number(policyRevision);
  return {
    tree_hash: treeHash,
    lockfile_hash: lockfileHash,
    migrations: migrationEntries.map(({ path }) => path),
    migration_hash: migrationListHash,
    policy_revision: Number.isSafeInteger(numericPolicyRevision) && numericPolicyRevision >= 0 ? numericPolicyRevision : -1,
  };
}

/**
 * The tracked file list of one checkout. Fails closed: a git that is absent, a directory that is
 * not a repository, a non-zero exit, a listing larger than the explicit buffer and an empty listing
 * are all refusals, never an empty array that the caller would hash into a constant.
 */
export function trackedFiles(rootDir) {
  const result = spawnSync('git', ['-C', rootDir, 'ls-files', '-z'], { maxBuffer: MAX_LISTING_BYTES });
  if (result.error) {
    const code = result.error.code === 'ENOBUFS' ? 'tree_listing_too_large' : 'tree_unavailable';
    throw new ReleaseIdentityError(code, `git ls-files failed in ${rootDir}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    throw new ReleaseIdentityError('tree_unavailable', `git ls-files exited ${result.status} in ${rootDir}${stderr ? `: ${stderr}` : ''}`);
  }
  const stdout = result.stdout ?? Buffer.alloc(0);
  // spawnSync truncates at maxBuffer; on some platforms it does so without setting `error`, so the
  // length is checked as well. A listing at the limit is refused rather than silently shortened.
  if (stdout.length >= MAX_LISTING_BYTES) {
    throw new ReleaseIdentityError('tree_listing_too_large', `git ls-files produced at least ${MAX_LISTING_BYTES} bytes in ${rootDir}; the listing may be truncated`);
  }
  const paths = stdout.toString('utf8').split('\0').filter(Boolean);
  if (paths.length === 0) {
    throw new ReleaseIdentityError('tree_empty', `git ls-files listed no tracked file in ${rootDir}; a release candidate needs a tracked tree`);
  }
  return paths;
}

export function recordCandidate({ rootDir = process.cwd(), policyRevision = 0, files } = {}) {
  const paths = Array.isArray(files) ? files : trackedFiles(rootDir);
  if (paths.length === 0) {
    throw new ReleaseIdentityError('tree_empty', 'a release candidate needs a non-empty file list');
  }
  const entries = [];
  const unreadable = [];
  for (const path of paths) {
    try {
      const absolute = join(rootDir, path);
      // git stores a symlink as its target string, so that is what the identity covers. Reading
      // THROUGH the link would either duplicate the target's bytes or throw EISDIR on a link to a
      // directory; a gitlink (submodule) is a directory here and is refused below, because its
      // content genuinely is not part of this tree.
      const status = lstatSync(absolute);
      entries.push({ path, content: status.isSymbolicLink() ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute) });
    } catch (error) {
      unreadable.push(`${path} (${error instanceof Error ? error.code ?? error.message : 'unreadable'})`);
    }
  }
  if (unreadable.length) {
    throw new ReleaseIdentityError('tree_unreadable', `${unreadable.length} tracked file(s) could not be read, so the tree hash would cover less than the tree: ${unreadable.slice(0, 3).join(', ')}`);
  }
  const lockfileEntry = entries.find(({ path }) => /(^|\/)pnpm-lock\.yaml$/.test(path))
    || entries.find(({ path }) => /(^|\/)(package-lock\.json|yarn\.lock)$/.test(path));
  if (!lockfileEntry) {
    throw new ReleaseIdentityError('lockfile_missing', 'no pnpm-lock.yaml, package-lock.json or yarn.lock is tracked; the workflows install with --frozen-lockfile and the lockfile hash would be a constant');
  }
  const migrations = entries.filter(({ path }) => /(^|\/)migrations\/[^/]+\.sql$/i.test(path));
  const identity = computeCandidateIdentity({
    treeEntries: entries,
    lockfile: lockfileEntry.content,
    migrations,
    policyRevision,
  });
  if (identity.tree_hash === EMPTY_SHA256 || identity.lockfile_hash === EMPTY_SHA256) {
    throw new ReleaseIdentityError('identity_degenerate', 'the tree or lockfile hash is the hash of an empty input; two unrelated checkouts would compare equal');
  }
  return identity;
}

/**
 * Script-level serialization guard. A non-terminal record owns a project lane;
 * terminal records may coexist as historical evidence.
 */
export function claimReleaseRecord(records = [], proposed = {}) {
  const active = new Set(['recorded', 'promoting', 'pending', 'running']);
  if (!proposed || typeof proposed.project_id !== 'string' || proposed.project_id.length === 0) {
    return { ok: false, reason: 'malformed_record' };
  }
  const conflict = (Array.isArray(records) ? records : []).find(
    (record) => record?.project_id === proposed.project_id && active.has(record.status),
  );
  return conflict
    ? { ok: false, reason: 'release_in_progress', record_id: conflict.record_id ?? null }
    : { ok: true };
}

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

/**
 * R3-09: `argumentValue` cannot tell "flag absent" from "flag present but empty", so
 * `--policy-revision "$POLICY_REVISION"` with an unset repository variable silently became 0 -
 * both sides then agreed on 0 forever and the policy-revision half of the identity check never
 * fired. This lookup returns '' for a present-but-empty flag so the caller can refuse it.
 */
function suppliedArgument(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const next = args[index + 1];
  return next === undefined || next.startsWith('--') ? '' : next;
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
  const rootDir = argumentValue(args, '--root', process.cwd());
  const suppliedRevision = suppliedArgument(args, '--policy-revision');
  let policyRevision = '0';
  if (suppliedRevision !== undefined) {
    if (!/^\d+$/.test(suppliedRevision.trim())) {
      process.stderr.write('Release candidate refused: policy_revision_missing (set the POLICY_REVISION repository variable to a non-negative integer)\n');
      process.stdout.write(`${JSON.stringify({ ok: false, reason: 'policy_revision_missing' })}\n`);
      process.exitCode = 1;
    } else {
      policyRevision = suppliedRevision.trim();
    }
  }
  // Lane ownership: when CI supplies the known release records, the candidate is refused while
  // another non-terminal release owns the same project lane. The records file is the registry's
  // serialization seam; this CLI does not own the durable transaction (see docs/release/README.md).
  const recordsPath = argumentValue(args, '--records', null);
  const projectId = argumentValue(args, '--project-id', null);
  if (process.exitCode !== 1 && (recordsPath || projectId)) {
    const records = recordsPath ? JSON.parse(readFileSync(recordsPath, 'utf8')) : [];
    const claim = claimReleaseRecord(Array.isArray(records) ? records : records?.records, { project_id: projectId ?? '' });
    if (!claim.ok) {
      process.stderr.write(`Release candidate refused: ${claim.reason}\n`);
      process.stdout.write(`${JSON.stringify(claim)}\n`);
      process.exitCode = 1;
    }
  }
  if (process.exitCode !== 1) {
    // R4-02: any refusal here ends the run. Nothing is written to candidate.json or GITHUB_OUTPUT,
    // so a degraded identity can never be uploaded as a staging record or compared in production.
    let identity;
    try {
      identity = recordCandidate({ rootDir, policyRevision });
    } catch (error) {
      const reason = error instanceof ReleaseIdentityError ? error.reason : 'tree_unavailable';
      process.stderr.write(`Release candidate refused: ${reason} (${error instanceof Error ? error.message : error})\n`);
      process.stdout.write(`${JSON.stringify({ ok: false, reason })}\n`);
      process.exitCode = 1;
      identity = null;
    }
    if (identity) {
      const outPath = argumentValue(args, '--out', null);
      if (outPath) writeFileSync(outPath, `${JSON.stringify(identity, null, 2)}\n`);
      const outputPath = argumentValue(args, '--github-output', null);
      if (outputPath) {
        appendFileSync(outputPath, `tree_hash=${identity.tree_hash}\nlockfile_hash=${identity.lockfile_hash}\npolicy_revision=${identity.policy_revision}\n`);
      }
      process.stdout.write(`${JSON.stringify(identity)}\n`);
    }
  }
}
