import { SubchapterForm } from "@/components/subchapters/subchapter-form";
import { PageHeader } from "@/components/shared/page-header";

export default async function EditSubchapterPage({
  params,
}: {
  params: Promise<{ chapterId: string; subchapterId: string }>;
}) {
  const { chapterId, subchapterId } = await params;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Edit Subchapter"
        description="Update this subchapter's details"
      />
      <SubchapterForm
        chapterId={chapterId}
        subchapterId={subchapterId}
        mode="edit"
      />
    </div>
  );
}
