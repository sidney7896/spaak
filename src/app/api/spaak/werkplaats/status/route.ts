import type { NextRequest, NextResponse } from "next/server";
import { getStore } from "../../../../../lib/spaak/server";
import { getStaff } from "../../../../../lib/spaak/staff";
import { spaakJson } from "../../response";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!await getStaff(request)) return spaakJson({ fout: "Log opnieuw in." }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return spaakJson({ fout: "Stuur een geldige code en status." }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body) ||
      !("code" in body) || typeof body.code !== "string" || !body.code.trim() || !("status" in body) ||
      (body.status !== "ontvangen" && body.status !== "bezig" && body.status !== "klaar" && body.status !== "opgehaald")) {
    return spaakJson({ fout: "Stuur een geldige code en status." }, 400);
  }

  try {
    const result = await getStore().setStatus(body.code, body.status);
    if (result.ok) return spaakJson({ ok: true });
    return spaakJson({ reden: result.reason }, result.reason === "onbekend" ? 404 : 409);
  } catch {
    return spaakJson({ fout: "De status kon even niet worden gewijzigd. Probeer het opnieuw." }, 503);
  }
}
