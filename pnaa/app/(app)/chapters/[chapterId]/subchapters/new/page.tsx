import { SubchapterForm } from "@/components/subchapters/subchapter-form";
import { PageHeader } from "@/components/shared/page-header";

export default async function NewSubchapterPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Create Subchapter"
        description="Add a new subchapter to this chapter"
      />
      <SubchapterForm chapterId={chapterId} mode="create" />
    </div>
  );
}
