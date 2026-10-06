// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingFlow } from "../../src/components/spaak/booking-flow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("never tells the customer to bring the bike after confirming a pick-up booking", async () => {
  const ophalen = { postcode: "3512 AB", adres: "Oudegracht 1" };
  const booking = vi.fn(async (init?: RequestInit) => {
    const input = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      code: "R7TQ2D", afspraak: { ...input, end: "11:00", ophalen, toeslagCent: 1000 },
    }), { status: 201 });
  });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "https://spaak.example");
    if (url.pathname === "/api/spaak/afspraken") return booking(init);
    const body = url.pathname === "/api/spaak/reparaties"
      ? { reparaties: [{ id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 }] }
      : { datum: "2026-10-09", reden: null, volgende: null,
        tijdvakken: [{ start: "10:00", eind: "11:00", vrij: 1, capaciteit: 2 }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }));

  const { container } = render(<BookingFlow initialDate="2026-10-09" />);
  fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
  fireEvent.click(await screen.findByRole("button", { name: /10:00\s*[–-]\s*11:00/ }));
  for (const [label, value] of Object.entries({
    Naam: "Femke de Wit", Telefoon: "0612345678", "E-mail": "femke@example.nl",
    "Wat is er met je fiets?": "Gazelle, ketting piept",
  })) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("checkbox", { name: "Ophalen en terugbrengen (€10 extra)" }));
  fireEvent.change(screen.getByLabelText("Postcode", { exact: true }), { target: { value: ophalen.postcode } });
  fireEvent.change(screen.getByLabelText("Straat en huisnummer", { exact: true }), { target: { value: ophalen.adres } });
  fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));

  await screen.findByRole("heading", { name: "Je afspraak staat" });
  expect(booking).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(booking.mock.calls[0][0]?.body)).ophalen).toEqual(ophalen);
  expect(screen.getByText("Bewaar je afspraakcode. We halen je fiets op en brengen hem terug.", { exact: true })).toBeTruthy();
  expect(container.querySelector(".spaak-lead")?.textContent).not.toMatch(/werkplaats/i);
  expect(container.textContent).not.toMatch(/\bbreng(?:t|en)?\s+(?:je|de)\s+fiets\b|\b(?:je|de)\s+fiets\s+(?:komt\s+)?brengen\b/i);
});
