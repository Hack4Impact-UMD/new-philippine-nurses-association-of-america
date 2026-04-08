"use client";

import { useState, useMemo } from "react";

//using recharts for the stacked bar chart
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

import type { Chapter } from "@/types/chapter";
//incorporating chapter aliases
import type { ChapterAlias } from "@/types/chapter-alias";

//using chapter names and/or chapter aliases
interface MembershipTrendsGraphProps{
  chapters: (Chapter & { id: string })[];
  aliases: ChapterAlias[];
}

//sortable by membership status and region of chapter
type ViewOption = "total" | "active" | "lapsed";
type FilterOption = "all" | "Eastern Region" | "Western Region" | "North Central Region" | "South Central Region" | "Other";

export function MembershipTrendsGraph({ chapters, aliases }: MembershipTrendsGraphProps) {
  const [viewBy, setViewBy] = useState<ViewOption>("total");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");

  //mapping aliases to chapter names
  const aliasMap = useMemo(() => {
    const map: Record<string, string> = {};
  
    aliases.forEach((alias) => {
      if (alias.chapterId) {
        map[alias.chapterId] = alias.aliasName;
      }
    });
  
    return map;
  }, [aliases]);

  //normalizing region names and chapter names/aliases for better display
  const chartData = chapters.map(ch => {
    const rawRegion = ch.region ?? "None";

    const normalizedRegion =
    rawRegion === "None" || rawRegion === "Unknown" ? "Other" : rawRegion;

    return {
      chapter: (aliasMap[ch.id]|| ch.name).replace(/^PNA\s*/, "").replace(/\s*PNAC\d+\s*/i, ""),
      total: ch.totalMembers ?? 0,
      active: ch.totalActive ?? 0,
      lapsed: ch.totalLapsed ?? 0,
      region: normalizedRegion,
    }
  });

  const isAllRegions = filterBy === "all";

  //aggregating counts by region
  const regionData = Object.values(
    chartData.reduce((acc, curr) => {
      const regionKey = curr.region;

      if (!acc[regionKey]) {
        acc[regionKey] = {
          region: regionKey,
          total: 0,
          active: 0,
          lapsed: 0,
        };
      }
  
      acc[regionKey].total += curr.total;
      acc[regionKey].active += curr.active;
      acc[regionKey].lapsed += curr.lapsed;
  
      return acc;
    }, {} as Record<string, { region: string; total: number; active: number; lapsed: number }>)
  );

  //putting "Other" to rightmost for visual purposes
  const sortedRegionData = regionData.sort((a, b) => {
    if (a.region === "Other") return 1;
    if(b.region === "Other") return -1;
    return a.region.localeCompare(b.region);
  })

  const viewLabel = {
    total: "Total Members",
    active: "Active Members",
    lapsed: "Lapsed Members",
  };

  //adjusting data to be displayed, region aggregate vs individual chapter data
  const displayData = isAllRegions
  ? sortedRegionData.map((r) => ({
      chapter: r.region, 
      total: r.total,
      active: r.active,
      lapsed: r.lapsed,
  }))
  : chartData.filter((d) => d.region === filterBy)

  //truncating x-axis labels to help with spacing
  const truncate = (str: string, max: number) => {
    return str.length > max ? str.slice(0, max) + "..." : str;
  };

  //custom x-axis tick to incorporate truncation + full title on hover
  const CustomXAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const fullText = payload.value;
  
    const maxLength = isAllRegions ? 20 : 12;
    const truncated =
      fullText.length > maxLength
        ? fullText.slice(0, maxLength) + "..."
        : fullText;
  
    return (
      <g transform={`translate(${x}, ${y})`}>
        <title>{fullText}</title>
        <text
          x={0}
          y={0}
          dy={16}
          textAnchor={isAllRegions ? "middle" : "end"}
          fill="#6b7280"
          fontSize={12}
          transform={isAllRegions ? "rotate(0)" : "rotate(-50)"}
        >
          {truncated}
        </text>
      </g>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-large">
      PNAA Membership: {viewLabel[viewBy]} — {isAllRegions ? "By Region" : filterBy}
      </CardTitle>

        <div className="flex gap-2">
          <Select value={viewBy} onValueChange={(value) => setViewBy(value as ViewOption)}>
            <SelectTrigger className="w-[160px] text-sm">
              <SelectValue placeholder="View" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="total">Total Members</SelectItem>
              <SelectItem value="active">Active Members</SelectItem>
              <SelectItem value="lapsed">Lapsed Members</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterBy} onValueChange={(value) => setFilterBy(value as FilterOption)}>
            <SelectTrigger className="w-[140px] text-sm">
              <SelectValue placeholder="Filter region" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Regions</SelectItem>
              <SelectItem value="Eastern Region">East</SelectItem>
              <SelectItem value="Western Region">West</SelectItem>
              <SelectItem value="North Central Region">North</SelectItem>
              <SelectItem value="South Central Region">South</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={displayData}
            barCategoryGap="30%"
            barGap={4}
            margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="chapter"
              tick={<CustomXAxisTick />}
              interval={0}
              height={isAllRegions ? 40 : 120}
              className="text-muted-foreground"
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip 
              cursor={{ fill: "transparent" }}
              shared={false}
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                fontSize: "12px",
              }}
              labelStyle={{ fontWeight: 500 }}
            />
            <Legend 
              verticalAlign="middle" 
              align="right"
              layout="vertical"
              height={36}
              wrapperStyle= {{ right: 10,
              top: 20,
              backgroundColor:"rgba(255, 255,255, 0.7)",
              padding: "6px 8px",
              borderRadius: "8px",
              fontSize: "11px"}}/>
            {viewBy === "total" && (
              <>
                <Bar
                  dataKey="active"
                  stackId="a"
                  fill="#1e40af"
                  name="Active Members"
                />
                <Bar
                  dataKey="lapsed"
                  stackId="a"
                  fill="#60a5fa"
                  name="Lapsed Members"
                />
              </>
            )}

            {viewBy === "active" && (
              <Bar
                dataKey="active"
                fill="#1e40af"
                name="Active Members"
              />
            )}

            {viewBy === "lapsed" && (
              <Bar
                dataKey="lapsed"
                fill="#60a5fa"
                name="Lapsed Members"
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}