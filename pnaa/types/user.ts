import { Timestamp } from "@/lib/supabase/timestamp";

export type UserRole = "national_admin" | "region_admin" | "chapter_admin" | "member";

export interface AppUser {
  email: string;
  displayName: string;
  role: UserRole;
  /** FK to chapters.id — set on first onboarding for chapter_admin / member. */
  chapterId?: string | null;
  region?: string;
  needsOnboarding?: boolean;
  createdAt: Timestamp;
  lastLogin: Timestamp;
  waContactId?: string;
}
