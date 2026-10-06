// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "../../src/components/spaak/booking-flow";
import * as domain from "../../src/lib/spaak/domain";

/**
 * W7 / S18-S19: meester-owned acceptance contract, not builder-owned.
 * Pick-up belongs to the existing step-3 contact form; Bevestigen submits directly to step 4.
 * Its summary belongs to the existing spaak-confirmation panel after a successful 201 reply.
 * Store fields.postcode is transported as velden.postcode by the public API (422).
 * Existing journeys, buttons and API statuses are unchanged with pick-up off.
 * Existing exact Booking/RPC fixtures gain only no-pick-up defaults; migration tests use 0001+0002.
 */
type Reply = { status: number; body: unknown };
let replies: Record<string, Reply[]>;
let calls: { url: string; init?: RequestInit }[];
const LABEL = "Ophalen en terugbrengen (€10 extra)";
const LINE = "Ophalen en terugbrengen: €10 extra";
const RING = "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599";
const CONTACT = { Naam: "Femke de Wit", Telefoon: "06 1234 5678", "E-mail": "femke@example.nl",
  "Wat is er met je fiets?": "Gazelle, ketting piept" };
const INPUT = { repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00", naam: CONTACT.Naam,
  telefoon: CONTACT.Telefoon, email: CONTACT["E-mail"], fiets: CONTACT["Wat is er met je fiets?"] };
const DAY = { datum: INPUT.date, reden: null, volgende: null, tijdvakken: [
  { start: "09:00", eind: "10:00", vrij: 0, capaciteit: 2 }, { start: "10:00", eind: "11:00", vrij: 1, capaciteit: 2 },
] };
const TYPES = { reparaties: [{ id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 }] };
const BOOKED = { code: "R7TQ2D", afspraak: { ...INPUT, code: "R7TQ2D", end: "11:00", status: "gepland",
  createdAt: "2026-10-08T08:15:00.000Z", ophalen: null, toeslagCent: 0 } };

function key(url: string) {
  if (url.startsWith("/api/spaak/reparaties")) return "reparaties";
  if (url.startsWith("/api/spaak/dag")) return "dag:" + new URL(url, "https://x").searchParams.get("datum");
  if (url.startsWith("/api/spaak/afspraken")) return "afspraken";
  return url;
}

beforeEach(() => {
  calls = [];
  replies = { reparaties: [{ status: 200, body: TYPES }], "dag:2026-10-09": [{ status: 200, body: DAY }],
    afspraken: [{ status: 201, body: BOOKED }] };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const queue = replies[key(url)] ?? [];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (!reply) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function description(element: HTMLElement) {
  return (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}
function bookingPosts() { return calls.filter((c) => key(c.url) === "afspraken"); }
function expectNoNewNavigation() {
  for (const name of ["Volgende", "Terug"]) expect(screen.queryByRole("button", { name })).toBeNull();
  for (const name of ["Bevestigen", "Ophalen"]) expect(screen.queryByRole("heading", { name })).toBeNull();
}
function expectDetails() {
  expect(screen.getByRole("heading", { name: "Wie ben je?" })).toBeTruthy();
  expect(screen.getByText("Stap 3 van 4", { exact: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Bevestigen" }).getAttribute("type")).toBe("submit");
  expect(screen.getByRole("button", { name: "Ander tijdvak kiezen" })).toBeTruthy();
  expect(screen.getByText(/vrijdag 9 oktober/i)).toBeTruthy();
  expect(screen.getByText(/10:00\s*[–-]\s*11:00/)).toBeTruthy();
  expect(screen.getByText("Onderhoudsbeurt", { exact: true })).toBeTruthy();
  for (const [label, value] of Object.entries(CONTACT)) expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
  expect(screen.queryByRole("heading", { name: "Je afspraak staat" })).toBeNull();
  expectNoNewNavigation();
}
function choosePickup(postcode = " 3512  ab ", adres = " Oudegracht 1 ") {
  fireEvent.click(screen.getByRole("checkbox", { name: LABEL }));
  fireEvent.change(screen.getByLabelText("Postcode", { exact: true }), { target: { value: postcode } });
  fireEvent.change(screen.getByLabelText("Straat en huisnummer", { exact: true }), { target: { value: adres } });
}
async function toDetails() {
  render(<BookingFlow initialDate={INPUT.date} />);
  expect(screen.getByRole("heading", { name: "Wat moet er aan je fiets gebeuren?" })).toBeTruthy();
  expect(screen.getByText("Stap 1 van 4", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull();
  expectNoNewNavigation();
  fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
  await screen.findByRole("heading", { name: "Wanneer kom je?" });
  expect(screen.getByText("Stap 2 van 4", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull();
  expectNoNewNavigation();
  fireEvent.click(await screen.findByRole("button", { name: /10:00\s*[–-]\s*11:00/ }));
  await screen.findByRole("heading", { name: "Wie ben je?" });
  for (const [label, value] of Object.entries(CONTACT)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  expectDetails();
}
async function confirmation() {
  await screen.findByRole("heading", { name: "Je afspraak staat" });
  expect(screen.getByText("Stap 4 van 4", { exact: true })).toBeTruthy();
  expect(screen.getByLabelText("Afspraakcode").textContent).toBe(BOOKED.code);
  expectNoNewNavigation();
  const panel = document.querySelector<HTMLElement>(".spaak-confirmation");
  if (!panel) throw new Error("Expected the existing confirmation panel.");
  expect(within(panel).getByText(/vrijdag 9 oktober/i)).toBeTruthy();
  expect(within(panel).getByText(/10:00\s*[–-]\s*11:00/)).toBeTruthy();
  expect(within(panel).getByText("Onderhoudsbeurt", { exact: true })).toBeTruthy();
  return panel;
}
async function expectPostcodeError() {
  const postcode = screen.getByLabelText("Postcode", { exact: true });
  await waitFor(() => expect(description(postcode)).toBe(RING));
  expect(postcode.getAttribute("aria-invalid")).toBe("true");
  const error = screen.getByText(RING, { exact: true });
  expect(error.classList.contains("spaak-field-error")).toBe(true);
  expect(error.id).not.toBe("");
  expect((postcode.getAttribute("aria-describedby") ?? "").split(/\s+/)).toContain(error.id);
  expect(postcode.closest("form")).toBe(error.closest("form"));
  expect(postcode.closest(".spaak-field")).toBeTruthy();
  expect(error.closest(".spaak-field")).toBe(postcode.closest(".spaak-field"));
  expect((postcode as HTMLInputElement).value).toBe("3600 AA");
  expect((screen.getByLabelText("Straat en huisnummer", { exact: true }) as HTMLInputElement).value).toBe("Buitenring 12");
  expect((screen.getByRole("checkbox", { name: LABEL }) as HTMLInputElement).checked).toBe(true);
  expectDetails();
}
function expectNoPickup(panel: HTMLElement, postIndex = 0) {
  expect(within(panel).queryByText(LINE, { exact: true })).toBeNull();
  expect(within(panel).queryByText(/Oudegracht 1|Buitenring 12|3512 AB|3600 AA/)).toBeNull();
  const sent = JSON.parse(String(bookingPosts()[postIndex].init?.body));
  expect({ ...sent, ophalen: sent.ophalen ?? null }).toEqual({ ...INPUT, ophalen: null });
}

describe("W7: pick-up in the booking flow", () => {
  // Catches: adding a screen, enabling pick-up by default, or placing fields outside the contact form.
  it("places the opt-out checkbox below contact fields and above Bevestigen in step 3", async () => {
    await toDetails();
    const checkbox = screen.getByRole("checkbox", { name: LABEL }) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "Bevestigen" });
    const form = submit.closest("form");
    expect(form).toBeTruthy();
    expect(checkbox.closest("form")).toBe(form);
    for (const label of Object.keys(CONTACT)) {
      const contact = screen.getByLabelText(label);
      expect(contact.closest("form")).toBe(form);
      expect(contact.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
    expect(checkbox.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(checkbox.checked).toBe(false);
    expect(screen.queryByLabelText("Postcode", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("Straat en huisnummer", { exact: true })).toBeNull();
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    for (const name of ["Postcode", "Straat en huisnummer"]) {
      const field = screen.getByRole("textbox", { name });
      expect((field as HTMLInputElement).type).toBe("text");
      expect(field.closest("form")).toBe(form);
      expect(checkbox.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(field.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
    expectDetails();
    expect(bookingPosts()).toHaveLength(0);
  });

  // Catches: putting the summary on a new screen, changing its literal text, or retaining raw postcode spacing.
  it("shows the exact surcharge and address in the step-4 confirmation panel when chosen", async () => {
    await toDetails();
    choosePickup();
    expectDetails();
    expect(document.querySelector(".spaak-confirmation")).toBeNull();
    expect(bookingPosts()).toHaveLength(0);
    replies.afspraken = [{ status: 201, body: { ...BOOKED, afspraak: { ...BOOKED.afspraak,
      ophalen: { postcode: "3512 AB", adres: "Oudegracht 1" }, toeslagCent: 1000 } } }];
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const panel = await confirmation();
    const line = within(panel).getByText(LINE, { exact: true });
    const address = within(panel).getByText("Oudegracht 1, 3512 AB", { exact: true });
    expect(line.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(bookingPosts()).toHaveLength(1);
    const sent = JSON.parse(String(bookingPosts()[0].init?.body));
    expect(sent).toMatchObject(INPUT);
    expect(domain.normalizePostcode(sent.ophalen.postcode)).toBe("3512 AB");
    expect(sent.ophalen.adres.trim()).toBe("Oudegracht 1");
  });

  // Catches: requiring another step or adding pick-up summary lines for a default ordinary booking.
  it("confirms directly from step 3 with pick-up off by default and no pick-up summary", async () => {
    await toDetails();
    expect((screen.getByRole("checkbox", { name: LABEL }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const panel = await confirmation();
    expect(bookingPosts()).toHaveLength(1);
    expectNoPickup(panel);
  });

  // Catches: retaining cached address or surcharge in the request or confirmation after opting out.
  it("shows neither pick-up line after entering an address and unticking the checkbox", async () => {
    await toDetails();
    choosePickup();
    fireEvent.click(screen.getByRole("checkbox", { name: LABEL }));
    expectDetails();
    expect(screen.queryByLabelText("Postcode", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("Straat en huisnummer", { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const panel = await confirmation();
    expect(bookingPosts()).toHaveLength(1);
    expectNoPickup(panel);
  });

  // Catches: submitting 3600 AA, leaving step 3, losing any entered value, or preventing opt-out recovery.
  it("S19 books nothing for 3600 AA, keeps all values in step 3, then books after unticking", async () => {
    await toDetails();
    choosePickup("3600 AA", "Buitenring 12");
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await expectPostcodeError();
    expect(bookingPosts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: LABEL }));
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const panel = await confirmation();
    expect(screen.queryByText(RING, { exact: true })).toBeNull();
    expect(bookingPosts()).toHaveLength(1);
    expectNoPickup(panel);
  });

  // Catches: discarding server postcode errors, showing only a generic alert, or clearing input after a bypass.
  it("shows the server postcode error at the step-3 field and preserves input after a bypass", async () => {
    vi.spyOn(domain, "validateOphalen").mockReturnValue({});
    replies.afspraken = [{ status: 422, body: { reden: "ongeldig", velden: { postcode: RING } } }, { status: 201, body: BOOKED }];
    await toDetails();
    choosePickup("3600 AA", "Buitenring 12");
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await expectPostcodeError();
    expect(bookingPosts()).toHaveLength(1);
    expect(JSON.parse(String(bookingPosts()[0].init?.body))).toEqual({ ...INPUT, ophalen: { postcode: "3600 AA", adres: "Buitenring 12" } });
    fireEvent.click(screen.getByRole("checkbox", { name: LABEL }));
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const panel = await confirmation();
    expect(bookingPosts()).toHaveLength(2);
    expectNoPickup(panel, 1);
  });
});
