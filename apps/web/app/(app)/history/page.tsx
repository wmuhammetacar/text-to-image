import { HistoryList } from "../../../components/history/history-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export default function HistoryPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Geçmiş</CardTitle>
          <CardDescription>
            Son üretimlerin, durumların ve önizlemelerin tek listesi.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Yeni kayıtlar yukarıdan akmaya devam eder.
        </CardContent>
      </Card>

      <HistoryList />
    </div>
  );
}
