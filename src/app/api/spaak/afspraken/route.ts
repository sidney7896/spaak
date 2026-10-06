import type { NextRequest } from "next/server";
import type { BookingInput } from "../../../../lib/spaak/store";
import { normalizePostcode, validateOphalen, type Ophalen } from "../../../../lib/spaak/domain";
import { getStore } from "../../../../lib/spaak/server";
import { spaakJson } from "../response";

const MAX_BYTES = 64 * 1024;
const INPUT_FIELDS = ["repairTypeId", "date", "start", "naam", "telefoon", "email", "fiets"] as const;

export async function POST(request: NextRequest) {
  const key = request.headers.get("Idempotency-Key");
  if (key === null || !/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    return spaakJson({ fout: "Een geldige Idempotency-Key is verplicht." }, 400);
  }

  let payload: unknown;
  try {
    // Count actual bytes, including streamed bodies without a Content-Length header.
    const reader = request.body?.getReader();
    if (!reader) return spaakJson({ fout: "Stuur een JSON-object met je afspraak." }, 400);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) {
          void reader.cancel().catch(() => {});
          return spaakJson({ fout: "De aanvraag is te groot (maximaal 64 KiB)." }, 413);
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    payload = JSON.parse(text) as unknown;
  } catch {
    return spaakJson({ fout: "Stuur een geldig JSON-object met je afspraak." }, 400);
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return spaakJson({ fout: "Stuur een JSON-object met je afspraak." }, 400);
  }

  const object = payload as Record<string, unknown>;
  const fields: Partial<Record<keyof BookingInput, string>> = {};
  for (const field of INPUT_FIELDS) {
    if (typeof object[field] !== "string") fields[field] = "Vul dit veld in als tekst.";
  }
  let ophalen: Ophalen | null = null;
  if (object.ophalen !== undefined && object.ophalen !== null) {
    const value = object.ophalen;
    if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, "postcode") || !Object.hasOwn(value, "adres") ||
        typeof (value as Record<string, unknown>).postcode !== "string" ||
        typeof (value as Record<string, unknown>).adres !== "string") {
      fields.ophalen = "Vul postcode en adres in als tekst.";
    } else {
      ophalen = value as Ophalen;
    }
  }
  if (Object.keys(fields).length > 0) {
    return spaakJson({ reden: "ongeldig", velden: fields }, 422);
  }
  if (ophalen) {
    const errors = validateOphalen(ophalen);
    if (Object.keys(errors).length) return spaakJson({ reden: "ongeldig", velden: errors }, 422);
  }
  // Copy only the validated input fields; ignore additional properties.
  const input: BookingInput = {
    repairTypeId: object.repairTypeId as string,
    date: object.date as string,
    start: object.start as string,
    naam: object.naam as string,
    telefoon: object.telefoon as string,
    email: object.email as string,
    fiets: object.fiets as string,
    ophalen,
  };
  try {
    const result = await getStore().book(input, key);
    if (result.ok) {
      // The store returns the original booking for a reused key. Only its submitter may see it.
      const matches = INPUT_FIELDS.every((field) => result.booking[field] ===
        (field === "repairTypeId" || field === "date" || field === "start" ? input[field] : input[field].trim()));
      const stored = result.booking.ophalen;
      const pickupMatches = ophalen === null ? stored === null : stored !== null &&
        stored.postcode === normalizePostcode(ophalen.postcode) && stored.adres === ophalen.adres.trim();
      if (!matches || !pickupMatches) return spaakJson({ reden: "sleutel" }, 409);
      return spaakJson({ code: result.booking.code, afspraak: result.booking }, 201);
    }
    if (result.reason === "ongeldig") {
      return spaakJson({ reden: result.reason, velden: result.fields ?? {} }, 422);
    }
    return spaakJson({ reden: result.reason }, 409);
  } catch {
    return spaakJson({ fout: "Je afspraak kon even niet worden verwerkt. Probeer het opnieuw." }, 503);
  }
}
