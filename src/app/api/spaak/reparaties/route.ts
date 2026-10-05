import type { NextRequest } from "next/server";
import { getStore } from "../../../../lib/spaak/server";
import { spaakJson } from "../response";

export async function GET(_request: NextRequest) {
  try {
    return spaakJson({ reparaties: await getStore().listRepairTypes() });
  } catch {
    return spaakJson({ fout: "De reparaties zijn even niet beschikbaar. Probeer het opnieuw." }, 503);
  }
}
