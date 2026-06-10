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
  // The client validates these too, but the API is the boundary: a
  // chapter_admin without a chapter passes is_admin() yet can write nowhere,
  // and a region_admin without a region can't match any rows.
  if (role === "chapter_admin" && !chapterId) {
    return NextResponse.json(
      { error: "chapter_admin requires a chapterId" },
      { status: 400 }
    );
  }
  if (role === "region_admin" && !region) {
    return NextResponse.json(
      { error: "region_admin requires a region" },
      { status: 400 }
    );
  }

  try {
    const admin = supabaseAdmin();

    if (chapterId) {
      const { data: chapterRow } = await admin
        .from("chapters")
        .select("id")
        .eq("id", chapterId)
        .maybeSingle();
      if (!chapterRow) {
        return NextResponse.json({ error: "Unknown chapter" }, { status: 400 });
      }
    }

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

    // RLS reads the role from the JWT, so a demoted admin keeps their old
    // privileges until their access token expires. Kill the user's sessions
    // when any claim changed — they re-auth and pick up the new claims. The
    // already-issued access token stays valid until its exp (~1h ceiling).
    const claimsChanged =
      prevMeta.user_role !== role ||
      (prevMeta.chapter_id ?? null) !== (chapterId ?? null) ||
      (prevMeta.region ?? null) !== (region ?? null);
    if (claimsChanged) {
      const { error: revokeErr } = await admin.rpc("revoke_user_sessions", {
        p_user_id: userId,
      });
      if (revokeErr) {
        console.error("Failed to revoke sessions after role change:", revokeErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
