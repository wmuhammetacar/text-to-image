import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function EmptyState(props: {
  title: string;
  description: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      {props.action !== undefined ? <CardContent>{props.action}</CardContent> : null}
    </Card>
  );
}
