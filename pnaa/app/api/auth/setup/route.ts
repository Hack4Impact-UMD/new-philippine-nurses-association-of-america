import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("firebase_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await adminAuth.verifySessionCookie(token);
    const uid = decoded.uid;

    // Only allow setup for users who still need onboarding
    const userDoc = await adminDb.collection("users").doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.needsOnboarding) {
      return NextResponse.json(
        { error: "Setup not required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { chapterName, region } = body as {
      chapterName: string;
      region: string;
    };

    if (!chapterName || !region) {
      return NextResponse.json(
        { error: "Chapter and region are required" },
        { status: 400 }
      );
    }

    await adminDb.collection("users").doc(uid).update({
      chapterName,
      region,
      needsOnboarding: false,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "Failed to save setup" },
      { status: 500 }
    );
  }
}
