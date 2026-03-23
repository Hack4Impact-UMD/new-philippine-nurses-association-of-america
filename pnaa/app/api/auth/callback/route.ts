import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, getContactInfo, extractFieldValue } from "@/lib/wild-apricot/oauth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/signin?error=missing_params`);
  }

  // Verify state
  const cookieStore = await cookies();
  const storedState = cookieStore.get("wa_oauth_state")?.value;
  if (state !== storedState) {
    return NextResponse.redirect(`${appUrl}/signin?error=invalid_state`);
  }
  cookieStore.delete("wa_oauth_state");

  try {
    // Exchange code for WA access token
    const tokenData = await exchangeCodeForToken(code);
    const { access_token } = tokenData;

    // Fetch user's contact info from WA
    const contact = await getContactInfo(access_token);

    const email = contact.Email;
    const displayName = `${contact.FirstName} ${contact.LastName}`.trim();
    const chapterName = "National";
    const region = "National";
    const memberId = "1111";


    // Find or create Firebase Auth user
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.getUserByEmail(email);
    } catch {
      firebaseUser = await adminAuth.createUser({
        email,
        displayName,
      });
    }

    const uid = firebaseUser.uid;

    // Determine role (default to member, can be upgraded by admin)
    const userDoc = await adminDb.collection("users").doc(uid).get();
    let role = "member";
    if (userDoc.exists) {
      role = userDoc.data()?.role || "member";
    }

    // Update/create user document in Firestore
    await adminDb
      .collection("users")
      .doc(uid)
      .set(
        {
          email,
          displayName,
          chapterName: chapterName || null,
          region: region || null,
          waContactId: String(contact.Id),
          lastLogin: new Date(),
          ...(userDoc.exists ? {} : { role, createdAt: new Date() }),
        },
        { merge: true }
      );

    // Create Firebase custom token with claims.
    // The client will sign in with this token, obtain an ID token, and then
    // POST it to /api/auth/session to create a verified session cookie.
    const customToken = await adminAuth.createCustomToken(uid, {
      role,
      chapterName: chapterName || null,
    });

    // Redirect to callback page which will sign in client-side
    return NextResponse.redirect(`${appUrl}/callback?token=${customToken}`);
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(`${appUrl}/signin?error=auth_failed`);
  }
}
