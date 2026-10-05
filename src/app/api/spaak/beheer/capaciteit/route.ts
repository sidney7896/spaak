import type { NextRequest, NextResponse } from "next/server";
import { slotsForDate } from "../../../../../lib/spaak/domain";
import { getStore } from "../../../../../lib/spaak/server";
import { spaakJson } from "../../response";
import { record, requireOwner, validDate } from "../shared";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const invalid = (): NextResponse => spaakJson({ fout: "Kies een geldige datum, een tijdvak en 0 tot 50 plaatsen." }, 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  if (!record(body) || !validDate(body.datum) || typeof body.start !== "string" ||
      typeof body.capaciteit !== "number" || !Number.isInteger(body.capaciteit) || body.capaciteit < 0 || body.capaciteit > 50 ||
      !slotsForDate(body.datum, []).some((slot) => slot.start === body.start)) return invalid();
  try {
    const store = getStore();
    const day = await store.dayAvailability(body.datum);
    if (!slotsForDate(body.datum, day.closed ? [body.datum] : []).some((slot) => slot.start === body.start)) return invalid();
    await store.setCapacity(body.datum, body.start, body.capaciteit);
    return spaakJson({ ok: true });
  } catch {
    return spaakJson({ fout: "De capaciteit kon even niet worden opgeslagen. Probeer het opnieuw." }, 503);
  }
}
