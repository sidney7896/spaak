// Publish the post-promotion health report as job outputs.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/health-outputs.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R3-08 (upstream half): an absent, empty or multi-line health value is refused here, so the health
// job fails instead of publishing an output that later reads as zero. The downstream half is
// rollback-payload.mjs, which turns an empty output into malformed_input rather than "healthy".
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HEALTH_OUTPUTS = [
  'failed_checks',
  'total_checks',
  'consecutive_failures',
  'provider_outage',
  'previous_release_id',
  'previous_release_compatible',
];

export function healthOutputBlock(health) {
  if (health === null || typeof health !== 'object' || Array.isArray(health)) {
    throw new Error('health report is not a JSON object');
  }
  return HEALTH_OUTPUTS.map((name) => {
    const raw = health[name];
    if (raw === undefined || raw === null) throw new Error(`health output missing ${name}`);
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (value.trim() === '' || value.includes('\n')) throw new Error(`health output ${name} is empty or multi-line`);
    return `${name}<<EOF\n${value}\nEOF\n`;
  }).join('');
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
  const reportPath = args.find((argument) => !argument.startsWith('--') && args[args.indexOf(argument) - 1] !== '--github-output') ?? 'health.json';
  const outputPath = argumentValue(args, '--github-output', process.env.GITHUB_OUTPUT ?? null);
  try {
    const block = healthOutputBlock(JSON.parse(readFileSync(reportPath, 'utf8')));
    if (outputPath) appendFileSync(outputPath, block);
    else process.stdout.write(block);
  } catch (error) {
    process.stderr.write(`Post-promotion health outputs refused: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
