import type { NextRequest, NextResponse } from "next/server";
import { CODE_ALPHABET } from "../../../../../lib/spaak/domain";
import { checkLookup } from "../../../../../lib/spaak/rate-limit";
import { getStore } from "../../../../../lib/spaak/server";
import { spaakJson } from "../../response";

const codePattern = new RegExp(`^[${CODE_ALPHABET}]{6}$`);
type Context = { params: Promise<{ code: string }> };

export async function GET(request: NextRequest, context: Context): Promise<NextResponse> {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!checkLookup(key)) {
    return spaakJson({ fout: "Te veel pogingen. Probeer het over een paar minuten opnieuw." }, 429);
  }
  const code = (await context.params).code.trim().toUpperCase();
  if (!codePattern.test(code)) return spaakJson({ fout: "Geen afspraak gevonden met deze code" }, 404);

  try {
    const store = getStore();
    const booking = await store.findByCode(code);
    if (!booking) return spaakJson({ fout: "Geen afspraak gevonden met deze code" }, 404);
    const repair = (await store.listRepairTypes()).find((type) => type.id === booking.repairTypeId);
    if (!repair) throw new Error("Reparatietype ontbreekt.");
    return spaakJson({
      code: booking.code,
      status: booking.status,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      reparatie: repair.naam,
    });
  } catch {
    return spaakJson({ fout: "Je afspraak is even niet beschikbaar. Probeer het opnieuw." }, 503);
  }
}
