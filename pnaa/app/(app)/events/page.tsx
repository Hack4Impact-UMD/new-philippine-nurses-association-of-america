"use client";

import Link from "next/link";
import { EventList } from "@/components/events/event-list";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useCanEdit, useScopeLabel } from "@/hooks/use-auth";
import { BulkEventUploadButton } from "@/components/events/bulk-event-upload";

export default function EventsPage() {
  const canEdit = useCanEdit();
  const scope = useScopeLabel();

  return (
    <div className="space-y-6">
      <PageHeader title="Events" description={`Events ${scope}`}>
        {canEdit && (
          <div className="flex items-center gap-2">
            <BulkEventUploadButton />
            <Button asChild>
              <Link href="/events/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Event
              </Link>
            </Button>
          </div>
        )}
      </PageHeader>
      <EventList />
    </div>
  );
}
