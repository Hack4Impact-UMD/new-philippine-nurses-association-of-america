"use client";

import Link from "next/link";
import { useDocument } from "@/hooks/use-firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { EventMetrics } from "./event-metrics";
import { AttendeeList } from "./attendee-list";
import { formatDateRange } from "@/lib/utils";
import { Pencil, Calendar, MapPin, Clock, Building2 } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-auth";
import type { AppEvent } from "@/types/event";

export function EventDetail({ eventId }: { eventId: string }) {
  const { data: event, loading } = useDocument<AppEvent>("events", eventId);
  const isAdmin = useIsAdmin();

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Event not found</h2>
        <Link href="/events" className="text-primary hover:underline mt-2 inline-block">
          Back to events
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{event.name}</h1>
            <StatusBadge
              variant={event.source === "wildapricot" ? "wildapricot" : "app"}
            />
            {event.archived && <StatusBadge variant="archived" />}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {formatDateRange(event.startDate, event.endDate)}
            </span>
            {event.startTime && (
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {event.startTime}
                {event.endTime && ` — ${event.endTime}`}
              </span>
            )}
            {event.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {event.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Building2 className="h-4 w-4" />
              {event.chapter}
            </span>
          </div>
        </div>
        {isAdmin && (
          <Link href={`/events/${eventId}/edit`}>
            <Button>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Event
            </Button>
          </Link>
        )}
      </div>

      {/* Poster */}
      {event.eventPoster?.downloadURL && (
        <Card>
          <CardContent className="p-0">
            <img
              src={event.eventPoster.downloadURL}
              alt={event.name}
              className="w-full max-h-96 object-cover rounded-lg"
            />
          </CardContent>
        </Card>
      )}

      {/* Description */}
      {event.about && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">About This Event</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {event.about}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Metrics */}
      <EventMetrics event={event} />

      {/* Attendees */}
      <Card className = "p-10"> 
        <CardHeader>
          <CardTitle className="text-base">Attendees</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AttendeeList eventId={eventId} />
        </CardContent>
      </Card>
    </div>
  );
}
