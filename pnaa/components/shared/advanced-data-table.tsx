"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import ExcelJS from "exceljs";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type RowSelectionState,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type ColumnSizingState,
  type Header,
  type FilterFn,
} from "@tanstack/react-table";
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "./empty-state";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Download,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Settings2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NumericFilterValue {
  op: ">" | ">=" | "<" | "<=" | "==" | "!=";
  value: number | "";
}

export interface ColumnMeta {
  filterType?: "text" | "select" | "numeric";
  filterOptions?: { label: string; value: string }[];
}

export type { ColumnDef };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const numericFilterFn: FilterFn<any> = (
  row,
  columnId,
  filterValue: NumericFilterValue,
) => {
  if (
    !filterValue ||
    filterValue.value === "" ||
    filterValue.value === undefined
  )
    return true;
  const rowValue = row.getValue<number>(columnId);
  const num = Number(filterValue.value);
  if (isNaN(num)) return true;
  switch (filterValue.op) {
    case ">":
      return rowValue > num;
    case ">=":
      return rowValue >= num;
    case "<":
      return rowValue < num;
    case "<=":
      return rowValue <= num;
    case "==":
      return rowValue === num;
    case "!=":
      return rowValue !== num;
    default:
      return true;
  }
};
numericFilterFn.autoRemove = (val: NumericFilterValue) =>
  !val || val.value === "" || val.value === undefined;

const NUMERIC_OPS = [">", ">=", "<", "<=", "==", "!="] as const;

interface AdvancedDataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  onRowClick?: (item: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  defaultPageSize?: number;
  globalFilter?: string;
  enableSelection?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  defaultColumnFilters?: ColumnFiltersState;
  exportFilename?: string;
  getRowId?: (row: T) => string;
}

// Using `any` for the header generic to avoid JSX generic syntax issues in .tsx
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DraggableHeaderCell({ header }: { header: Header<any, unknown> }) {
  const { attributes, isDragging, listeners, setNodeRef, transform } =
    useSortable({ id: header.column.id });

  // Only the select column is not draggable (fixed to the far left)
  if (header.column.id === "select") {
    return (
      <TableHead
        style={{ width: header.getSize(), minWidth: header.getSize() }}
        className="px-3"
      >
        {flexRender(header.column.columnDef.header, header.getContext())}
      </TableHead>
    );
  }

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? "none" : "transform 0.15s ease",
    opacity: isDragging ? 0.75 : 1,
    position: "relative",
    zIndex: isDragging ? 10 : 0,
    width: header.getSize(),
    minWidth: header.getSize(),
  };

  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
  const canFilter = !!meta?.filterType;
  const currentFilter = header.column.getFilterValue() as
    | string
    | NumericFilterValue
    | undefined;

  const isFiltered = (() => {
    if (currentFilter === undefined || currentFilter === null) return false;
    if (typeof currentFilter === "object") {
      return (
        (currentFilter as NumericFilterValue).value !== "" &&
        (currentFilter as NumericFilterValue).value !== undefined
      );
    }
    return currentFilter !== "";
  })();

  const canSort = header.column.getCanSort();
  const sortDir = header.column.getIsSorted();

  const numFilter = currentFilter as NumericFilterValue | undefined;
  const currentOp = numFilter?.op ?? ">";
  const currentNumValue = numFilter?.value ?? "";

  return (
    <TableHead ref={setNodeRef} style={style} className="select-none group">
      {/*
        DND listeners live on the content div, NOT on a separate grip icon.
        - The resize handle is a sibling div, so its events never reach this div → no drag/resize conflict.
        - activationConstraint: { distance: 6 } means quick clicks still fire sort/filter; only
          a real drag (6px+ movement) activates column reorder.
      */}
      <div
        {...attributes}
        {...listeners}
        className="flex items-center cursor-grab active:cursor-grabbing"
      >
        {/* Column label + sort */}
        {canSort ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-1 h-7 px-1 gap-1 font-medium text-xs"
            onClick={() => header.column.toggleSorting(sortDir === "asc")}
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
            {sortDir === "asc" ? (
              <ArrowUp className="h-3 w-3 text-primary" />
            ) : sortDir === "desc" ? (
              <ArrowDown className="h-3 w-3 text-primary" />
            ) : (
              <ArrowUpDown className="h-3 w-3 opacity-30" />
            )}
          </Button>
        ) : (
          <span className="text-xs font-medium">
            {flexRender(header.column.columnDef.header, header.getContext())}
          </span>
        )}

        {/* Column filter popover */}
        {canFilter && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6 ml-0.5 shrink-0 transition-opacity",
                  isFiltered
                    ? "text-primary opacity-100"
                    : "opacity-0 group-hover:opacity-60 text-muted-foreground",
                )}
              >
                <Filter className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="start">
              <p className="text-xs font-semibold mb-2 text-muted-foreground">
                Filter: {String(header.column.columnDef.header)}
              </p>

              {meta?.filterType === "numeric" ? (
                <div className="space-y-2">
                  <Select
                    value={currentOp}
                    onValueChange={(op) =>
                      header.column.setFilterValue({
                        op: op as NumericFilterValue["op"],
                        value: currentNumValue,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NUMERIC_OPS.map((op) => (
                        <SelectItem
                          key={op}
                          value={op}
                          className="text-xs font-mono"
                        >
                          {op}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      placeholder="Value..."
                      value={String(currentNumValue)}
                      onChange={(e) =>
                        header.column.setFilterValue({
                          op: currentOp,
                          value:
                            e.target.value === "" ? "" : Number(e.target.value),
                        })
                      }
                    />
                    {isFiltered && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => header.column.setFilterValue(undefined)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : meta?.filterType === "select" && meta.filterOptions ? (
                <Select
                  value={(currentFilter as string) ?? ""}
                  onValueChange={(v) =>
                    header.column.setFilterValue(
                      v === "__all__" ? undefined : v,
                    )
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All</SelectItem>
                    {meta.filterOptions.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        className="text-xs"
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex gap-1">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Filter value..."
                    value={(currentFilter as string) ?? ""}
                    onChange={(e) =>
                      header.column.setFilterValue(e.target.value || undefined)
                    }
                  />
                  {isFiltered && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => header.column.setFilterValue(undefined)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Column resize handle */}
      <div
        onMouseDown={header.getResizeHandler()}
        onTouchStart={header.getResizeHandler()}
        className={cn(
          "absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "bg-border hover:bg-primary/50",
          header.column.getIsResizing() && "bg-primary opacity-100",
        )}
      />
    </TableHead>
  );
}

export function AdvancedDataTable<T extends object>({
  columns,
  data,
  loading,
  onRowClick,
  emptyTitle = "No data found",
  getRowId,
  emptyDescription,
  emptyIcon,
  defaultPageSize = 15,
  globalFilter = "",
  enableSelection = true,
  onSelectionChange,
  defaultColumnFilters,
  exportFilename = "export",
}: AdvancedDataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    defaultColumnFilters ?? [],
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // The checkbox column, defined here to be defined by Tanstack ColumnDef
  // so that is aware when the rows are reordered.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectionColumn: ColumnDef<any, unknown> = {
    id: "select",
    size: 44,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    header: ({ table }) => (
      //checkbox value differs based on whether all or none of rows selected
      <Checkbox
        checked={
          table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? "indeterminate"
              : false
        }
        //select all rows currently filtered.
        onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
        aria-label="Select all filtered rows"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Select row"
      />
    ),
  };

  //Add the selection column at start only if selection is enabled
  if (enableSelection) {
    columns = [selectionColumn, ...columns];
  }

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    return columns
      .map((col) => {
        if ("accessorKey" in col) return col.accessorKey as string;
        if ("id" in col && col.id) return col.id;
        return "";
      })
      .filter(Boolean);
  });
  // Automatically inject numericFilterFn for columns with filterType: "numeric"
  const processedColumns = useMemo(
    () =>
      columns.map((col) => {
        const meta = col.meta as ColumnMeta | undefined;
        if (meta?.filterType === "numeric") {
          return { ...col, filterFn: numericFilterFn };
        }
        return col;
      }),
    [columns],
  );

  const table = useReactTable({
    data,
    columns: processedColumns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      columnSizing,
      globalFilter,
      rowSelection,
    },
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    enableRowSelection: enableSelection ?? true,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => {
      if (getRowId) return getRowId(row);
      const id = (row as { id?: string | number }).id;
      if (id !== undefined && id !== null) return String(id);
      // fallback if no id is available; avoid [object Object]
      if (typeof row === "object" && row !== null) {
        try {
          return JSON.stringify(row);
        } catch {
          // as last resort
          return String(row);
        }
      }
      return String(row);
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: defaultPageSize } },
    globalFilterFn: "includesString",
  });

  // Lift selected rows to parent whenever selection changes
  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange(table.getSelectedRowModel().rows.map((r) => r.original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setColumnOrder((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  // Returns headers and rows for export and mapping status "false" to "active" and "true" to "archived"
  const buildExportData = useCallback(() => {
    const exportColumns = table
      .getAllColumns()
      .filter((col) => {
        const h = col.columnDef.header ?? col.id;
        return col.id !== "select" && col.getIsVisible() && typeof h === "string" && h !== "";
      });

    const headers = exportColumns.map((col) =>
      (col.columnDef.header ?? col.id) as string,
    );

    const rows = table.getSelectedRowModel().rows.map((row) =>
      exportColumns.map((col) => {
        const val = row.getValue(col.id);
        const headerText = (col.columnDef.header ?? col.id) as string;
        if (headerText.toLowerCase() === "status") {
          if (String(val) === "false") return "active";
          else if (String(val) === "true") return "archived";
          else return "";
        }
        return val == null ? "" : val;
      }),
    );

    return { exportColumns, headers, rows };
  }, [table]);

  const exportToCSV = useCallback(() => {
    //format value for CSV, escaping quotes and wrapping in quotes if contains comma/newline
    const csvEscape = (value: string): string => {
      const escaped = value.replace(/"/g, '""');
      const needsQuotes = /^[,"\n=+\-@\t\r]/.test(value);
      return needsQuotes ? `"${escaped}"` : escaped;
    };

    //gets the currently visible columns and rows. Format for export
    const { exportColumns, headers, rows } = buildExportData();

    if (exportColumns.length === 0) {
      console.warn("No visible columns to export to CSV");
      return;
    }

    const escapedHeaders = headers.map(csvEscape);
    const escapedRows = rows.map((row) =>
      row.map((val) => csvEscape(String(val))),
    );

    //create csv file and trigger download
    const csv = [escapedHeaders, ...escapedRows]
      .map((r) => r.join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFilename}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, [buildExportData, exportFilename]);


  //export to an xlsx format (for excel)
  const exportToXLSX = useCallback(async () => {
    const { exportColumns, headers, rows } = buildExportData();

    if (exportColumns.length === 0) {
      console.warn("No visible columns to export to XLSX");
      return;
    }

    //ExcelJS mimics using excel: creating workbook, worksheet, and table
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(exportFilename);
    worksheet.addTable({
      name: `${exportFilename}Table`,
      ref: "A1",
      headerRow: true,
      totalsRow: false,
      style: {
        //styling matches the current app theme closely.
        theme: "TableStyleLight9",
        showRowStripes: true,
      },
      columns: headers.map((h) => ({ name: h, filterButton: true })),
      rows: rows as ExcelJS.CellValue[][],
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFilename}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, [buildExportData, exportFilename]);

  const activeFilters = columnFilters.filter((f) => {
    if (f.value === undefined || f.value === null) return false;
    if (typeof f.value === "object" && "op" in (f.value as object)) {
      return (
        (f.value as NumericFilterValue).value !== "" &&
        (f.value as NumericFilterValue).value !== undefined
      );
    }
    return f.value !== "";
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const visibleExportColumnCount = table
    .getAllColumns()
    .filter((col) => col.id !== "select" && col.getIsVisible()).length;

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* Table toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* Active filter chips + selection count */}
        <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
          {enableSelection && selectedCount > 0 ? (
            <>
              <span className="text-xs text-muted-foreground">
                {selectedCount} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground px-2"
                onClick={() => setRowSelection({})}
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            </>
          ) : activeFilters.length > 0 ? (
            <>
              {activeFilters.map((filter) => {
                const col = table.getColumn(filter.id);
                const header = col?.columnDef.header;
                const fv = filter.value;
                const displayValue =
                  typeof fv === "object" &&
                  fv !== null &&
                  "op" in (fv as object)
                    ? `${(fv as NumericFilterValue).op} ${(fv as NumericFilterValue).value}`
                    : String(fv);
                return (
                  <Badge
                    key={filter.id}
                    variant="outline"
                    className="gap-1 pr-1 text-xs h-6 bg-muted/40 text-muted-foreground border-border/60"
                  >
                    <span className="text-muted-foreground">
                      {String(header ?? filter.id)}:
                    </span>
                    {displayValue}
                    <button
                      onClick={() => col?.setFilterValue(undefined)}
                      className="ml-0.5 rounded hover:bg-muted-foreground/20 p-0.5 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground px-2"
                onClick={() => setColumnFilters([])}
              >
                <X className="h-3 w-3" />
                Clear all
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {filteredCount !== totalCount
                ? `${filteredCount} of ${totalCount} results`
                : `${totalCount} result${totalCount !== 1 ? "s" : ""}`}
            </span>
          )}
        </div>

        {/* Right-side actions */}

        <div className="flex items-center gap-2">
          {enableSelection && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  disabled={
                    selectedCount === 0 || visibleExportColumnCount === 0
                  }
                  aria-label="Export selected rows"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-3" align="start">
                <p className="text-xs font-semibold mb-2 text-muted-foreground">
                  Export selected rows and visible columns
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-xs gap-1.5 mt-1"
                  onClick={() => exportToXLSX()}
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel file
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-xs gap-1.5 mt-1"
                  onClick={() => exportToCSV()}
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV file
                </Button>
              </PopoverContent>
            </Popover>
          )}
          {/* Column visibility toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 text-xs"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs py-1.5">
                Toggle Columns
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((col) => col.getCanHide())
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    className="text-xs"
                    checked={col.getIsVisible()}
                    onCheckedChange={(v) => col.toggleVisibility(!!v)}
                  >
                    {String(col.columnDef.header ?? col.id)}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table — outer div clips border-radius; scroll is handled by Table's internal container */}
      <div className="rounded-lg border overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={columnOrder}
            strategy={horizontalListSortingStrategy}
          >
            <Table
              style={{
                width: table.getCenterTotalSize(),
                minWidth: "100%",
              }}
            >
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="hover:bg-transparent border-b"
                  >
                    {headerGroup.headers.map((header) => (
                      <DraggableHeaderCell key={header.id} header={header} />
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground text-sm"
                    >
                      No results match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() => onRowClick?.(row.original)}
                      className={cn(
                        "transition-colors",
                        onRowClick && "cursor-pointer hover:bg-muted/40",
                        row.getIsSelected() && "bg-muted/30",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          style={{ width: cell.column.getSize() }}
                          className="py-2.5"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </SortableContext>
        </DndContext>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Rows per page
          </span>
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(v) => {
              table.setPageSize(Number(v));
              table.setPageIndex(0);
            }}
          >
            <SelectTrigger className="h-7 w-[70px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 15, 25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeFilters.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {filteredCount} of {totalCount}
            </span>
          )}
        </div>

        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground px-2 whitespace-nowrap">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
