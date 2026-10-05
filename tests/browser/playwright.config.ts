import { defineConfig } from "@playwright/test";
import { STATE } from "./paden";

// Browser walk of a deployed preview (roadmap 11H): run by the new-klus knob against the real
// deployment, never by vitest. Needs BASE_URL, VERCEL_AUTOMATION_BYPASS_SECRET,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_SCHEMA in the environment.
//
// The auth service accepts about 30 code checks per 5 minutes from one address, so the member
// signs in once ("inloggen"), both devices reuse that session, and everything that signs out or
// spends codes runs last ("afmelden").
const telefoon = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const computer = { viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // W6: the JUnit report is what the evidence register reads (scenario id at the start of each title).
  reporter: [["list"], ["junit", { outputFile: "../../test-results/browser/junit.xml" }]],
  use: { baseURL: process.env.BASE_URL, screenshot: "only-on-failure", trace: "off" },
  projects: [
    { name: "inloggen", testMatch: /inloggen\.setup\.ts$/, use: telefoon },
    { name: "telefoon", testMatch: /\.pw\.ts$/, testIgnore: /(afmelden|spaak-personeel|spaak-breedtes)\.pw\.ts$/, dependencies: ["inloggen"], use: { ...telefoon, storageState: STATE } },
    { name: "computer", testMatch: /\.pw\.ts$/, testIgnore: /(afmelden|spaak-klant)\.pw\.ts$/, dependencies: ["inloggen"], use: { ...computer, storageState: STATE } },
    { name: "afmelden", testMatch: /afmelden\.pw\.ts$/, dependencies: ["telefoon", "computer"], use: computer },
  ],
});
