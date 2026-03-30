import Link from "next/link";
import { PublicGalleryView } from "../../components/gallery/public-gallery-view";
import { buttonVariants } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

export default function GalleryPage(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 md:px-6">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Pixora Public Gallery</CardTitle>
          <CardDescription>
            Public paylaşıma açılan üretimler burada keşfedilir. Unlisted kayıtlar sadece share bağlantısıyla açılır.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Uygulamaya dön
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "default" })}>
            Giriş yap
          </Link>
        </CardContent>
      </Card>

      <PublicGalleryView />
    </div>
  );
}
