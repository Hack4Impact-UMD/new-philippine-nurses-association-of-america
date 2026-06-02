"use client";

import { useMemo } from "react";
import { Check, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BulkUploadButton,
  type BulkUploadAdapter,
  type RowApi,
  type RowStatus,
} from "@/components/shared/bulk-upload-dialog";
import { useChaptersMap, type ChapterRow } from "@/hooks/use-chapters-map";
import { addDocument, Timestamp } from "@/lib/supabase/firestore";
import { splitHeader, col } from "@/lib/csv";
import { stripChapterPrefix } from "@/lib/utils";
import {
  SUBTYPES_BY_TYPE,
  EVENT_SUBTYPE_LABELS,
  type EventType,
  type EventSubtype,
} from "@/types/event";

interface EventDraft {
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  eventType: EventType;
  eventSubtype: EventSubtype;
  defaultHours: number;
  warning?: string;
}

type EvtResolution =
  | { kind: "ready"; chapterId: string; draft: EventDraft }
  | { kind: "unknown_chapter"; rawChapter: string; draft: EventDraft }
  | { kind: "invalid"; reason: string }
  | { kind: "skipped" };

interface EvtRow {
  key: string;
  index: number;
  rawName: string;
  rawChapter: string;
  resolution: EvtResolution;
}

const KNOWN_HEADERS = [
  "name",
  "start date",
  "end date",
  "chapter",
  "event type",
  "subtype",
  "default hours",
  "location",
];

const TEMPLATE_CSV = [
  "Name,Start Date,End Date,Chapter,Event Type,Subtype,Default Hours,Location",
  "Health Fair,2026-06-01,2026-06-01,PNA Metro Houston,community_outreach,health_screening,2,Houston TX",
].join("\n");

function normalizeDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function parseEventType(raw: string): EventType | null {
  const v = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (v === "conference") return "conference";
  if (v === "community_outreach") return "community_outreach";
  return null;
}

function useEventAdapter(): BulkUploadAdapter<EvtRow> {
  const { byName, canonical } = useChaptersMap();

  return useMemo<BulkUploadAdapter<EvtRow>>(() => {
    const sortedChapters = canonical
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    const analyze = async (grid: string[][]): Promise<EvtRow[]> => {
      const { headerMap, dataRows } = splitHeader(grid, KNOWN_HEADERS);
      return dataRows
        .map((r, i) => ({
          index: i + 1,
          name: col(r, headerMap, "name", 0),
          startDate: col(r, headerMap, "start date", 1),
          endDate: col(r, headerMap, "end date", 2),
          rawChapter: col(r, headerMap, "chapter", 3),
          rawType: col(r, headerMap, "event type", 4),
          rawSubtype: col(r, headerMap, "subtype", 5),
          rawHours: col(r, headerMap, "default hours", 6),
          location: col(r, headerMap, "location", 7),
        }))
        .filter((p) => p.name || p.rawChapter)
        .map((p) => {
          const base = { key: String(p.index), index: p.index, rawName: p.name, rawChapter: p.rawChapter };
          if (!p.name) {
            return { ...base, resolution: { kind: "invalid", reason: "Event name is required." } as const };
          }
          const startDate = normalizeDate(p.startDate);
          if (!startDate) {
            return { ...base, resolution: { kind: "invalid", reason: `Couldn't read start date "${p.startDate}".` } as const };
          }
          const endDate = normalizeDate(p.endDate) ?? startDate;
          const eventType = parseEventType(p.rawType);
          if (!eventType) {
            return { ...base, resolution: { kind: "invalid", reason: `Event type must be "conference" or "community_outreach" (got "${p.rawType}").` } as const };
          }
          const validSubtypes = SUBTYPES_BY_TYPE[eventType];
          const subKey = p.rawSubtype.trim().toLowerCase().replace(/\s+/g, "_") as EventSubtype;
          let eventSubtype: EventSubtype;
          let warning: string | undefined;
          if (validSubtypes.includes(subKey)) {
            eventSubtype = subKey;
          } else {
            eventSubtype = validSubtypes[0];
            warning = `Subtype "${p.rawSubtype}" isn't valid for ${eventType} — defaulting to ${EVENT_SUBTYPE_LABELS[eventSubtype]}.`;
          }
          const hoursNum = Number(p.rawHours);
          const defaultHours = Number.isFinite(hoursNum) && hoursNum >= 0 ? hoursNum : 0;

          const draft: EventDraft = {
            name: p.name,
            startDate,
            endDate,
            location: p.location,
            eventType,
            eventSubtype,
            defaultHours,
            warning,
          };

          const chapter = byName.get(p.rawChapter.trim().toLowerCase());
          if (!chapter) {
            return { ...base, resolution: { kind: "unknown_chapter", rawChapter: p.rawChapter, draft } as const };
          }
          return { ...base, resolution: { kind: "ready", chapterId: chapter.id, draft } as const };
        });
    };

    const status = (row: EvtRow): RowStatus => {
      switch (row.resolution.kind) {
        case "ready":
          return "ready";
        case "skipped":
          return "skipped";
        default:
          return "conflict";
      }
    };

    const apply = async (readyRows: EvtRow[], user: string) => {
      let ok = 0;
      const errors: string[] = [];
      for (const row of readyRows) {
        if (row.resolution.kind !== "ready") continue;
        const { chapterId, draft } = row.resolution;
        try {
          await addDocument("events", {
            name: draft.name,
            startDate: draft.startDate,
            endDate: draft.endDate,
            startTime: "",
            endTime: "",
            location: draft.location || "",
            chapterId,
            about: "",
            eventType: draft.eventType,
            eventSubtype: draft.eventSubtype,
            defaultHours: draft.defaultHours,
            volunteers: 0,
            participantsServed: 0,
            volunteerHours: 0,
            archived: false,
            subeventIds: [],
            source: "app" as const,
            attendees: 0,
            attendedCount: 0,
            registrations: 0,
            incompleteRegistrations: 0,
            totalRevenue: 0,
            contactHours: 0,
            lastUpdatedUser: user,
            lastUpdated: Timestamp.now(),
            creationDate: Timestamp.now(),
          });
          ok++;
        } catch (e) {
          errors.push(`Row ${row.index}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
      if (errors.length > 0) {
        throw new Error(
          `Created ${ok} of ${readyRows.length} events. ${errors.length} failed — ${errors[0]}`
        );
      }
      return { appliedCount: ok, message: `Created ${ok} event${ok === 1 ? "" : "s"}` };
    };

    const renderRow = (row: EvtRow, api: RowApi<EvtRow>) => (
      <EventRowItem row={row} api={api} chapters={sortedChapters} />
    );

    return {
      title: "Bulk Upload Events",
      description:
        "Upload a CSV to create events in bulk. These are app-source events (most events sync from Wild Apricot). Re-uploading creates duplicates — there is no dedupe.",
      templateFilename: "events-template.csv",
      templateCsv: TEMPLATE_CSV,
      columnsHint: "Columns: Name, Start Date, End Date, Chapter, Event Type, Subtype, Default Hours, Location",
      analyze,
      status,
      renderRow,
      apply,
    };
  }, [byName, canonical]);
}

function EventRowItem({
  row,
  api,
  chapters,
}: {
  row: EvtRow;
  api: RowApi<EvtRow>;
  chapters: ChapterRow[];
}) {
  const res = row.resolution;
  const skip = () => api.updateRow(row.key, { resolution: { kind: "skipped" } });

  if (res.kind === "ready") {
    return (
      <div className="p-3 flex items-start gap-3">
        <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            <span className="font-medium">{res.draft.name}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">{res.draft.startDate}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">{EVENT_SUBTYPE_LABELS[res.draft.eventSubtype]}</span>
          </p>
          {res.draft.warning && (
            <p className="text-xs text-amber-600 mt-0.5">{res.draft.warning}</p>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={skip}>
          Skip
        </Button>
      </div>
    );
  }

  if (res.kind === "skipped") {
    return (
      <div className="p-3 flex items-center gap-3 opacity-50">
        <X className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-sm flex-1 min-w-0 truncate">
          Row {row.index}: <span className="line-through">{row.rawName}</span>
        </p>
      </div>
    );
  }

  if (res.kind === "invalid") {
    return (
      <div className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            Row {row.index}: <span className="font-medium">{row.rawName || "(no name)"}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{res.reason}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={skip}>
          Skip
        </Button>
      </div>
    );
  }

  // unknown_chapter
  return (
    <div className="p-3 flex items-start gap-3 bg-amber-50/40 dark:bg-amber-950/10">
      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-medium">{res.draft.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Chapter &quot;{res.rawChapter}&quot; not found. Pick one.
          </p>
        </div>
        <Select
          onValueChange={(chapterId) =>
            api.updateRow(row.key, {
              resolution: { kind: "ready", chapterId, draft: res.draft },
            })
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Pick a chapter..." />
          </SelectTrigger>
          <SelectContent>
            {chapters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {stripChapterPrefix(c.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button variant="ghost" size="sm" className="h-7" onClick={skip}>
        Skip
      </Button>
    </div>
  );
}

export function BulkEventUploadButton() {
  const adapter = useEventAdapter();
  return <BulkUploadButton adapter={adapter} />;
}
