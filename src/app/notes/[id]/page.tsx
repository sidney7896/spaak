import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../lib/auth/session";

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getCurrentUser())) redirect("/sign-in");
  const supabase = await createServerSupabaseClient();
  const { data: note } = await supabase.from("notes").select("id,title,body").eq("id", id).single();
  if (!note) notFound();
  return <main><p><Link href="/notes">← Terug naar notities</Link></p><section className="card"><form action="/api/notes" method="post" className="stack"><h1>Notitie bewerken</h1><input type="hidden" name="id" value={note.id} /><label className="field">Titel<input name="title" required maxLength={120} defaultValue={note.title} /></label><label className="field">Tekst<textarea name="body" required maxLength={10000} defaultValue={note.body} /></label><div><button type="submit">Wijzigingen opslaan</button></div></form></section></main>;
}
