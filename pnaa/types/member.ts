import { Timestamp } from "@/lib/supabase/timestamp";

export interface Member {
  name: string;
  email: string;
  membershipLevel: string;
  renewalDueDate: string;
  chapterName: string;
  highestEducation: string;
  memberId: string;
  region: string;
  activeStatus: "Active" | "Lapsed";
  lastSynced: Timestamp;
}
