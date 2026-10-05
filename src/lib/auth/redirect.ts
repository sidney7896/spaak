const allowedPaths = new Set(["/", "/dashboard", "/notes"]);

export function getSafeRedirect(value: string | null | undefined, origin: string): string {
  if (!value || !allowedPaths.has(value)) return `${origin}/dashboard`;
  try {
    const candidate = new URL(value, origin);
    if (candidate.origin !== origin || candidate.pathname !== value || candidate.search || candidate.hash) {
      return `${origin}/dashboard`;
    }
    return candidate.toString();
  } catch {
    return `${origin}/dashboard`;
  }
}

export function isAllowedRedirect(value: string, origin: string): boolean {
  if (!allowedPaths.has(value)) return false;
  try { return getSafeRedirect(value, origin) === new URL(value, origin).toString(); } catch { return false; }
}
