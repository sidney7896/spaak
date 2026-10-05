import { contrastProblemen, engelseResten, expect, schema, serviceKey, supabaseUrl, test } from "./helpers";

// The template's example feature. A klus that removes the notes also removes this file.
const titels: string[] = [];

test.afterAll(async () => {
  for (const titel of titels) {
    await fetch(`${supabaseUrl()}/rest/v1/notes?title=like.${encodeURIComponent(titel)}*`, {
      method: "DELETE",
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, "Content-Profile": schema() },
    });
  }
});

test("een notitie maken en bewerken", async ({ page }) => {
  await page.goto("/notes");
  const titel = `Doorloop ${Date.now()}`;
  titels.push(titel);
  await page.getByLabel("Titel").fill(titel);
  await page.getByLabel("Tekst").fill("Automatische doorloop van de proefversie.");
  await page.getByRole("button", { name: "Notitie opslaan" }).click();
  await expect(page.getByRole("heading", { name: titel })).toBeVisible();
  expect(await contrastProblemen(page)).toEqual([]);
  expect(engelseResten(await page.locator("body").innerText())).toEqual([]);
  await page.getByRole("article").filter({ hasText: titel }).getByRole("link", { name: "Bewerken" }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  await page.getByLabel("Titel").fill(`${titel} (bewerkt)`);
  await page.getByRole("button", { name: "Wijzigingen opslaan" }).click();
  await page.waitForURL(/\/notes$/);
  await expect(page.getByRole("heading", { name: `${titel} (bewerkt)` })).toBeVisible();
});
