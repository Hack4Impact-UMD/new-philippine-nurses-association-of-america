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
import { FileUpload } from "@/components/shared/file-upload";
import { addDocument, updateDocument } from "@/lib/firebase/firestore";
import { uploadEventPoster } from "@/lib/firebase/storage";
import { useAuth } from "@/hooks/use-auth";
import { Timestamp } from "firebase/firestore";
import type { AppEvent } from "@/types/event";

const eventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  startTime: z.string(),
  endTime: z.string(),
  location: z.string(),
  chapter: z.string().min(1, "Chapter is required"),
  region: z.string(),
  about: z.string(),
  attendees: z.number().min(0),
  volunteers: z.number().min(0),
  participantsServed: z.number().min(0),
  contactHours: z.number().min(0),
  volunteerHours: z.number().min(0),
  archived: z.boolean(),
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [posterFile, setPosterFile] = useState<File | null>(null);

  const subchapterId = searchParams.get("subchapterId") || undefined;
  const chapterFromParams = searchParams.get("chapter") || "";
  const regionFromParams = searchParams.get("region") || "";

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      name: event?.name || "",
      startDate: event?.startDate || "",
      endDate: event?.endDate || "",
      startTime: event?.startTime || "",
      endTime: event?.endTime || "",
      location: event?.location || "",
      chapter: event?.chapter || chapterFromParams,
      region: event?.region || regionFromParams,
      about: event?.about || "",
      attendees: event?.attendees || 0,
      volunteers: event?.volunteers || 0,
      participantsServed: event?.participantsServed || 0,
      contactHours: event?.contactHours || 0,
      volunteerHours: event?.volunteerHours || 0,
      archived: event?.archived || false,
    },
  });

  const onSubmit = async (values: EventFormValues) => {
    setIsSubmitting(true);
    try {
      let eventPoster = event?.eventPoster || {
        name: "",
        ref: "",
        downloadURL: "",
      };

      const eventData = {
        ...values,
        location: values.location || "",
        region: values.region || "",
        about: values.about || "",
        startTime: values.startTime || "",
        endTime: values.endTime || "",
        eventPoster,
        lastUpdatedUser: user?.email || "",
        lastUpdated: Timestamp.now(),
      };

      if (mode === "create") {
        const docId = await addDocument("events", {
          ...eventData,
          source: "app" as const,
          creationDate: Timestamp.now(),
          ...(subchapterId ? { subchapterId } : {}),
        });

        if (posterFile) {
          eventPoster = await uploadEventPoster(docId, posterFile);
          await updateDocument("events", docId, { eventPoster });
        }

        toast.success("Event created successfully");
        router.push(`/events/${docId}`);
      } else if (event) {
        if (posterFile) {
          eventPoster = await uploadEventPoster(event.id, posterFile);
          eventData.eventPoster = eventPoster;
        }

        await updateDocument("events", event.id, eventData);
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="chapter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chapter</FormLabel>
                    <FormControl>
                      <Input placeholder="Chapter name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Region</FormLabel>
                    <FormControl>
                      <Input placeholder="Region" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

            <div>
              <label className="text-sm font-medium">Event Poster</label>
              <div className="mt-2">
                <FileUpload
                  onFileSelect={setPosterFile}
                  currentUrl={event?.eventPoster?.downloadURL}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  { name: "attendees", label: "Attendees" },
                  { name: "volunteers", label: "Volunteers" },
                  { name: "participantsServed", label: "Participants Served" },
                  { name: "contactHours", label: "Contact Hours" },
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
