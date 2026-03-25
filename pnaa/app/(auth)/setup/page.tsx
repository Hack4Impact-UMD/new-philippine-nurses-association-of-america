"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthContext } from "@/lib/auth/context";
import { useCollection } from "@/hooks/use-firestore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Chapter } from "@/types/chapter";

export default function SetupPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthContext();
  const { data: chapters, loading: chaptersLoading } =
    useCollection<Chapter>("chapters");

  const [region, setRegion] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if user doesn't need onboarding
  useEffect(() => {
    if (!authLoading && user && !user.needsOnboarding) {
      router.replace("/dashboard");
    }
    if (!authLoading && !user) {
      router.replace("/signin");
    }
  }, [authLoading, user, router]);

  const regions = useMemo(
    () =>
      [
        ...new Set(chapters.map((c) => c.region).filter(Boolean)),
      ].sort() as string[],
    [chapters]
  );

  const filteredChapters = useMemo(
    () =>
      chapters
        .filter((c) => c.region === region)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [chapters, region]
  );

  const handleRegionChange = (value: string) => {
    setRegion(value);
    setChapterName("");
  };

  const handleSubmit = async () => {
    if (!region || !chapterName) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterName, region }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      // Force a full page load so auth context re-reads the updated user doc
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  };

  if (authLoading || !user?.needsOnboarding) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome to PNAA
          </h1>
          <p className="text-muted-foreground">
            Select your region and chapter to get started.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="region">Region</Label>
            <Select
              value={region}
              onValueChange={handleRegionChange}
              disabled={chaptersLoading}
            >
              <SelectTrigger id="region" className="w-full">
                <SelectValue
                  placeholder={
                    chaptersLoading ? "Loading..." : "Select your region..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {regions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {region && (
            <div className="space-y-1.5">
              <Label htmlFor="chapter">Chapter</Label>
              <Select value={chapterName} onValueChange={setChapterName}>
                <SelectTrigger id="chapter" className="w-full">
                  <SelectValue placeholder="Select your chapter..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredChapters.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filteredChapters.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No chapters found for this region.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!region || !chapterName || saving}
          >
            {saving ? "Saving..." : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
