import type { NextRequest, NextResponse } from "next/server";
import { getStore } from "../../../../../lib/spaak/server";
import { spaakJson } from "../../response";
import { requireOwner, validDate } from "../shared";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const datum = request.nextUrl.searchParams.get("datum");
  if (!validDate(datum)) return spaakJson({ fout: "Kies een geldige datum (JJJJ-MM-DD)." }, 400);
  try {
    const day = await getStore().dayAvailability(datum);
    return spaakJson({
      datum, gesloten: day.closed,
      tijdvakken: day.slots.map((slot) => ({
        start: slot.start, eind: slot.end, capaciteit: slot.capacity, geboekt: slot.booked, vrij: slot.free,
      })),
    });
  } catch {
    return spaakJson({ fout: "De agenda is even niet beschikbaar. Probeer het opnieuw." }, 503);
  }
}
