import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export async function POST(request: NextRequest) {
  try {
    // Verify session
    const cookieStore = await cookies();
    const token = cookieStore.get("firebase_token")?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the session cookie
    const decoded = await adminAuth.verifySessionCookie(token).catch(() => null);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userDoc = await adminDb.collection("users").doc(decoded.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "national_admin") {
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

    // Log the sync trigger
    await adminDb.collection("syncLogs").add({
      type,
      status: "triggered",
      triggeredBy: decoded.uid,
      triggeredAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: `${type} sync triggered successfully`,
    });
  } catch (error) {
    console.error("Sync trigger error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
