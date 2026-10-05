import { expect, test as base, type Page } from "@playwright/test";

// Two keuring users on the shared auth pool: the knob makes the first a member of this app's
// staging environment and never the second. Their mail never arrives (example.com); a test asks
// the auth service for the one-time code instead.
export const LID = "keuring-lid@example.com";
export const GEEN_LID = "keuring-geen-lid@example.com";

export { STATE } from "./paden";

/** Anonymous visitors in a project that otherwise reuses the member's session. */
export const ANONIEM = { cookies: [], origins: [] };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ontbreekt voor de browserdoorloop`);
  return value;
}

export const supabaseUrl = () => required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
export const serviceKey = () => required("SUPABASE_SERVICE_ROLE_KEY");
export const schema = () => required("SUPABASE_DB_SCHEMA");

/** Pages reach the protected preview (bypass header on its own host only) and never send a real sign-in mail. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({}, provide) => { await provide([]); },
  page: async ({ page, errors }, provide) => {
    const host = new URL(required("BASE_URL")).host;
    const bypass = required("VERCEL_AUTOMATION_BYPASS_SECRET");
    const supabase = supabaseUrl();
    await page.route("**/*", (route) => {
      const request = route.request();
      if (new URL(request.url()).host === host) return route.continue({ headers: { ...request.headers(), "x-vercel-protection-bypass": bypass } });
      if (request.url().startsWith(`${supabase}/auth/v1/otp`)) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.continue();
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await provide(page);
  },
});
export { expect };

/** A fresh one-time code from the real auth service (admin API; no mail is sent). */
export async function inlogcode(email: string): Promise<string> {
  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const data = (await response.json()) as { email_otp?: string; properties?: { email_otp?: string } };
  const code = data.email_otp ?? data.properties?.email_otp;
  if (!response.ok || !code) throw new Error(`geen inlogcode voor ${email} (status ${response.status})`);
  return code;
}

/** Sign in the way a person does: email, the emailed code, then wherever the app sends them. */
export async function logIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByRole("button", { name: "Stuur inlogcode" }).click();
  await page.getByLabel("Inlogcode").fill(await inlogcode(email));
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in") || url.search.includes("error="));
}

/** Visible text whose contrast against its background is below WCAG AA (4.5:1). */
export async function contrastProblemen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const background = (element: Element | null): number[] => {
      for (let current = element; current; current = current.parentElement) {
        const color = rgb(getComputedStyle(current).backgroundColor);
        if (color.length === 3 || (color.length === 4 && color[3] > 0.5)) return color;
      }
      return [255, 255, 255];
    };
    const problemen: string[] = [];
    for (const element of Array.from(document.querySelectorAll("button, a, input, label, p, h1, h2, h3, span, time, td, th"))) {
      const html = element as HTMLElement;
      if (!html.offsetParent || !html.textContent?.trim()) continue;
      const a = luminance(rgb(getComputedStyle(html).color));
      const b = luminance(background(html));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5) problemen.push(`${html.tagName.toLowerCase()} "${html.textContent.trim().slice(0, 24)}" ${ratio.toFixed(1)}`);
    }
    return problemen;
  });
}

const ENGELS = ["Sign in", "Sign out", "Dashboard", "Loading", "Non-production", "Create note", "Save changes", "Edit note", "Something went wrong", "Try again"];

/** English interface text that should have been Dutch. */
export function engelseResten(tekst: string): string[] {
  return ENGELS.filter((woord) => tekst.includes(woord));
}
