import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/types/user";

const VALID_ROLES: UserRole[] = [
  "national_admin",
  "region_admin",
  "chapter_admin",
  "member",
];

async function getCallerUid(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("firebase_token")?.value;
  if (!token) return null;
  try {
    // Firebase custom tokens are JWTs with the user's uid in the payload
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    return payload.uid || null;
  } catch {
    return null;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const callerUid = await getCallerUid();
  if (!callerUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify caller is national_admin via Firestore
  const callerDoc = await adminDb.collection("users").doc(callerUid).get();
  if (!callerDoc.exists || callerDoc.data()?.role !== "national_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await params;

  const body = await request.json();
  const { role, chapterName, region } = body as {
    role: UserRole;
    chapterName?: string;
    region?: string;
  };

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  try {
    await adminDb.collection("users").doc(userId).update({
      role,
      chapterName: chapterName || null,
      region: region || null,
    });

    await adminAuth.setCustomUserClaims(userId, {
      role,
      chapterName: chapterName || null,
      region: region || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
