import { Timestamp } from "@/lib/supabase/timestamp";

export type EventType = "conference" | "community_outreach";

export type ConferenceSubtype = "in_person" | "webinar";
export type CommunityOutreachSubtype =
  | "medical_mission"
  | "health_screening"
  | "volunteerism";
export type EventSubtype = ConferenceSubtype | CommunityOutreachSubtype;

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  conference: "Conference",
  community_outreach: "Community Outreach",
};

export const EVENT_SUBTYPE_LABELS: Record<EventSubtype, string> = {
  in_person: "In Person",
  webinar: "Webinar",
  medical_mission: "Medical Mission",
  health_screening: "Health Screening",
  volunteerism: "Volunteerism",
};

export const SUBTYPES_BY_TYPE: Record<EventType, EventSubtype[]> = {
  conference: ["in_person", "webinar"],
  community_outreach: ["medical_mission", "health_screening", "volunteerism"],
};

export interface AppEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  /** FK to chapters.id — null for national / cross-chapter events. */
  chapterId: string | null;
  archived: boolean;

  // Type / subtype
  eventType: EventType;
  eventSubtype: EventSubtype;
  defaultHours: number;

  // Enrichment fields
  about: string;
  startTime: string;
  endTime: string;

  // Metrics
  attendees: number;
  registrations: number;
  incompleteRegistrations: number;
  totalRevenue: number;
  volunteers: number;
  participantsServed: number;
  contactHours: number;
  attendedCount: number;
  volunteerHours: number;

  // Subchapter association (optional)
  subchapterId?: string;

  // National conferences only: ordered list of sub-events drawn from the
  // subevents catalog. Empty / unused on other event types.
  subeventIds: string[];

  // Metadata
  source: "wildapricot" | "app";
  lastUpdatedUser: string;
  lastUpdated: Timestamp;
  creationDate: Timestamp;
}
