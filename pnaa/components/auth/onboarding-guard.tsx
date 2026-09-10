"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/lib/auth/context";
import { needsOnboarding } from "@/lib/auth/onboarding";

/**
 * Redirects users who haven't completed onboarding to /setup. "Completed"
 * means their role's scope is actually set, not just that the needsOnboarding
 * flag was cleared — a member whose chapter was later removed reads back an
 * empty app under RLS, so they're sent back through setup to pick one.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuthContext();
  const router = useRouter();
  const incomplete = !isLoading && needsOnboarding(user);

  useEffect(() => {
    if (incomplete) {
      router.replace("/setup");
    }
  }, [incomplete, router]);

  // Hide app content while redirecting to setup
  if (incomplete) return null;

  return <>{children}</>;
}
