export default function FundraisingItemPage({
  params,
}: {
  params: { fundraisingId: string };
}) {
  return <div>Fundraising Item {params.fundraisingId}</div>;
}
