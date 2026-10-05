import type { NextRequest, NextResponse } from "next/server";
import { CODE_ALPHABET } from "../../../../../../lib/spaak/domain";
import { checkLookup } from "../../../../../../lib/spaak/rate-limit";
import { getStore } from "../../../../../../lib/spaak/server";
import { spaakJson } from "../../../response";

const codePattern = new RegExp(`^[${CODE_ALPHABET}]{6}$`);
type Context = { params: Promise<{ code: string }> };

export async function POST(request: NextRequest, context: Context): Promise<NextResponse> {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!checkLookup(key)) {
    return spaakJson({ fout: "Te veel pogingen. Probeer het over een paar minuten opnieuw." }, 429);
  }
  const code = (await context.params).code.trim().toUpperCase();
  if (!codePattern.test(code)) return spaakJson({ fout: "Geen afspraak gevonden met deze code" }, 404);

  try {
    const result = await getStore().cancel(code);
    if (result.ok) return spaakJson({ status: "geannuleerd" });
    switch (result.reason) {
      case "onbekend": return spaakJson({ fout: "Geen afspraak gevonden met deze code" }, 404);
      case "te-laat": return spaakJson({ reden: "te-laat", telefoon: "010-555 01 42" }, 409);
      case "status": return spaakJson({ reden: "status" }, 409);
    }
  } catch {
    return spaakJson({ fout: "Annuleren lukt even niet. Probeer het opnieuw." }, 503);
  }
}
