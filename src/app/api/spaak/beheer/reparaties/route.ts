import type { NextRequest, NextResponse } from "next/server";
import { getStore } from "../../../../../lib/spaak/server";
import { spaakJson } from "../../response";
import { record, requireOwner } from "../shared";

type FieldErrors = Partial<Record<"naam" | "duurMinuten" | "prijsCent", string>>;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  try {
    return spaakJson({ reparaties: await getStore().listRepairTypes() });
  } catch {
    return spaakJson({ fout: "De reparaties zijn even niet beschikbaar. Probeer het opnieuw." }, 503);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const input: Record<string, unknown> = record(body) ? body : {};
  const naam = typeof input.naam === "string" ? input.naam.trim() : "";
  const { duurMinuten, prijsCent } = input;
  const velden: FieldErrors = {};
  if (naam.length < 1 || naam.length > 80) velden.naam = "Vul een naam van 1 tot en met 80 tekens in.";
  if (typeof duurMinuten !== "number" || !Number.isInteger(duurMinuten) || duurMinuten < 1 || duurMinuten > 480) {
    velden.duurMinuten = "Vul een duur van 1 tot 480 minuten in.";
  }
  if (prijsCent !== null && (typeof prijsCent !== "number" || !Number.isInteger(prijsCent) || prijsCent < 0 || prijsCent > 1_000_000)) {
    velden.prijsCent = "Vul een prijs van 0 tot 10.000 euro in, of laat de prijs leeg.";
  }
  if (Object.keys(velden).length > 0 || typeof duurMinuten !== "number" ||
      (prijsCent !== null && typeof prijsCent !== "number")) {
    return spaakJson({ reden: "ongeldig", velden }, 422);
  }
  try {
    const reparatie = await getStore().addRepairType({ naam, duurMinuten, prijsCent });
    return spaakJson({ reparatie }, 201);
  } catch {
    return spaakJson({ fout: "De reparatie kon even niet worden toegevoegd. Probeer het opnieuw." }, 503);
  }
}
