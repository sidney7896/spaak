import { NextResponse, type NextRequest } from "next/server";
import { hasApplicationAccess, requireUser } from "../../../lib/auth/session";
import { privateStorageBucketName, getServerConfig } from "../../../lib/config";
import { ownerStoragePath, validateUpload } from "../../../lib/storage";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { isModuleEnabled } from "../../../lib/profile";

export async function POST(request: NextRequest) {
  if (!isModuleEnabled("fileUpload")) return NextResponse.json({ error: "File uploads are disabled." }, { status: 404 });
  let user;
  try { user = await requireUser(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  // R4S-11: in the shared topology one Auth pool serves every application, so "signed in" is not
  // "belongs here". Without this gate a signed-in non-member reached the handler and was stopped by
  // the Storage RLS predicate, which surfaced as `502 Upload failed` - a refusal reported as a
  // provider error. RLS stays the second line; this is the first.
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
    if (!(await hasApplicationAccess(supabase, user))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch { return NextResponse.json({ error: "Uploads are unavailable." }, { status: 503 }); }
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required." }, { status: 400 });
  try {
    validateUpload(file);
    const config = getServerConfig();
    const path = ownerStoragePath(user.id, file.name);
    const { error } = await supabase.storage.from(privateStorageBucketName(config)).upload(path, file, { contentType: file.type, upsert: false });
    if (error) return NextResponse.json({ error: "Upload failed." }, { status: 502 });
    return NextResponse.json({ path }, { status: 201 });
  } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
}
