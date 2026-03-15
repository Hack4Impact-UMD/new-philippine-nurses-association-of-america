import { Timestamp } from "firebase/firestore";

export interface EventPoster {
  name: string;
  ref: string;
  downloadURL: string;
}

export interface AppEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  chapter: string;
  region: string;
  archived: boolean;

  // Enrichment fields
  about: string;
  startTime: string;
  endTime: string;
  eventPoster: EventPoster;

  // Metrics
  attendees: number;
  volunteers: number;
  participantsServed: number;
  contactHours: number;
  volunteerHours: number;

  // Subchapter association (optional)
  subchapterId?: string;

  // Metadata
  source: "wildapricot" | "app";
  lastUpdatedUser: string;
  lastUpdated: Timestamp;
  creationDate: Timestamp;
}
