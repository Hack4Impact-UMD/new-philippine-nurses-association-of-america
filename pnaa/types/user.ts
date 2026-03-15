import { Timestamp } from "firebase/firestore";

export type UserRole = "national_admin" | "region_admin" | "chapter_admin" | "member";

export interface AppUser {
  email: string;
  displayName: string;
  role: UserRole;
  chapterName?: string;
  region?: string;
  createdAt: Timestamp;
  lastLogin: Timestamp;
  waContactId?: string;
}
