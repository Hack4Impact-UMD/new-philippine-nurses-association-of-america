import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getCaller } from "@/lib/supabase/server";
import type { UserRole } from "@/types/user";

const VALID_ROLES: UserRole[] = [
  "national_admin",
  "region_admin",
  "chapter_admin",
  "member",
];

/**
 * Replaces the createUser callable Cloud Function. National admins only.
 * Creates an auth.users row + public.users profile + sets app_metadata claims.
 */
export async function POST(request: NextRequest) {
  const { uid, role } = await getCaller();
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (role !== "national_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    email,
    displayName,
    role: targetRole,
    chapterId,
    region,
  } = body as {
    email: string;
    displayName: string;
    role: UserRole;
    chapterId?: string;
    region?: string;
  };

  if (!email || !displayName) {
    return NextResponse.json(
      { error: "Email and displayName are required" },
      { status: 400 }
    );
  }
  if (!VALID_ROLES.includes(targetRole)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  try {
    const admin = supabaseAdmin();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { displayName },
      app_metadata: {
        user_role: targetRole,
        ...(chapterId ? { chapter_id: chapterId } : {}),
        ...(region ? { region } : {}),
      },
    });
    if (createErr) throw createErr;
    const newUserId = created.user?.id;
    if (!newUserId) throw new Error("Failed to create auth user");

    // public.users row is also created by the on_auth_user_created trigger,
    // but we overwrite to pick up the chosen role/chapter/region.
    const { error: profileErr } = await admin.from("users").upsert({
      id: newUserId,
      email,
      displayName,
      role: targetRole,
      chapterId: chapterId ?? null,
      region: region ?? null,
      needsOnboarding: false,
    });
    if (profileErr) throw profileErr;

    return NextResponse.json({ success: true, userId: newUserId });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
