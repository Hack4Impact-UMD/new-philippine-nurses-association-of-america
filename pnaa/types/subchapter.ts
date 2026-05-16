import { Timestamp } from "@/lib/supabase/timestamp";

export interface Subchapter {
  name: string;
  chapterId: string;
  chapterName: string;
  region: string;
  description: string;
  memberIds: string[];
  archived: boolean;
  createdBy: string;
  lastUpdatedUser: string;
  createdAt: Timestamp;
  lastUpdated: Timestamp;
}
