import { Timestamp } from "@/lib/supabase/timestamp";

export interface FundraisingCampaign {
  fundraiserName: string;
  chapterName: string;
  subchapterId?: string;
  date: string;
  amount: number;
  note: string;
  archived: boolean;
  lastUpdated: Timestamp;
  lastUpdatedUser: string;
  creationDate: Timestamp;
}
