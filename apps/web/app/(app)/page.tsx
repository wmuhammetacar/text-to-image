import { GeneratorForm } from "../../components/generator/generator-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

export default function DashboardPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Visual Director</CardTitle>
          <CardDescription>
            Metni girin, sistem intent + emotion analizi ile visual_plan oluşturup çoklu varyant üretsin.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Üretim asenkron ilerler. Submit sonrası generation detail ekranında polling ile run durumu izlenir.
        </CardContent>
      </Card>

      <GeneratorForm />
    </div>
  );
}
