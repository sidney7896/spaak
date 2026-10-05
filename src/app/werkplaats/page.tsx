import { redirect } from "next/navigation";
import { DayBoard } from "../../components/spaak/day-board";
import { Wheel } from "../../components/spaak/wheel";
import { getStaff } from "../../lib/spaak/staff";
import "../spaak.css";

export default async function WorkshopPage() {
  if (!await getStaff()) redirect("/sign-in");
  return <main className="spaak-home spaak-workshop">
    <header className="spaak-shop-header"><Wheel /><div>
      <p className="spaak-shop-name">De Spaak</p>
      <p className="spaak-shop-subtitle">Werkplaats · dagoverzicht</p>
    </div></header>
    <DayBoard />
  </main>;
}
