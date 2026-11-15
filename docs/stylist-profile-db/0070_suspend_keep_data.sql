-- ============================================================================
-- 0070 停止（データを残す）【運用開始後の停止手順】
--  Supabase の SQL エディタで全文そのまま実行できる（psql の \ コマンドは使っていない）。
--  ・サロンへの追加表示（画像・雇用形態・Instagram・大切にしたいこと・年齢）を止める:
--      フラグ stylist_public_extended を「停止」にするだけ。一覧関数は従来の項目だけを返し、画像の閲覧も不可になる。
--      本人のプレビューも同じフラグで判定するため、停止中は従来の項目だけを表示する（サロン側と一致）。
--  ・何も削除しない: 生年月日の列と値、生年月日保存関数、スカウト設定と退避表、給与提示の停止。
--  ・再開: 0070_public_extended_resume.sql
-- ============================================================================
begin;
insert into public.feature_pauses (feature, paused, reason)
values ('stylist_public_extended', true, '運営により停止（データは保持）')
on conflict (feature) do update set paused = true, reason = excluded.reason, updated_at = now();
commit;
