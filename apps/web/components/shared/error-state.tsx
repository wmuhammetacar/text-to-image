import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function ErrorState(props: {
  title?: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <Card className="border-danger/30 bg-danger/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-danger">
          <AlertTriangle className="h-4 w-4" />
          {props.title ?? "Bir hata oluştu"}
        </CardTitle>
        <CardDescription className="text-foreground/80">{props.description}</CardDescription>
      </CardHeader>
      {props.onAction !== undefined ? (
        <CardContent>
          <Button variant="danger" size="sm" onClick={props.onAction}>
            {props.actionLabel ?? "Tekrar dene"}
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
