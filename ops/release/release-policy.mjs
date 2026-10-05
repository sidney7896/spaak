// The one place the release path learns which gates the standard requires.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/release-policy.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R3-04: every release helper runs in a workflow job that only checks the repository out, so no
// helper may import anything outside node: builtins. This reader therefore extracts the two fields
// the release path needs (`release.required_gates` and `release.production_job`) from the policy
// file directly instead of importing the `yaml` package. It is deliberately strict - an unreadable
// or unrecognised policy throws, it never degrades to an empty gate list. release.test.mjs compares
// its result against the `yaml` package's parse of the real policy file, so a divergence fails.
//
// R3-06: callers must NOT be able to supply a shorter required-gate list. `record-promotion.mjs`
// and `check-promotion.mjs` take their list from here and from nowhere else.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// =================================================================================================
// CONSTANTS OF THE STANDARD (R5-01).
//
// R5 showed that "canonical" must be a property of the SET, not of whatever the template directory
// happens to hold: a workflow that brought its own thirteen `run: "true"` stub jobs named after the
// required gates satisfied the per-document analysis, and a manifest line was one paste away. These
// constants are therefore NOT read from the repository being validated and NOT overridable by
// its policy file. They live here, in the module both the monorepo and every generated project run
// byte-identically, so widening them is a diff in the gate's own source rather than in data.
//
// R6REL-03: ops/release/release.test.mjs pins every one of them against a literal expectation, in
// BOTH delivered copies. Changing any of these lists is a reviewed change to the standard and fails
// the suite until the expectation is updated in the same commit.
// =================================================================================================

/** The only workflow file names a managed repository may contain, under any circumstances. */
export const CANONICAL_WORKFLOW_NAMES = ['ci.yml', 'release.yml'];

/** The one canonical workflow that is allowed to carry production capability at all. */
export const RELEASE_WORKFLOW = 'release.yml';

/** The closed list of jobs of RELEASE_WORKFLOW that may carry production capability. */
export const PRODUCTION_JOBS = [
  'apply-migrations',
  'production-build',
  'smoke',
  'promote-production',
  'post-promotion-health',
  'rollback-app',
];

/**
 * R7REL-05. The minimum dependency closure each production job must keep, pinned HERE.
 *
 * `CANONICAL_REQUIRED_GATES` pins the thirteen CI gates, but `tree-equivalence` (the R3-03
 * staging-record equivalence check) and `smoke` (the R4-03 pre-promotion verification) are JOBS of
 * the canonical release workflow, not gates, and nothing pinned them: a `release.yml` whose
 * `promote-production` simply dropped `needs: [tree-equivalence, smoke]` validated clean against
 * the structural rules. The two controls the whole promotion design rests on are now part of the
 * standard's own constants, so removing one is a diff in this file - the same class of change as
 * shrinking the gate set - and never a quiet edit in a workflow.
 *
 * Read as: this job must TRANSITIVELY need all of these. A job absent from a repository's
 * `release.yml` is not required to exist by this constant (the capability rule and the gate-set
 * rule decide that); when it does exist, its closure must hold.
 */
export const PRODUCTION_JOB_DEPENDENCIES = {
  'apply-migrations': ['tree-equivalence'],
  'production-build': ['tree-equivalence'],
  smoke: ['tree-equivalence', 'production-build'],
  'promote-production': ['tree-equivalence', 'production-build', 'smoke', 'apply-migrations'],
  'post-promotion-health': ['promote-production'],
  'rollback-app': ['promote-production', 'post-promotion-health'],
};

/**
 * The closed list of production-class secret names (deploy tokens and production database URLs),
 * plus the shape that catches a renamed one. A job that reads any of these is production-capable
 * even without an `environment:`; `mentionsDeploymentSecrets` separately treats EVERY secret other
 * than GITHUB_TOKEN as production-AFFECTING, which is the stricter gate-closure rule (R3-01).
 */
export const PRODUCTION_SECRETS = [
  'PRODUCTION_DATABASE_URL',
  'VERCEL_TOKEN',
  'VERCEL_PROJECT_ID',
  'VERCEL_ORG_ID',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
];

/**
 * R6REL-01, GATE-SET RULE. The gates the standard requires, pinned HERE rather than taken from the
 * repository's policy file. `release.required_gates` is data: a generated project carries its own
 * `ops/release/global-policy.yaml`, and the sixth review cut that file down to a single gate, which
 * silently shrank the dependency closure every production job had to satisfy. The policy file may
 * now only ADD to this set; a policy that omits one of these gates fails the gate, whatever the
 * launch manifest, the digest manifest or the provenance rule say.
 *
 * This is the set the standard delivers for every template version pinned by
 * DELIVERED_RELEASE_CONTROLS (see ops/release/validate-workflows.mjs). A template version that
 * changes the canonical gate set turns this constant into a per-version map in the same reviewed
 * change; it is not a per-repository setting in either shape.
 */
export const CANONICAL_REQUIRED_GATES = [
  'lint',
  'typecheck',
  'build',
  'unit_tests',
  'integration_tests',
  'e2e_tests',
  'security_scan',
  'dependency_scan',
  'secret_scan',
  'access_isolation',
  'migrations',
  'environment_isolation',
  'operational_readiness',
];

export const PRODUCTION_SECRET_SHAPE = /(?:^|_)PROD(?:UCTION)?(?:_|$)|(?:^|_)(?:DEPLOY|DEPLOYMENT|VERCEL|NETLIFY|CLOUDFLARE|FLY|WRANGLER)(?:_|$)/;

export function isProductionSecret(name) {
  const text = String(name ?? '').trim().toUpperCase();
  if (text === '') return false;
  return PRODUCTION_SECRETS.includes(text) || PRODUCTION_SECRET_SHAPE.test(text);
}

const BLANK_OR_COMMENT = /^\s*(?:#.*)?$/;
const RELEASE_KEY = /^release:\s*(?:#.*)?$/;
const REQUIRED_GATES_BLOCK = /^ {2}required_gates:\s*(?:#.*)?$/;
const REQUIRED_GATES_FLOW = /^ {2}required_gates:\s*\[(.*)\]\s*(?:#.*)?$/;
const REQUIRED_GATES_ITEM = /^ {4,}-\s+(.+)$/;
const PRODUCTION_JOB = /^ {2}production_job:\s*(.+)$/;

function scalar(value) {
  const withoutComment = /\s#/.test(value) ? value.slice(0, value.search(/\s#/)) : value;
  const text = withoutComment.trim();
  const quoted = (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"));
  return quoted && text.length > 1 ? text.slice(1, -1) : text;
}

/**
 * Read `release.required_gates` and `release.production_job` from a policy document.
 * Only the block-list and flow-list spellings of a plain string list are accepted; anything else
 * (an anchor, a nested mapping, a merge key) is refused rather than half-understood.
 */
export function parseReleasePolicyText(text, source = '<policy>') {
  const lines = String(text).split(/\r?\n/);
  let inRelease = false;
  let collecting = false;
  let requiredGates = null;
  let productionJob = null;
  for (const line of lines) {
    if (BLANK_OR_COMMENT.test(line)) continue;
    if (!/^\s/.test(line)) {
      inRelease = RELEASE_KEY.test(line);
      collecting = false;
      continue;
    }
    if (!inRelease) continue;
    if (collecting) {
      const item = REQUIRED_GATES_ITEM.exec(line);
      if (item) {
        requiredGates.push(scalar(item[1]));
        continue;
      }
      collecting = false;
    }
    const flow = REQUIRED_GATES_FLOW.exec(line);
    if (flow) {
      requiredGates = flow[1].split(',').map((entry) => scalar(entry)).filter((entry) => entry.length > 0);
      continue;
    }
    if (REQUIRED_GATES_BLOCK.test(line)) {
      requiredGates = [];
      collecting = true;
      continue;
    }
    const job = PRODUCTION_JOB.exec(line);
    if (job) {
      const value = scalar(job[1]);
      productionJob = value === '' || value === 'null' || value === '~' ? null : value;
    }
  }
  if (!Array.isArray(requiredGates) || requiredGates.length === 0
    || requiredGates.some((gate) => typeof gate !== 'string' || gate.length === 0 || /[^A-Za-z0-9_.-]/.test(gate))) {
    throw new Error(`${source}: release.required_gates must be a non-empty list of plain gate names`);
  }
  return { requiredGates, productionJobId: productionJob };
}

/**
 * R5-02: the policy decides WHICH gates the structural analysis requires, so where it is read from
 * is part of the critical path. The old list ended in a fallback next to this module, which in a
 * generated project resolves to the same `ops/release/` directory the gate itself lives in and
 * hides a downgrade behind a second name. The candidates are now exactly two repository-relative
 * locations - the standard's own copy, and the copy a generated project receives - and a repository
 * with neither fails closed instead of degrading to whatever sits beside the script.
 */
export function releasePolicyCandidates(policyPath, rootDir) {
  const root = resolve(rootDir);
  return [
    policyPath,
    join(root, 'standard/policy/global-policy.yaml'),
    join(root, 'ops/release/global-policy.yaml'),
  ];
}

export function loadReleasePolicy(policyPath = join(process.cwd(), 'standard/policy/global-policy.yaml'), rootDir = process.cwd()) {
  const candidates = releasePolicyCandidates(policyPath, rootDir);
  const selected = candidates.find((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate));
  if (!selected) throw new Error(`release policy not found; expected one of ${candidates.join(', ')}`);
  const parsed = parseReleasePolicyText(readFileSync(selected, 'utf8'), selected);
  return { ...parsed, policyPath: selected };
}
