-- 公開プロフィールの追加表示（画像・雇用形態・Instagram・大切にしたいこと・年齢）を再開する。
-- Supabase の SQL エディタで全文そのまま実行できる。
begin;
insert into public.feature_pauses (feature, paused, reason)
values ('stylist_public_extended', false, '再開')
on conflict (feature) do update set paused = false, reason = excluded.reason, updated_at = now();
commit;
