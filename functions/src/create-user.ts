import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

interface CreateUserData {
  email: string;
  displayName: string;
  role: "national_admin" | "region_admin" | "chapter_admin" | "member";
  chapterName?: string;
  region?: string;
}

export const createUser = onCall(async (request) => {
  // Only allow national admins to create users
  if (request.auth?.token?.role !== "national_admin") {
    throw new HttpsError(
      "permission-denied",
      "Only national admins can create users"
    );
  }

  const data = request.data as CreateUserData;
  const { email, displayName, role, chapterName, region } = data;

  if (!email || !displayName || !role) {
    throw new HttpsError(
      "invalid-argument",
      "email, displayName, and role are required"
    );
  }

  const auth = getAuth();
  const db = getFirestore();

  try {
    // Create Firebase Auth user
    const userRecord = await auth.createUser({
      email,
      displayName,
    });

    // Create Firestore user document
    await db.collection("users").doc(userRecord.uid).set({
      email,
      displayName,
      role,
      chapterName: chapterName || null,
      region: region || null,
      createdAt: Timestamp.now(),
      lastLogin: Timestamp.now(),
    });

    // Set custom claims
    await auth.setCustomUserClaims(userRecord.uid, {
      role,
      chapterName: chapterName || null,
      region: region || null,
    });

    return { uid: userRecord.uid, success: true };
  } catch (error) {
    console.error("Error creating user:", error);
    throw new HttpsError("internal", "Failed to create user");
  }
});
