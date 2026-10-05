import profileJson from "../../project.profile.json";

export type AuthProvider = "google" | "microsoft" | "apple" | "magicLink";

export type ProjectProfile = {
  schemaVersion: string;
  slug: string | null;
  client: string | null;
  topology: "shared" | "dedicated";
  signupMode: "invite-only" | "self-service";
  auth: { providers: Record<AuthProvider, boolean> };
  modules: Record<string, { enabled: boolean }>;
};

export const projectProfile = profileJson as ProjectProfile;

export function isModuleEnabled(name: string, profile: ProjectProfile = projectProfile): boolean {
  return profile.modules?.[name]?.enabled === true;
}
