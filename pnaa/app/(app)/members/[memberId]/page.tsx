import { MemberDetail } from "@/components/members/member-detail";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return <MemberDetail memberId={memberId} />;
}
