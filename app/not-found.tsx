import { StatusPanel } from "@/components/error-panel";

export default function NotFound() {
  return (
    <StatusPanel title="ページが見つかりません">
      <p>お探しのページは存在しないか、閲覧する権限がありません。URLをご確認ください。</p>
    </StatusPanel>
  );
}
