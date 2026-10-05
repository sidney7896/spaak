// Generated-project copy. Behaviourally identical to the monorepo ops/release/decide-rollback.mjs;
// only the import of the core rollback contract differs. Automatic database restore stays forbidden.
import { decideRollback as coreDecideRollback } from './core-decide-rollback.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function decideRollback(input) {
  const decision = coreDecideRollback(input);
  if (decision?.action === 'restore_database' || decision?.reason === 'database_restore') {
    return { action: 'incident', reason: 'database_restore_forbidden' };
  }
  return decision;
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
  try {
    // R7REL-02: an unreadable payload is a named refusal, not an uncaught stack trace - and never
    // a decision. `rollback-payload.mjs` is the only producer of this argument.
    const payload = process.argv[2] ? JSON.parse(process.argv[2]) : {};
    process.stdout.write(`${JSON.stringify(decideRollback(payload))}\n`);
  } catch (error) {
    process.stderr.write(`rollback_payload_unreadable: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
