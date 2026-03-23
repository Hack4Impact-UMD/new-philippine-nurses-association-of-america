"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/lib/auth/context";

/**
 * Redirects users who haven't completed onboarding (chapter/region selection)
 * to the /setup page. Wrap app-level layouts with this guard.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user?.needsOnboarding) {
      router.replace("/setup");
    }
  }, [isLoading, user, router]);

  // Hide app content while redirecting to setup
  if (!isLoading && user?.needsOnboarding) return null;

  return <>{children}</>;
}
