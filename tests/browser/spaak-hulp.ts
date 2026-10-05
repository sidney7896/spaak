import { randomBytes, randomInt } from "node:crypto";
import { expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { schema, serviceKey, supabaseUrl } from "./helpers";

/**
 * Werkstuk W6 (route D trial, 05-10): helpers for the Spaak scenario suite. The suite runs against the protected
 * preview and its real (staging) database, three rounds per walk, so every test picks its own empty day far ahead and
 * books its own appointments; nothing depends on what another test or an earlier round left behind. Test data is
 * fictitious (example.com, 06 numbers). Written by the meester; builders may not change this file.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ontbreekt voor de browserdoorloop`);
  return value;
}

export const bypassHeaders = () => ({ "x-vercel-protection-bypass": required("VERCEL_AUTOMATION_BYPASS_SECRET") });

/** An anonymous API client for the public routes, through the preview protection. Playwright would otherwise copy
 * the project's signed-in storage state into the new context, so it is cleared explicitly. */
export async function klantApi(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: required("BASE_URL"), extraHTTPHeaders: bypassHeaders(),
                                        storageState: { cookies: [], origins: [] } });
}

/** The visible alert of a page. Next.js keeps an empty role="alert" route announcer, so empty alerts are skipped. */
export const melding = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

/** A fresh anonymous browser page with the same bypass routing as the suite's `page` fixture. */
export async function klantPagina(browser: Browser, viewport = { width: 390, height: 844 }): Promise<Page> {
  const context = await browser.newContext({ viewport, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const host = new URL(required("BASE_URL")).host;
  await page.route("**/*", (route) => {
    const request = route.request();
    if (new URL(request.url()).host === host) return route.continue({ headers: { ...request.headers(), ...bypassHeaders() } });
    return route.continue();
  });
  return page;
}

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" });
const label = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export const vandaag = (): string => ymd.format(new Date());

export function verschuif(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export const weekdag = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** "dinsdag 13 oktober", as the pages write a day. */
export const dagLabel = (date: string): string => label.format(new Date(`${date}T00:00:00Z`));

type Tijdvak = { start: string; eind: string; vrij: number; capaciteit: number; voorbij?: boolean };
type Dag = { datum: string; reden: string | null; volgende: string | null; tijdvakken: Tijdvak[] };

export async function dag(api: APIRequestContext, date: string): Promise<Dag> {
  const response = await api.get(`/api/spaak/dag?datum=${date}`);
  expect(response.status(), `dag ${date}`).toBe(200);
  return await response.json() as Dag;
}

export async function tijdvak(api: APIRequestContext, date: string, start: string): Promise<Tijdvak> {
  const slot = (await dag(api, date)).tijdvakken.find((value) => value.start === start);
  if (!slot) throw new Error(`geen tijdvak ${start} op ${date}`);
  return slot;
}

/** An open weekday 40 to 400 days ahead on which no slot has a booking and every slot has its usual two places. */
export async function legeDag(api: APIRequestContext): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const date = verschuif(vandaag(), 40 + randomInt(360));
    if (weekdag(date) === 0 || weekdag(date) === 1) continue;
    const value = await dag(api, date);
    if (value.reden === null && value.tijdvakken.length === 8 &&
        value.tijdvakken.every((slot) => slot.capaciteit === 2 && slot.vrij === 2 && !slot.voorbij)) return date;
  }
  throw new Error("geen lege dag gevonden in 40 pogingen");
}

/** The first Sunday at least 40 days ahead (the shop is closed on Sunday and Monday). */
export function zondag(): string {
  let date = verschuif(vandaag(), 40);
  while (weekdag(date) !== 0) date = verschuif(date, 1);
  return date;
}

export const uniek = (prefix: string): string => `${prefix} ${randomBytes(3).toString("hex")}`;

export type Boeking = { repairTypeId?: string; date: string; start: string; naam?: string; fiets?: string };

/** Books through the public API exactly as the booking page does; returns the appointment code. */
export async function boek(api: APIRequestContext, input: Boeking, key = `w6-${randomBytes(12).toString("hex")}`): Promise<string> {
  const response = await api.post("/api/spaak/afspraken", {
    headers: { "Idempotency-Key": key },
    data: { repairTypeId: input.repairTypeId ?? "onderhoud", date: input.date, start: input.start,
            naam: input.naam ?? uniek("Proefklant"), telefoon: "06 1234 5678", email: "proefklant@example.com",
            fiets: input.fiets ?? "Stadsfiets, ketting piept" },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json() as { code: string };
  expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  return body.code;
}

/** Staff calls with the signed-in member's session (the walk makes the member the shop owner on the preview). */
export async function personeel(page: Page, path: string, data: unknown): Promise<void> {
  const response = await page.request.post(path, { headers: bypassHeaders(), data });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
}

export const zetStatus = (page: Page, code: string, status: string) =>
  personeel(page, "/api/spaak/werkplaats/status", { code, status });

export const zetCapaciteit = (page: Page, datum: string, start: string, capaciteit: number) =>
  personeel(page, "/api/spaak/beheer/capaciteit", { datum, start, capaciteit });

export async function werkplaatsDag(page: Page, datum: string) {
  const response = await page.request.get(`/api/spaak/werkplaats/dag?datum=${datum}`, { headers: bypassHeaders() });
  expect(response.status()).toBe(200);
  return await response.json() as { datum: string; tijdvakken: { start: string; afspraken: { code: string; naam: string; status: string }[] }[] };
}

/**
 * An appointment whose start is less than 24 hours away, for "cancelling too late". A real slot that close is not
 * always bookable (Saturday evening to Tuesday morning the shop is closed), so it is written straight into the staging
 * table with the service role: a real slot (09:00-10:00 on an empty day far ahead, so the store can read it) whose
 * `start_tijdstip`, the only field the 24-hour rule reads, lies two hours from now.
 */
export async function afspraakBinnen24Uur(api: APIRequestContext): Promise<{ code: string; datum: string }> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const datum = await legeDag(api);
  const now = new Date().toISOString();
  const response = await fetch(`${supabaseUrl()}/rest/v1/spaak_afspraken`, {
    method: "POST",
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, "Content-Type": "application/json",
               "Content-Profile": schema(), Prefer: "return=minimal" },
    body: JSON.stringify({ code, sleutel: `w6-${randomBytes(12).toString("hex")}`, reparatie_id: "onderhoud",
                           datum, start: "09:00", eind: "10:00",
                           start_tijdstip: new Date(Date.now() + 2 * 3_600_000).toISOString(), naam: uniek("Proefklant"),
                           telefoon: "06 1234 5678",
                           email: "proefklant@example.com", fiets: "Proefrit te laat annuleren", status: "gepland",
                           aangemaakt: now, bijgewerkt: now }),
  });
  expect(response.status, await response.text()).toBe(201);
  return { code, datum };
}

/** Things a reader would see as broken layout: a sideways scroll bar, text running out of its box, buttons on top of each other. */
export async function opmaakProblemen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problemen: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth + 1) problemen.push(`zijwaarts scrollen: ${root.scrollWidth} > ${window.innerWidth}`);
    const zichtbaar = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    for (const element of Array.from(document.querySelectorAll("main *"))) {
      if (!(element instanceof HTMLElement) || !zichtbaar(element)) continue;
      const style = getComputedStyle(element);
      if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0 && element.textContent?.trim()) {
        problemen.push(`tekst buiten kader: <${element.tagName.toLowerCase()} class="${element.className}">`);
      }
    }
    const knoppen = Array.from(document.querySelectorAll("main button, main a.spaak-button")).filter(zichtbaar)
      .map((element) => ({ element, box: element.getBoundingClientRect() }));
    for (let i = 0; i < knoppen.length; i += 1) {
      for (let j = i + 1; j < knoppen.length; j += 1) {
        const a = knoppen[i].box;
        const b = knoppen[j].box;
        if (knoppen[i].element.contains(knoppen[j].element) || knoppen[j].element.contains(knoppen[i].element)) continue;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          problemen.push(`knoppen overlappen: "${knoppen[i].element.textContent?.trim()}" en "${knoppen[j].element.textContent?.trim()}"`);
        }
      }
    }
    return problemen.slice(0, 20);
  });
}
