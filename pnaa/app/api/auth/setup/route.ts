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
      .select("needsOnboarding, role, chapterName, region")
      .eq("id", uid)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!userRow || !(userRow as { needsOnboarding: boolean }).needsOnboarding) {
      return NextResponse.json({ error: "Setup not required" }, { status: 400 });
    }

    const body = await request.json();
    const { chapterName, region } = body as { chapterName: string; region: string };
    if (!chapterName || !region) {
      return NextResponse.json(
        { error: "Chapter and region are required" },
        { status: 400 }
      );
    }

    const { error: updErr } = await admin
      .from("users")
      .update({ chapterName, region, needsOnboarding: false })
      .eq("id", uid);
    if (updErr) throw updErr;

    // Mirror into auth.users.app_metadata so future JWTs carry it.
    const role = (userRow as { role: string }).role;
    await admin.auth.admin.updateUserById(uid, {
      app_metadata: { user_role: role, chapter_name: chapterName, region },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json({ error: "Failed to save setup" }, { status: 500 });
  }
}
