const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);
const maxBytes = 10 * 1024 * 1024;

export function validateUpload(file: { type: string; size: number }): void {
  if (!allowedTypes.has(file.type)) throw new Error("Unsupported upload type.");
  if (file.size <= 0 || file.size > maxBytes) throw new Error("Upload exceeds the 10 MB limit.");
}

export function ownerStoragePath(ownerId: string, filename: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId) || filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") throw new Error("Invalid storage path.");
  return `${ownerId}/${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
}
