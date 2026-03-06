# Functions CLI Commands

All commands are run from the `functions/` directory.

---

## Build

```bash
npm run build
```

Compiles TypeScript to JavaScript (`src/` → `lib/`). Run this before any `node lib/...` command, or just use the `npm run sync:*` scripts which build automatically.

---

## Deploy to Firebase

```bash
npm run deploy
```

Builds and deploys all four Cloud Functions to production:
- `syncMembers` — runs every 1 minute
- `syncEvents` — runs every 1 minute
- `updateMembers` — runs daily at 2 AM EST
- `createUser` — callable by national admins

To deploy only specific functions (faster):

```bash
firebase deploy --only functions:syncMembers,functions:syncEvents
```

---

## Local Sync (runs against production Firestore directly)

These run on your machine but write to the real production database. No deploy needed.

### Sync everything

```bash
npm run sync
```

Syncs all members + chapters, then all events.

---

### Sync members & chapters

```bash
npm run sync:members
```

Fetches all contacts from Wild Apricot, writes them to the `members` collection, then aggregates chapter totals into the `chapters` collection.

**With flags** (pass after `--`):

```bash
# Start from contact #5000 (skip the first 5000)
npm run sync:members -- --from 5000

# Process only the first 3000 contacts
npm run sync:members -- --limit 3000

# Process contacts 5000–7999 (start at 5000, take 3000)
npm run sync:members -- --from 5000 --limit 3000

# --skip is an alias for --from
npm run sync:members -- --skip 10000
```

> **Note:** Chapters are always aggregated from **all** members already in Firestore, not just the ones written in the current run. This means partial runs still produce accurate chapter counts.

**How to sync 22,000 contacts in chunks** (if a single run is too slow or times out):

```bash
npm run sync:members -- --limit 5000           # contacts 0–4999
npm run sync:members -- --from 5000  --limit 5000  # contacts 5000–9999
npm run sync:members -- --from 10000 --limit 5000  # contacts 10000–14999
npm run sync:members -- --from 15000 --limit 5000  # contacts 15000–19999
npm run sync:members -- --from 20000               # contacts 20000–end
```

---

### Sync events

```bash
npm run sync:events
```

Fetches all events from Wild Apricot and inserts any that don't already exist in the `events` collection. **Existing events are never overwritten** — only new ones are added.

---

## How the WA contacts sync works

Wild Apricot's contacts API uses an async job system for large result sets:

1. An initial request is made — WA starts preparing the result and returns a `ResultUrl`.
2. The script polls the `ResultUrl` every 5 seconds (up to 10 minutes) until the job is `Complete`.
3. Once complete, the script paginates through the result 100 contacts at a time using `$top`/`$skip`.

The first run may take several minutes to start while WA prepares the result. Subsequent runs within ~10 minutes are faster because WA caches the result.

---

## Emulator (local only, does not touch production)

```bash
npm run serve
```

Builds and starts the Firebase emulator suite locally (Functions on port 5001, Firestore on 8080, Storage on 9199, Auth on 9099). Data written here does **not** affect production.
