import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";

// Session cookie lasts 1 hour (matches previous custom token cookie behavior)
const SESSION_EXPIRY_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { idToken } = body as { idToken: string };

    if (!idToken) {
      return NextResponse.json({ error: "Missing ID token" }, { status: 400 });
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_EXPIRY_MS,
    });

    const cookieStore = await cookies();
    cookieStore.set("firebase_token", sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_EXPIRY_MS / 1000,
      path: "/",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 401 }
    );
  }
}
