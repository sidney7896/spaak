import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import { BookingFlow } from "../components/spaak/booking-flow";
import { Wheel } from "../components/spaak/wheel";
import "./spaak.css";

export default function HomePage() {
  return <main className="spaak-home">
    <header className="spaak-shop-header"><Wheel /><div>
      <p className="spaak-shop-name">De Spaak</p>
      <p className="spaak-shop-subtitle">Fietsenmakerij</p>
    </div></header>
    <BookingFlow />
    <footer className="spaak-footer">
      <p>Je brengt je fiets op het gekozen tijdvak.</p>
      <p>De werkplaats is open van dinsdag tot en met zaterdag. Op zondag en maandag zijn we dicht.</p>
    </footer>
  </main>;
}
