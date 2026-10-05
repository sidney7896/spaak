import Link from "next/link";
import { listNotes } from "../../../lib/notes";
import { getCurrentUser } from "../../../lib/auth/session";

const tijd = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" });

export default async function DashboardPage() {
  let notes: Awaited<ReturnType<typeof listNotes>> | null = null;
  try { notes = await listNotes(); } catch { notes = null; }
  const recent = (notes ?? []).slice(0, 3);
  const user = await getCurrentUser();
  return <main>
    <div className="row"><div className="stack" style={{ gap: ".25rem" }}><h1>Welkom terug</h1><p className="muted">Je notities zijn alleen voor jou zichtbaar.</p></div><Link className="button" href="/notes#nieuw">Nieuwe notitie</Link></div>
    <div className="stats">
      <section className="card stat"><span className="muted">Notities</span><span className="stat-value">{notes === null ? "–" : notes.length}</span></section>
      <section className="card stat"><span className="muted">Laatst bijgewerkt</span><span className="stat-value" style={{ fontSize: "1.25rem" }}>{recent[0] ? tijd.format(new Date(recent[0].updated_at)) : "Nog niets"}</span></section>
      <section className="card stat soft"><span className="muted">Ingelogd als</span><span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{user?.email ?? "onbekend"}</span></section>
    </div>
    <section className="card stack"><div className="row"><h2>Recente notities</h2><Link href="/notes">Alle notities</Link></div>
      {notes === null ? <p className="notice error" role="alert">Notities zijn even niet beschikbaar. Probeer het later opnieuw.</p>
        : recent.length === 0 ? <p className="muted">Nog geen notities. <Link href="/notes#nieuw">Maak je eerste notitie</Link>.</p>
        : <div className="list">{recent.map((note) => <Link key={note.id} className="list-item" href={`/notes/${note.id}`} style={{ color: "inherit", textDecoration: "none" }}><span className="stack" style={{ gap: ".25rem" }}><strong>{note.title}</strong><span className="note-body">{note.body.slice(0, 120)}</span></span><time dateTime={note.updated_at}>{tijd.format(new Date(note.updated_at))}</time></Link>)}</div>}
    </section>
  </main>;
}
