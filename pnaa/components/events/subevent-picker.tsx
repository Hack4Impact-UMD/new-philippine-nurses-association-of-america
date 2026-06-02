"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useSubevents, invalidateSubevents } from "@/hooks/use-subevents";
import {
  addSubeventToEvent,
  removeSubeventFromEvent,
  reorderEventSubevents,
} from "@/lib/supabase/attendees";

interface SubeventPickerProps {
  /** When present, all mutations are committed via RPC immediately (edit mode). */
  eventId?: string;
  value: string[];
  onChange: (next: string[]) => void;
  user: string;
  disabled?: boolean;
}

export function SubeventPicker({
  eventId,
  value,
  onChange,
  user,
  disabled,
}: SubeventPickerProps) {
  const { all, byId, byNameLower, loading } = useSubevents();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const trimmed = query.trim();
  const trimmedLower = trimmed.toLowerCase();

  const suggestions = useMemo(() => {
    const selected = new Set(value);
    const lower = trimmedLower;
    return all
      .filter((s) => !s.archived && !selected.has(s.id))
      .filter((s) => (lower ? s.name.toLowerCase().includes(lower) : true))
      .slice(0, 8);
  }, [all, value, trimmedLower]);

  const exactMatch = trimmedLower ? byNameLower.get(trimmedLower) : undefined;
  const canCreateNew = trimmed.length > 0 && !exactMatch;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleAddExisting = async (id: string) => {
    if (value.includes(id)) return;
    setBusy(true);
    try {
      if (eventId) {
        const meta = byId.get(id);
        await addSubeventToEvent({
          eventId,
          name: meta?.name ?? "",
          user,
        });
        // RPC may have unarchived the catalog row — refresh names.
        invalidateSubevents();
      }
      onChange([...value, id]);
      setQuery("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add sub-event");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateNew = async () => {
    if (!trimmed) return;
    setBusy(true);
    try {
      let id: string;
      if (eventId) {
        id = await addSubeventToEvent({ eventId, name: trimmed, user });
        invalidateSubevents();
      } else {
        // Create-mode: insert into the catalog directly (RLS allows admins).
        // Case-insensitive uniqueness on the index means a duplicate raises;
        // fall back to looking it up if so.
        const supabase = getSupabaseBrowser();
        const { data, error } = await supabase
          .from("subevents")
          .insert({ name: trimmed })
          .select("id")
          .maybeSingle();
        if (error) {
          // Race / duplicate: re-read by name.
          const { data: existing } = await supabase
            .from("subevents")
            .select("id")
            .ilike("name", trimmed)
            .maybeSingle();
          if (!existing) throw error;
          id = (existing as { id: string }).id;
        } else {
          id = (data as { id: string }).id;
        }
        invalidateSubevents();
      }
      if (!value.includes(id)) onChange([...value, id]);
      setQuery("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create sub-event");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      if (eventId) {
        await removeSubeventFromEvent({ eventId, subeventId: id, user });
      }
      onChange(value.filter((v) => v !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove sub-event");
    } finally {
      setBusy(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = value.indexOf(String(active.id));
    const newIndex = value.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(value, oldIndex, newIndex);
    onChange(next);
    if (eventId) {
      try {
        await reorderEventSubevents({ eventId, subeventIds: next, user });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to reorder");
        onChange(value);
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? "Loading catalog..." : "Pick from existing or type a new name..."}
          disabled={disabled || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (exactMatch) handleAddExisting(exactMatch.id);
              else if (canCreateNew) handleCreateNew();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={exactMatch ? "Add existing sub-event" : "Create new sub-event"}
          disabled={disabled || busy || (!exactMatch && !canCreateNew)}
          onClick={() => {
            if (exactMatch) handleAddExisting(exactMatch.id);
            else if (canCreateNew) handleCreateNew();
          }}
          className="bg-blue-100 text-blue-700 hover:bg-blue-500 hover:text-white dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-500 dark:hover:text-white disabled:opacity-50 disabled:hover:bg-blue-100 disabled:hover:text-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {trimmed.length > 0 && suggestions.length > 0 && !exactMatch && (
        <div className="rounded-md border bg-popover p-1 text-sm">
          <p className="px-2 py-1 text-xs text-muted-foreground">Existing matches</p>
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-2 py-1.5 rounded hover:bg-muted"
              onClick={() => handleAddExisting(s.id)}
              disabled={disabled || busy}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No sub-events yet. Type a name and press Enter, or pick from existing.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {value.map((id) => {
                const meta = byId.get(id);
                return (
                  <SortableSubeventRow
                    key={id}
                    id={id}
                    name={meta?.name ?? "(unknown sub-event)"}
                    archived={meta?.archived}
                    disabled={disabled || busy}
                    onRemove={() => handleRemove(id)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableSubeventRow({
  id,
  name,
  archived,
  disabled,
  onRemove,
}: {
  id: string;
  name: string;
  archived?: boolean;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5"
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground touch-none cursor-grab"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm">
        {name}
        {archived && (
          <span className="ml-2 text-xs text-muted-foreground">(archived)</span>
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove sub-event"
      >
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}
