"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, Calendar, DollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface StatsData {
  totalMembers: number;
  activeMembers: number;
  lapsedMembers: number;
  totalChapters: number;
  upcomingEvents: number;
  totalFundraised: number;
}

export function StatsCards({ stats }: { stats: StatsData }) {
  const cards = [
    {
      title: "Total Members",
      value: stats.totalMembers.toLocaleString(),
      subtitle: `${stats.activeMembers} active · ${stats.lapsedMembers} lapsed`,
      icon: Users,
    },
    {
      title: "Active Chapters",
      value: stats.totalChapters.toString(),
      subtitle: "Across the U.S.",
      icon: Building2,
    },
    {
      title: "Upcoming Events",
      value: stats.upcomingEvents.toString(),
      subtitle: "Scheduled events",
      icon: Calendar,
    },
    {
      title: "Total Fundraised",
      value: formatCurrency(stats.totalFundraised),
      subtitle: "All campaigns",
      icon: DollarSign,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {card.subtitle}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}