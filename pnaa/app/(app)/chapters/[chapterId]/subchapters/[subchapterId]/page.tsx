import { SubchapterDetail } from "@/components/subchapters/subchapter-detail";

export default async function SubchapterPage({
  params,
}: {
  params: Promise<{ chapterId: string; subchapterId: string }>;
}) {
  const { chapterId, subchapterId } = await params;

  return <SubchapterDetail chapterId={chapterId} subchapterId={subchapterId} />;
}
