"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useIsNationalAdmin,
  useIsRegionAdmin,
  useUserChapter,
  useUserRegion,
} from "@/hooks/use-auth";
import { useChaptersMap } from "@/hooks/use-chapters-map";
import { stripChapterPrefix } from "@/lib/utils";

/** A scope encoded as one select value: "national" | "region:<name>" | "chapter:<id>". */
export function parseScope(value: string): { scopeType: string; scope: string | null } {
  if (value === "national") return { scopeType: "national", scope: null };
  const [scopeType, ...rest] = value.split(":");
  return { scopeType, scope: rest.join(":") };
}

export interface ViewScope {
  value: string;
  setValue: (value: string) => void;
  scopeType: string;
  scope: string | null;
  /** Human label for the current scope, e.g. "All PNAA chapters". */
  label: string;
  /** Only one possible scope (chapter admins), so there is nothing to pick. */
  fixed: boolean;
}

/**
 * The national / region / chapter scope shared by the admin member tools. The
 * options it offers are narrowed by role, but that is presentation only: the
 * RPCs re-check every requested scope server-side in resolve_view_scope().
 */
export function useViewScope(): ViewScope {
  const isNationalAdmin = useIsNationalAdmin();
  const isRegionAdmin = useIsRegionAdmin();
  const userChapter = useUserChapter();
  const userRegion = useUserRegion();
  const { nameFor } = useChaptersMap();

  // The caller's own scope until they pick another. Derived rather than seeded
  // into state, because the role resolves after first render.
  const [chosen, setChosen] = useState<string | null>(null);
  const fallback = isNationalAdmin
    ? "national"
    : isRegionAdmin && userRegion
      ? `region:${userRegion}`
      : userChapter
        ? `chapter:${userChapter}`
        : "national";
  const value = chosen ?? fallback;

  const setValue = useCallback((next: string) => setChosen(next), []);
  const { scopeType, scope } = parseScope(value);

  const label = useMemo(() => {
    if (scopeType === "national") return "All PNAA chapters";
    if (scopeType === "region") return scope ?? "Your region";
    return stripChapterPrefix(nameFor(scope, "Your chapter"));
  }, [scopeType, scope, nameFor]);

  return {
    value,
    setValue,
    scopeType,
    scope,
    label,
    fixed: !isNationalAdmin && !isRegionAdmin,
  };
}

export function ScopeSelect({ scope }: { scope: ViewScope }) {
  const isNationalAdmin = useIsNationalAdmin();
  const { canonical } = useChaptersMap();

  const regions = useMemo(
    () =>
      Array.from(
        new Set(canonical.map((c) => c.region).filter((r): r is string => !!r))
      ).sort(),
    [canonical]
  );
  const chapters = useMemo(
    () =>
      [...canonical]
        .filter((c) => c.id !== "national")
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [canonical]
  );

  // A chapter admin has exactly one answer, so show it instead of a picker.
  if (scope.fixed) {
    return <span className="text-sm font-medium">{scope.label}</span>;
  }

  return (
    <Select value={scope.value} onValueChange={scope.setValue}>
      <SelectTrigger className="h-9 w-[240px] text-sm">
        <SelectValue placeholder="Scope" />
      </SelectTrigger>
      <SelectContent>
        {isNationalAdmin && <SelectItem value="national">National</SelectItem>}
        {regions.length > 0 && (
          <SelectGroup>
            <SelectLabel>Regions</SelectLabel>
            {regions.map((r) => (
              <SelectItem key={r} value={`region:${r}`}>
                {r}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {chapters.length > 0 && (
          <SelectGroup>
            <SelectLabel>Chapters</SelectLabel>
            {chapters.map((c) => (
              <SelectItem key={c.id} value={`chapter:${c.id}`}>
                {stripChapterPrefix(c.name)}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
