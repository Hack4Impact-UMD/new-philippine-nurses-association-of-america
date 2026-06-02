import { Timestamp } from "@/lib/supabase/timestamp";

export interface Subchapter {
  name: string;
  /** FK to chapters.id (required). */
  chapterId: string;
  description: string;
  memberIds: string[];
  archived: boolean;
  createdBy: string;
  lastUpdatedUser: string;
  createdAt: Timestamp;
  lastUpdated: Timestamp;
}
