export function evaluateGates(required, results) {
  if (!Array.isArray(required)) return { pass: false, failing: [], missing: [] };
  const failing = new Set();
  const missing = new Set();
  for (const name of required) {
    const result = results && typeof results === 'object' ? results[name] : undefined;
    if (!result) missing.add(name);
    else if (result.status !== 'passed' || typeof result.evidence_ref !== 'string' || result.evidence_ref.trim() === '') failing.add(name);
  }
  return { pass: failing.size === 0 && missing.size === 0, failing: [...failing].sort(), missing: [...missing].sort() };
}
