This is the Next.js app for the PNAA Chapter Management System. For the full
architecture, auth flow, data models, and deployment docs, see the
[root README](../README.md).

## Getting Started

Install dependencies:

```bash
cd pnaa
npm install
```

Run the development server (uses `.env.local`, which points to the **production**
Supabase project by default):

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Environments (prod vs staging)

This app can talk to either the **production** or **staging** Supabase project,
depending on which env file you use:

- `.env.local` → points to the **production** Supabase project (`pnaa-prod`).
- `.env.staging.local` → points to the **staging** Supabase project (`pnaa-staging`).

```bash
# Production (default)
npm run dev

# Staging (loads .env.staging.local via env-cmd)
npm run dev:staging
```

See [Staging Environment](../README.md#staging-environment) in the root README for
the full list of required environment variables.
