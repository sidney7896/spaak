import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_PATTERNS = [
  { name: 'prefixed-token', regex: /\b(?:sk_(?:live|test)_|gh[pousr]_\w{8,}|xox[baprs]-\w{8,}|sbp_\w{16,}|phc_\w{16,}|re_\w{16,})[A-Za-z0-9_-]{8,}/g },
  { name: 'cloud-key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'github-fine-grained-token', regex: /\bgithub_pat_[0-9A-Za-z_]{22,}\b/g },
  { name: 'gitlab-token', regex: /\bglpat-[0-9A-Za-z_-]{20,}\b/g },
  { name: 'package-token', regex: /\b(?:npm|dop_v1)_[0-9A-Za-z_-]{16,}\b/g },
  { name: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'secret-assignment', regex: /\b(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*["']?([A-Za-z0-9_+/=-]{20,})/gi },
];

function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
}

function isHash(value) {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
}

function entropyCandidates(line) {
  const words = line.match(/\b[A-Za-z0-9+/=_-]{24,}\b/g) ?? [];
  return words.filter((word) => !isHash(word) && /[A-Z]/.test(word) && /[a-z]/.test(word) && /\d/.test(word) && entropy(word) >= 4.1);
}

export function loadAllowList(text = '') {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

// R3-07: a `path:` entry used to suppress EVERY detector in a whole file, so twelve repository
// paths were fully exempt and a real AWS key or `sk_live_` token planted in any of them was
// reported nowhere. A whole-file entry now suppresses only the two heuristic detectors, which are
// the ones that produce fixture noise; every high-confidence token detector still fires inside an
// allowlisted file unless that exact value is listed.
const HEURISTIC_DETECTORS = new Set(['entropy', 'secret-assignment']);

function matchesPath(pattern, file) {
  if (!pattern.includes('*')) return pattern === file;
  const expression = `^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`;
  return new RegExp(expression).test(file);
}

/**
 * Allowlist entry forms:
 *   <exact value>              suppress this exact value ANYWHERE, heuristic detectors only
 *   path:<glob>#<exact value>  suppress this exact token only inside matching files
 *   path:<glob>                suppress ONLY entropy/secret-assignment noise inside matching files
 *
 * R5-06: a bare entry used to suppress every detector in every file, and it was the one entry form
 * the guard test did not constrain - so a real `sk_live_…`, `AKIA…` or private key parked as an
 * allowlist line was reported nowhere, in this repository and in every generated project. A bare
 * entry now reaches the two heuristic detectors only (which is all the shipped ones need: they are
 * long repository paths that the entropy heuristic reads as tokens). Suppressing a high-confidence
 * token still requires the scoped `path:<glob>#<value>` form, which names the file it lives in.
 */
export function matchesAllowList(candidate, file, allowList, detector) {
  const entries = Array.isArray(allowList) ? allowList : [...allowList];
  return entries.some((entry) => {
    if (!entry.startsWith('path:')) return HEURISTIC_DETECTORS.has(detector) && entry === candidate;
    const rest = entry.slice(5);
    const separator = rest.indexOf('#');
    if (separator >= 0) return matchesPath(rest.slice(0, separator), file) && rest.slice(separator + 1) === candidate;
    return HEURISTIC_DETECTORS.has(detector) && matchesPath(rest, file);
  });
}

/**
 * The exact values a scoped `path:<glob>#<value>` entry declares. R5-06: the allowlist file used to
 * be skipped by the traversal entirely. It is scanned now; the only values it may legitimately
 * contain are the ones it declares as scoped synthetic fixtures, so those - and nothing else - are
 * suppressed inside the allowlist file itself. A bare entry, a comment or a stray paste is not
 * declared this way and is reported.
 */
export function declaredAllowListValues(allowList) {
  const entries = Array.isArray(allowList) ? allowList : [...allowList];
  const values = new Set();
  for (const entry of entries) {
    if (!entry.startsWith('path:')) continue;
    const separator = entry.indexOf('#');
    if (separator >= 0) values.add(entry.slice(separator + 1));
  }
  return values;
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

/**
 * `heuristics: false` keeps every high-confidence token detector and drops the two that guess
 * (`entropy`, `secret-assignment`). It is used for generated content - build output and the
 * printable runs of a binary - where those two produce nothing but noise (a minified bundle is one
 * long high-entropy line, and `token:"…"` appears in every source map) while a real `sk_live_`,
 * `AKIA…`, `sbp_…` or private key still has to be reported.
 */
export function scanText(text, { file = '<input>', allowList = new Set(), entropyScan = true, heuristics = true, allowListSelf = false } = {}) {
  const source = String(text);
  const findings = [];
  const declared = allowListSelf ? declaredAllowListValues(allowList) : null;
  const suppressed = (candidate, detector) => (declared !== null && declared.has(candidate))
    || matchesAllowList(candidate, file, allowList, detector);
  for (const pattern of TOKEN_PATTERNS) {
    if (!heuristics && HEURISTIC_DETECTORS.has(pattern.name)) continue;
    for (const match of source.matchAll(pattern.regex)) {
      const candidate = match[1] ?? match[0];
      if (!suppressed(candidate, pattern.name)) {
        findings.push({ file, line: lineNumber(source, match.index ?? 0), detector: pattern.name, value: candidate });
      }
    }
  }
  if (entropyScan && heuristics) {
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const candidate of entropyCandidates(line)) {
        if (!suppressed(candidate, 'entropy')) findings.push({ file, line: index + 1, detector: 'entropy', value: candidate });
      }
    });
  }
  return findings.filter((finding, index, all) => all.findIndex((other) => (
    other.file === finding.file
    && other.line === finding.line
    && other.detector === finding.detector
    && other.value === finding.value
  )) === index);
}

// R4-09: `dist`, `.next` and `coverage` used to be skipped, so a credential baked into a committed
// build output was never seen. They are traversed now; only the directories that can never hold
// repository content are skipped. Build output is generated, so it is scanned with the high-
// confidence detectors only (see BUILD_OUTPUT below) - measured on this repository, traversing it
// with the heuristics on produced 367 false positives and 2 real `sbp_`-shaped hits.
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.turbo']);
const BUILD_OUTPUT = /(?:^|\/)(?:dist|\.next|coverage|build|out|\.output|\.svelte-kit)(?:\/|$)/;

// R4-09: a file containing a NUL byte used to be `continue`d without any finding, which is not the
// same as the `unreadable` finding the adjacent catch produces - a planted key inside a binary was
// reported nowhere. A binary is now scanned over its printable runs with the entropy heuristic off:
// every high-confidence token detector still fires, and ordinary binaries (images, fonts, archives)
// do not drown the gate in entropy noise.
const PRINTABLE_RUN = /[\t\n\r\x20-\x7e]{6,}/g;

export function printableRuns(buffer) {
  return (buffer.toString('latin1').match(PRINTABLE_RUN) ?? []).join('\n');
}

/** Is `candidate` (a real path) the scanned root or inside it? No boundary means "anywhere". */
function withinRoot(boundary, candidate) {
  if (!boundary) return true;
  return candidate === boundary || candidate.startsWith(`${boundary}${sep}`);
}

function filesIn(path, visited = new Set(), boundary = null) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return [];
  let realPath;
  try {
    realPath = realpathSync(absolute);
    if (visited.has(realPath)) return [];
    visited.add(realPath);
    if (lstatSync(realPath).isFile()) return [realPath];
  } catch {
    return [];
  }
  const result = [];
  for (const entry of readdirSync(realPath, { withFileTypes: true })) {
    // R8REL-08: the NAME decides, and it decides BEFORE the type. `entry.isDirectory()` is false
    // for a SYMLINK called `node_modules`, so the skip list used to miss it and `realpathSync` then
    // followed the link straight out of the repository - measured by the eighth review: 231
    // findings whose paths lay outside the checkout, which makes the delivered `secret_scan` gate
    // unusable in any workspace that reaches its dependencies through a link, and puts foreign file
    // paths in the CI log.
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const child = join(realPath, entry.name);
    // ... and no link is followed OUT of the scanned root either. The gate reports on the tree it
    // was asked about; a link to the host's own files is not part of that tree. The paths the
    // caller named are exempt (they are what it asked for); this bounds what TRAVERSAL discovers.
    let realChild;
    try {
      realChild = realpathSync(child);
    } catch {
      continue;
    }
    if (!withinRoot(boundary, realChild)) continue;
    result.push(...filesIn(child, visited, boundary));
  }
  return result;
}

export function scanPaths(paths, { rootDir = process.cwd(), allowList = new Set(), allowListPath } = {}) {
  const findings = [];
  // NOTE: never `paths.flatMap(filesIn)` - flatMap passes the array index as the second argument,
  // which lands in `visited` and makes every traversal throw and return nothing. That silently
  // turned the whole secret_scan gate into a no-op. One shared `visited` set also de-duplicates
  // overlapping roots and still detects symlink cycles across them.
  const visited = new Set();
  // R8REL-08: the real path of the scanned root, so traversal cannot leave it through a link.
  let boundary = null;
  try {
    boundary = realpathSync(resolve(rootDir));
  } catch {
    boundary = null;
  }
  const files = (Array.isArray(paths) ? paths : [paths]).flatMap((path) => filesIn(path, visited, boundary));
  for (const file of files) {
    // R5-06: the allowlist file itself used to be skipped, so a real credential written into it was
    // invisible to the gate. It is scanned like any other file; only the exact values it declares
    // in the scoped `path:<glob>#<value>` form are suppressed inside it.
    const allowListSelf = Boolean(allowListPath) && resolve(file) === resolve(allowListPath);
    try {
      const content = readFileSync(file);
      const relativeFile = relative(rootDir, file);
      // The allowlist is by construction a list of token-shaped strings, so the two heuristics say
      // nothing there; every high-confidence detector (prefixed-token, cloud-key, jwt, private-key,
      // ...) stays on, which is what makes a parked credential visible.
      const heuristics = !BUILD_OUTPUT.test(relativeFile) && !allowListSelf;
      if (content.includes(0)) {
        findings.push(...scanText(printableRuns(content), { file: relativeFile, allowList, heuristics: false, allowListSelf }));
        continue;
      }
      const entropyScan = !/(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lock)$/i.test(relativeFile);
      findings.push(...scanText(content.toString('utf8'), { file: relativeFile, allowList, entropyScan, heuristics, allowListSelf }));
    } catch {
      // A file that cannot be read is not a passing scan; report it as unavailable.
      findings.push({ file: relative(rootDir, file), line: 1, detector: 'unreadable' });
    }
  }
  return findings;
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
  const rootDir = argumentValue(args, '--root', process.cwd());
  const allowListPath = argumentValue(args, '--allowlist', join(rootDir, 'ops/release/secret-scan.allowlist'));
  const allowList = loadAllowList(existsSync(allowListPath) ? readFileSync(allowListPath, 'utf8') : '');
  const paths = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--allowlist' && args[index - 1] !== '--root');
  const findings = scanPaths(paths.length ? paths : ['.'], { rootDir, allowList, allowListPath });
  for (const finding of findings) process.stderr.write(`Potential secret in ${finding.file}:${finding.line} (${finding.detector})\n`);
  process.exitCode = findings.length ? 1 : 0;
}
