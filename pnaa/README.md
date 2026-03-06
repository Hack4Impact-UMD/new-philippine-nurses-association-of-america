This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Install dependencies:

```bash
cd pnaa
npm install
```

Run the development server (uses `.env.local` which uses **production** Firebase by default):

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Environments (prod vs staging)

This app can talk to either the **production** or **staging** Firebase project, depending on which env file/script you use.

- `.env.local` → points to **production** Firebase (`pnaa-chapter-management`).
- `.env.staging.local` → points to **staging** Firebase (`pnaa-chaptermanagement-staging`).

#### Run against production (default)

1. Ensure `pnaa/.env.local` contains the **production** Firebase credentials.
2. Start dev server:

   ```bash
   npm run dev
   ```

### Run against staging

- **Using a dedicated script:**

  Ensure `pnaa/.env.staging.local` contains the **staging** Firebase credentials.

  ```bash
  # package.json script
  # "dev:staging": "env-cmd -f .env.staging.local next dev"

  npm run dev:staging
  ```

<!-- - **Temporarily copy the staging env over:**

  ```bash
  cp .env.staging.local .env.local
  npm run dev
  ```

  Remember to restore `.env.local` with production values when you want to point back to prod. -->
