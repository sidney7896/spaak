// Generated-project copy. Behaviourally identical to the monorepo ops/release/evaluate-gates.mjs;
// only the import of the core gate contract differs.
import { evaluateGates as coreEvaluateGates } from './core-evaluate-gates.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// GitHub Actions reports a job result as success|failure|cancelled|skipped, while the core gate
// contract speaks 'passed'. Only the exact string 'success' is translated; every other value
// (including 'skipped' and an empty result) is passed through unchanged and therefore fails.
export function normaliseGateResults(results) {
  if (results === null || typeof results !== 'object' || Array.isArray(results)) return results;
  return Object.fromEntries(Object.entries(results).map(([name, entry]) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [name, entry];
    return [name, entry.status === 'success' ? { ...entry, status: 'passed' } : entry];
  }));
}

export function evaluateGates(required, results) {
  return coreEvaluateGates(required, normaliseGateResults(results));
}

function parseJsonArgument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? JSON.parse(args[index + 1]) : undefined;
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
  const required = parseJsonArgument(args, '--required') ?? [];
  const results = parseJsonArgument(args, '--results') ?? {};
  const result = evaluateGates(required, results);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.pass) {
    process.stderr.write(`Required gates failed: ${[...result.failing, ...result.missing].join(', ')}\n`);
    process.exitCode = 1;
  }
}
