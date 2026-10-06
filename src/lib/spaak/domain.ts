export type Status = "gepland" | "ontvangen" | "bezig" | "klaar" | "opgehaald" | "geannuleerd";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type Slot = { start: string; end: string; capacity: number };
export type Contact = { naam: string; telefoon: string; email: string; fiets: string };
export type ContactErrors = Partial<Record<keyof Contact, string>>;
export type Ophalen = { postcode: string; adres: string };
export const OPHAAL_TOESLAG_CENT = 1000;

export function normalizePostcode(input: string): string | null {
  const compact = input.replace(/\s/g, "").toUpperCase();
  if (!/^[1-9][0-9]{3}[A-Z]{2}$/.test(compact)) return null;
  return `${compact.slice(0, 4)} ${compact.slice(4)}`;
}

export function validateOphalen(o: Ophalen): Partial<Record<keyof Ophalen, string>> {
  const errors: Partial<Record<keyof Ophalen, string>> = {};
  const postcode = normalizePostcode(o.postcode);
  if (postcode === null) errors.postcode = "Vul een postcode in zoals 3512 AB.";
  else if (Number(postcode.slice(0, 4)) < 3500 || Number(postcode.slice(0, 4)) > 3599) {
    errors.postcode = "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599";
  }
  const length = o.adres.trim().length;
  if (length < 1 || length > 120) errors.adres = "Vul een straat en huisnummer in.";
  return errors;
}

function parseDate(date: string): Date {
  if (date.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Ongeldige datum.");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Ongeldige datum.");
  }
  return parsed;
}

export function slotsForDate(date: string, closedDays: readonly string[]): Slot[] {
  const weekday = parseDate(date).getUTCDay();
  if (weekday === 0 || weekday === 1 || closedDays.includes(date)) return [];
  const saturday = weekday === 6;
  return Array.from({ length: saturday ? 7 : 8 }, (_, index): Slot => ({
    start: `${String(9 + index).padStart(2, "0")}:00`,
    end: `${String(10 + index).padStart(2, "0")}:00`,
    capacity: saturday ? 3 : 2,
  }));
}

const amsterdamClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  era: "short",
});

function amsterdamOffset(instant: Date): number {
  const parts: Record<string, string> = {};
  for (const part of amsterdamClock.formatToParts(instant)) parts[part.type] = part.value;
  const wall = new Date(0);
  const year = parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
  wall.setUTCFullYear(year, Number(parts.month) - 1, Number(parts.day));
  wall.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), 0);
  return wall.getTime() - instant.getTime();
}

export function slotStart(date: string, start: string): Date {
  const wall = parseDate(date);
  if (start.length !== 5 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new Error("Ongeldige tijd.");
  const [hour, minute] = start.split(":").map(Number);
  wall.setUTCHours(hour, minute, 0, 0);
  let instant = wall.getTime();
  // Re-evaluate the offset at the resulting instant: it may cross a DST boundary.
  for (let attempt = 0; attempt < 4; attempt++) {
    const adjusted = wall.getTime() - amsterdamOffset(new Date(instant));
    if (adjusted === instant) return new Date(instant);
    instant = adjusted;
  }
  // A wall time inside the spring-forward gap has no corresponding instant.
  throw new Error("Deze tijd bestaat niet in Europe/Amsterdam.");
}

export function validateContact(contact: Contact): ContactErrors {
  const errors: ContactErrors = {};
  const nameLength = contact.naam.trim().length;
  if (nameLength < 1 || nameLength > 80) errors.naam = "Vul een naam van 1 tot en met 80 tekens in.";
  const digits = contact.telefoon.replace(/\D/g, "").length;
  if (/[^\d +()-]/.test(contact.telefoon) || digits < 10 || digits > 15) {
    errors.telefoon = "Vul een telefoonnummer met 10 tot en met 15 cijfers in.";
  }
  if (/\s/.test(contact.email) || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(contact.email)) {
    errors.email = "Vul een geldig e-mailadres in.";
  }
  if (!contact.fiets.trim() || contact.fiets.length > 500) {
    errors.fiets = "Beschrijf de fiets in 1 tot en met 500 tekens.";
  }
  return errors;
}

export function generateCode(random: () => number): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(random() * 32)]).join("");
}

export function canCancel(start: Date, now: Date): boolean {
  return start.getTime() - now.getTime() >= 24 * 3600_000;
}

export function nextStatus(status: Status): Status | null {
  switch (status) {
    case "gepland": return "ontvangen";
    case "ontvangen": return "bezig";
    case "bezig": return "klaar";
    case "klaar": return "opgehaald";
    default: return null;
  }
}
