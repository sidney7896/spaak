import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// Roadmap 11G: the automatic inspection of a generated project rejects a deployment without these
// response headers. They are set once in next.config.ts so that every route, static or dynamic, carries them.
const expected: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

describe("every response carries the security headers", () => {
  it("declares one rule for every path with exactly the expected headers", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const rules = await nextConfig.headers!();
    const all = rules.filter((rule) => rule.source === "/:path*");
    expect(all).toHaveLength(1);
    expect(Object.fromEntries(all[0].headers.map(({ key, value }) => [key, value]))).toEqual(expected);
  });

  it("keeps React strict mode on", () => {
    expect(nextConfig.reactStrictMode).toBe(true);
  });
});
