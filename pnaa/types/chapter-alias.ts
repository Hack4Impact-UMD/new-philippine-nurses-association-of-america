import { Timestamp } from "@/lib/supabase/timestamp";

export interface ChapterAlias {
  id?: string;
  chapterId: string;
  aliasName: string;
  createdBy: string;
  createdAt?: Timestamp;
  lastUpdated?: Timestamp;
}
