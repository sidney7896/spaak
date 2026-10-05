"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { nextStatus, type Status } from "../../lib/spaak/domain";

type ActiveStatus = Exclude<Status, "geannuleerd">;
type WorkshopStatus = Exclude<ActiveStatus, "gepland">;
type Appointment = {
  code: string; naam: string; telefoon: string; fiets: string; reparatie: string;
  status: ActiveStatus; start: string; eind: string;
};
type Day = { datum: string; tijdvakken: { start: string; eind: string; afspraken: Appointment[] }[] };
type Task = { kind: "day"; date: string } | { kind: "status"; date: string; code: string; status: WorkshopStatus };
type Notice = { message: string; retry: Task; refreshRequired?: boolean };

const STATUS_LABELS: Record<ActiveStatus, string> = {
  gepland: "Gepland", ontvangen: "Ontvangen", bezig: "Bezig", klaar: "Klaar", opgehaald: "Opgehaald",
};
const STATUS_BUTTONS: readonly WorkshopStatus[] = ["ontvangen", "bezig", "klaar", "opgehaald"];
const dayFormatter = new Intl.DateTimeFormat("nl-NL", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});

function today(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string): string => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function appointment(value: unknown): value is Appointment {
  return record(value) && ["code", "naam", "telefoon", "fiets", "reparatie", "start", "eind"]
    .every((field) => typeof value[field] === "string") && typeof value.status === "string" &&
    Object.hasOwn(STATUS_LABELS, value.status);
}

function dayReply(value: unknown, date: string): value is Day {
  return record(value) && value.datum === date && Array.isArray(value.tijdvakken) &&
    value.tijdvakken.every((slot: unknown) => record(slot) && typeof slot.start === "string" &&
      typeof slot.eind === "string" && Array.isArray(slot.afspraken) && slot.afspraken.every(appointment));
}

async function fetchReply(task: Task, controller: AbortController): Promise<{ status: number; body: unknown }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  // Bound both fetch and the body reader, even if either ignores AbortSignal.
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("De verbinding is onderbroken."));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      reject(new Error("De werkplaats reageert niet. Probeer het opnieuw."));
      controller.abort();
    }, 15_000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(task.kind === "day"
          ? `/api/spaak/werkplaats/dag?datum=${encodeURIComponent(task.date)}`
          : "/api/spaak/werkplaats/status", {
          method: task.kind === "day" ? "GET" : "POST", cache: "no-store", signal: controller.signal,
          ...(task.kind === "status" ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: task.code, status: task.status }),
          } : {}),
        });
        if (response.status === 401) return { status: 401, body: null };
        if (response.status >= 500) throw new Error("De werkplaats is even niet bereikbaar.");
        const body: unknown = await response.json();
        return { status: response.status, body };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

export function DayBoard({ initialDate }: { initialDate?: string }) {
  const [date, setDate] = useState<string>(() => initialDate ?? today());
  const [day, setDay] = useState<Day | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const headingId = useId();

  const execute = useCallback(async (task: Task): Promise<void> => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const requestGeneration = ++generation.current;
    setBusy(true);
    setNotice(null);
    setSignedOut(false);
    if (task.kind === "day") setDay(null);
    try {
      const { status, body } = await fetchReply(task, controller);
      if (generation.current !== requestGeneration) return;
      if (status === 401) {
        setDay(null);
        setSignedOut(true);
      } else if (task.kind === "day" && status === 200 && dayReply(body, task.date)) {
        setDay(body);
      } else if (task.kind === "status" && status === 200 && record(body) && body.ok === true) {
        setDay((current) => current?.datum === task.date ? {
          ...current,
          tijdvakken: current.tijdvakken.map((slot) => ({
            ...slot, afspraken: slot.afspraken.map((booking) => booking.code === task.code
              ? { ...booking, status: task.status } : booking),
          })),
        } : current);
      } else if (task.kind === "status" && (status === 400 || status === 404 || status === 409)) {
        const explanation = status === 409 ? "Bekijk de actuele status en volg de volgende stap."
          : status === 404 ? "Deze afspraak is niet meer gevonden." : "Controleer de afspraak en de status.";
        setNotice({ message: `De status kon niet worden gewijzigd. ${explanation}`,
          retry: { kind: "day", date: task.date }, refreshRequired: true });
      } else {
        throw new Error("We konden het antwoord niet lezen.");
      }
    } catch (error) {
      if (generation.current === requestGeneration) {
        const explanation = error instanceof TypeError ? "Er is geen verbinding."
          : error instanceof Error ? error.message : "Er ging iets mis.";
        // A lost POST reply may already have changed the status; refresh before another POST.
        setNotice({ message: task.kind === "status" ? `De status kon niet worden gewijzigd. ${explanation}` : explanation,
          retry: { kind: "day", date: task.date }, refreshRequired: task.kind === "status" });
      }
    } finally {
      if (generation.current === requestGeneration) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    void execute({ kind: "day", date });
    return () => {
      generation.current++;
      active.current?.abort();
      active.current = null;
    };
  }, [date, execute]);

  return <section className="spaak-flow spaak-day-board" aria-labelledby={headingId}>
    {(day !== null || !busy) && <h1 id={headingId}>
      {dayFormatter.format(new Date(`${day?.datum ?? date}T00:00:00Z`))}
    </h1>}
    <div className="spaak-day-nav">
      <button type="button" className="spaak-button spaak-secondary" disabled={busy && day !== null}
        onClick={() => setDate((current) => shiftDate(current, -1))}>Vorige dag</button>
      <button type="button" className="spaak-button spaak-secondary" disabled={busy && day !== null}
        onClick={() => setDate((current) => shiftDate(current, 1))}>Volgende dag</button>
    </div>
    {busy && <p className="spaak-loading" role="status">{day ? "Status wordt gewijzigd…" : "Agenda wordt geladen…"}</p>}
    {signedOut && <div className="spaak-alert" role="alert">
      <p>Log opnieuw in.</p><a className="spaak-button spaak-secondary" href="/sign-in">Opnieuw inloggen</a>
    </div>}
    {notice && <div className="spaak-alert" role="alert">
      <p>{notice.message}</p>
      <button type="button" className="spaak-button spaak-secondary" onClick={() => void execute(notice.retry)}>
        Opnieuw proberen
      </button>
    </div>}
    {day?.tijdvakken.length === 0 && <div className="spaak-panel spaak-empty-day">
      <p>Geen afspraken vandaag</p>
      <button type="button" className="spaak-button" onClick={() => setDate((current) => shiftDate(current, 1))}>
        Naar morgen
      </button>
    </div>}
    {day?.tijdvakken.map((slot) => <section className="spaak-workshop-slot" key={slot.start}>
      <h2>{slot.start} – {slot.eind}</h2>
      {slot.afspraken.map((booking) => <article className="spaak-panel spaak-workshop-booking"
        aria-label={booking.naam} key={booking.code}>
        <div className="spaak-booking-heading">
          <h3>{booking.naam}</h3><span className="spaak-workshop-status" data-status={booking.status}>
            {STATUS_LABELS[booking.status]}
          </span>
        </div>
        <p><strong>{booking.reparatie}</strong></p>
        <p>{booking.fiets}</p><p>{booking.telefoon}</p><p>Code: <strong>{booking.code}</strong></p>
        <div className="spaak-status-buttons" role="group" aria-label={`Status van ${booking.naam}`}>
          {STATUS_BUTTONS.map((status) => <button key={status} type="button" className="spaak-button spaak-secondary"
            aria-pressed={booking.status === status}
            disabled={busy || signedOut || notice?.refreshRequired === true || nextStatus(booking.status) !== status}
            onClick={() => void execute({ kind: "status", date: day?.datum ?? date, code: booking.code, status })}>
            {STATUS_LABELS[status]}
          </button>)}
        </div>
      </article>)}
    </section>)}
  </section>;
}
