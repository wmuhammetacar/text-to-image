import { HistoryList } from "../../../components/history/history-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export default function HistoryPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Geçmiş</CardTitle>
          <CardDescription>
            generation_id, active_run_state, total_runs ve thumbnail bilgileri listelenir.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Liste cursor pagination ile yüklenir.
        </CardContent>
      </Card>

      <HistoryList />
    </div>
  );
}
