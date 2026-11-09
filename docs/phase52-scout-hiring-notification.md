# Phase 52: Scout → 採用進捗 → 通知 の接続

## 原因
1. 通知: `notifications` に `scout_received` / `scout_responded` の type は 0023 から用意されていたが、0025 で「次フェーズ」として未接続のまま。Scout送信・返信のどちらも通知を作っていなかった。
2. 導線: 「採用進捗に追加」ボタンは既に `スカウト履歴`（`/salon/stores/[storeId]/scouts`）にあったが、店舗側は返信が来たことに気付けず、そこへ辿り着く手がかりが無かった。

## 変更（0051 + アプリ）
- `0051_scout_notifications.sql`（**未適用・要承認**）
  - `scouts` の AFTER INSERT トリガー → 美容師へ `scout_received`（遷移先 `/stylist/scouts#scout-<id>`）。
  - `scouts.response_status` が `no_response → 返信済み` になったとき → 店舗の書き込み権限者へ `scout_responded`（遷移先 `/salon/stores/<店舗>/scouts#scout-<id>`）。
  - 受信者は 0038 と同じ: company_owner / company_admin / recruiting_admin、割当のある area_manager、store_manager / recruiter。viewer・他社・未割当 area_manager は対象外。`store_id` の無い旧Scoutだけ送信者本人。
  - `related_entity_type='scout'`・`related_entity_id=scouts.id`。`notifications` に `store_id` は追加しない。
  - 冪等: `unique(user_id,type,related_entity_id)` + 返信は1回だけ発火。本文にScout本文・返信本文は含めない。
  - 通知の失敗はScoutの送信・返信を止めない（warningに落とす）。
  - 既存RPC（send_scout / send_scout_v2 / respond_scout）は再定義しない。0001〜0050は変更なし。
- アプリ: 通知リンク先のアンカー（美容師のScoutカード・店舗のScout履歴）、店舗ダッシュボードの「前向きな返信が届いています（n名）」案内、スカウト履歴の説明文（権限が無い場合の注記）。

## 採用進捗（既存RPCのまま・変更なし）
`add_hiring_candidate`（店舗側の明示操作のみ・重複不可）→ 連絡調整中 → 面談予定（`schedule_hiring_interview`）→ 面談済み → 選考中 → 内定 → 採用（`update_hiring_status`。hired は offered からのみ）。採用時の成功報酬は 0039 のトリガーが1件だけ作成。メッセージ（Scoutの返信）と採用進捗は別物。

## 適用順
0051をSupabaseへ適用（アプリはどちらの順でも動く。適用前は通知が出ないだけ）。
