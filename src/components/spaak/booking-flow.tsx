"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { slotsForDate, slotStart, validateContact } from "../../lib/spaak/domain";
import type { Contact } from "../../lib/spaak/domain";
import type { Booking, BookingInput, RepairType } from "../../lib/spaak/store";
import { Wheel } from "./wheel";

type Step = 1 | 2 | 3 | 4;
type TimeSlot = { start: string; eind: string; vrij: number; capaciteit: number; voorbij?: boolean };
type Day = { datum: string; reden: "gesloten" | "vol" | null; volgende: string | null; tijdvakken: TimeSlot[] };
type Summary = Pick<Booking, "date" | "start" | "end" | "repairTypeId">;
type Confirmation = { code: string; afspraak: Summary };
type FieldErrors = Partial<Record<keyof BookingInput, string>>;
type ApiRequest = { kind: "repairs" } | { kind: "day"; date: string }
  | { kind: "booking"; input: BookingInput; key: string };
type Notice = { message: string; retry?: ApiRequest };

const HEADINGS = ["Wat moet er aan je fiets gebeuren?", "Wanneer kom je?", "Wie ben je?", "Je afspraak staat"];
const LABELS: Record<keyof Contact, string> = {
  naam: "Naam", telefoon: "Telefoon", email: "E-mail", fiets: "Wat is er met je fiets?",
};
const CONTACT_FIELDS: (keyof Contact)[] = ["naam", "telefoon", "email", "fiets"];
const BOOKING_FIELDS: (keyof BookingInput)[] = [...CONTACT_FIELDS, "date", "start", "repairTypeId"];
const dayFormatter = new Intl.DateTimeFormat("nl-NL", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});

function dayLabel(date: string): string {
  return dayFormatter.format(new Date(`${date}T00:00:00Z`));
}

function moveDay(date: string, amount: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function nextOpenDay(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string): string => parts.find((entry) => entry.type === name)?.value ?? "";
  let day = `${part("year")}-${part("month")}-${part("day")}`;
  while (!slotsForDate(day, []).some((slot) => slotStart(day, slot.start).getTime() > now.getTime())) {
    day = moveDay(day, 1);
  }
  return day;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function price(type: RepairType): string {
  return type.prijsCent === null ? "Prijs op offerte" : `€ ${new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: type.prijsCent % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(type.prijsCent / 100)}`;
}

async function fetchReply(task: ApiRequest, controller: AbortController): Promise<{ status: number; body: unknown }> {
  const url = task.kind === "repairs" ? "/api/spaak/reparaties"
    : task.kind === "day" ? `/api/spaak/dag?datum=${encodeURIComponent(task.date)}` : "/api/spaak/afspraken";
  const init: RequestInit = { signal: controller.signal, cache: "no-store" };
  if (task.kind === "booking") {
    init.method = "POST";
    init.headers = { "Content-Type": "application/json", "Idempotency-Key": task.key };
    init.body = JSON.stringify(task.input);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  // Reject explicitly: abort alone cannot settle a stalled fetch mock or response reader.
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("De verbinding is onderbroken. Probeer het opnieuw."));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      reject(new Error("De werkplaats reageert niet. Probeer het opnieuw."));
      controller.abort();
    }, 15_000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, init);
        if (response.status >= 500) throw new Error("De werkplaats is even niet bereikbaar. Probeer het opnieuw.");
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

export function BookingFlow({ initialDate }: { initialDate?: string }) {
  const [step, setStep] = useState<Step>(1);
  const [date, setDate] = useState(() => initialDate ?? nextOpenDay());
  const [repairs, setRepairs] = useState<RepairType[]>([]);
  const [repair, setRepair] = useState<RepairType | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [contact, setContact] = useState<Contact>({ naam: "", telefoon: "", email: "", fiets: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const submission = useRef<Extract<ApiRequest, { kind: "booking" }> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const fieldPrefix = useId();

  const execute = useCallback(async (task: ApiRequest): Promise<void> => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const requestGeneration = ++generation.current;
    setBusy(true);
    setNotice(null);
    try {
      const { status, body } = await fetchReply(task, controller);
      if (generation.current !== requestGeneration) return;
      if (!record(body)) throw new Error("We konden het antwoord niet lezen. Probeer het opnieuw.");
      if (task.kind === "booking" && status === 422) {
        const fieldErrors: FieldErrors = {};
        if (record(body.velden)) {
          for (const field of BOOKING_FIELDS) {
            const message = body.velden[field];
            if (typeof message === "string") fieldErrors[field] = message;
          }
        }
        setErrors(fieldErrors);
        setNotice({ message: "Controleer je gegevens en probeer het nog eens." });
        submission.current = null;
      } else if (task.kind === "booking" && status === 409) {
        const message = body.reden === "vol" ? "Dit tijdvak is net vol geraakt. Kies een ander tijdvak."
          : body.reden === "gesloten" ? "Op deze dag is de werkplaats gesloten. Kies een andere dag."
            : body.reden === "sleutel" ? "Deze aanvraag hoort bij andere gegevens. Probeer het opnieuw."
              : "Dit tijdvak is al voorbij. Kies een ander tijdvak.";
        setNotice({ message });
        submission.current = null;
      } else if (status < 200 || status >= 300) {
        throw new Error("We konden je aanvraag niet verwerken. Probeer het opnieuw.");
      } else if (task.kind === "repairs") {
        if (!Array.isArray(body.reparaties)) throw new Error("De reparaties konden niet worden geladen.");
        setRepairs(body.reparaties as RepairType[]);
      } else if (task.kind === "day") {
        if (!Array.isArray(body.tijdvakken) || body.datum !== task.date) throw new Error("De agenda kon niet worden geladen.");
        setDay(body as Day);
      } else {
        if (status !== 200 && status !== 201) throw new Error("Je afspraak is nog niet bevestigd. Probeer het opnieuw.");
        if (typeof body.code !== "string" || !record(body.afspraak)) throw new Error("De bevestiging kon niet worden gelezen.");
        submission.current = null;
        setConfirmation(body as Confirmation);
        setStep(4);
      }
    } catch (error) {
      if (generation.current === requestGeneration) {
        setNotice({ message: error instanceof TypeError ? "Er is geen verbinding. Probeer het opnieuw."
          : error instanceof Error ? error.message : "Er ging iets mis. Probeer het opnieuw.", retry: task });
      }
    } finally {
      if (generation.current === requestGeneration) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    void execute({ kind: "repairs" });
    return () => {
      generation.current++;
      active.current?.abort();
      active.current = null;
    };
  }, [execute]);

  useEffect(() => { heading.current?.focus(); }, [step]);

  function openDay(nextDate: string): void {
    if (active.current) return;
    setDate(nextDate);
    setDay(null);
    setSlot(null);
    setStep(2);
    // Navigation does not resolve a submission whose response may have been lost.
    void execute({ kind: "day", date: nextDate });
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitBooking();
  }

  function submitBooking(): void {
    if (active.current || !repair || !slot) return;
    const fieldErrors = validateContact(contact);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      setNotice(null);
      return;
    }
    const input: BookingInput = {
      naam: contact.naam.trim(), telefoon: contact.telefoon.trim(), email: contact.email.trim(), fiets: contact.fiets.trim(),
      repairTypeId: repair.id, date, start: slot.start,
    };
    if (!submission.current || JSON.stringify(submission.current.input) !== JSON.stringify(input)) {
      submission.current = { kind: "booking", input, key: crypto.randomUUID() };
    }
    void execute(submission.current);
  }

  function summary(value: Summary) {
    return <dl className="spaak-summary">
      <div><dt>Dag</dt><dd>{dayLabel(value.date)}</dd></div>
      <div><dt>Tijdvak</dt><dd>{value.start} – {value.end}</dd></div>
      <div><dt>Reparatie</dt><dd>{repairs.find((item) => item.id === value.repairTypeId)?.naam ?? repair?.naam}</dd></div>
    </dl>;
  }

  return <section className="spaak-flow" aria-labelledby={`${fieldPrefix}-heading`}>
    <div className="spaak-progress"><Wheel spokes={step * 2} /><div>
      <p className="spaak-kicker">Stap {step} van 4</p>
      <p className="spaak-step-label">{["Reparatie", "Dag en tijd", "Je gegevens", "Klaar"][step - 1]}</p>
    </div></div>
    <h1 id={`${fieldPrefix}-heading`} ref={heading} tabIndex={-1}>{HEADINGS[step - 1]}</h1>
    {notice && <div className="spaak-alert" role="alert">
      <p>{notice.message}</p>
      {notice.retry && <button className="spaak-button spaak-secondary" type="button" disabled={busy}
        onClick={() => {
          if (notice.retry?.kind === "booking") submitBooking();
          else if (notice.retry) void execute(notice.retry);
        }}>Opnieuw proberen</button>}
    </div>}
    {busy && <p className="spaak-loading" role="status">{step === 3 ? "Je afspraak wordt verwerkt…" : "Even ophalen…"}</p>}
    {step === 1 && <>
      <p className="spaak-lead">Kies een reparatie. Daarna zoeken we een plek in de werkplaats.</p>
      <div className="spaak-choices">{repairs.map((type) => <button className="spaak-choice" type="button" key={type.id}
        disabled={busy} onClick={() => { setRepair(type); openDay(date); }}>
        <span className="spaak-choice-name">{type.naam}</span>
        <span className="spaak-choice-meta">{type.duurMinuten} minuten · {price(type)}</span>
        <span className="spaak-choice-arrow" aria-hidden="true">→</span>
      </button>)}</div>
    </>}
    {step === 2 && <>
      <p className="spaak-lead">Kies wanneer je je fiets komt brengen.</p>
      <div className="spaak-day-nav">
        <button className="spaak-button spaak-secondary" type="button" disabled={busy}
          onClick={() => openDay(moveDay(date, -1))}>Vorige dag</button>
        <button className="spaak-button spaak-secondary" type="button" disabled={busy}
          onClick={() => openDay(moveDay(date, 1))}>Volgende dag</button>
      </div>
      <p className="spaak-day-label"><time dateTime={date}>{dayLabel(date)}</time></p>
      {day?.reden && <div className="spaak-panel">
        <p>{day.reden === "gesloten" ? "Op deze dag is de werkplaats gesloten."
          : day.tijdvakken.length > 0 && day.tijdvakken.every((time) => time.voorbij)
            ? "Alle tijdvakken op deze dag zijn voorbij." : "Deze dag is helemaal vol."}</p>
        {day.volgende && <button className="spaak-button" type="button" disabled={busy}
          onClick={() => { if (day.volgende) openDay(day.volgende); }}>{dayLabel(day.volgende)}</button>}
      </div>}
      <div className="spaak-choices">{day?.tijdvakken.map((time) => <button type="button" key={time.start}
        className="spaak-choice spaak-slot" disabled={time.voorbij === true || time.vrij <= 0 || busy}
        aria-label={`${time.start} – ${time.eind}${time.voorbij ? " Voorbij" : time.vrij <= 0 ? " Vol" : ""}`}
        onClick={() => { setSlot(time); setErrors({}); setNotice(null); setStep(3); }}>
        <span>{time.start} – {time.eind}</span>{(time.voorbij || time.vrij <= 0) &&
          <span className="spaak-slot-note">{time.voorbij ? "Voorbij" : "Vol"}</span>}
      </button>)}</div>
      <button className="spaak-back" type="button" disabled={busy} onClick={() => { setNotice(null); setStep(1); }}>Andere reparatie kiezen</button>
    </>}
    {step === 3 && repair && slot && <>
      <div className="spaak-recap">{summary({ date, start: slot.start, end: slot.eind, repairTypeId: repair.id })}</div>
      <form noValidate onSubmit={submit}>
        {CONTACT_FIELDS.map((field) => {
          const id = `${fieldPrefix}-${field}`;
          const common = {
            id, name: field, value: contact[field], "aria-invalid": errors[field] ? true : undefined,
            "aria-describedby": errors[field] ? `${id}-error` : undefined,
            onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              const value = event.target.value;
              setContact((current) => ({ ...current, [field]: value }));
              setErrors((current) => ({ ...current, [field]: undefined }));
            },
          };
          return <div className="spaak-field" key={field}>
            <label htmlFor={id}>{LABELS[field]}</label>
            {field === "fiets" ? <textarea {...common} rows={5} />
              : <input {...common} type={field === "email" ? "email" : field === "telefoon" ? "tel" : "text"}
                autoComplete={field === "naam" ? "name" : field === "telefoon" ? "tel" : "email"} />}
            {errors[field] && <p className="spaak-field-error" id={`${id}-error`}>{errors[field]}</p>}
          </div>;
        })}
        {(["date", "start", "repairTypeId"] as const).map((field) => errors[field]
          ? <p className="spaak-field-error" key={field}>{errors[field]}</p> : null)}
        <button className="spaak-button" type="submit" disabled={busy}>Bevestigen</button>
      </form>
      <button className="spaak-back" type="button" disabled={busy} onClick={() => openDay(date)}>Ander tijdvak kiezen</button>
    </>}
    {step === 4 && confirmation && <>
      <p className="spaak-lead">Bewaar je afspraakcode. We zien je graag in de werkplaats.</p>
      <p className="spaak-code" aria-label="Afspraakcode">{Array.from(confirmation.code, (letter, index) => <span key={index}>{letter}</span>)}</p>
      <div className="spaak-panel spaak-confirmation">{summary(confirmation.afspraak)}</div>
    </>}
  </section>;
}
