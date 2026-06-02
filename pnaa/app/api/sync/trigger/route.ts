import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getCaller } from "@/lib/supabase/server";

/**
 * Triggers a sync run. `members` runs as a GitHub Actions workflow (see
 * .github/workflows/sync-members.yml) so we can't kick it off from here;
 * `events` calls the Supabase Edge Function.
 */
export async function POST(request: NextRequest) {
  try {
    const { uid, role } = await getCaller();
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (role !== "national_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { type } = body as { type: "members" | "events" };
    if (!type || !["members", "events"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid sync type. Must be 'members' or 'events'" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    await admin.from("sync_logs").insert({
      type,
      status: "triggered",
      triggeredBy: uid,
    });

    if (type === "members") {
      // sync-members lives in GitHub Actions; surface a helpful message.
      return NextResponse.json({
        success: true,
        message:
          "Members sync runs nightly via GitHub Actions. Trigger a manual run from the repo's Actions tab (sync-members.yml -> Run workflow).",
      });
    }

    // Fire-and-forget the events Edge Function. We don't await the response
    // because the function may take a few minutes to complete.
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sync-events?key=${encodeURIComponent(
      process.env.WEBHOOK_SECRET ?? ""
    )}`;
    fetch(url, { method: "POST" }).catch((err) => {
      console.error("sync-events trigger failed:", err);
    });

    return NextResponse.json({
      success: true,
      message: "Events sync triggered",
    });
  } catch (error) {
    console.error("Sync trigger error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
