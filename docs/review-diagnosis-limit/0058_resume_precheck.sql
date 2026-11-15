-- 再開前チェック（読み取り専用）。巻き戻し中に保存されて、状態表に記録されていない件数を確認する。
-- 「状態表の最終更新以降に保存された診断結果」＝巻き戻し中の保存。これらは消さず、回数にも数えない。
select * from (
  select 1 as no, 'INFO' as level, '状態表が残っている（再開できる状態）' as item,
         (to_regclass('public.diagnosis_change_limits') is not null)::text as value
  union all select 2, 'INFO', '状態表の行数（再開で変更しない）', (select count(*) from public.diagnosis_change_limits)::text
  union all select 3, 'INFO', '制限のトリガー（0なら巻き戻し済み）',
         (select count(*) from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal)::text
  union all select 4, 'INFO', '美容師・サロン診断14問: 状態表に記録の無い所有者（再開で「初回保存済み・ロックなし」を作る）',
         (select count(*) from (select distinct r.user_id, case when r.mode='stylist' then 'stylist' else 'salon_quiz' end k from public.diagnosis_results r) x
            where not exists (select 1 from public.diagnosis_change_limits l where l.user_id = x.user_id and l.kind = x.k))::text
  union all select 5, 'INFO', '巻き戻しの時刻（状態表のコメントから。不明なら件数は参考にならない）', coalesce((select nullif(substring(obj_description('public.diagnosis_change_limits'::regclass,'pg_class') from 'rolled_back_at=(.*)$'),'')::timestamptz)::text, '不明')
  union all select 6, 'INFO', '状態表に記録のある所有者の、巻き戻し後に保存された診断結果の件数（残す・数えない）',
         (select count(*) from public.diagnosis_results r join public.diagnosis_change_limits l
            on l.user_id = r.user_id and l.kind = case when r.mode='stylist' then 'stylist' else 'salon_quiz' end
           where r.created_at > (select nullif(substring(obj_description('public.diagnosis_change_limits'::regclass,'pg_class') from 'rolled_back_at=(.*)$'),'')::timestamptz))::text
  union all select 7, 'INFO', '  うち、現在ロック中の所有者の分（結果は残り、次回変更可能日時までは変更できない）',
         (select count(*) from public.diagnosis_results r join public.diagnosis_change_limits l
            on l.user_id = r.user_id and l.kind = case when r.mode='stylist' then 'stylist' else 'salon_quiz' end
           where l.locked_until > now() and r.created_at > (select nullif(substring(obj_description('public.diagnosis_change_limits'::regclass,'pg_class') from 'rolled_back_at=(.*)$'),'')::timestamptz))::text
  union all select 8, 'INFO', 'サロンらしさ本人用: 状態表に記録の無い確定済み',
         (select count(*) from public.salon_culture_profiles p where p.status='completed' and not exists (select 1 from public.diagnosis_change_limits l where l.kind='salon_culture_user' and l.user_id=p.salon_user_id))::text
  union all select 9, 'INFO', 'サロンらしさ店舗用: 状態表に記録の無い確定済み',
         (select count(*) from public.salon_store_culture_profiles p where p.status='completed' and not exists (select 1 from public.diagnosis_change_limits l where l.kind='salon_culture_store' and l.store_id=p.store_id))::text
  union all select 10, 'INFO', '下書きの行数（再開で変更しない）', (select count(*) from public.salon_culture_drafts)::text
) q order by no;
