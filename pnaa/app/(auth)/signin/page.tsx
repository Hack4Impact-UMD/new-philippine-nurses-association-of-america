"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

function SignInContent() {
  const { signIn } = useAuth();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-2xl font-bold">
            P
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PNAA</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Philippine Nurses Association of America
            </p>
            <p className="text-muted-foreground text-xs mt-0.5">
              Chapter Management Platform
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive text-center">
              {error === "auth_failed"
                ? "Authentication failed. Please try again."
                : error === "invalid_state"
                  ? "Invalid session. Please try again."
                  : "An error occurred. Please try again."}
            </div>
          )}
          <Button onClick={signIn} className="w-full" size="lg">
            Sign in with Wild Apricot
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Use your Wild Apricot credentials to access the platform
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
