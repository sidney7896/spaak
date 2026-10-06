import { BookingFlow } from "../components/spaak/booking-flow";
import { Wheel } from "../components/spaak/wheel";
import { pageDate } from "../lib/spaak/datum";
import "./spaak.css";

type Props = { searchParams: Promise<{ datum?: string | string[] }> };

export default async function HomePage({ searchParams }: Props) {
  const { datum } = await searchParams;
  return <main className="spaak-home">
    <header className="spaak-shop-header"><Wheel /><div>
      <p className="spaak-shop-name">De Spaak</p>
      <p className="spaak-shop-subtitle">Fietsenmakerij</p>
    </div></header>
    <BookingFlow initialDate={pageDate(datum)} />
    <footer className="spaak-footer">
      <p>Je brengt je fiets op het gekozen tijdvak, of laat hem ophalen binnen de ring.</p>
      <p>De werkplaats is open van dinsdag tot en met zaterdag. Op zondag en maandag zijn we dicht.</p>
      <a className="spaak-staff-link" href="/werkplaats">Voor de werkplaats</a>
    </footer>
  </main>;
}
