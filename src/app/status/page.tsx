import { StatusLookup } from "../../components/spaak/status-lookup";
import { Wheel } from "../../components/spaak/wheel";
import "../spaak.css";
import "../spaak-status.css";

type Props = { searchParams: Promise<{ code?: string | string[] }> };

export default async function StatusPage({ searchParams }: Props) {
  const { code } = await searchParams;
  const initialCode = Array.isArray(code) ? code[0] : code;
  return <main className="spaak-home spaak-status-page">
    <header className="spaak-shop-header"><Wheel /><div>
      <p className="spaak-shop-name">De Spaak</p>
      <p className="spaak-shop-subtitle">Fietsenmakerij</p>
    </div></header>
    <StatusLookup initialCode={initialCode} />
    <footer className="spaak-footer">
      <p>Vragen over je fiets? Bel ons: <a href="tel:0105550142">010-555 01 42</a>.</p>
    </footer>
  </main>;
}
