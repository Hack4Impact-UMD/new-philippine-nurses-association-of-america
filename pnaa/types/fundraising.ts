import { Timestamp } from "@/lib/supabase/timestamp";

export interface FundraisingCampaign {
  fundraiserName: string;
  /** FK to chapters.id — null for national campaigns. */
  chapterId: string | null;
  subchapterId?: string;
  date: string;
  amount: number;
  note: string;
  archived: boolean;
  lastUpdated: Timestamp;
  lastUpdatedUser: string;
  creationDate: Timestamp;
}
