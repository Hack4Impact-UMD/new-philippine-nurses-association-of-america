"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Building2,
  DollarSign,
  Info,
  LogOut,
  ChevronLeft,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth, useIsNationalAdmin } from "@/hooks/use-auth";

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Events", href: "/events", icon: Calendar },
  { title: "Chapters", href: "/chapters", icon: Building2 },
  { title: "Fundraising", href: "/fundraising", icon: DollarSign },
  { title: "About", href: "/about", icon: Info },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const isNationalAdmin = useIsNationalAdmin();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  const roleBadge =
    user?.role === "national_admin"
      ? "National Admin"
      : user?.role === "region_admin"
        ? "Region Admin"
        : user?.role === "chapter_admin"
          ? "Chapter Admin"
          : "Member";

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm">
            P
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span className="font-semibold text-sm">PNAA</span>
              <span className="text-xs text-sidebar-foreground/70">
                Chapter Management
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <Separator className="bg-sidebar-border" />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href));

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isNationalAdmin && (
          <SidebarGroup>
            <Separator className="bg-sidebar-border mb-2" />
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith("/users")}
                    tooltip="User Management"
                  >
                    <Link href="/users">
                      <Users className="h-4 w-4" />
                      <span>User Management</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <Separator className="mb-4 bg-sidebar-border" />
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!isCollapsed && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <span className="truncate text-sm font-medium">
                {user?.displayName || "User"}
              </span>
              <Badge
                variant="secondary"
                className="w-fit text-[10px] px-1.5 py-0"
              >
                {roleBadge}
              </Badge>
            </div>
          )}
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
