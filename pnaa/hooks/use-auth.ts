"use client";

import { useAuthContext } from "@/lib/auth/context";

export function useAuth() {
  return useAuthContext();
}

export function useIsNationalAdmin(): boolean {
  const { user } = useAuthContext();
  return user?.role === "national_admin";
}

export function useIsRegionAdmin(): boolean {
  const { user } = useAuthContext();
  return user?.role === "region_admin";
}

export function useIsAdmin(): boolean {
  const { user } = useAuthContext();
  return (
    user?.role === "national_admin" ||
    user?.role === "region_admin" ||
    user?.role === "chapter_admin"
  );
}

/** Chapter id (FK to chapters.id) for the current user. */
export function useUserChapter(): string | undefined {
  const { user } = useAuthContext();
  return user?.chapterId ?? undefined;
}

export function useUserRegion(): string | undefined {
  const { user } = useAuthContext();
  return user?.region;
}

/**
 * Roles that may change data at all: national admins org-wide, chapter admins
 * within their own chapter. Region admins review their region read-only, and
 * members read only. Use this for "create" affordances that aren't tied to a
 * chapter yet (New Event, New Campaign); use `useCanEditChapter` once a
 * specific chapter is in hand.
 */
export function useCanEdit(): boolean {
  const { user } = useAuthContext();
  return user?.role === "national_admin" || user?.role === "chapter_admin";
}

/** Whether the current user may edit rows belonging to `chapterId`. */
export function useCanEditChapter(
  chapterId: string | null | undefined
): boolean {
  const { user } = useAuthContext();
  if (user?.role === "national_admin") return true;
  return (
    user?.role === "chapter_admin" &&
    !!chapterId &&
    chapterId === user.chapterId
  );
}

/**
 * Prepositional phrase naming the slice of the org the current user can see —
 * "across all PNAA chapters", "in Northeast Region", "in your chapter". Page
 * descriptions use it so the copy never promises data that RLS withholds.
 */
export function useScopeLabel(): string {
  const { user } = useAuthContext();
  if (user?.role === "national_admin") return "across all PNAA chapters";
  if (user?.role === "region_admin") {
    return user.region ? `in ${user.region}` : "in your region";
  }
  return "in your chapter";
}
