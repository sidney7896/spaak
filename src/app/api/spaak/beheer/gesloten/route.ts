import type { NextRequest, NextResponse } from "next/server";
import { getStore } from "../../../../../lib/spaak/server";
import { spaakJson } from "../../response";
import { record, requireOwner, validDate } from "../shared";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const invalid = (): NextResponse => spaakJson({ fout: "Kies een geldige datum en geef aan of de dag gesloten is." }, 400);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  if (!record(body) || !validDate(body.datum) || typeof body.gesloten !== "boolean") return invalid();
  try {
    await getStore().setClosedDay(body.datum, body.gesloten);
    return spaakJson({ ok: true });
  } catch {
    return spaakJson({ fout: "De dag kon even niet worden gewijzigd. Probeer het opnieuw." }, 503);
  }
}
