"use client";

import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const BrowserDemo = dynamic(() => import("./browser-demo"), {
  ssr: false,
  loading: () => (
    <Card className="w-full min-w-0 bg-muted/30">
      <CardHeader>
        <CardTitle>Try compress in browser</CardTitle>
        <CardDescription>PNG, JPEG, and WebP through the shared Smartu strategy.</CardDescription>
        <CardAction>
          <Badge variant="secondary">Loading</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Preparing browser runtime
        </div>
      </CardContent>
    </Card>
  ),
});

export default function BrowserDemoShell() {
  return <BrowserDemo />;
}
