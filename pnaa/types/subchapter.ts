import { Timestamp } from "@/lib/supabase/timestamp";

export interface Subchapter {
  name: string;
  /** FK to chapters.id (required). */
  chapterId: string;
  description: string;
  memberIds: string[];
  archived: boolean;
  /** auth.users.id (uuid) of the creator — null for rows migrated from Firestore. */
  createdBy: string | null;
  lastUpdatedUser: string;
  createdAt: Timestamp;
  lastUpdated: Timestamp;
}
