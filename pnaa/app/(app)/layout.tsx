import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { OnboardingGuard } from "@/components/auth/onboarding-guard";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OnboardingGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <Header />
          <main className="flex-1 p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </OnboardingGuard>
  );
}
