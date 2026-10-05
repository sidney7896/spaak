import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { boek, klantApi, klantPagina, legeDag, uniek } from "./spaak-hulp";

/**
 * Werkstuk W7 (route D trial, 05-10): the last two quality limits of the Spaak product card, so the evidence register
 * can judge them instead of reporting them as blocked.
 * - KAXE: axe finds no violation of impact "serious" or "critical" on any Spaak page (a floor, not a verdict).
 * - KSNEL: the customer pages load on a simulated 4G phone (150 ms latency, 1.6 Mbit/s down, CPU 4x slower, empty
 *   cache) with the largest content painted within 2.5 s, and with at most 200 kB of JavaScript over the wire
 *   (compressed) per customer page.
 * Written by the meester; builders may not change this file.
 */

let api: APIRequestContext;
let datum: string;
test.beforeAll(async () => {
  api = await klantApi();
  datum = await legeDag(api);
  await boek(api, { date: datum, start: "10:00", naam: uniek("Toegankelijkheidsproef") });
});
test.afterAll(async () => { await api.dispose(); });

async function ernstig(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe(() => {
  test("KAXE geen ernstige of kritieke toegankelijkheidsfouten op de Spaak-pagina's", async ({ page }) => {
    const stappen: [string, (p: Page) => Promise<void>][] = [
      [`/?datum=${datum}`, async (p) => { await expect(p.getByRole("heading", { name: "Wat moet er aan je fiets gebeuren?" })).toBeVisible(); }],
      [`/?datum=${datum} stap 2`, async (p) => {
        await p.getByRole("button", { name: /Onderhoudsbeurt/ }).click();
        await expect(p.getByRole("heading", { name: "Wanneer kom je?" })).toBeVisible();
      }],
      [`/?datum=${datum} stap 3`, async (p) => {
        await p.getByRole("button", { name: /^11:00\s*[–-]/ }).click();
        await expect(p.getByRole("heading", { name: "Wie ben je?" })).toBeVisible();
      }],
      ["/status", async (p) => { await expect(p.getByRole("heading", { name: "Hoe staat het met je fiets?" })).toBeVisible(); }],
      [`/werkplaats?datum=${datum}`, async (p) => { await expect(p.getByRole("article").first()).toBeVisible(); }],
      [`/beheer?datum=${datum}`, async (p) => { await expect(p.getByRole("button", { name: "Opslaan 10:00 – 11:00" })).toBeVisible(); }],
    ];
    const gevonden: string[] = [];
    for (const [label, klaar] of stappen) {
      const pad = label.split(" ")[0];
      if (!label.includes(" stap ")) await page.goto(pad);
      await klaar(page);
      gevonden.push(...(await ernstig(page)).map((fout) => `${label}: ${fout}`));
    }
    expect(gevonden).toEqual([]);
  });

  test("KSNEL klantpagina's snel genoeg op een 4G-telefoon", async ({ browser }) => {
    for (const pad of [`/?datum=${datum}`, "/status"]) {
      const page = await klantPagina(browser);
      try {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
        });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        let script = 0;
        const pending: Promise<void>[] = [];
        page.on("response", (response) => {
          if (response.request().resourceType() !== "script") return;
          pending.push(response.request().sizes().then((sizes) => { script += sizes.responseBodySize; }).catch(() => undefined));
        });
        await page.goto(pad, { waitUntil: "load" });
        const lcp = await page.evaluate(() => new Promise<number>((resolve) => {
          let latest = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) latest = Math.max(latest, entry.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });
          setTimeout(() => resolve(latest), 1_000);
        }));
        await Promise.all(pending);
        expect(lcp, `${pad}: grootste beeld na ${Math.round(lcp)} ms`).toBeGreaterThan(0);
        expect(lcp, `${pad}: grootste beeld na ${Math.round(lcp)} ms`).toBeLessThanOrEqual(2_500);
        expect(script, `${pad}: ${Math.round(script / 1024)} kB JavaScript`).toBeLessThanOrEqual(200 * 1024);
      } finally {
        await page.context().close();
      }
    }
  });
});
