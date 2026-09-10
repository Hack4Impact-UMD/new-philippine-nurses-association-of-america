import type { UserRole } from "@/types/user";

/** The subset of a user record the onboarding rule looks at. */
export interface OnboardingScope {
  role?: UserRole | string | null;
  chapterId?: string | null;
  region?: string | null;
  needsOnboarding?: boolean | null;
}

/**
 * Whether a user still has to finish setup before the app is usable.
 *
 * Every role but national_admin is scoped to part of the org, and RLS returns
 * that role *nothing* until its scope is set — no members, no events, no
 * chapters. A user in that state would land on an empty dashboard with no way
 * to fix it, so the guard sends them to /setup instead. Chapter admins and
 * members need a chapter; region admins need a region.
 *
 * This is the single source of truth for the rule: the client guard, the setup
 * page, the setup API and the OAuth callback redirect all call it, so they
 * can't drift apart and strand someone in a redirect loop.
 */
export function needsOnboarding(user: OnboardingScope | null | undefined): boolean {
  if (!user) return false;
  if (user.needsOnboarding) return true;
  if (user.role === "national_admin") return false;
  if (user.role === "region_admin") return !user.region;
  return !user.chapterId;
}
