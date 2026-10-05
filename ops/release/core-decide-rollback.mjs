const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function decideRollback(input) {
  if (!plain(input) || !plain(input.health) || !Number.isSafeInteger(input.health.failed_checks) || !Number.isSafeInteger(input.health.total_checks) || !Number.isSafeInteger(input.health.consecutive_failures) || input.health.failed_checks > input.health.total_checks || typeof input.provider_outage !== 'boolean' || !Number.isInteger(input.recent_rollbacks) || !Number.isInteger(input.max_rollbacks) || !Number.isInteger(input.confirm_threshold) || input.confirm_threshold < 1) return { action: 'incident', reason: 'malformed_input' };
  if (input.provider_outage) return { action: 'incident', reason: 'provider_outage' };
  if (input.health.failed_checks === 0) return { action: 'none', reason: 'healthy' };
  if (input.health.consecutive_failures < input.confirm_threshold) return { action: 'wait', reason: 'below_confirm_threshold' };
  if (input.recent_rollbacks >= input.max_rollbacks) return { action: 'incident', reason: 'circuit_open' };
  if (!plain(input.previous_release) || typeof input.previous_release.id !== 'string' || input.previous_release.id.length === 0 || input.previous_release.compatible_with_current_schema !== true) return { action: 'incident', reason: 'incompatible_previous_release' };
  return { action: 'rollback', reason: 'health_failure_confirmed' };
}
