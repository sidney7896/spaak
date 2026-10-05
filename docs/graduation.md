# Supabase topology and graduation

This project was generated with `topology: shared` for application `spaak`.

In the shared project, the application environments use separate schemas: development
`app_spaak_dev`, staging `app_spaak_stg`, and production `app_spaak_prod`. The
application migration is applied with `search_path` pinned to the target schema. The
registry membership check and row ownership check are both required by the shared
policies. The private Storage buckets are `<slug>-<env>-private`.

## Graduation to a dedicated project

Graduation is an owner-approved, resumable operation. Before switching traffic:

1. Record the decision and budget approval in the registry; create the dedicated Supabase project.
2. Render each migration with `ops/render-migration.mjs --topology dedicated --schema public` and apply it to `public`; dedicated policies retain ownership checks and omit shared registry membership checks.
3. Export the production schema data, member users, and Storage objects with checksums. Restore them and run the restore evaluation.
4. Recreate auth providers, SMTP, redirect settings, and the environment references in Infisical and Vercel.
5. Deploy, smoke-test, and keep the old shared schema read-only during the rollback window.
6. Delete the old schema only after a human approves deletion and the rollback window has ended.

No service-role key belongs in a browser or worker. Non-production data remains synthetic or explicitly approved sanitized data.
