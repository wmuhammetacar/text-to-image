"use client";

import React from "react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function ReturningSessionCard(props: {
  generationId: string;
  activeRunState: string;
  unfinished: boolean;
  onContinue: () => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Kaldığın yerden devam et</CardTitle>
        <CardDescription>
          Son generation kaydın hazır. Tek tıkla devam edebilirsin.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={props.onContinue}
        >
          {props.unfinished ? "Unfinished generationı devam ettir" : "Son generationı aç"}
        </Button>
        <span className="text-xs text-muted-foreground">
          run_state: {props.activeRunState} · id: {props.generationId}
        </span>
      </CardContent>
    </Card>
  );
}
