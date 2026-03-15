"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { addDocument, updateDocument } from "@/lib/firebase/firestore";
import { useDocument } from "@/hooks/use-firestore";
import { useAuth } from "@/hooks/use-auth";
import type { Chapter } from "@/types/chapter";
import type { Subchapter } from "@/types/subchapter";

const subchapterSchema = z.object({
  name: z.string().min(1, "Subchapter name is required"),
  description: z.string(),
});

type SubchapterFormValues = z.infer<typeof subchapterSchema>;

interface SubchapterFormProps {
  chapterId: string;
  subchapterId?: string;
  mode: "create" | "edit";
}

export function SubchapterForm({ chapterId, subchapterId, mode }: SubchapterFormProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: chapter, loading: chapterLoading } = useDocument<Chapter>(
    "chapters",
    chapterId
  );
  const { data: subchapter, loading: subchapterLoading } = useDocument<Subchapter>(
    "subchapters",
    mode === "edit" ? subchapterId : undefined
  );

  // Access guard: chapter_admin can only manage their own chapter
  const isChapterAdmin = user?.role === "chapter_admin";
  const isRegionAdmin = user?.role === "region_admin";
  const forbidden =
    !chapterLoading &&
    chapter &&
    ((isChapterAdmin && chapter.name !== user?.chapterName) ||
      (isRegionAdmin && chapter.region !== user?.region));

  useEffect(() => {
    if (forbidden) {
      router.replace(`/chapters/${chapterId}`);
    }
  }, [forbidden, chapterId, router]);

  const form = useForm<SubchapterFormValues>({
    resolver: zodResolver(subchapterSchema),
    defaultValues: { name: "", description: "" },
  });

  // Populate form when editing and subchapter data loads
  useEffect(() => {
    if (subchapter) {
      form.reset({
        name: subchapter.name,
        description: subchapter.description || "",
      });
    }
  }, [subchapter, form]);

  const loading = chapterLoading || (mode === "edit" && subchapterLoading);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!chapter) {
    return (
      <p className="text-muted-foreground text-center py-8">Chapter not found.</p>
    );
  }

  const onSubmit = async (values: SubchapterFormValues) => {
    setIsSubmitting(true);
    try {
      if (mode === "create") {
        const docId = await addDocument("subchapters", {
          name: values.name,
          description: values.description || "",
          chapterId,
          chapterName: chapter.name,
          region: chapter.region,
          memberIds: [],
          archived: false,
          createdBy: user?.email || "",
          lastUpdatedUser: user?.email || "",
        });
        toast.success("Subchapter created");
        router.push(`/chapters/${chapterId}/subchapters/${docId}`);
      } else if (subchapter && subchapterId) {
        await updateDocument("subchapters", subchapterId, {
          name: values.name,
          description: values.description || "",
          lastUpdatedUser: user?.email || "",
        });
        toast.success("Subchapter updated");
        router.push(`/chapters/${chapterId}/subchapters/${subchapterId}`);
      }
    } catch (error) {
      toast.error("Failed to save subchapter");
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
            <CardTitle className="text-base">Subchapter Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted px-4 py-3 text-sm">
              <span className="text-muted-foreground">Parent Chapter: </span>
              <span className="font-medium">{chapter.name}</span>
              <span className="text-muted-foreground ml-3">Region: </span>
              <span className="font-medium">{chapter.region}</span>
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subchapter Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter subchapter name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe this subchapter..."
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

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving..."
              : mode === "create"
                ? "Create Subchapter"
                : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
