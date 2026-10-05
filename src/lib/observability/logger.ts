const sensitiveKey = /password|secret|token|key|authorization|cookie|dsn/i;
const sensitiveValuePattern = /(?:bearer\s+|(?:api[_-]?key|token|secret|password|dsn)=)[^\s&]+/gi;
// Basic-auth style credentials in any URL: postgres://user:pw@host, https://alice:secret@example.test.
const urlCredentialPattern = /([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;
const jsonWebTokenPattern = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
const privateKeyPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function createCorrelationId(requestId?: string | null): string {
  return requestId?.trim() || crypto.randomUUID();
}

function redactString(value: string): string {
  return value
    .replace(privateKeyPattern, "[REDACTED]")
    .replace(jsonWebTokenPattern, "[REDACTED]")
    .replace(urlCredentialPattern, (_match, scheme: string) => `${scheme}[REDACTED]@`)
    .replace(sensitiveValuePattern, "[REDACTED]");
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : redact(item)]));
  if (typeof value === "string") return redactString(value);
  return value;
}

export function createLogger(requestId?: string | null) {
  const correlationId = createCorrelationId(requestId);
  const output = (fields: Record<string, unknown>) => redact(fields) as Record<string, unknown>;
  return {
    correlationId,
    info(message: string, fields: Record<string, unknown> = {}) { console.info(JSON.stringify(redact({ ...fields, level: "info", message, correlationId }))); },
    error(message: string, fields: Record<string, unknown> = {}) { console.error(JSON.stringify(redact({ ...fields, level: "error", message, correlationId }))); },
  };
}
