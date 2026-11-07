import type { ReactNode } from "react";
import { ShieldCheckIcon } from "lucide-react";

import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function TwoStepShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheckIcon className="size-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {children}
          <form action={signOut} className="text-center">
            <Button type="submit" variant="link" size="sm">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
