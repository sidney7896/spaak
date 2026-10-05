import { createServerSupabaseClient } from "./supabase/server";

export type Note = { id: string; owner_id: string; title: string; body: string; created_at: string; updated_at: string };

export async function listNotes(): Promise<Note[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("notes").select("id,owner_id,title,body,created_at,updated_at").order("updated_at", { ascending: false });
  if (error) throw new Error("Could not load notes.");
  return (data ?? []) as Note[];
}

export async function createNote(title: string, body: string): Promise<Note> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("notes").insert({ title, body }).select("id,owner_id,title,body,created_at,updated_at").single();
  if (error || !data) throw new Error("Could not create note.");
  return data as Note;
}

export async function updateNote(id: string, title: string, body: string): Promise<Note> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("notes").update({ title, body }).eq("id", id).select("id,owner_id,title,body,created_at,updated_at").single();
  if (error || !data) throw new Error("Could not update note.");
  return data as Note;
}
