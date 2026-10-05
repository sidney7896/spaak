// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerSettings } from "../../src/components/spaak/owner-settings";

const DATE = "2026-10-09";
const TYPES = { reparaties: [{ id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 }] };
const ADDED = { id: "band", naam: "Band", duurMinuten: 30, prijsCent: null };
const day = (datum = DATE) => ({ datum, gesloten: false,
  tijdvakken: [{ start: "10:00", eind: "11:00", capaciteit: 3, geboekt: 2, vrij: 1 }] });
type Reply = { status: number; body: unknown } | "network" | "unreadable";
let replies: Record<string, Reply>;
let calls: { key: string; init?: RequestInit }[];

beforeEach(() => {
  calls = [];
  replies = {
    "GET reparaties": { status: 200, body: TYPES },
    [`GET dag?datum=${DATE}`]: { status: 200, body: day() },
  };
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).replace("/api/spaak/beheer/", "")}`;
    calls.push({ key, init });
    const reply = replies[key] ?? { status: 404, body: { fout: "Onbekend verzoek." } };
    if (reply === "network") return Promise.reject(new TypeError("Failed to fetch"));
    if (reply === "unreadable") return Promise.resolve(new Response("{", { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function changeButtons(): HTMLButtonElement[] {
  return screen.getAllByRole("button", { name: /^(Toevoegen|Opslaan .+|Dag sluiten|Dag openen)$/ }) as HTMLButtonElement[];
}

function expectLocked(locked = true): void {
  expect(changeButtons().length).toBeGreaterThan(1);
  expect(changeButtons().every((button) => button.disabled === locked)).toBe(true);
}

async function start(closed = false): Promise<void> {
  if (closed) replies[`GET dag?datum=${DATE}`] = { status: 200, body: { ...day(), gesloten: true, tijdvakken: [] } };
  render(<OwnerSettings initialDate={DATE} />);
  await screen.findByText("Onderhoudsbeurt");
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Band" } });
  fireEvent.change(screen.getByLabelText("Duur in minuten"), { target: { value: "30" } });
}

const mutations = [
  { name: "Toevoegen", path: "reparaties", closed: false },
  { name: "Opslaan 10:00 – 11:00", path: "capaciteit", closed: false },
  { name: "Dag sluiten", path: "gesloten", closed: false },
  { name: "Dag openen", path: "gesloten", closed: true },
] as const;

describe("owner change reconciliation", () => {
  describe.each(mutations)("$name", ({ name, path, closed }) => {
    it.each<Reply>(["network", "unreadable", { status: 200, body: {} }, { status: 503, body: { fout: "Niet bereikbaar." } }])(
      "locks every change after an uncertain reply: %j", async (failure) => {
        replies[`POST ${path}`] = failure;
        await start(closed);
        fireEvent.click(screen.getByRole("button", { name }));
        expect((await screen.findByRole("alert")).textContent).toContain("De wijziging kan al opgeslagen zijn.");
        expectLocked();
        fireEvent.submit(screen.getByRole("button", { name: "Toevoegen" }).closest("form")!);
        for (const button of changeButtons()) fireEvent.click(button);
        expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
      },
    );

    it("keeps definite rejections editable", async () => {
      replies[`POST ${path}`] = { status: 409, body: { reden: "De wijziging is afgewezen." } };
      await start(closed);
      fireEvent.click(screen.getByRole("button", { name }));
      await screen.findByText("De wijziging is afgewezen.");
      expectLocked(false);
    });
  });

  it.each(["types", "day", "wrong-date"])("retains the lock through repeated incomplete refreshes: %s", async (failure) => {
    replies["POST reparaties"] = "network";
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    await screen.findByRole("alert");
    const newTypes = { status: 200, body: { reparaties: [...TYPES.reparaties, ADDED] } };
    replies["GET reparaties"] = failure === "types" ? "network" : newTypes;
    replies[`GET dag?datum=${DATE}`] = failure === "day" ? { status: 200, body: {} }
      : { status: 200, body: day(failure === "wrong-date" ? "2026-10-10" : DATE) };
    for (let retry = 0; retry < 2; retry++) {
      fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
      await screen.findByRole("alert");
      expectLocked();
      expect(screen.queryByText("Band")).toBeNull();
    }
    replies["GET reparaties"] = newTypes;
    replies[`GET dag?datum=${DATE}`] = { status: 200, body: day() };
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByText("Band");
    await waitFor(() => expectLocked(false));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
  });

  it.each([
    { name: "Vorige dag", date: "2026-10-08" },
    { name: "Volgende dag", date: "2026-10-10" },
  ])("fully refreshes on $name and keeps the lock if either read fails", async ({ name, date }) => {
    replies["POST reparaties"] = "network";
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    await screen.findByRole("alert");
    replies["GET reparaties"] = "network";
    replies[`GET dag?datum=${date}`] = { status: 200, body: day(date) };
    fireEvent.click(screen.getByRole("button", { name }));
    await screen.findByRole("alert");
    expect(calls.filter((call) => call.key === "GET reparaties")).toHaveLength(2);
    expect(calls.some((call) => call.key === `GET dag?datum=${date}`)).toBe(true);
    expect((screen.getByRole("button", { name: "Toevoegen" }) as HTMLButtonElement).disabled).toBe(true);
    replies["GET reparaties"] = { status: 200, body: { reparaties: [...TYPES.reparaties, ADDED] } };
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByText("Band");
    expectLocked(false);
    expect(screen.getByText("2 van 3 geboekt")).toBeTruthy();
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
  });

  it("waits for the shown day even when the repair types have already reloaded", async () => {
    replies["POST reparaties"] = "network";
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    await screen.findByRole("alert");
    let finishDay!: (response: Response) => void;
    const pendingDay = new Promise<Response>((resolve) => { finishDay = resolve; });
    vi.stubGlobal("fetch", vi.fn((input: string) => String(input).includes("dag?") ? pendingDay
      : Promise.resolve(new Response(JSON.stringify({ reparaties: [...TYPES.reparaties, ADDED] }), { status: 200 }))));
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByText("Even verwerken…");
    expectLocked();
    expect(screen.queryByText("Band")).toBeNull();
    finishDay(new Response(JSON.stringify(day()), { status: 200 }));
    await screen.findByText("Band");
    expectLocked(false);
  });

  it("does not treat a failed day read after an acknowledged reopening as an unanswered change", async () => {
    replies["POST gesloten"] = { status: 200, body: { ok: true } };
    await start(true);
    replies[`GET dag?datum=${DATE}`] = "network";
    fireEvent.click(screen.getByRole("button", { name: "Dag openen" }));
    expect((await screen.findByRole("alert")).textContent).not.toContain("De wijziging kan al opgeslagen zijn.");
    expectLocked(false);
  });
});
