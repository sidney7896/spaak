# Environment mapping

| Branch | Logical environment | Data |
| --- | --- | --- |
| `feature/*` | isolated development/test | disposable synthetic |
| `dev` | development | separate application schema and private bucket |
| `staging` | staging | separate application schema and private bucket |
| `main` | production | production schema and private bucket only |

Local development is separate from hosted Preview. Environment values affect new deployments; verify the active deployment after changing them.
In a shared project, `SUPABASE_DB_SCHEMA` and `NEXT_PUBLIC_SUPABASE_DB_SCHEMA` must name the matching `app_<slug>_<dev|stg|prod>` schema. The corresponding private bucket is `<slug>-<env>-private`; `public` is used only for a dedicated project.
