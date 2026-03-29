import { GenerationDetailView } from "../../../../components/generator/generation-detail-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GenerationDetailPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return <GenerationDetailView generationId={id} />;
}
