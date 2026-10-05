import type { NextRequest } from "next/server";
import { slotsForDate } from "../../../../lib/spaak/domain";
import { getStore } from "../../../../lib/spaak/server";
import { spaakJson } from "../response";

export async function GET(request: NextRequest) {
  const datum = request.nextUrl.searchParams.get("datum");
  try {
    if (datum === null) throw new Error("Ongeldige datum.");
    slotsForDate(datum, []);
  } catch {
    return spaakJson({ fout: "Kies een geldige datum (JJJJ-MM-DD)." }, 400);
  }
  // The validation above guarantees a real calendar date.
  if (datum === null) return spaakJson({ fout: "Kies een datum." }, 400);
  try {
    const store = getStore();
    const day = await store.dayAvailability(datum);
    // A past day has no bookable places; keep the public reason vocabulary small.
    const reden = day.reason === "verleden" ? "vol" : day.reason;
    const tomorrow = new Date(`${datum}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const nextDate = tomorrow.toISOString().slice(0, 10);
    const volgende = reden !== null && /^\d{4}-\d{2}-\d{2}$/.test(nextDate)
      ? await store.nextAvailableDate(nextDate) : null;
    return spaakJson({
      datum,
      reden,
      volgende,
      tijdvakken: day.slots.map((slot) => ({
        start: slot.start,
        eind: slot.end,
        vrij: slot.free,
        capaciteit: slot.capacity,
      })),
    });
  } catch {
    return spaakJson({ fout: "De agenda is even niet beschikbaar. Probeer het opnieuw." }, 503);
  }
}
