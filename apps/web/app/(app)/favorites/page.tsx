import { FavoritesList } from "../../../components/favorites/favorites-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

export default function FavoritesPage(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Favoriler</CardTitle>
          <CardDescription>
            Kaydettiğin kareleri tek yerden yönet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Favori kareleri yeniden açıp varyasyon üretmeye devam edebilirsin.
        </CardContent>
      </Card>

      <FavoritesList />
    </div>
  );
}
