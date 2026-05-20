import type { AppEvent } from "@/types/event";

export const NATIONAL_CHAPTER_ID = "national";

/**
 * A "national conference" is a conference assigned to the National chapter.
 * Unlocks sub-events, per-sub-event attendance, and bulk attendance upload.
 */
export function isNationalConference(
  event: Pick<AppEvent, "eventType" | "chapterId"> | null | undefined
): boolean {
  if (!event) return false;
  return event.eventType === "conference" && event.chapterId === NATIONAL_CHAPTER_ID;
}
