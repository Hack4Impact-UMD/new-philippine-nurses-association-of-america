"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Calendar, MapPin, Users } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/utils";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import type { AppEvent } from "@/types/event";

export function EventCard({ event }: { event: AppEvent & { id: string } }) {
  const { nameFor } = useChaptersMap();
  return (
    <Link href={`/events/${event.id}`}>
      <Card className="transition-all hover:shadow-md hover:border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm line-clamp-2">
              {event.name}
            </h3>
            <StatusBadge
              variant={event.source === "wildapricot" ? "wildapricot" : "app"}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>{formatDate(event.startDate)}</span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">
              {nameFor(event.chapterId)}
            </span>
            {event.attendees > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>{event.attendees}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
