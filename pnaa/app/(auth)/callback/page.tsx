"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) return;

    signInWithCustomToken(auth, token)
      .then(async (userCredential) => {
        // Get a verified ID token from the signed-in user
        const idToken = await userCredential.user.getIdToken();

        // Exchange it for a server-side session cookie
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });

        if (!res.ok) {
          throw new Error("Failed to create session");
        }

        // Check if this is a new user who needs to pick their chapter
        const userDoc = await getDoc(
          doc(db, "users", userCredential.user.uid)
        );
        if (userDoc.exists() && userDoc.data()?.needsOnboarding) {
          router.push("/setup");
        } else {
          router.push("/dashboard");
        }
      })
      .catch((err) => {
        console.error("Firebase sign-in error:", err);
        setError("Authentication failed. Please try again.");
      });
  }, [token, router]);

  const displayError = !token ? "No authentication token provided" : error;

  if (displayError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">{displayError}</p>
          <a href="/signin" className="text-primary underline">
            Return to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
        <p className="text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  );
}
