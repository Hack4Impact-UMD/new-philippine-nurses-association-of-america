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

type FundResolution =
  | { kind: "ready"; fundraiserName: string; chapterId: string; date: string; amount: number; note: string }
  | { kind: "unknown_chapter"; rawChapter: string; fundraiserName: string; date: string; amount: number; note: string }
  | { kind: "invalid"; reason: string }
  | { kind: "skipped" };

interface FundRow {
  key: string;
  index: number;
  rawName: string;
  rawChapter: string;
  resolution: FundResolution;
}

const KNOWN_HEADERS = ["fundraiser name", "fundraiser", "chapter", "date", "amount", "note"];

const TEMPLATE_CSV = [
  "Fundraiser Name,Chapter,Date,Amount,Note",
  "Spring Gala,PNA Metro Houston,2026-04-15,5000,Annual gala",
].join("\n");

/** Validate + normalize a date cell to YYYY-MM-DD, or null when unparseable. */
function normalizeDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // Already ISO date — keep as-is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function useCampaignAdapter(): BulkUploadAdapter<FundRow> {
  const { byName, canonical } = useChaptersMap();

  return useMemo<BulkUploadAdapter<FundRow>>(() => {
    const sortedChapters = canonical
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    const analyze = async (grid: string[][]): Promise<FundRow[]> => {
      const { headerMap, dataRows } = splitHeader(grid, KNOWN_HEADERS);
      return dataRows
        .map((r, i) => {
          const fundraiserName =
            col(r, headerMap, "fundraiser name", 0) || col(r, headerMap, "fundraiser", 0);
          const rawChapter = col(r, headerMap, "chapter", 1);
          const rawDate = col(r, headerMap, "date", 2);
          const rawAmount = col(r, headerMap, "amount", 3);
          const note = col(r, headerMap, "note", 4);
          return { index: i + 1, fundraiserName, rawChapter, rawDate, rawAmount, note };
        })
        .filter((p) => p.fundraiserName || p.rawChapter || p.rawAmount)
        .map((p) => {
          const base = { key: String(p.index), index: p.index, rawName: p.fundraiserName, rawChapter: p.rawChapter };
          if (!p.fundraiserName) {
            return { ...base, resolution: { kind: "invalid", reason: "Fundraiser name is required." } as const };
          }
          const date = normalizeDate(p.rawDate);
          if (!date) {
            return { ...base, resolution: { kind: "invalid", reason: `Couldn't read date "${p.rawDate}".` } as const };
          }
          const amount = Number(p.rawAmount.replace(/[$,]/g, ""));
          if (!Number.isFinite(amount) || amount < 0) {
            return { ...base, resolution: { kind: "invalid", reason: `Couldn't read amount "${p.rawAmount}".` } as const };
          }
          const chapter = byName.get(p.rawChapter.trim().toLowerCase());
          if (!chapter) {
            return {
              ...base,
              resolution: {
                kind: "unknown_chapter",
                rawChapter: p.rawChapter,
                fundraiserName: p.fundraiserName,
                date,
                amount,
                note: p.note,
              } as const,
            };
          }
          return {
            ...base,
            resolution: {
              kind: "ready",
              fundraiserName: p.fundraiserName,
              chapterId: chapter.id,
              date,
              amount,
              note: p.note,
            } as const,
          };
        });
    };

    const status = (row: FundRow): RowStatus => {
      switch (row.resolution.kind) {
        case "ready":
          return "ready";
        case "skipped":
          return "skipped";
        default:
          return "conflict";
      }
    };

    const apply = async (readyRows: FundRow[], user: string) => {
      let ok = 0;
      const errors: string[] = [];
      for (const row of readyRows) {
        if (row.resolution.kind !== "ready") continue;
        const r = row.resolution;
        try {
          await addDocument("fundraising", {
            fundraiserName: r.fundraiserName,
            chapterId: r.chapterId,
            date: r.date,
            amount: r.amount,
            note: r.note || "",
            archived: false,
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
          `Created ${ok} of ${readyRows.length} campaigns. ${errors.length} failed — ${errors[0]}`
        );
      }
      return { appliedCount: ok, message: `Created ${ok} campaign${ok === 1 ? "" : "s"}` };
    };

    const renderRow = (row: FundRow, api: RowApi<FundRow>) => (
      <CampaignRowItem row={row} api={api} chapters={sortedChapters} />
    );

    return {
      title: "Bulk Upload Campaigns",
      description:
        "Upload a CSV to create fundraising campaigns in bulk. Re-uploading the same file creates duplicates — there is no dedupe.",
      templateFilename: "fundraising-template.csv",
      templateCsv: TEMPLATE_CSV,
      columnsHint: "Columns: Fundraiser Name, Chapter, Date, Amount, Note",
      analyze,
      status,
      renderRow,
      apply,
    };
  }, [byName, canonical]);
}

function CampaignRowItem({
  row,
  api,
  chapters,
}: {
  row: FundRow;
  api: RowApi<FundRow>;
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
            <span className="font-medium">{res.fundraiserName}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">{res.date}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">${res.amount.toLocaleString()}</span>
          </p>
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
          <p className="text-sm font-medium">{res.fundraiserName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Chapter &quot;{res.rawChapter}&quot; not found. Pick one.
          </p>
        </div>
        <Select
          onValueChange={(chapterId) =>
            api.updateRow(row.key, {
              resolution: {
                kind: "ready",
                fundraiserName: res.fundraiserName,
                chapterId,
                date: res.date,
                amount: res.amount,
                note: res.note,
              },
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

export function BulkCampaignUploadButton() {
  const adapter = useCampaignAdapter();
  return <BulkUploadButton adapter={adapter} />;
}
