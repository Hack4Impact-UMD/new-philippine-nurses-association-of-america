import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getCaller } from "@/lib/supabase/server";
import { needsOnboarding } from "@/lib/auth/onboarding";

export async function POST(request: NextRequest) {
  try {
    const { uid } = await getCaller();
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { data: userRow, error: selErr } = await admin
      .from("users")
      .select("needsOnboarding, role, chapterId, region")
      .eq("id", uid)
      .maybeSingle();
    if (selErr) throw selErr;
    // Not just the needsOnboarding flag: a user whose chapter was later
    // removed has the flag cleared but still can't see anything, and setup is
    // their only way to pick one again.
    if (!userRow || !needsOnboarding(userRow)) {
      return NextResponse.json({ error: "Setup not required" }, { status: 400 });
    }

    const body = await request.json();
    const { chapterId, region } = body as { chapterId: string; region: string };
    if (!chapterId || !region) {
      return NextResponse.json(
        { error: "Chapter and region are required" },
        { status: 400 }
      );
    }

    // Sanity-check the chapter exists. 'national' is the organization, not a
    // chapter anyone belongs to, so it's rejected here as well as being left
    // out of the chapter_directory() picker feed.
    if (chapterId === "national") {
      return NextResponse.json(
        { error: "Select the chapter you belong to" },
        { status: 400 }
      );
    }
    const { data: chapterRow } = await admin
      .from("chapters")
      .select("id")
      .eq("id", chapterId)
      .maybeSingle();
    if (!chapterRow) {
      return NextResponse.json({ error: "Unknown chapter" }, { status: 400 });
    }

    const { error: updErr } = await admin
      .from("users")
      .update({ chapterId, region, needsOnboarding: false })
      .eq("id", uid);
    if (updErr) throw updErr;

    const role = (userRow as { role: string }).role;
    // (#7) Merge into existing app_metadata so unrelated claims survive.
    const { data: authUser } = await admin.auth.admin.getUserById(uid);
    const prevMeta = (authUser?.user?.app_metadata ?? {}) as Record<string, unknown>;
    await admin.auth.admin.updateUserById(uid, {
      app_metadata: { ...prevMeta, user_role: role, chapter_id: chapterId, region },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json({ error: "Failed to save setup" }, { status: 500 });
  }
}
