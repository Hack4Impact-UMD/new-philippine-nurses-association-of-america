import { Timestamp } from "@/lib/supabase/timestamp";

export interface Member {
  name: string;
  email: string;
  membershipLevel: string;
  renewalDueDate: string;
  /** FK to chapters.id — null when WA didn't report a chapter. */
  chapterId: string | null;
  highestEducation: string;
  memberId: string;
  region: string;
  activeStatus: "Active" | "Lapsed";
  lastSynced: Timestamp;
}
