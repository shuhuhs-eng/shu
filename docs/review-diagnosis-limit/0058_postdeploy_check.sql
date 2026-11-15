-- 0058 デプロイ後の確認用（読み取り専用）。テスト用アカウントのメールアドレスを書き換えて実行する。
-- 画面で操作した結果（状態・ロック日時・結果の件数・送信ID）が、DBに期待どおり残っているかを見る。
with u as (select id, email from auth.users where email = 'ここにテスト用アカウントのメール'),
st as (
  select l.kind, l.change_count, l.initial_saved_at, l.last_change_at, l.locked_until,
         (l.locked_until is not null and l.locked_until > now()) as locked_now
    from public.diagnosis_change_limits l join u on u.id = l.user_id
)
select 1 as no, '状態（kind / 変更回数 / ロック日時 / 今ロック中か）' as item,
       coalesce((select string_agg(kind || ' / ' || change_count || ' / ' || coalesce(locked_until::text,'ロックなし') || ' / ' || locked_now, E'\n') from st), '状態なし') as value
union all select 2, '診断結果の件数（美容師）',
       (select count(*) from public.diagnosis_results r join u on u.id = r.user_id where r.mode = 'stylist')::text
union all select 3, '最新の診断結果の保存日時',
       coalesce((select max(r.created_at)::text from public.diagnosis_results r join u on u.id = r.user_id where r.mode = 'stylist'), 'なし')
union all select 4, '送信ID記録（action別の件数: initial/change/unchanged）',
       coalesce((select string_agg(action || '=' || n, ' / ') from (select s.action, count(*) n from public.diagnosis_save_requests s join u on u.id = s.user_id group by s.action) x), '記録なし')
union all select 5, '直近の送信ID記録（新しい順・5件）',
       coalesce((select string_agg(created_at::text || ' ' || action, E'\n' order by created_at desc) from (select s.created_at, s.action from public.diagnosis_save_requests s join u on u.id = s.user_id order by s.created_at desc limit 5) y), '記録なし')
order by 1;
