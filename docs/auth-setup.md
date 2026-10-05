# Authentication setup

Configure Supabase Auth redirect URLs for the exact application origin and `/auth/callback`. Enable a provider in both Supabase and `project.profile.json`; the sign-in screen intentionally renders only profile-enabled methods. For `signupMode: invite-only`, disable Supabase Auth's “Allow new users to sign up” setting and provision the user's application membership before sending a link. The OTP request uses `shouldCreateUser: false`, and the callback signs out users without a membership. Configure production custom SMTP before relying on magic links. Callback redirects are restricted to same-origin paths in the allow-list.

## The membership oracle: one function, both topologies

The application gate calls exactly one function, in the exposed `public` schema:

```ts
supabase.schema("public").rpc("launch_is_member", { slug, env })
```

`public.launch_is_member(slug text, env text)` is `SECURITY DEFINER` with a pinned `search_path` and
reads `auth.uid()` itself, so a caller can only ever ask about itself and nothing has to expose the
control-plane `registry` schema to the Data API (decision D-013). PostgREST binds RPC arguments by
name, so `slug` and `env` are part of the contract, and `env` is one of `dev`, `stg`, `prod`.

| topology | where the wrapper and the membership rows live |
|---|---|
| `shared` | the control plane: `packages/registry/migrations/0009_adoption_enforcement_and_membership_wrapper.sql` over `registry.app_memberships`. RLS policies inside the database keep calling `registry.is_member(auth.uid(), slug, env)` directly. |
| `dedicated` | this project: the rendered migration creates `app_memberships` and the identical wrapper, and the RLS policies call `public.launch_is_member(slug, env)`. |

Deployment prerequisites, both integration responsibilities outside this template:

- `EXECUTE` on `public.launch_is_member` must be granted to `authenticated` (and revoked from
  `anon`). Both migrations do this; confirm it with the database's own checks, not with this
  document.
- Membership rows are written by the provisioning path with the service role. In a dedicated
  project `app_memberships` is readable by the member themself and writable only by the service
  role; there is no self-service path into it.

A user who is removed from the membership table loses the application gate and row access at the
same time, because the same predicate sits in the RLS policies.

There is no claim-based path. An earlier version of this template read an
`app_metadata.invited_slugs` claim in the dedicated branch; nothing in the platform ever writes that
claim, so every dedicated invite-only project refused every user at the callback (R3-01). If you
find that name anywhere, it is a regression.

## Identity binding

`SUPABASE_DB_SCHEMA`, `NEXT_PUBLIC_SUPABASE_DB_SCHEMA`, `SUPABASE_STORAGE_BUCKET` and
`NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` are derived from the canonical slug in `project.profile.json`
plus `APP_ENV`. A valid-looking schema or bucket belonging to another application or another
environment is rejected at startup with an exact message; the server and public settings must be
identical.

`APP_ENV` is server-only and `NEXT_PUBLIC_*` values are inlined at build time, so the browser bundle
and the middleware need their own build-stamped copy of the environment: `NEXT_PUBLIC_APP_ENV`. Set
it in every environment - the generated `.env.example` carries it and `check:standard` requires it
to be present:

- with `NEXT_PUBLIC_APP_ENV` the browser and middleware binding covers the application *and* the
  environment, and the server config rejects any value that disagrees with `APP_ENV`;
- without it the browser and middleware binding falls back to the application alone. They then
  accept `app_<slug>_dev` while the server is bound to `app_<slug>_prod`. Nothing leaks - the
  server rejects the mismatch and the browser client is only used for auth - but a promoted build
  would keep its build environment's schema in the client bundle without saying so.
