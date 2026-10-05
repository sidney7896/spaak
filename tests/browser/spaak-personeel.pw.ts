import type { APIRequestContext } from "@playwright/test";
import { ANONIEM, expect, test } from "./helpers";
import {
  boek, bypassHeaders, dagLabel, klantApi, klantPagina, legeDag, melding, tijdvak, uniek, verschuif, vandaag,
  werkplaatsDag, zetCapaciteit,
} from "./spaak-hulp";

/**
 * Werkstuk W6 (route D trial, 05-10): the staff scenarios S12-S17 of the Spaak product card, on a laptop or tablet,
 * against the protected preview and its real staging database. The walk's member is the shop owner on the preview
 * (SPAAK_EIGENAAR_EMAILS), so one signed-in session serves the mechanic's and the owner's pages; that a mechanic may
 * not open the owner's settings is proven by the integration tests. Anonymous describe blocks keep the scenario id at
 * the start of each JUnit name. Revised after a read-only review (05-10). Written by the meester; builders may not
 * change this file.
 */

let api: APIRequestContext;
test.beforeAll(async () => { api = await klantApi(); });
test.afterAll(async () => { await api.dispose(); });

const slot = (page: import("@playwright/test").Page, label: RegExp) =>
  page.locator("section.spaak-workshop-slot", { has: page.getByRole("heading", { name: label }) });

test.describe(() => {
  test("S12 dagoverzicht en status bijwerken", async ({ page, errors }) => {
    const date = await legeDag(api);
    const [a, b, c] = [uniek("Monteurproef A"), uniek("Monteurproef B"), uniek("Monteurproef C")];
    const code = await boek(api, { date, start: "10:00", naam: a });
    await boek(api, { date, start: "10:00", naam: b });
    await boek(api, { date, start: "14:00", naam: c });
    await page.goto(`/werkplaats?datum=${date}`);
    await expect(slot(page, /^10:00\s*[–-]\s*11:00$/).getByRole("article")).toHaveCount(2);
    await expect(slot(page, /^14:00\s*[–-]\s*15:00$/).getByRole("article")).toHaveCount(1);
    await expect(slot(page, /^14:00\s*[–-]\s*15:00$/).getByRole("article", { name: c })).toBeVisible();
    const kaart = page.getByRole("article", { name: a });
    for (const status of ["Ontvangen", "Bezig", "Klaar", "Opgehaald"]) {
      await kaart.getByRole("group", { name: `Status van ${a}` }).getByRole("button", { name: status }).click();
      await expect(kaart.locator(".spaak-workshop-status")).toHaveText(status);
    }
    const lookup = await api.get(`/api/spaak/afspraken/${code}`);
    expect(lookup.status()).toBe(200);
    expect((await lookup.json() as { status: string }).status).toBe("opgehaald");
    expect(errors).toEqual([]);
  });

  test("S13 lege dag voor de monteur", async ({ page }) => {
    const date = await legeDag(api);
    await page.goto(`/werkplaats?datum=${date}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(dagLabel(date));
    await expect(page.getByText("Geen afspraken vandaag")).toBeVisible();
    await page.getByRole("button", { name: "Naar morgen" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(dagLabel(verschuif(date, 1)));
  });

  test("S15 reparatiesoort toevoegen", async ({ page, browser }) => {
    const naam = uniek("Banden wisselen");
    await page.goto("/beheer");
    await page.getByLabel("Naam").fill(naam);
    await page.getByLabel("Duur in minuten").fill("30");
    await page.getByLabel("Prijs in euro").fill("25");
    await page.getByRole("button", { name: "Toevoegen" }).click();
    await expect(page.locator("main")).toContainText(naam);
    const klant = await klantPagina(browser);
    try {
      await klant.goto("/");
      const keuze = klant.getByRole("button", { name: new RegExp(naam) });
      await expect(keuze).toBeVisible();
      await expect(keuze).toContainText(/30 minuten/);
      await expect(keuze).toContainText(/€\s?25/);
      await keuze.click();
      await expect(klant.getByRole("heading", { name: "Wanneer kom je?" })).toBeVisible();
    } finally {
      await klant.context().close();
    }
  });

  test("S16 capaciteit wijzigen", async ({ page }) => {
    const date = await legeDag(api);
    await zetCapaciteit(page, date, "10:00", 3);
    await boek(api, { date, start: "10:00" });
    await boek(api, { date, start: "10:00" });
    expect((await tijdvak(api, date, "10:00")).vrij).toBe(1);
    await page.goto(`/beheer?datum=${date}`);
    await page.getByLabel("Plaatsen 10:00 – 11:00").fill("2");
    await page.getByRole("button", { name: "Opslaan 10:00 – 11:00" }).click();
    await expect(page.locator("main")).toContainText("opgeslagen");
    expect((await tijdvak(api, date, "10:00")).vrij).toBe(0);
    const overzicht = await werkplaatsDag(page, date);
    expect(overzicht.tijdvakken.find((s) => s.start === "10:00")?.afspraken).toHaveLength(2);
    await page.goto(`/?datum=${date}`);
    await page.getByRole("button", { name: /Onderhoudsbeurt/ }).click();
    await expect(page.getByRole("button", { name: /^10:00\s*[–-]\s*11:00.*Vol/ })).toBeDisabled();
  });

  test("S17 server niet bereikbaar in het dagoverzicht", async ({ page }) => {
    const date = await legeDag(api);
    const naam = uniek("Storingsproef");
    await boek(api, { date, start: "09:00", naam });
    await page.goto(`/werkplaats?datum=${date}`);
    const kaart = page.getByRole("article", { name: naam });
    await page.route("**/api/spaak/werkplaats/status", (route) => route.abort("connectionrefused"));
    await kaart.getByRole("button", { name: "Ontvangen" }).click();
    await expect(melding(page)).toBeVisible({ timeout: 15_000 });
    await page.unroute("**/api/spaak/werkplaats/status");
    // The failed change was never saved: the retry reloads the day and shows the real state, then the change works.
    await melding(page).getByRole("button", { name: "Opnieuw proberen" }).click();
    await expect(kaart.locator(".spaak-workshop-status")).toHaveText("Gepland");
    await kaart.getByRole("button", { name: "Ontvangen" }).click();
    await expect(kaart.locator(".spaak-workshop-status")).toHaveText("Ontvangen");
  });
});

test.describe(() => {
  test.use({ storageState: ANONIEM });

  test("S14 geen toegang zonder inloggen", async ({ page }) => {
    for (const pad of ["/werkplaats", "/beheer"]) {
      await page.goto(pad);
      await expect(page).toHaveURL(/\/sign-in/);
      await expect(page.getByLabel("E-mailadres")).toBeVisible();
    }
    const datum = verschuif(vandaag(), 1);
    for (const [method, pad, data] of [
      ["GET", `/api/spaak/werkplaats/dag?datum=${datum}`, undefined],
      ["GET", `/api/spaak/beheer/dag?datum=${datum}`, undefined],
      ["GET", "/api/spaak/beheer/reparaties", undefined],
      ["POST", "/api/spaak/werkplaats/status", { code: "ABCDEF", status: "ontvangen" }],
      ["POST", "/api/spaak/beheer/capaciteit", { datum, start: "10:00", capaciteit: 0 }],
    ] as const) {
      const response = await page.request.fetch(pad, { method, headers: bypassHeaders(), data });
      expect(response.status(), `${method} ${pad}`).toBe(401);
      // The app's own refusal, not the preview protection's: the bypass worked and the route itself said no.
      expect(await response.json(), `${method} ${pad}`).toEqual({ fout: "Log opnieuw in." });
    }
  });
});
