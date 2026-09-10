"use client";

import Link from "next/link";
import { LifeBuoy, Mail, Phone, Clock, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPPORT_CONTACT, telHref } from "@/lib/support";

/**
 * Help box for the chapter dashboard. Chapter admins and members can't reach
 * the national office through the app anywhere else, so this is their one
 * escalation path for data that looks wrong.
 */
export function SupportCard() {
  const { email, phone, hours } = SUPPORT_CONTACT;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
            <LifeBuoy className="h-4 w-4" />
          </span>
          Help &amp; Support
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Questions about your chapter&apos;s members, events, or fundraising
          totals? The PNAA national office can help.
        </p>

        <div className="space-y-2 text-sm">
          {email && (
            <a
              href={`mailto:${email}`}
              className="flex items-center gap-2.5 rounded-md border p-2.5 transition-colors hover:bg-muted/50"
            >
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{email}</span>
            </a>
          )}

          {phone && (
            <a
              href={telHref(phone)}
              className="flex items-center gap-2.5 rounded-md border p-2.5 transition-colors hover:bg-muted/50"
            >
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{phone}</span>
            </a>
          )}

          {hours && (
            <p className="flex items-center gap-2.5 px-2.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {hours}
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Member and event records sync from Wild Apricot overnight, so a change
          made there can take a day to appear here.
        </p>

        <Link
          href="/about"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Info className="h-3.5 w-3.5" />
          About PNAA
        </Link>
      </CardContent>
    </Card>
  );
}
