import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./helpers";
import {
  afspraakBinnen24Uur, boek, dag, dagLabel, klantApi, klantPagina, legeDag, melding, opmaakProblemen, tijdvak, uniek,
  werkplaatsDag, zetCapaciteit, zetStatus, zondag,
} from "./spaak-hulp";

/**
 * Werkstuk W6 (route D trial, 05-10): the customer scenarios S1-S11 and S17 of the Spaak product card, on a phone,
 * against the protected preview and its real staging database. Each title starts with the scenario id and the describe
 * block is anonymous, so the JUnit name starts with the id: the evidence register reads the report by that id.
 * Revised after a read-only review (05-10): anonymous API client, the empty Next.js route announcer is not an alert,
 * S3/S7/S11 prove what the card says, S17 also covers a server that does not answer.
 * Written by the meester; builders may not change this file.
 */

let api: APIRequestContext;
test.beforeAll(async () => { api = await klantApi(); });
test.afterAll(async () => { await api.dispose(); });

const CONTACT = { Naam: "Femke de Wit", Telefoon: "06 1234 5678", "E-mail": "femke@example.com",
                  "Wat is er met je fiets?": "Gazelle, ketting piept" };

async function naarGegevens(page: Page, date: string, start: string, reparatie = /Onderhoudsbeurt/) {
  await page.goto(`/?datum=${date}`);
  await page.getByRole("button", { name: reparatie }).click();
  await expect(page.getByRole("heading", { name: "Wanneer kom je?" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${start}\\s*[–-]`) }).click();
  await expect(page.getByRole("heading", { name: "Wie ben je?" })).toBeVisible();
}

async function vulIn(page: Page, over: Partial<typeof CONTACT> = {}) {
  for (const [label, value] of Object.entries({ ...CONTACT, ...over })) await page.getByLabel(label).fill(value);
}

async function statusVan(page: Page, code: string) {
  await page.goto("/status");
  await page.getByLabel("Afspraakcode").fill(code);
  await page.getByRole("button", { name: "Bekijk status" }).click();
}

const bevestigd = (page: Page) => page.getByRole("heading", { name: "Je afspraak staat" });

test.describe(() => {
  test("S1 afspraak maken in een vrij tijdvak", async ({ page, errors }) => {
    const date = await legeDag(api);
    await naarGegevens(page, date, "09:00");
    await vulIn(page);
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(bevestigd(page)).toBeVisible();
    const code = (await page.getByLabel("Afspraakcode").textContent())?.replace(/\s/g, "") ?? "";
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    const samenvatting = page.locator(".spaak-confirmation");
    await expect(samenvatting).toContainText(dagLabel(date));
    await expect(samenvatting).toContainText(/09:00\s*[–-]\s*10:00/);
    await expect(samenvatting).toContainText("Onderhoudsbeurt");
    expect((await tijdvak(api, date, "09:00")).vrij).toBe(1);
    expect(errors).toEqual([]);
  });

  test("S2 vol tijdvak is niet te kiezen", async ({ page }) => {
    const date = await legeDag(api);
    await boek(api, { date, start: "09:00" });
    await boek(api, { date, start: "09:00" });
    await page.goto(`/?datum=${date}`);
    await page.getByRole("button", { name: /Onderhoudsbeurt/ }).click();
    await expect(page.getByRole("button", { name: /^09:00\s*[–-]\s*10:00.*Vol/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^10:00\s*[–-]\s*11:00$/ })).toBeEnabled();
  });

  test("S3 twee klanten tegelijk voor de laatste plek", async ({ browser, page }) => {
    const date = await legeDag(api);
    await boek(api, { date, start: "10:00" });
    const [een, twee] = [await klantPagina(browser), await klantPagina(browser)];
    try {
      for (const klant of [een, twee]) {
        await naarGegevens(klant, date, "10:00");
        await vulIn(klant, { Naam: uniek("Gelijktijdig") });
      }
      await Promise.all([een, twee].map((klant) => klant.getByRole("button", { name: "Bevestigen" }).click()));
      for (const klant of [een, twee]) await expect(bevestigd(klant).or(melding(klant))).toBeVisible();
      const uitkomst = [await bevestigd(een).isVisible(), await bevestigd(twee).isVisible()];
      expect(uitkomst.filter(Boolean)).toHaveLength(1);
      const verliezer = uitkomst[0] ? twee : een;
      await expect(melding(verliezer)).toContainText("Dit tijdvak is net vol geraakt. Kies een ander tijdvak.");
      await expect(verliezer.getByLabel("Naam")).toHaveValue(/^Gelijktijdig /);
      const tien = (await werkplaatsDag(page, date)).tijdvakken.find((slot) => slot.start === "10:00");
      expect(tien?.afspraken).toHaveLength(2);
    } finally {
      await een.context().close();
      await twee.context().close();
    }
  });

  test("S4 dubbel verzenden geeft één afspraak", async ({ page }) => {
    const date = await legeDag(api);
    const verzonden: { key: string; body: string }[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/spaak/afspraken") {
        verzonden.push({ key: request.headers()["idempotency-key"] ?? "", body: request.postData() ?? "" });
      }
    });
    await naarGegevens(page, date, "11:00");
    await vulIn(page);
    await page.getByRole("button", { name: "Bevestigen" }).dblclick();
    await expect(bevestigd(page)).toBeVisible();
    const code = (await page.getByLabel("Afspraakcode").textContent())?.replace(/\s/g, "");
    expect(verzonden.length).toBeGreaterThan(0);
    expect(new Set(verzonden.map((v) => v.key)).size).toBe(1);
    // The browser repeats the request (same key, same body): the same appointment comes back, no second one.
    const herhaald = await api.post("/api/spaak/afspraken", {
      headers: { "Idempotency-Key": verzonden[0].key, "Content-Type": "application/json" }, data: verzonden[0].body });
    expect([200, 201]).toContain(herhaald.status());
    expect((await herhaald.json() as { code: string }).code).toBe(code);
    expect((await tijdvak(api, date, "11:00")).vrij).toBe(1);
  });

  test("S5 ongeldige invoer", async ({ page }) => {
    const date = await legeDag(api);
    await naarGegevens(page, date, "12:00");
    await vulIn(page, { Telefoon: "06 12a4 5678", "E-mail": "femke.example.com" });
    await page.getByRole("button", { name: "Bevestigen" }).click();
    for (const label of ["Telefoon", "E-mail"]) {
      const field = page.getByLabel(label);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      const described = await field.getAttribute("aria-describedby");
      expect(described, `${label} heeft een uitleg`).toBeTruthy();
      await expect(page.locator(`[id="${described?.split(/\s+/)[0]}"]`)).not.toBeEmpty();
    }
    await expect(page.getByLabel("Telefoon")).toHaveValue("06 12a4 5678");
    await expect(page.getByLabel("E-mail")).toHaveValue("femke.example.com");
    await expect(page.getByLabel("Naam")).toHaveValue(CONTACT.Naam);
    await expect(bevestigd(page)).toHaveCount(0);
    expect((await tijdvak(api, date, "12:00")).vrij).toBe(2);
  });

  test("S6 gesloten dag of niets meer vrij", async ({ page }) => {
    const sunday = zondag();
    await page.goto(`/?datum=${sunday}`);
    await page.getByRole("button", { name: /Onderhoudsbeurt/ }).click();
    await expect(page.getByText("Op deze dag is de werkplaats gesloten.")).toBeVisible();
    const volgende = (await dag(api, sunday)).volgende;
    expect(volgende).toBeTruthy();
    await page.getByRole("button", { name: dagLabel(volgende!) }).click();
    await expect(page.getByRole("button", { name: /^\d\d:00\s*[–-]\s*\d\d:00$/ }).first()).toBeEnabled();

    const vol = await legeDag(api);
    for (const start of ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]) {
      await zetCapaciteit(page, vol, start, 0);
    }
    await page.goto(`/?datum=${vol}`);
    await page.getByRole("button", { name: /Onderhoudsbeurt/ }).click();
    await expect(page.getByText("Deze dag is helemaal vol.")).toBeVisible();
    const daarna = (await dag(api, vol)).volgende;
    expect(daarna).toBeTruthy();
    await expect(page.getByRole("button", { name: dagLabel(daarna!) })).toBeEnabled();
  });

  test("S7 lange naam en omschrijving op een smalle telefoon", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const date = await legeDag(api);
    const naam = "Annemarie-Wilhelmina van der Voort tot Oosterbeek-Langeveldt";
    const fiets = "Achterwiel slingert en de ketting loopt eraf; ".repeat(11).slice(0, 500);
    expect([naam.length, fiets.length]).toEqual([60, 500]);
    await naarGegevens(page, date, "13:00");
    await vulIn(page, { Naam: naam, "Wat is er met je fiets?": fiets });
    await expect(page.getByLabel("Naam")).toHaveValue(naam);
    await expect(page.getByLabel("Wat is er met je fiets?")).toHaveValue(fiets);
    for (const label of ["Naam", "Wat is er met je fiets?"]) {
      const box = await page.getByLabel(label).boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 375, `${label} binnen 375px`).toBe(true);
    }
    expect(await opmaakProblemen(page)).toEqual([]);
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(bevestigd(page)).toBeVisible();
    expect(await opmaakProblemen(page)).toEqual([]);
    // The long name and description are shown in full where they are read back: the mechanic's day (K375 checks
    // that page at this width).
    const geboekt = (await werkplaatsDag(page, date)).tijdvakken.flatMap((slot) => slot.afspraken);
    expect(geboekt.some((afspraak) => afspraak.naam === naam)).toBe(true);
  });

  test("S8 status opzoeken met de code", async ({ page }) => {
    const date = await legeDag(api);
    const code = await boek(api, { date, start: "14:00" });
    await zetStatus(page, code, "ontvangen");
    await zetStatus(page, code, "bezig");
    await statusVan(page, code);
    const kaart = page.locator("main");
    await expect(kaart).toContainText("Bezig");
    await expect(kaart).toContainText(dagLabel(date));
    await expect(kaart).toContainText(/14:00\s*[–-]\s*15:00/);
    await expect(kaart).toContainText("Onderhoudsbeurt");
  });

  test("S9 onbekende code", async ({ page }) => {
    await statusVan(page, "ZZZZZZ");
    await expect(page.getByText("Geen afspraak gevonden met deze code")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Tijdvak");
    await expect(page.locator("main")).not.toContainText("Reparatie");
  });

  test("S10 annuleren op tijd", async ({ page }) => {
    const date = await legeDag(api);
    const code = await boek(api, { date, start: "15:00" });
    expect((await tijdvak(api, date, "15:00")).vrij).toBe(1);
    await statusVan(page, code);
    await page.getByRole("button", { name: "Afspraak annuleren" }).click();
    await page.getByRole("button", { name: "Ja, annuleren" }).click();
    await expect(page.locator("main")).toContainText("Geannuleerd");
    expect((await tijdvak(api, date, "15:00")).vrij).toBe(2);
  });

  test("S11 annuleren te laat", async ({ page }) => {
    const { code, datum } = await afspraakBinnen24Uur(api);
    await statusVan(page, code);
    await expect(page.locator("main")).toContainText("Gepland");
    await page.getByRole("button", { name: "Afspraak annuleren" }).click();
    await page.getByRole("button", { name: "Ja, annuleren" }).click();
    await expect(melding(page)).toContainText("Annuleren kan niet meer online");
    await expect(melding(page)).toContainText("010-555 01 42");
    const rij = (await werkplaatsDag(page, datum)).tijdvakken.flatMap((slot) => slot.afspraken).find((a) => a.code === code);
    expect(rij?.status).toBe("gepland");
  });

  test("S17 server niet bereikbaar bij bevestigen", async ({ page }) => {
    const date = await legeDag(api);
    await naarGegevens(page, date, "16:00");
    await vulIn(page);
    await page.route("**/api/spaak/afspraken", (route) => route.abort("connectionrefused"));
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(melding(page)).toBeVisible({ timeout: 15_000 });
    await expect(melding(page).getByRole("button", { name: "Opnieuw proberen" })).toBeVisible();
    await expect(page.getByLabel("Naam")).toHaveValue(CONTACT.Naam);
    await page.unroute("**/api/spaak/afspraken");
    await melding(page).getByRole("button", { name: "Opnieuw proberen" }).click();
    await expect(bevestigd(page)).toBeVisible();
    expect((await tijdvak(api, date, "16:00")).vrij).toBe(1);
  });

  test("S17 server antwoordt niet bij bevestigen", async ({ page }) => {
    const date = await legeDag(api);
    await naarGegevens(page, date, "15:00");
    await vulIn(page);
    // The request never gets an answer; the page gives up on its own (15 s) and offers a retry with the same key.
    await page.route("**/api/spaak/afspraken", () => undefined);
    const start = Date.now();
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(melding(page)).toBeVisible({ timeout: 16_500 });
    expect(Date.now() - start).toBeLessThan(16_500);
    await expect(page.getByLabel("Naam")).toHaveValue(CONTACT.Naam);
    await page.unroute("**/api/spaak/afspraken");
    await melding(page).getByRole("button", { name: "Opnieuw proberen" }).click();
    await expect(bevestigd(page)).toBeVisible();
    expect((await tijdvak(api, date, "15:00")).vrij).toBe(1);
  });
});
