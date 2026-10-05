import { projectProfile, type AuthProvider, type ProjectProfile } from "../profile";

export const providerLabels: Record<AuthProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
  magicLink: "Magic link",
};

export function enabledSignInMethods(profile: ProjectProfile = projectProfile): AuthProvider[] {
  return (Object.keys(providerLabels) as AuthProvider[]).filter((provider) => profile.auth.providers[provider]);
}
