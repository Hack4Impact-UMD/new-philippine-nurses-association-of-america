# Plan 004: Renewal reminders & lapsed-member retention

> **Executor instructions**: This plan has a **human-decision gate you cannot resolve alone** (which
> email provider, and whether to coordinate with Wild Apricot's existing renewal emails). Do **Step 0**
> first and STOP for the operator's answers before building anything that actually sends mail. Follow
> every verification command. Honor STOP conditions. When done (or blocked at the gate), update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ae467a2..HEAD -- supabase/migrations/20260613000001_dashboard_stats.sql supabase/functions supabase/config.toml`
> If any changed, compare the "Current state" excerpts below against the live code; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH (sends real email to up to ~14k people; provider + deliverability + opt-out;
  must not duplicate Wild Apricot's own renewal mail)
- **Depends on**: none (but is the biggest/riskiest of the four — schedule it last)
- **Category**: direction
- **Planned at**: commit `ae467a2`, 2026-06-15

## Why this matters

The app **already knows exactly who is about to lapse** — `dashboard_stats()` computes "renewals due
in the next 30 days" — but nothing acts on it, because there is **no email/notification system
anywhere in the codebase** (a grep for `resend|sendgrid|mailgun|smtp` finds only `member.email` field
references). For a membership organization, reducing lapse is mission-critical, and the at-risk list
is already calculated. This plan adds the missing outbound channel: a scheduled job that emails
members whose renewal is approaching. It is deliberately the last plan because it touches real
people's inboxes and requires provisioning an external service.

## Current state

Relevant files (read each before editing):

- `supabase/migrations/20260613000001_dashboard_stats.sql` — proves the at-risk query already exists.
  The renewal-due-soon computation:
  ```sql
  count(*) filter (
    where "activeStatus" = 'Active'
      and "renewalDueDate" ~ '^\d{4}-\d{2}-\d{2}'
      and to_date("renewalDueDate", 'YYYY-MM-DD') between v_today and (v_today + 30)
  )
  ```
  Reuse this exact predicate to *select the rows* (not just count them) in the reminder job.
- `supabase/functions/sync-events/index.ts` — exemplar Edge Function. Conventions: Deno, imports from
  `../_shared/supabase.ts` (`getServiceClient`, `verifyWebhookSecret`) and `../_shared/wa.ts`,
  HTTP-triggered with `?key=<WEBHOOK_SECRET>`. **Match this structure** (service client, secret
  verification) for a new function.
- `supabase/functions/_shared/supabase.ts` — exports `getServiceClient()` (service-role client, used
  for privileged reads/writes) and `verifyWebhookSecret(req)`. Read it before writing the new function.
- `supabase/config.toml` — registers each function and its `verify_jwt` flag:
  ```toml
  [functions.sync-events]
  verify_jwt = false
  [functions.wild-apricot-webhook]
  verify_jwt = false
  ```
  The new function needs its own `[functions.send-renewal-reminders]` block.
- `supabase/migrations/20260515000005_pg_cron.sql` — the cron pattern: `cron.schedule(name, expr,
  $$ ... $$)`. Scheduling an Edge Function from pg_cron requires `pg_net` (`net.http_post`) — confirm
  whether the project already enables it (grep migrations for `pg_net` / `net.http_post`); if not, the
  schedule step must enable it.
- The `members` table has `email`, `name`, `renewalDueDate`, `activeStatus`, `chapterId`, `region`.
  There is **no opt-out / email-preferences column today** — this plan adds one.

Conventions:
- New SQL = new migration file. Quoted camelCase columns.
- Edge Functions live in `supabase/functions/<name>/index.ts`, Deno, and read config from the
  Supabase project's function secrets (NOT from `.env.local`). Secrets are referenced by name only.

## ⚠️ Secrets note

This plan introduces an email-provider API key. **Never write the key value into any file in the
repo.** It belongs in the Supabase project's Edge Function secrets (Dashboard → Settings → Edge
Functions → Secrets), referenced in code by name only (e.g. `Deno.env.get("RESEND_API_KEY")`). If you
ever see a real key, do not echo it; reference it by name and recommend rotation.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint (from `pnaa/`) | `npm run lint` | exit 0 (only if you touch app code) |
| Local DB (repo root) | `supabase start` + `supabase db reset` | migrations apply cleanly |
| Serve function locally (repo root) | `supabase functions serve send-renewal-reminders` | function boots, no import error |
| Deno check (repo root) | `deno check supabase/functions/send-renewal-reminders/index.ts` | exit 0 |

## Scope

**In scope** (create or modify only these):
- `supabase/migrations/<next-timestamp>_email_prefs.sql` (create — adds an opt-out column + a
  `renewal_reminder_candidates()` RPC + a send-log table)
- `supabase/functions/send-renewal-reminders/index.ts` (create — the sending function)
- `supabase/functions/_shared/email.ts` (create — thin provider wrapper, provider chosen in Step 0)
- `supabase/config.toml` (modify — register the new function)

**Out of scope** (do NOT touch):
- The `members` sync pipeline (`scripts/sync-members.ts`, webhook function) — do not change how
  members are ingested.
- `dashboard_stats()` — reuse its predicate, do not modify it.
- Any UI for composing/sending mail manually — this iteration is the automated reminder only.
- SMS / push notifications.

## Git workflow

- Branch: `advisor/004-renewal-reminders`.
- Commit per logical unit. Short imperative messages matching `git log`.
- Do NOT push, deploy a function, or schedule anything against a real project unless the operator
  explicitly instructs it. Deploying this sends real email.

## Steps

### Step 0 (GATE — STOP after this until the operator answers)

This plan cannot be finished correctly without two decisions only the operator can make. Ask, then
STOP and wait:

1. **Email provider.** Recommended default: **Resend** (simple HTTP API, generous free tier, good
   deliverability, trivial Deno fetch integration). Alternatives: SendGrid, Amazon SES. The operator
   must (a) pick one, (b) create the account and verify the sending domain (SPF/DKIM), and (c) put the
   API key in Supabase Edge Function secrets. The executor cannot do (b)/(c).
2. **Coordination with Wild Apricot.** Wild Apricot is the membership platform and **very likely
   already sends its own renewal reminder emails.** Sending a second, parallel reminder risks
   confusing members and double-emailing. The operator must confirm: should this app send reminders at
   all, or only for a segment WA doesn't cover, or with different timing/content? Do not guess.

Report both questions. **Do not build the sending function until answered.** You MAY, in parallel,
build the non-sending, side-effect-free pieces (the migration in Step 1 and the candidate RPC), since
they do not email anyone — but gate the actual send behind the answers.

### Step 1: Migration — opt-out column, candidate RPC, send log

New migration `supabase/migrations/<next-timestamp>_email_prefs.sql` (timestamp strictly greater than
the highest existing):
- Add an opt-out flag to members:
  `alter table public.members add column if not exists "emailOptOut" boolean not null default false;`
- A send-log table so the job is idempotent and auditable:
  ```sql
  create table public.reminder_log (
    id uuid primary key default gen_random_uuid(),
    "memberId" text not null,
    email text not null,
    "renewalDueDate" text,
    "sentAt" timestamptz not null default now(),
    status text not null,            -- 'sent' | 'failed' | 'skipped'
    error text,
    unique ("memberId", "sentAt")
  );
  alter table public.reminder_log enable row level security;
  create policy reminderlog_read on public.reminder_log
    for select to authenticated using (public.is_national_admin());
  ```
- A `renewal_reminder_candidates()` `security definer` function returning members due to renew within
  30 days, `activeStatus = 'Active'`, `"emailOptOut" = false`, with a non-empty `email`, and **not
  already emailed in the last 14 days** (left-join `reminder_log` on `memberId`). Reuse the
  `dashboard_stats()` date predicate verbatim. Return `{ memberId, name, email, renewalDueDate }`.
  Grant execute to `service_role` only (this is called by the Edge Function, not the browser).

**Verify (local Supabase, repo root)**: `supabase db reset` applies cleanly; `select * from
public.renewal_reminder_candidates();` runs without error (likely empty locally — fine).

### Step 2: Provider wrapper (after Step 0 answered)

Create `supabase/functions/_shared/email.ts` — a thin async `sendEmail({ to, subject, html })` that
calls the chosen provider's HTTP API using `Deno.env.get("<PROVIDER>_API_KEY")` and a configurable
`Deno.env.get("REMINDER_FROM_ADDRESS")`. Return `{ ok: boolean, error?: string }`; never throw on a
single failed send (the job must continue the batch). Reference the key by env-var name only — no
literal key anywhere.

**Verify**: `deno check supabase/functions/_shared/email.ts` → exit 0.

### Step 3: The reminder function (after Step 0 answered)

Create `supabase/functions/send-renewal-reminders/index.ts` modeled on `sync-events/index.ts`:
- HTTP POST, `verifyWebhookSecret(req)` (reuse from `_shared/supabase.ts`) — reject without the secret.
- `getServiceClient()`, call `renewal_reminder_candidates()` via `.rpc(...)`.
- For each candidate: render a short renewal-reminder email (member name, renewal date, a link to
  renew — the link target is provided by the operator in Step 0; do not invent a URL), call
  `sendEmail(...)`, and insert a `reminder_log` row with status `sent`/`failed`. **Batch with a small
  concurrency limit (e.g. 5 at a time) and a cap** so a misconfiguration can't blast 14k emails — read
  a `MAX_PER_RUN` env (default e.g. 500) and stop after it, logging that the cap was hit.
- Always return HTTP 200 with a JSON summary `{ attempted, sent, failed, skipped }` (the webhook
  function's "always 200" convention).
- Register in `config.toml`:
  ```toml
  [functions.send-renewal-reminders]
  verify_jwt = false
  ```

**Verify**: `supabase functions serve send-renewal-reminders` boots with no import error;
`deno check supabase/functions/send-renewal-reminders/index.ts` → exit 0. **Do NOT invoke it against
real data / real provider** during local verification unless the operator says so — test against a
provider sandbox / a single allow-listed test address only.

### Step 4: Scheduling (operator-gated — describe, do not auto-enable)

Document (in the migration as a commented block, or hand to the operator) how to schedule the
function: a daily `cron.schedule('send-renewal-reminders', '0 13 * * *', $$ select net.http_post(...
?key=<secret> ...) $$);` using `pg_net`. **Do not enable the schedule** as part of execution — that
starts sending on a timer. Leave it for the operator to turn on after they've verified content and
deliverability. If `pg_net` is not enabled in the project, note that it must be enabled first.

**Verify**: the scheduling SQL is present (commented or documented) but NOT active; grep confirms no
`cron.schedule('send-renewal-reminders'...)` is live in an applied migration unless the operator
instructed it.

## Test plan

No automated test framework exists — do not add one. Verification is: migrations apply via
`supabase db reset`; `deno check` passes on the new function and wrapper; the function boots under
`supabase functions serve`; and a **single test send to one allow-listed address through a provider
sandbox** (only after Step 0 is answered and the operator approves).

## Done criteria

Because of the human gate, "DONE" means one of:
- **Fully done**: Steps 0–4 complete, operator answered both questions, a single sandbox test send
  succeeded and logged to `reminder_log`, schedule left off for the operator to enable. OR
- **Partially done (acceptable hand-off)**: Step 1 migration + candidate RPC complete and applying
  cleanly; Steps 2–4 specified and stubbed but NOT wired to send, marked BLOCKED on the Step 0
  decisions.

In either case:
- [ ] No email-provider key value appears in any committed file (grep for the provider name; only
      env-var *references* allowed).
- [ ] Migrations apply via `supabase db reset`.
- [ ] `deno check` passes on any function code written.
- [ ] No live `cron.schedule('send-renewal-reminders'...)` unless the operator instructed it.
- [ ] No files outside the in-scope list modified (`git status`).
- [ ] `plans/README.md` status row for 004 updated (DONE or BLOCKED-with-reason).

## STOP conditions

Stop and report back (do not improvise) if:
- Step 0 is unanswered — do not build or deploy anything that sends mail.
- The operator says Wild Apricot already covers renewal reminders and they don't want a parallel
  channel — then this plan should likely be REJECTED or rescoped; report rather than building it.
- The `dashboard_stats()` renewal predicate no longer matches the excerpt above.
- You cannot run a local Supabase or `deno check`. **Do NOT `supabase functions deploy` or
  `supabase db push` to a linked project** — that risks live sends. Mark BLOCKED and hand off.
- You're about to send to more than one address during testing, or to a real member — STOP; testing
  is sandbox + single allow-listed address only.

## Maintenance notes

- **Deliverability is the real risk**, not code. The sending domain needs SPF/DKIM/DMARC; without
  them reminders land in spam and harm the org's domain reputation. This is operator work, flagged in
  Step 0.
- **Idempotency** rests on the `reminder_log` 14-day look-back in `renewal_reminder_candidates()`. If
  the cadence changes, revisit that window so members aren't double-emailed.
- **Opt-out (`emailOptOut`) and CAN-SPAM/CASL**: every reminder must include an unsubscribe path, and
  honoring it must flip `emailOptOut`. A future plan should add the unsubscribe endpoint + a member
  email-preferences UI (deferred here).
- The `MAX_PER_RUN` cap is a safety valve against accidental mass-sends — a reviewer should confirm it
  exists and defaults conservatively.
- If the org later wants event reminders or announcements, generalize `_shared/email.ts` and the
  `reminder_log` into a small notifications module rather than copying this function.
