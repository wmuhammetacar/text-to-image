import { FavoritesList } from "../../../components/favorites/favorites-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export default function FavoritesPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Favoriler</CardTitle>
          <CardDescription>
            Favoriler ekranı mevcut API sözleşmesiyle uyumlu çalışır. Route hazır değilse local fallback devam eder.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          signed_url değerleri yalnız generation detail response üzerinden okunur.
        </CardContent>
      </Card>

      <FavoritesList />
    </div>
  );
}
