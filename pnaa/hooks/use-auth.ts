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
