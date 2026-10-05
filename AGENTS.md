# Project agent guidance

Keep server-only environment values out of client components. Treat `project.profile.json` as the source of truth for optional modules and authentication methods. Run `pnpm typecheck`, `pnpm lint`, tests, and `pnpm build` before release. Never edit an applied Supabase migration.
