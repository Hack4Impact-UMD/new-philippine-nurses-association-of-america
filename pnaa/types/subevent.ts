import { Timestamp } from "@/lib/supabase/timestamp";

export interface Subevent {
  id: string;
  name: string;
  archived: boolean;
  createdBy?: string;
  createdAt: Timestamp;
}
