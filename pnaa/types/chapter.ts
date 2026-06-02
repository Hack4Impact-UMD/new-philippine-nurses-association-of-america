import { Timestamp } from "@/lib/supabase/timestamp";

export interface Chapter {
  name: string;
  region: string;
  totalMembers: number;
  totalActive: number;
  totalLapsed: number;
  lastUpdated: Timestamp;
}
