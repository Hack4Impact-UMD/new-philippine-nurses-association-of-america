export default function ChapterPage({
  params,
}: {
  params: { chapterId: string };
}) {
  return <div>Chapter {params.chapterId}</div>;
}
