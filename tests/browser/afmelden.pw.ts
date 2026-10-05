import { expect, GEEN_LID, inlogcode, LID, logIn, test } from "./helpers";

// Runs after every other project: signing out ends the member's session everywhere, and these
// tests spend one-time codes. A clear rate-limit message means the auth service's own brake.
test("een niet-lid wordt geweigerd en weer uitgelogd", async ({ page }) => {
  await logIn(page, GEEN_LID);
  await expect(page).toHaveURL(/error=invite_required/);
  await expect(page.locator("p.error")).toContainText("geen toegang");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("uitloggen sluit de toegang", async ({ page }) => {
  await logIn(page, LID);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("navigation", { name: "Hoofdmenu" }).getByRole("button", { name: "Uitloggen" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("een gebruikte code werkt geen tweede keer", async ({ page }) => {
  const code = await inlogcode(LID);
  const probeer = async () => {
    await page.goto("/sign-in");
    await page.getByLabel("E-mailadres").fill(LID);
    await page.getByRole("button", { name: "Stuur inlogcode" }).click();
    await page.getByLabel("Inlogcode").fill(code);
    await page.getByRole("button", { name: "Inloggen" }).click();
  };
  await probeer();
  await page.waitForURL(/\/dashboard$/);
  await page.getByRole("navigation", { name: "Hoofdmenu" }).getByRole("button", { name: "Uitloggen" }).click();
  await page.waitForLoadState("networkidle");
  await probeer();
  await expect(page.locator("p.error")).toHaveText("Deze code klopt niet of is verlopen. Vraag een nieuwe code aan.");
});
