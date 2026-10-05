import type { APIRequestContext, Page } from "@playwright/test";
import { contrastProblemen, expect, test } from "./helpers";
import { boek, klantApi, legeDag, opmaakProblemen, uniek } from "./spaak-hulp";

/**
 * Werkstuk W6 (route D trial, 05-10): the quality limits of the Spaak product card. At 375, 768, 1280 and 1920 pixels
 * every Spaak page has no sideways scroll bar, no text outside its box and no buttons on top of each other (K375,
 * K768, K1280, K1920), with a long name and description on the staff pages. Contrast is checked as a floor; the axe
 * floor (KAXE) and the speed limit (KSNEL) need tools this walk does not have yet and stay "geblokkeerd" in the evidence
 * register until they are added. Written by the meester; builders may not change this file.
 */

let api: APIRequestContext;
let datum: string;
let langeNaam: string;
test.beforeAll(async () => {
  api = await klantApi();
  datum = await legeDag(api);
  langeNaam = uniek("Annemarie-Wilhelmina van der Voort tot Oosterbeek");
  await boek(api, { date: datum, start: "10:00", naam: langeNaam,
                    fiets: "Achterwiel slingert en de ketting loopt eraf; ".repeat(11).slice(0, 500) });
});
test.afterAll(async () => { await api.dispose(); });

const PAGINAS = () => [`/?datum=${datum}`, "/status", `/werkplaats?datum=${datum}`, `/beheer?datum=${datum}`];

/** Wait for the real content of each page instead of network silence, so an error or a loading state never passes. */
async function geladen(page: Page, pad: string) {
  if (pad.startsWith("/?")) await expect(page.getByRole("heading", { name: "Wat moet er aan je fiets gebeuren?" })).toBeVisible();
  else if (pad === "/status") await expect(page.getByRole("heading", { name: "Hoe staat het met je fiets?" })).toBeVisible();
  else if (pad.startsWith("/werkplaats")) await expect(page.getByRole("article", { name: langeNaam })).toBeVisible();
  else await expect(page.getByRole("button", { name: "Opslaan 10:00 – 11:00" })).toBeVisible();
}

for (const breedte of [375, 768, 1280, 1920]) {
  test(`K${breedte} geen zijwaartse scroll, geen tekst buiten zijn kader, geen overlappende knoppen`, async ({ page }) => {
    await page.setViewportSize({ width: breedte, height: 900 });
    for (const pad of PAGINAS()) {
      await page.goto(pad);
      await geladen(page, pad);
      expect(await opmaakProblemen(page), `${pad} op ${breedte}px`).toEqual([]);
      if (pad.startsWith("/?")) {
        await page.getByRole("button", { name: /Onderhoudsbeurt/ }).click();
        await expect(page.getByRole("button", { name: /^10:00\s*[–-]\s*11:00/ })).toBeVisible();
        expect(await opmaakProblemen(page), `${pad} stap 2 op ${breedte}px`).toEqual([]);
      }
    }
  });
}

test("leesbaar: genoeg contrast op elke Spaak-pagina", async ({ page }) => {
  for (const pad of PAGINAS()) {
    await page.goto(pad);
    await geladen(page, pad);
    expect(await contrastProblemen(page), pad).toEqual([]);
  }
});
