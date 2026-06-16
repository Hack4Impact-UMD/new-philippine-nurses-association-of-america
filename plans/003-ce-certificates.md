# Plan 003: Contact-hours (CE) certificates & verification letters

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and
> report — do not improvise. **Step 1 is a decision spike** — complete it and report the chosen
> approach before building the rest, OR follow the recommended default in Step 1 if the operator told
> you to proceed without check-in. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ae467a2..HEAD -- pnaa/components/members/member-detail.tsx pnaa/types/event.ts pnaa/types/attendee.ts pnaa/package.json`
> If any changed, compare the "Current state" excerpts below against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (introduces a new client dependency; Step 1 spike de-risks it)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ae467a2`, 2026-06-15

## Why this matters

Nurses need **documented continuing-education (CE) / contact hours** to renew their licenses, and
this app already tracks every input: events carry `contactHours`/`defaultHours`, each attendee row
carries `hours`, and `member-detail.tsx` already computes a complete per-member rollup (total hours,
conference vs. community-outreach split, and every attended event). The one missing piece is the
*output* — a downloadable certificate / attendance-verification letter the member or admin can hand
to a licensing board. This is the single highest org-specific value item on the roadmap and almost
all the data work is already done; this plan adds the document-generation layer on top.

## Current state

Relevant files (read each before editing):

- `pnaa/components/members/member-detail.tsx` — **the data source for certificates already exists
  here.** It subscribes to all of a member's attended attendee rows, joins event docs, builds
  `eventRows: AttendedEventRow[]`, and computes:
  ```ts
  const stats = useMemo(() => {
    let totalHours = 0, conferenceHours = 0, outreachHours = 0;
    for (const r of eventRows) {
      totalHours += r.hours;
      if (r.eventType === "conference") conferenceHours += r.hours;
      else if (r.eventType === "community_outreach") outreachHours += r.hours;
    }
    return { totalHours, conferenceHours, outreachHours, eventsAttended: eventRows.length };
  }, [eventRows]);
  ```
  Each `AttendedEventRow` has `{ eventName, startDate, chapter, region, eventType, eventSubtype,
  hours }`. This is exactly the table a certificate/verification letter needs. The component imports
  `Award` from `lucide-react` already (currently decorative). **Reuse this computed data — do not
  re-query.**
- `pnaa/types/event.ts` — exports `EVENT_TYPE_LABELS`, `EVENT_SUBTYPE_LABELS`, `AppEvent`. Used to
  render human-readable type names.
- `pnaa/types/member.ts` — the `Member` type (`name`, `email`, `membershipLevel`, `memberId`,
  `chapterId`, `region`, …).
- `pnaa/lib/utils.ts` — `formatDate`, `formatCurrency`, `cn`.
- `pnaa/package.json` — current deps. **`exceljs` is present (Excel only — not for PDF).** There is
  **no PDF library** and no HTML-to-PDF tooling. `recharts`, `date-fns`, `lucide-react`, `sonner` are
  available.
- Existing export precedent: the app already does client-side `.xlsx` export via ExcelJS (grep
  `exceljs` / `ExcelJS` to find the helper). A certificate is the same idea (client generates a file
  from data already in the browser), different format.

Conventions:
- Client components are `"use client"`, use shadcn `Button`, `toast` from `sonner` for feedback.
- Revenue/payment figures are gated to national admins — **certificates must NOT include any
  monetary fields**, only hours. (Hours are not gated.)

## Commands you will need

| Purpose | Command (from `pnaa/`) | Expected |
|---|---|---|
| Install | `npm install` | exit 0 |
| Add dep (only the one chosen in Step 1) | `npm install <pkg>` | exit 0; lockfile updated |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (create or modify only these):
- `pnaa/package.json` + lockfile (modify — add exactly one PDF dependency, per Step 1)
- `pnaa/lib/certificate.ts` (create — the generation function; pure data → file/blob)
- `pnaa/components/members/certificate-button.tsx` (create — the download button)
- `pnaa/components/members/member-detail.tsx` (modify — mount the button, pass the already-computed
  `member`, `eventRows`, and `stats`)

**Out of scope** (do NOT touch):
- The attendees / events schema, the hours-computation logic in `member-detail.tsx` (reuse it, don't
  change it), and any RLS or RPC.
- Server-side / Edge-Function PDF rendering — this plan is **client-side only** (the data is already
  in the browser; no server round-trip needed). Server rendering is a deferred option (see
  Maintenance notes).
- Bulk "generate certificates for the whole chapter" — single-member only this iteration.
- Any monetary field on the certificate.

## Git workflow

- Branch: `advisor/003-ce-certificates`.
- Commit per logical unit (dependency + lib, then UI). Short imperative messages matching `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1 (SPIKE — decide the PDF approach): pick a generation strategy

There is no PDF tooling in the repo, so the first task is choosing one. Evaluate against: works fully
client-side (no new backend), small bundle, actively maintained, MIT/permissive license, produces a
clean tabular certificate.

**Recommended default (use this unless the spike surfaces a blocker): `jspdf` + `jspdf-autotable`.**
Rationale: pure client-side, no headless browser, ~feasible bundle, trivial table rendering via
`autotable`, permissive license, no React-version coupling. Alternative considered:
`@react-pdf/renderer` (nicer layout API but larger and heavier); `react-to-print` / browser print
(zero dep, but output fidelity depends on the user's print dialog — rejected for a document people
submit to licensing boards).

Spike actions:
1. `npm install jspdf jspdf-autotable` (from `pnaa/`).
2. Write a throwaway 15-line script or a temporary button that renders a one-page PDF with a title,
   a member name line, and a 3-row table via `autoTable`. Confirm it downloads and opens.
3. Confirm `npx tsc --noEmit` still passes with the new types (jspdf ships its own types).

**Report after the spike** (unless told to proceed): the chosen library and that it builds. If
`jspdf` fails to typecheck/build under Next 16 + Turbopack, or its bundle is unacceptable, STOP and
report rather than silently switching to a heavier option.

**Verify**: `npm run build` → exit 0 with the new dependency installed.

### Step 2: Implement the certificate generator

Create `pnaa/lib/certificate.ts` exporting a pure function:
```ts
import type { Member } from "@/types/member";

export interface CertificateRow {
  eventName: string;
  date: string;       // ISO
  type: string;       // human label, e.g. "Conference · Webinar"
  hours: number;
}
export interface CertificateData {
  member: Pick<Member, "name" | "email" | "memberId">;
  rows: CertificateRow[];
  totalHours: number;
  conferenceHours: number;
  outreachHours: number;
  generatedOn: Date;
  periodLabel?: string; // optional "for calendar year 2026"
}

export function generateCertificate(data: CertificateData): void { /* builds + triggers download */ }
```
The function builds a one-or-more-page PDF:
- Header: "Philippine Nurses Association of America" + "Certificate of Contact Hours" (or
  "Attendance Verification"). Plain text title — no logo asset is in scope.
- Member block: name, Member ID, email.
- Summary line: Total contact hours, with the conference/outreach split.
- A table (via `autoTable`) of every attended event: Event, Date (`formatDate`), Type, Hours.
- Footer: "Generated on <date> by the PNAA Chapter Management System. This document reflects
  attendance recorded in the system and is not an official accreditation statement." (Honest framing
  — STOP condition if the operator expects an *accredited* CE certificate; see STOP conditions.)
- Filename: `PNAA-contact-hours-<member-name-slug>-<YYYY-MM-DD>.pdf`.

Do not include any monetary data.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Wire the download button into the member detail page

Create `pnaa/components/members/certificate-button.tsx` — a `"use client"` component taking
`{ member, rows, totalHours, conferenceHours, outreachHours }`, rendering a shadcn `Button`
(`variant="outline"`, `Award` or `Download` icon from `lucide-react`) labeled "Download Contact-Hours
Certificate". On click it maps the data into `CertificateData` and calls `generateCertificate(...)`,
then `toast.success("Certificate downloaded")`. Wrap the click in try/catch and `toast.error` on
failure.

Modify `pnaa/components/members/member-detail.tsx`: import the button and render it in the header
area (near the member name / stats cards), passing the already-computed `member`, the `eventRows`
mapped to `CertificateRow[]` (use `EVENT_TYPE_LABELS`/`EVENT_SUBTYPE_LABELS` to build the `type`
string the same way the table cell already does), and `stats.totalHours` /
`stats.conferenceHours` / `stats.outreachHours`. Do not refetch — reuse `eventRows` and `stats`.

Consider visibility: who can download? Default — any admin viewing a member detail page, plus the
member themselves if a self-view path exists. Since there is currently no member self-service view
(the roadmap's portal item was not built), gate the button to `useIsAdmin()` for now and note in
Maintenance that the future portal should expose it to the member directly.

**Verify**: `npm run build` → exit 0. Manually: `npm run dev`, sign in as an admin, open a member
who has attended events, click the button → a PDF downloads listing those events with hours, and the
total matches the on-screen "Total Hours" stat.

## Test plan

No automated test framework exists — do not add one. Verification is `npx tsc --noEmit`,
`npm run lint`, `npm run build`, and the manual smoke test in Step 3 (download a real member's
certificate; confirm totals match the on-screen stats and no dollar figures appear).

## Done criteria

ALL must hold:
- [ ] Exactly one PDF dependency added (default `jspdf` + `jspdf-autotable`); lockfile updated.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` all exit 0.
- [ ] A member-detail page shows a "Download Contact-Hours Certificate" button (admin-gated).
- [ ] The downloaded PDF lists every attended event with hours; the total equals the on-screen
      "Total Hours" stat; **no monetary values appear anywhere on it.**
- [ ] No files outside the in-scope list modified (`git status`).
- [ ] `plans/README.md` status row for 003 updated.

## STOP conditions

Stop and report back (do not improvise) if:
- The `stats`/`eventRows` excerpts from `member-detail.tsx` no longer match the live code (the hours
  computation moved or changed shape).
- `jspdf` (or the chosen lib) fails to build under Next 16 + Turbopack, or balloons the bundle
  unacceptably — report before swapping to a heavier alternative.
- The operator indicates they need an **accredited / board-recognized** CE certificate (with an
  accreditation number, provider ID, signature). That is a compliance artifact this plan does not
  produce — its footer explicitly disclaims official accreditation. Surface this; do not fake an
  accreditation statement.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Self-service**: when the deferred member-portal feature lands (roadmap item #5), the member
  should be able to download their *own* certificate — relax the `useIsAdmin()` gate to also allow a
  user whose `users.waContactId` equals the viewed `members.id`.
- **Bulk export** (one PDF per chapter member, or a single roster PDF) is a natural follow-up; the
  `generateCertificate` function is structured to be called in a loop later.
- **Server-side rendering** was deliberately avoided — all the data is already client-side in
  `member-detail.tsx`, so a backend round-trip adds nothing now. If certificates ever need a tamper-
  evident signature or a server-stored copy, move generation into an Edge Function (the
  `supabase/functions/` pattern) and revisit.
- Reviewer should confirm: no monetary fields leak onto the PDF, the footer disclaimer is present,
  and totals reconcile with the on-screen stats.
