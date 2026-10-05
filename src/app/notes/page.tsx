import Link from "next/link";
import { redirect } from "next/navigation";
import { listNotes } from "../../lib/notes";
import { getCurrentUser } from "../../lib/auth/session";

const tijd = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" });

export default async function NotesPage() {
  if (!(await getCurrentUser())) redirect("/sign-in");
  let notes: Awaited<ReturnType<typeof listNotes>> | null = null;
  try {
    notes = await listNotes();
  } catch {
    notes = null;
  }
  // Rendered outside the try: React renders JSX lazily, so a catch around JSX would not catch render errors.
  if (notes === null) return <main><section className="card stack"><h1>Notities</h1><p className="notice error" role="alert">Notities zijn even niet beschikbaar. Probeer het later opnieuw.</p></section></main>;
  return <main>
    <div className="stack" style={{ gap: ".25rem" }}><h1>Notities</h1><p className="muted">Alleen jij kunt je notities zien.</p></div>
    <section className="card" id="nieuw"><form action="/api/notes" method="post" className="stack"><h2>Nieuwe notitie</h2><label className="field">Titel<input name="title" required maxLength={120} /></label><label className="field">Tekst<textarea name="body" required maxLength={10000} /></label><div><button type="submit">Notitie opslaan</button></div></form></section>
    <section className="card" aria-label="Je notities">{notes.length === 0 ? <p className="muted">Nog geen notities.</p> : <div className="list">{notes.map((note) => <article className="list-item" key={note.id}><div className="stack" style={{ gap: ".25rem" }}><h2>{note.title}</h2><p className="note-body">{note.body}</p><p><Link href={`/notes/${note.id}`}>Bewerken</Link></p></div><time dateTime={note.updated_at}>{tijd.format(new Date(note.updated_at))}</time></article>)}</div>}</section>
  </main>;
}
