// Real-time Wild Apricot webhook handler.
// HTTP-triggered: POST /functions/v1/wild-apricot-webhook?key=<WEBHOOK_SECRET>
//
// Always returns 200 so WA doesn't retry on transient errors — failures are
// surfaced in the function logs and (when actionable) in pending_registrations.
//
// Replaces functions/src/webhook-handler.ts.

import { getServiceClient, verifyWebhookSecret } from "../_shared/supabase.ts";
import {
  getWAToken,
  getWAAccountId,
  fetchWAContact,
  fetchWAEvent,
  fetchWARegistration,
  extractFieldValue,
  extractChapterName,
  loadResolver,
  flushPendingChapters,
  type ChapterResolver,
} from "../_shared/wa.ts";

type SupabaseSvc = ReturnType<typeof getServiceClient>;

interface WAWebhookBody {
  MessageType?: string;
  Parameters?: Record<string, string>;
}

function mapContact(contact: Record<string, unknown>, resolver: ChapterResolver) {
  const fields = (contact.FieldValues as Array<{ FieldName: string; Value: unknown }>) ?? [];
  const now = new Date();
  const renewalDueDate = extractFieldValue(fields, "Renewal due");
  const activeStatus = renewalDueDate && new Date(renewalDueDate) >= now ? "Active" : "Lapsed";
  const memberId = extractFieldValue(fields, "Member ID") || String(contact.Id);
  const membershipLevel =
    contact.MembershipLevel && typeof contact.MembershipLevel === "object" &&
      "Name" in (contact.MembershipLevel as Record<string, unknown>)
      ? String((contact.MembershipLevel as { Name: unknown }).Name)
      : "";
  let chapterName = extractChapterName(fields);
  if (!chapterName && membershipLevel === "Member-at-Large (1 year)") {
    chapterName = "PNA Member-at-Large";
  }
  const region = extractFieldValue(fields, "PNAA Region");
  const chapterId = resolver.resolve(
    chapterName,
    chapterName === "PNA Member-at-Large" ? "" : region,
  );

  return {
    id: memberId,
    name: `${contact.FirstName ?? ""} ${contact.LastName ?? ""}`.trim(),
    email: String(contact.Email ?? ""),
    membershipLevel,
    renewalDueDate,
    chapterId,
    highestEducation: extractFieldValue(fields, "Highest Level of Education"),
    memberId,
    region,
    activeStatus,
    lastSynced: now.toISOString(),
  };
}

async function recalculateChapterAggregates(supabase: SupabaseSvc, chapterIds: string[]) {
  const now = new Date();
  for (const chapterId of chapterIds) {
    if (!chapterId) continue;
    const { data: members } = await supabase
      .from("members")
      .select("renewalDueDate")
      .eq("chapterId", chapterId);
    let totalMembers = 0;
    let totalActive = 0;
    let totalLapsed = 0;
    for (const m of members ?? []) {
      const row = m as { renewalDueDate?: string };
      totalMembers++;
      const isActive = row.renewalDueDate && new Date(row.renewalDueDate) >= now;
      if (isActive) totalActive++;
      else totalLapsed++;
    }
    await supabase
      .from("chapters")
      .update({ totalMembers, totalActive, totalLapsed })
      .eq("id", chapterId);
  }
}

async function handleContact(
  supabase: SupabaseSvc,
  accessToken: string,
  accountId: string,
  contactId: string,
  resolver: ChapterResolver,
) {
  const raw = await fetchWAContact(accessToken, accountId, contactId);
  if (!raw) return;
  const member = mapContact(raw, resolver);

  // Capture old chapter so we can recalc both old and new aggregates.
  const { data: existing } = await supabase
    .from("members")
    .select("chapterId")
    .eq("id", member.id)
    .maybeSingle();
  const oldChapterId = (existing as { chapterId?: string } | null)?.chapterId ?? "";

  // Ensure any chapter the resolver invented exists before the FK insert.
  await flushPendingChapters(supabase, resolver);

  const { error } = await supabase.from("members").upsert(member, { onConflict: "id" });
  if (error) throw error;

  const chaptersToRecalc = [member.chapterId, oldChapterId].filter(
    (c, i, arr): c is string => !!c && arr.indexOf(c) === i,
  );
  if (chaptersToRecalc.length > 0) {
    await recalculateChapterAggregates(supabase, chaptersToRecalc);
  }
}

async function handleEvent(
  supabase: SupabaseSvc,
  accessToken: string,
  accountId: string,
  eventId: string,
  action: string,
  resolver: ChapterResolver,
) {
  if (action === "Deleted") {
    await supabase.from("events").update({ archived: true }).eq("id", eventId);
    return;
  }

  const raw = await fetchWAEvent(accessToken, accountId, eventId);
  if (!raw) return;

  // Insert-only for new events; never overwrite existing rows.
  const { data: existing } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (existing) return; // app already manages this row

  // WA events report "Tags" with chapter and region — use the resolver if WA gives us one.
  // The /v2/events payload doesn't carry a structured chapter; we leave chapterId null
  // and let admins assign it from the app.
  await flushPendingChapters(supabase, resolver);
  await supabase.from("events").insert({
    id: eventId,
    name: String(raw.Name ?? ""),
    startDate: raw.StartDate ? String(raw.StartDate) : null,
    endDate: raw.EndDate ? String(raw.EndDate) : null,
    location: String(raw.Location ?? ""),
    archived: false,
  });
}

async function handleEventRegistration(
  supabase: SupabaseSvc,
  accessToken: string,
  accountId: string,
  registrationId: string,
  eventId: string,
  action: string,
) {
  if (action === "Deleted") {
    await supabase
      .from("attendees")
      .delete()
      .eq("registrationId", registrationId)
      .eq("source", "wildapricot");
    return;
  }

  const { data: ev } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) {
    await supabase.from("pending_registrations").upsert(
      { id: registrationId, eventId, payload: { action, registrationId, eventId }, attempts: 0 },
      { onConflict: "id" },
    );
    return;
  }

  const reg = await fetchWARegistration(accessToken, accountId, registrationId);
  if (!reg) return;

  const { data: existing } = await supabase
    .from("attendees")
    .select("attended, hours")
    .eq("id", registrationId)
    .maybeSingle();

  await supabase.from("attendees").upsert(
    {
      id: registrationId,
      registrationId,
      eventId: reg.eventId || eventId,
      contactId: reg.contactId,
      memberId: reg.contactId,
      name: reg.name,
      attended: (existing as { attended?: boolean } | null)?.attended ?? false,
      hours: (existing as { hours?: number } | null)?.hours ?? 0,
      source: "wildapricot",
      registrationTypeId: reg.registrationTypeId,
      registrationType: reg.registrationType,
      organization: reg.organization,
      isPaid: reg.isPaid,
      registrationFee: reg.registrationFee,
      paidSum: reg.paidSum,
      OnWaitlist: reg.OnWaitlist,
      Status: reg.Status,
    },
    { onConflict: "id" },
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  if (!verifyWebhookSecret(req)) {
    console.warn("webhook: bad secret");
    return new Response("ok", { status: 200 });
  }

  let body: WAWebhookBody;
  try {
    body = await req.json();
  } catch {
    console.warn("webhook: bad json");
    return new Response("ok", { status: 200 });
  }

  try {
    const supabase = getServiceClient();
    const accessToken = await getWAToken();
    const accountId = getWAAccountId();
    const resolver = await loadResolver(supabase);

    const messageType = body.MessageType ?? "";
    const params = body.Parameters ?? {};
    const action = params["Action"] ?? "";

    if (messageType === "Contact" || messageType === "Membership" || messageType === "MembershipRenewed") {
      const contactId = params["Contact.Id"] ?? params["ContactId"];
      if (contactId) await handleContact(supabase, accessToken, accountId, contactId, resolver);
    } else if (messageType === "Event") {
      const eventId = params["Event.Id"] ?? params["EventId"];
      if (eventId) await handleEvent(supabase, accessToken, accountId, eventId, action, resolver);
    } else if (messageType === "EventRegistration") {
      const registrationId = params["Registration.Id"] ?? params["RegistrationId"];
      const eventId = params["EventToRegister.Id"] ?? params["Event.Id"];
      if (registrationId && eventId) {
        await handleEventRegistration(
          supabase,
          accessToken,
          accountId,
          registrationId,
          eventId,
          action,
        );
      }
    }
  } catch (err) {
    console.error("webhook handler error:", err);
  }

  return new Response("ok", { status: 200 });
});
