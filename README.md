# Zeroday CVE module

Nuxt 4 app for syncing CVEs from the NVD API into PostgreSQL, optional OpenAI EN→TR fields, PDF reports, and email bulletins. Auth uses signed cookies; SMTP, cron schedule, and report recipients are stored in the database (Settings UI), not in `.env`.

## Prerequisites

| Component | Required | Notes |
|-----------|----------|--------|
| **Node.js** | Yes | Use an LTS version compatible with Nuxt 4. |
| **PostgreSQL** | Yes | CVE rows, settings, email logs, users. Tables are created on startup via `sequelize.sync` (no separate migration CLI). |
| **MinIO** (or S3-compatible storage) | No | Uploads report PDFs to a bucket. If MinIO env is missing, PDFs can still be generated/downloaded; upload is skipped. |
| **OpenAI API** | No | Turkish description / affected products for new CVEs. Without a key those fields stay empty. |
| **NVD API key** | No | Higher rate limits — [request a key](https://nvd.nist.gov/developers/request-an-api-key). Use `NUXT_NVD_API_KEY` or `NVD_API_KEY`. |

SMTP and bulletin recipients are configured in-app under **Settings**, not via environment variables.

## Environment variables

Create a `.env` file in the project root. See `.env.example` for a full template.

**Required**

- `NUXT_SESSION_SECRET` — Cookie session signing secret (use a long random value in production, 32+ chars).
- `NUXT_CVE_URL` — PostgreSQL URL, e.g. `postgres://user:password@127.0.0.1:5432/zeroday`. Alternatively set `NUXT_CVE_HOST`, `NUXT_CVE_PORT`, `NUXT_CVE_DATABASE`, `NUXT_CVE_USER`, `NUXT_CVE_PASSWORD` with `NUXT_CVE_DIALECT=postgres`.

**Optional**

- `NUXT_MINIO_ENDPOINT`, `NUXT_MINIO_ACCESS_KEY`, `NUXT_MINIO_SECRET_KEY`, `NUXT_MINIO_BUCKET` — S3-compatible storage; optional `NUXT_MINIO_REGION` (default `us-east-1`).
- `NUXT_OPENAI_API_KEY` or `OPENAI_API_KEY`, `NUXT_OPENAI_MODEL`, `NUXT_OPENAI_BASE_URL` — translation pipeline.
- `NUXT_NVD_API_KEY` or `NVD_API_KEY` — NVD API quota.
- `NUXT_AUTH_ALLOW_REGISTER=false` — disable new user registration (hides “Register” on the login page).

## PostgreSQL

1. Create an empty database (e.g. `zeroday`).
2. Set `NUXT_CVE_URL` (or the split `NUXT_CVE_*` fields) in `.env`.
3. On first run, tables are created automatically (`cves`, `cve_settings`, `cve_email_logs`, `users`, …).

## MinIO (optional)

S3-compatible endpoint. Local quick start:

```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Point `NUXT_MINIO_ENDPOINT` at your server (e.g. `http://127.0.0.1:9000`), set access/secret keys and `NUXT_MINIO_BUCKET`. The app may create the bucket on upload if it does not exist.

## Install and dev server

```bash
cp .env.example .env
# Edit .env — at least SESSION_SECRET and PostgreSQL

npm install
npm run dev
```

Dev server: `http://localhost:3000` by default.

## Production build

```bash
npm run build
npm run preview
```

See [Nuxt deployment](https://nuxt.com/docs/getting-started/deployment). In production, use a strong `NUXT_SESSION_SECRET`, HTTPS, and a secure database connection.

## More

- [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction)
