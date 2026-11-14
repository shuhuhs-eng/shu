# 0061 停止・復旧手順（運用開始後はデータを残す）

状態: ローカル検証済み。本番での実行は未確認。

## 原則
- 実データが入った後は `DROP TABLE` を通常手順にしない。
- 完全削除（0061_rollback_unused）は「0061の8表が全て0行」のときだけ動く。1行でもあれば例外で拒否し、何も消さない。
- 運用中の止め方は「停止」（0061_suspend_keep_data）。データ・関数・表は残り、認証済みユーザーが公開RPC 9本を呼べなくなる。
- 戻すときは 0061_resume（EXECUTE を再付与）。

## A. 未使用（0行）のとき: 完全削除
1. 0061_postapply_check ではなく、件数だけ確認: 8表の行数合計が 0。
2. `0061_rollback_unused.sql` を実行。
3. 0061_preapply_check を実行し、INFO のハッシュが、その本番の適用前チェックで控えた値と一致することを確認。

## B. 運用開始後: 停止してデータを残す
1. 先に書き出し（バックアップ）:
   `pg_dump --data-only --disable-triggers -t public.admin_audit_events -t public.admin_visit_cases -t public.admin_threads -t public.admin_messages -t public.admin_message_deliveries -t public.account_invitations -t public.account_invitation_events -t public.salon_inquiries`
2. `0061_suspend_keep_data.sql` を実行（EXECUTE の取り消しのみ。データ不変）。
3. 件数が停止前と同じことを確認。画面側は連絡機能を非表示にする。
4. 原因対応後、`0061_resume.sql` で再開。

## C. どうしても作り直す場合（個別承認が必要）
書き出し → 8表を空にする → 0061_rollback_unused → 修正版の適用 → 書き出しの流し込み。予行で件数 5/157/45 が復元されることを確認済み。

## 予行結果（ローカル、件数 スレッド5/メッセージ157/通知45）
- データあり→完全削除: 拒否（235行）、件数・関数とも不変
- 停止: admin_list_threads / inbox_list_threads が permission denied、件数不変
- 再開: 呼び出し可能に復帰、件数不変
- 書き出し→空→完全削除→再適用→流し込み: 件数 5/157/45 が復元
- 空の状態で完全削除後: スキーマハッシュが適用前（ローカルの値）と一致。本番の期待値には使わない
