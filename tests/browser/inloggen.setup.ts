import { expect, LID, logIn, STATE, test } from "./helpers";

// The one sign-in of the member per run: the phone flow, the right landing page and navigation,
// no browser errors. Both device projects then reuse this session.
test("een lid logt in met de code uit de mail", async ({ page, errors }) => {
  await logIn(page, LID);
  await expect(page).toHaveURL(/\/dashboard$/);
  const nav = page.getByRole("navigation", { name: "Hoofdmenu" });
  await expect(nav.getByRole("button", { name: "Uitloggen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Inloggen" })).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.context().storageState({ path: STATE });
});
