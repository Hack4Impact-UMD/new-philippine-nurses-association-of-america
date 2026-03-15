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
import { addDocument, updateDocument } from "@/lib/firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { Timestamp } from "firebase/firestore";
import type { FundraisingCampaign } from "@/types/fundraising";

const campaignSchema = z.object({
  fundraiserName: z.string().min(1, "Fundraiser name is required"),
  chapterName: z.string().min(1, "Chapter name is required"),
  date: z.string().min(1, "Date is required"),
  amount: z.number().min(0, "Amount must be positive"),
  note: z.string(),
  archived: z.boolean(),
});

type CampaignFormValues = z.infer<typeof campaignSchema>;

interface CampaignFormProps {
  campaign?: FundraisingCampaign & { id: string };
  mode: "create" | "edit";
}

export function CampaignForm({ campaign, mode }: CampaignFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const subchapterId = searchParams.get("subchapterId") || undefined;
  const chapterFromParams = searchParams.get("chapterName") || "";

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      fundraiserName: campaign?.fundraiserName || "",
      chapterName: campaign?.chapterName || chapterFromParams || user?.chapterName || "",
      date: campaign?.date || new Date().toISOString().split("T")[0],
      amount: campaign?.amount || 0,
      note: campaign?.note || "",
      archived: campaign?.archived || false,
    },
  });

  const onSubmit = async (values: CampaignFormValues) => {
    setIsSubmitting(true);
    try {
      const data = {
        ...values,
        note: values.note || "",
        lastUpdatedUser: user?.email || "",
        lastUpdated: Timestamp.now(),
      };

      if (mode === "create") {
        const docId = await addDocument("fundraising", {
          ...data,
          creationDate: Timestamp.now(),
          ...(subchapterId ? { subchapterId } : {}),
        });
        toast.success("Campaign created successfully");
        router.push(`/fundraising/${docId}`);
      } else if (campaign) {
        await updateDocument("fundraising", campaign.id, data);
        toast.success("Campaign updated successfully");
        router.push(`/fundraising/${campaign.id}`);
      }
    } catch (error) {
      toast.error("Failed to save campaign");
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
            <CardTitle className="text-base">Campaign Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="fundraiserName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fundraiser Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter fundraiser name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="chapterName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chapter Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Chapter name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="0.00"
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
            </div>

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes..."
                      rows={3}
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
          <CardContent className="pt-6">
            <FormField
              control={form.control}
              name="archived"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <div>
                    <FormLabel>Archived</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Archived campaigns are hidden from the main list
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
                ? "Create Campaign"
                : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
