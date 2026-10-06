import type { NextRequest, NextResponse } from "next/server";
import { slotsForDate } from "../../../../../lib/spaak/domain";
import { getStore } from "../../../../../lib/spaak/server";
import { getStaff } from "../../../../../lib/spaak/staff";
import { spaakJson } from "../../response";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!await getStaff(request)) return spaakJson({ fout: "Log opnieuw in." }, 401);
  const datum = request.nextUrl.searchParams.get("datum");
  if (datum === null) return spaakJson({ fout: "Kies een geldige datum (JJJJ-MM-DD)." }, 400);
  try {
    slotsForDate(datum, []);
  } catch {
    return spaakJson({ fout: "Kies een geldige datum (JJJJ-MM-DD)." }, 400);
  }

  try {
    const store = getStore();
    const [groups, repairs] = await Promise.all([store.dayOverview(datum), store.listRepairTypes()]);
    const repairNames = new Map(repairs.map((repair) => [repair.id, repair.naam]));
    return spaakJson({
      datum,
      tijdvakken: groups.map(({ slot, bookings }) => ({
        start: slot.start,
        eind: slot.end,
        afspraken: bookings.map((booking) => ({
          code: booking.code, naam: booking.naam, telefoon: booking.telefoon, fiets: booking.fiets,
          reparatie: repairNames.get(booking.repairTypeId) ?? "Onbekende reparatie",
          status: booking.status, start: booking.start, eind: booking.end,
          ophalen: booking.ophalen, toeslagCent: booking.toeslagCent,
        })),
      })),
    });
  } catch {
    return spaakJson({ fout: "De agenda is even niet beschikbaar. Probeer het opnieuw." }, 503);
  }
}
