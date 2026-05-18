import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getCaller } from "@/lib/supabase/server";
import type { UserRole } from "@/types/user";

const VALID_ROLES: UserRole[] = [
  "national_admin",
  "region_admin",
  "chapter_admin",
  "member",
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { uid: callerUid, role: callerRole } = await getCaller();
  if (!callerUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (callerRole !== "national_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;
  const body = await request.json();
  const { role, chapterId, region } = body as {
    role: UserRole;
    chapterId?: string;
    region?: string;
  };

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  try {
    const admin = supabaseAdmin();
    const { error: dbErr } = await admin
      .from("users")
      .update({
        role,
        chapterId: chapterId ?? null,
        region: region ?? null,
      })
      .eq("id", userId);
    if (dbErr) throw dbErr;

    // (#7) Merge into existing app_metadata so unrelated claims survive.
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const prevMeta = (authUser?.user?.app_metadata ?? {}) as Record<string, unknown>;
    const { error: claimsErr } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...prevMeta,
        user_role: role,
        chapter_id: chapterId ?? null,
        region: region ?? null,
      },
    });
    if (claimsErr) throw claimsErr;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
