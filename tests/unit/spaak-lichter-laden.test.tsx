// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Werkstuk W8 (route D trial, 05-10): the browser walk's speed check (KSNEL) measured about 370 kB of compressed
 * JavaScript on every customer page against a limit of 200 kB. The largest single part was the analytics library
 * (posthog-js) and its zod-validated browser config, imported statically by the root layout's AnalyticsBootstrap
 * even when analytics is switched off, as it is in Spaak. Analytics must load only when it can actually run.
 * Written by the meester; the builder may not change this file.
 */

const state = vi.hoisted(() => ({ posthog: 0, loader: 0, analytics: false, init: vi.fn() }));
vi.mock("posthog-js", () => { state.posthog += 1; return { default: { init: state.init } }; });
vi.mock("../../src/lib/observability/posthog-browser", async (importOriginal) => {
  state.loader += 1;
  return await importOriginal();
});
vi.mock("../../src/lib/profile", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/profile")>();
  return { ...real, isModuleEnabled: (name: string) => (name === "analytics" ? state.analytics : real.isModuleEnabled(name)) };
});

beforeEach(() => {
  vi.resetModules();
  state.posthog = 0;
  state.loader = 0;
  state.analytics = false;
  state.init.mockReset();
  document.cookie = "analytics_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function mount() {
  const { AnalyticsBootstrap } = await import("../../src/app/analytics-bootstrap");
  render(<AnalyticsBootstrap />);
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("analytics loads only when it can run", () => {
  it("loads nothing when analytics is switched off", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-posthog-project");
    await mount();
    expect(state.loader).toBe(0);
    expect(state.posthog).toBe(0);
  });

  it("loads nothing without a key or without consent", async () => {
    state.analytics = true;
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    document.cookie = "analytics_consent=granted";
    await mount();
    expect(state.posthog).toBe(0);
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-posthog-project");
    document.cookie = "analytics_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    await mount();
    expect(state.posthog).toBe(0);
  });

  it("loads and starts analytics when it is on, configured and consented", async () => {
    state.analytics = true;
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-posthog-project");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
    document.cookie = "analytics_consent=granted";
    await mount();
    await vi.waitFor(() => expect(state.init).toHaveBeenCalledTimes(1));
    expect(state.init.mock.calls[0][0]).toBe("test-posthog-project");
  });
});
