"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar, ArrowUpRight, MapPin, Building2 } from "lucide-react";
import { parseISO, format } from "date-fns";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { stripChapterPrefix } from "@/lib/utils";
import type { AppEvent } from "@/types/event";

/** Compact two-line month/day block for the event's start date. */
function DateBlock({ date }: { date: string }) {
  let month = "";
  let day = "";
  if (date) {
    const d = parseISO(date);
    month = format(d, "MMM").toUpperCase();
    day = format(d, "d");
  }
  return (
    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md border bg-muted/40 leading-none">
      <span className="text-[10px] font-semibold text-muted-foreground">
        {month}
      </span>
      <span className="text-base font-bold tabular-nums">{day}</span>
    </div>
  );
}

export function UpcomingEvents({
  events,
}: {
  events: (AppEvent & { id: string })[];
}) {
  const { nameFor } = useChaptersMap();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Upcoming Events</CardTitle>
        <Link
          href="/events"
          className="text-sm text-primary flex items-center gap-1 hover:underline"
        >
          View all <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Calendar className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No upcoming events</p>
          </div>
        ) : (
          <div className="space-y-1">
            {events.map((event) => {
              const chapterName =
                event.chapterId && event.chapterId !== "national"
                  ? stripChapterPrefix(nameFor(event.chapterId))
                  : null;
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="flex items-start gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-accent"
                >
                  <DateBlock date={event.startDate} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{event.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {chapterName && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {chapterName}
                        </span>
                      )}
                      {event.location && (
                        <span className="flex items-center gap-1 min-w-0">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{event.location}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
