import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth/session";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await getCurrentUser())) redirect("/sign-in");
  return children;
}
