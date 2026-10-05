import { ANONIEM, contrastProblemen, engelseResten, expect, LID, test } from "./helpers";

// Roadmap 11H: what every klus must survive before Sid sees it, on a phone and on a computer.
test.describe("zonder inloggen", () => {
  test.use({ storageState: ANONIEM });

  test("de kopbalk biedt alleen inloggen aan", async ({ page }) => {
    await page.goto("/sign-in");
    const nav = page.getByRole("navigation", { name: "Hoofdmenu" });
    await expect(nav.getByRole("link", { name: "Inloggen" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Uitloggen" })).toHaveCount(0);
  });

  test("de klantpagina toont alleen de winkelkop en een werkplaatslink", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Hoofdmenu" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Voor de werkplaats" })).toBeVisible();
  });

  test("het overzicht is afgeschermd", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("een verkeerde code krijgt een Nederlandse uitleg", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("E-mailadres").fill(LID);
    await page.getByRole("button", { name: "Stuur inlogcode" }).click();
    await page.getByLabel("Inlogcode").fill("000000");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await expect(page.locator("p.error")).toHaveText("Deze code klopt niet of is verlopen. Vraag een nieuwe code aan.");
    await expect(page.getByLabel("Inlogcode")).toBeVisible();
  });

  test("leesbaar en Nederlands", async ({ page }) => {
    for (const pad of ["/", "/sign-in"]) {
      await page.goto(pad);
      expect(await contrastProblemen(page), pad).toEqual([]);
      expect(engelseResten(await page.locator("body").innerText()), pad).toEqual([]);
    }
  });
});

test.describe("als lid", () => {
  test("het overzicht opent met de kopbalk van een ingelogde gebruiker, zonder fouten", async ({ page, errors }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    const nav = page.getByRole("navigation", { name: "Hoofdmenu" });
    await expect(nav.getByRole("button", { name: "Uitloggen" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Inloggen" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("leesbaar en Nederlands na inloggen", async ({ page }) => {
    await page.goto("/dashboard");
    expect(await contrastProblemen(page)).toEqual([]);
    expect(engelseResten(await page.locator("body").innerText())).toEqual([]);
  });
});
