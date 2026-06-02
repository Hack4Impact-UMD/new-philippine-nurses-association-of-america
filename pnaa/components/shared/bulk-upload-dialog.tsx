"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Upload, Download, Check, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { parseCSV, downloadCsv } from "@/lib/csv";

export type RowStatus = "ready" | "conflict" | "skipped";

/** Mutators handed to an adapter's `renderRow` so it can resolve conflicts. */
export interface RowApi<Row> {
  /** Patch a single row, matched by its `key`. */
  updateRow: (key: string, patch: Partial<Row>) => void;
  /** Replace the whole row list (e.g. re-analyze siblings after a fix). */
  replaceRows: (updater: (rows: Row[]) => Row[]) => void;
}

/** Per-feature contract. The shell owns parsing/state/apply orchestration; the
 *  adapter owns columns, row classification, row UI, and the commit. */
export interface BulkUploadAdapter<Row extends { key: string }> {
  title: string;
  description: string;
  templateFilename: string;
  templateCsv: string;
  /** Short hint shown in the dropzone, e.g. "Columns: Name, Email, Attended". */
  columnsHint: string;
  /** Optional one-time load of lookup data when the dialog opens. */
  prepare?: () => Promise<void>;
  /** Turn a parsed CSV grid into classified rows. */
  analyze: (grid: string[][]) => Promise<Row[]>;
  /** Bucket a row for the summary badges and the apply gate. */
  status: (row: Row) => RowStatus;
  /** Render one row, including any inline resolution controls. */
  renderRow: (row: Row, api: RowApi<Row>) => ReactNode;
  /** Commit all ready rows. Returns a count (+ optional message) for the toast. */
  apply: (
    readyRows: Row[],
    user: string
  ) => Promise<{ appliedCount: number; message?: string }>;
}

interface BulkUploadDialogProps<Row extends { key: string }> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adapter: BulkUploadAdapter<Row>;
  onApplied?: () => void;
}

/** Self-contained "Bulk Upload" button + dialog for list pages that just need a
 *  launcher and don't track dialog state themselves. */
export function BulkUploadButton<Row extends { key: string }>({
  adapter,
  label = "Bulk Upload",
  onApplied,
}: {
  adapter: BulkUploadAdapter<Row>;
  label?: string;
  onApplied?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        {label}
      </Button>
      <BulkUploadDialog
        open={open}
        onOpenChange={setOpen}
        adapter={adapter}
        onApplied={onApplied}
      />
    </>
  );
}

export function BulkUploadDialog<Row extends { key: string }>({
  open,
  onOpenChange,
  adapter,
  onApplied,
}: BulkUploadDialogProps<Row>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {open && (
          <BulkUploadBody
            adapter={adapter}
            onClose={() => onOpenChange(false)}
            onApplied={onApplied}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkUploadBody<Row extends { key: string }>({
  adapter,
  onClose,
  onApplied,
}: {
  adapter: BulkUploadAdapter<Row>;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(!adapter.prepare);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // One-time lookup load (attendees, members, chapters …) when the modal opens.
  useEffect(() => {
    if (!adapter.prepare) return;
    let cancelled = false;
    adapter
      .prepare()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        console.error("Bulk upload prepare failed", err);
        if (!cancelled) toast.error("Failed to load data for upload");
      });
    return () => {
      cancelled = true;
    };
    // adapter is constructed per-open by the caller; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api: RowApi<Row> = useMemo(
    () => ({
      updateRow: (key, patch) =>
        setRows((cur) =>
          cur.map((r) => (r.key === key ? { ...r, ...patch } : r))
        ),
      replaceRows: (updater) => setRows((cur) => updater(cur)),
    }),
    []
  );

  const handleFile = async (file: File) => {
    if (!ready) {
      toast.error("Still loading — try again in a moment");
      return;
    }
    setParsing(true);
    try {
      const text = await file.text();
      const grid = parseCSV(text);
      if (grid.length === 0) {
        toast.error("CSV is empty");
        return;
      }
      const analyzed = await adapter.analyze(grid);
      setRows(analyzed);
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse CSV");
    } finally {
      setParsing(false);
    }
  };

  const readyRows = rows.filter((r) => adapter.status(r) === "ready");
  const conflictRows = rows.filter((r) => adapter.status(r) === "conflict");
  const skippedRows = rows.filter((r) => adapter.status(r) === "skipped");

  const applyAll = async () => {
    if (readyRows.length === 0) {
      toast.message("No matched rows to apply");
      return;
    }
    setApplying(true);
    try {
      const { appliedCount, message } = await adapter.apply(
        readyRows,
        user?.email || ""
      );
      toast.success(
        message ??
          `Applied ${appliedCount} row${appliedCount === 1 ? "" : "s"}`
      );
      onApplied?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk apply failed");
    } finally {
      setApplying(false);
    }
  };

  const hasData = rows.length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{adapter.title}</DialogTitle>
        <DialogDescription>{adapter.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadCsv(adapter.templateFilename, adapter.templateCsv)}
          >
            <Download className="h-4 w-4 mr-1.5" />
            Download Template
          </Button>
          {hasData && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRows([])}
            >
              Clear & re-upload
            </Button>
          )}
        </div>

        {!hasData && (
          <label
            className={
              "flex flex-col items-center justify-center rounded-md border-2 border-dashed py-10 cursor-pointer transition " +
              (dragOver ? "bg-muted/50 border-primary" : "border-muted")
            }
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <Upload className="h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-sm font-medium">
              {parsing
                ? "Parsing..."
                : !ready
                  ? "Loading..."
                  : "Drop a CSV here or click to choose"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{adapter.columnsHint}</p>
          </label>
        )}

        {hasData && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <Badge
                variant="outline"
                className="border-green-200 text-green-700 bg-green-50 dark:bg-green-950/30"
              >
                <Check className="h-3 w-3 mr-1" />
                {readyRows.length} ready
              </Badge>
              {conflictRows.length > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950/30"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {conflictRows.length} need{conflictRows.length === 1 ? "s" : ""} resolution
                </Badge>
              )}
              {skippedRows.length > 0 && (
                <Badge variant="outline" className="text-muted-foreground">
                  {skippedRows.length} skipped
                </Badge>
              )}
            </div>

            <ScrollArea className="h-72 rounded-md border">
              <ul className="divide-y">
                {rows.map((row) => (
                  <li key={row.key}>{adapter.renderRow(row, api)}</li>
                ))}
              </ul>
            </ScrollArea>
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={applying}>
          Cancel
        </Button>
        <Button
          onClick={applyAll}
          disabled={!hasData || applying || readyRows.length === 0}
        >
          {applying
            ? "Applying..."
            : `Apply ${readyRows.length} row${readyRows.length === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </>
  );
}
