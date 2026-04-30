"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, HandHelping, Clock, UserCheck, Heart, CircleDollarSign } from "lucide-react";
import { useIsNationalAdmin } from "@/hooks/use-auth";
import type { AppEvent } from "@/types/event";

const baseMetricConfig = [
  { key: "totalRevenue" as const, label: "Total Revenue", icon: CircleDollarSign, nationalAdminOnly: true },
  { key: "attendees" as const, label: "Attendees", icon: Users },
  { key: "volunteers" as const, label: "Volunteers", icon: HandHelping },

  { key: "contactHours" as const, label: "Contact Hours", icon: Clock },
  {
    key: "volunteerHours" as const,
    label: "Volunteer Hours",
    icon: UserCheck,
  },
];

export function EventMetrics({ event }: { event: AppEvent }) {
  const isNationalAdmin = useIsNationalAdmin();
  const metricConfig = baseMetricConfig.filter(
    (m) => !m.nationalAdminOnly || isNationalAdmin
  );
  const hasMetrics = metricConfig.some((m) => event[m.key] > 0);

  if (!hasMetrics && event.source === "wildapricot") {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No metrics reported yet — Edit to add event metrics
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Event Metrics</h3>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {metricConfig.map((metric) => (
          <Card key={metric.key}>
            <CardContent className="pt-4 pb-4 flex flex-col items-center text-center">
              <metric.icon className="h-5 w-5 text-primary mb-2" />
              <span className="text-2xl font-bold">
                {metric.key === "totalRevenue"
                  ? `$${(event[metric.key] ?? 0).toLocaleString("en-US")}`
                  : (event[metric.key] ?? 0)}
              </span>
              <span className="text-xs text-muted-foreground mt-1">
                {metric.label}
              </span>            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
