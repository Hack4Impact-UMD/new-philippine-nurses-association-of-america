"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDocument, updateDocument } from "@/lib/supabase/firestore";
import { propagateConferenceDefaultHours } from "@/lib/supabase/attendees";
import { useAuth } from "@/hooks/use-auth";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { Timestamp } from "@/lib/supabase/firestore";
import { isNationalConference } from "@/lib/national-conference";
import { SubeventPicker } from "@/components/events/subevent-picker";
import {
  EVENT_TYPE_LABELS,
  EVENT_SUBTYPE_LABELS,
  SUBTYPES_BY_TYPE,
  type AppEvent,
  type EventType,
  type EventSubtype,
} from "@/types/event";

const eventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  startTime: z.string(),
  endTime: z.string(),
  location: z.string(),
  chapterId: z.string().min(1, "Chapter is required"),
  about: z.string(),
  eventType: z.enum(["conference", "community_outreach"]),
  eventSubtype: z.enum([
    "in_person",
    "webinar",
    "medical_mission",
    "health_screening",
    "volunteerism",
  ]),
  defaultHours: z.number().min(0),
  volunteers: z.number().min(0),
  participantsServed: z.number().min(0),
  volunteerHours: z.number().min(0),
  archived: z.boolean(),
  subeventIds: z.array(z.string()),
});

type EventFormValues = z.infer<typeof eventSchema>;

interface EventFormProps {
  event?: AppEvent & { id: string };
  mode: "create" | "edit";
}

export function EventForm({ event, mode }: EventFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { all: chapters } = useChaptersMap();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const subchapterId = searchParams.get("subchapterId") || undefined;
  const chapterIdFromParams = searchParams.get("chapterId") || "";

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      name: event?.name || "",
      startDate: event?.startDate || "",
      endDate: event?.endDate || "",
      startTime: event?.startTime || "",
      endTime: event?.endTime || "",
      location: event?.location || "",
      chapterId: event?.chapterId || chapterIdFromParams,
      about: event?.about || "",
      eventType: event?.eventType || "conference",
      eventSubtype: event?.eventSubtype || "in_person",
      defaultHours: event?.defaultHours ?? 0,
      volunteers: event?.volunteers || 0,
      participantsServed: event?.participantsServed || 0,
      volunteerHours: event?.volunteerHours || 0,
      archived: event?.archived || false,
      subeventIds: event?.subeventIds ?? [],
    },
  });

  // Watch type to filter subtype options and label the hours field appropriately.
  const watchedType = form.watch("eventType") as EventType;
  const watchedChapter = form.watch("chapterId");
  const watchedSubeventIds = form.watch("subeventIds");
  const subtypeOptions = SUBTYPES_BY_TYPE[watchedType] ?? [];
  const isNational = isNationalConference({
    eventType: watchedType,
    chapterId: watchedChapter,
  } as AppEvent);
  const hoursLabel = isNational
    ? "Hours per sub-event"
    : watchedType === "conference"
      ? "Hours per attendee"
      : "Default hours (autofilled per attendee)";
  const hoursDescription = isNational
    ? "Each sub-event attended earns this many hours. Total = hours × sub-events attended."
    : watchedType === "conference"
      ? "Every attendee marked attended earns this many hours."
      : "Prefilled for each attendee — admins can override per person.";

  const onSubmit = async (values: EventFormValues) => {
    setIsSubmitting(true);
    try {
      // Snap subtype to a valid option for the chosen type (in case type changed
      // since the subtype was last picked).
      const validSubtypes = SUBTYPES_BY_TYPE[values.eventType];
      const subtype: EventSubtype = validSubtypes.includes(values.eventSubtype)
        ? values.eventSubtype
        : validSubtypes[0];

      const eventData = {
        ...values,
        eventSubtype: subtype,
        location: values.location || "",
        about: values.about || "",
        startTime: values.startTime || "",
        endTime: values.endTime || "",
        lastUpdatedUser: user?.email || "",
        lastUpdated: Timestamp.now(),
      };

      if (mode === "create") {
        const docId = await addDocument("events", {
          ...eventData,
          source: "app" as const,
          // Counters start at zero on create.
          attendees: 0,
          attendedCount: 0,
          registrations: 0,
          incompleteRegistrations: 0,
          totalRevenue: 0,
          contactHours: 0,
          creationDate: Timestamp.now(),
          ...(subchapterId ? { subchapterId } : {}),
        });

        toast.success("Event created successfully");
        router.push(`/events/${docId}`);
      } else if (event) {
        // In edit mode subeventIds is owned by SubeventPicker (already committed
        // via RPC). Omit it from the update so we don't clobber attendee cleanup.
        const { subeventIds: _ignoredSubeventIds, ...editData } = eventData;
        void _ignoredSubeventIds;
        await updateDocument("events", event.id, editData);

        // For conferences, propagate any defaultHours (or type) change to every
        // attended attendee — keeps the "live" rule the user asked for.
        const becameConference = values.eventType === "conference";
        const hoursChanged = (event.defaultHours ?? 0) !== values.defaultHours;
        const typeChanged = event.eventType !== values.eventType;
        if (becameConference && (hoursChanged || typeChanged)) {
          await propagateConferenceDefaultHours({
            eventId: event.id,
            newDefaultHours: values.defaultHours,
            user: user?.email || "",
          });
        }

        toast.success("Event updated successfully");
        router.push(`/events/${event.id}`);
      }
    } catch (error) {
      toast.error("Failed to save event");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter event name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="eventType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event Type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        // Reset subtype to the first valid option when type changes.
                        const next = SUBTYPES_BY_TYPE[v as EventType][0];
                        form.setValue("eventSubtype", next);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
                          <SelectItem key={t} value={t}>
                            {EVENT_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="eventSubtype"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subtype</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select subtype" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {subtypeOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {EVENT_SUBTYPE_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter location" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="chapterId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chapter</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a chapter" />
                      </SelectTrigger>
                      <SelectContent>
                        {chapters
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                              {c.region ? ` · ${c.region}` : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="about"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe this event..."
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hours & Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="defaultHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{hoursLabel}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      {...field}
                      onChange={(e) =>
                        field.onChange(Number(e.target.value) || 0)
                      }
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground mt-1">
                    {hoursDescription}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  { name: "volunteers", label: "Volunteers" },
                  { name: "participantsServed", label: "Participants Served" },
                  { name: "volunteerHours", label: "Volunteer Hours" },
                ] as const
              ).map((metric) => (
                <FormField
                  key={metric.name}
                  control={form.control}
                  name={metric.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{metric.label}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          onChange={(e) =>
                            field.onChange(Number(e.target.value) || 0)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {isNational && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sub-events</CardTitle>
              <p className="text-sm text-muted-foreground">
                National conferences track attendance per sub-event. Pick from
                the shared catalog or type a new name to add it.
              </p>
            </CardHeader>
            <CardContent>
              <SubeventPicker
                eventId={mode === "edit" ? event?.id : undefined}
                value={watchedSubeventIds}
                onChange={(next) =>
                  form.setValue("subeventIds", next, { shouldDirty: true })
                }
                user={user?.email || ""}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            <FormField
              control={form.control}
              name="archived"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <div>
                    <FormLabel>Archived</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Archived events are hidden from the main list
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving..."
              : mode === "create"
                ? "Create Event"
                : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
