import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getCaller } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { uid } = await getCaller();
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { data: userRow, error: selErr } = await admin
      .from("users")
      .select("needsOnboarding, role")
      .eq("id", uid)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!userRow || !(userRow as { needsOnboarding: boolean }).needsOnboarding) {
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

    // Sanity-check the chapter exists.
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
    await admin.auth.admin.updateUserById(uid, {
      app_metadata: { user_role: role, chapter_id: chapterId, region },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json({ error: "Failed to save setup" }, { status: 500 });
  }
}
