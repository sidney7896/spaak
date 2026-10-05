import Link from "next/link";
import { redirect } from "next/navigation";
import { OwnerSettings } from "../../components/spaak/owner-settings";
import { Wheel } from "../../components/spaak/wheel";
import { getStaff } from "../../lib/spaak/staff";
import "../spaak.css";

export default async function OwnerPage() {
  const staff = await getStaff();
  if (staff === null) redirect("/sign-in");
  return <main className="spaak-home spaak-owner">
    <header className="spaak-shop-header"><Wheel /><div>
      <p className="spaak-shop-name">De Spaak</p>
      <p className="spaak-shop-subtitle">Instellingen van de werkplaats</p>
    </div></header>
    {staff.rol !== "eigenaar" ? <section className="spaak-flow">
      <h1>Alleen voor de eigenaar.</h1>
      <Link className="spaak-button spaak-secondary" href="/werkplaats">Naar de werkplaats</Link>
    </section> : <OwnerSettings />}
  </main>;
}
