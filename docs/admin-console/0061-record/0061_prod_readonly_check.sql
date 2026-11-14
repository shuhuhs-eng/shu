-- 0061 本番の「現在の状態」の読み取り専用チェック（何も変更しない。1つのSELECTだけ。書き込み・一時表なし）。
-- 目的: 適用前の基準ハッシュが無い場合の代替。0061の8表・17関数が、migration どおりの定義・権限・状態であることを、本番のカタログだけで確認する。
--   ・定義の照合値は「migration そのものから計算した値」（本番固有の状態に依存しない）。本番の既存オブジェクトの基準ではない。
--   ・既存オブジェクトに0061が影響していないことは、このSQLでは証明しない（項目6は【今回あらためて取る基準】であり、一致確認ではない）。
-- 出力: 項目ごとの PASS / FAIL / INFO と、最後の行（VERDICT）。VERDICT が NG なら、アプリはpushせず FAIL 行を共有する。
begin read only;
with p as (
  select array['admin_audit_events','admin_visit_cases','admin_threads','admin_messages','admin_message_deliveries','account_invitations','account_invitation_events','salon_inquiries'] as nt,
         array['admin_create_thread','admin_post_message','admin_set_thread_status','admin_list_threads','admin_get_thread','admin_record_delivery','inbox_list_threads','inbox_get_thread','inbox_reply'] as pub,
         array['admin_create_thread','admin_post_message','admin_set_thread_status','admin_list_threads','admin_get_thread','admin_record_delivery','inbox_list_threads','inbox_get_thread','inbox_reply',
           '_admin_salon_access','_admin_thread_visible_to','_admin_inbox_can_see','_admin_threads_consistency','_admin_messages_rules','_admin_request_hash','_admin_lock_sender','_admin_lock_request'] as nf
), exp(kind, name, fp) as (values
    ('fn','_admin_inbox_can_see','e71b39042e09cae01036f245e62ec740'),
    ('fn','_admin_lock_request','ffe8923060218e8b340cb9550d42d022'),
    ('fn','_admin_lock_sender','2b75d417e44c6c8919aa4f71ff776dc3'),
    ('fn','_admin_messages_rules','62292fd8dc1dd67747d179402d60a45e'),
    ('fn','_admin_request_hash','0905aaa0b184e925e496f908f5b79ebe'),
    ('fn','_admin_salon_access','4ce5827c78521d3993a522a1a11dc456'),
    ('fn','_admin_thread_visible_to','f351da67180f71322606746b5fb84ddc'),
    ('fn','_admin_threads_consistency','03a84c1ad9cd84fa81d9a21908124243'),
    ('fn','admin_create_thread','fb9a4ed0804d51197af257f6ed0a1f33'),
    ('fn','admin_get_thread','15378606bd946b112bf0d57e157865d0'),
    ('fn','admin_list_threads','7f2e8744d956a135e6e77baecb414c93'),
    ('fn','admin_post_message','4dae1255610579503c1cbf18b1fb4f4f'),
    ('fn','admin_record_delivery','82533195f4d357a033cb2afe7a5c20b3'),
    ('fn','admin_set_thread_status','85258b2893e8bfd19554a419643de5a2'),
    ('fn','inbox_get_thread','b621f3c70e0fab8038a27d658b7c4d69'),
    ('fn','inbox_list_threads','a5d02f2b42bf608bdd6d9f1339814bad'),
    ('fn','inbox_reply','74b011c7b6f6d2eab7edee08909f22d7'),
    ('tbl','account_invitation_events','ea68f622baa0a5933da6be494d24a420'),
    ('tbl','account_invitations','2944152408c4b2a6bc6ae9b548423c52'),
    ('tbl','admin_audit_events','1f221ec21017779f062d9fabfda5ce82'),
    ('tbl','admin_message_deliveries','6c261fd34c6cf482bc463befee663c71'),
    ('tbl','admin_messages','5c17d98ef692329ab78089315c59459d'),
    ('tbl','admin_threads','a9ff465024acf1737348816d039ba53c'),
    ('tbl','admin_visit_cases','082e91be1834fcf6df57378a29b357ed'),
    ('tbl','salon_inquiries','6895eafc10c99a4034d98bd0f931fdbf')
), act as (
  select 'fn' as kind, pr.proname::text as name, md5(pr.prosrc || '|' || pg_get_function_identity_arguments(pr.oid) || '|' || pg_get_function_result(pr.oid) || '|' || pr.prosecdef::text || '|' || pr.provolatile::text) as fp
    from pg_proc pr, p where pr.pronamespace = 'public'::regnamespace and pr.proname = any (p.nf)
  union all
  select 'tbl', c.relname::text, md5((select string_agg(a2.attname || ':' || format_type(a2.atttypid, a2.atttypmod) || ':' || a2.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a2.attnum)
       from pg_attribute a2 left join pg_attrdef d on d.adrelid = a2.attrelid and d.adnum = a2.attnum where a2.attrelid = c.oid and a2.attnum > 0 and not a2.attisdropped)
     || '|' || coalesce((select string_agg(pg_get_constraintdef(k.oid), ';' order by pg_get_constraintdef(k.oid)) from pg_constraint k where k.conrelid = c.oid), ''))
    from pg_class c, p where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any (p.nt)
), r(sort, name, result, info) as (
  select 0, '0 サーバー版', 'INFO', version()
  union all select 10, '1 0061の表が8つ', case when count(*) = 8 then 'PASS' else 'FAIL' end, count(*)::text from pg_class c, p where c.relnamespace = 'public'::regnamespace and c.relname = any (p.nt) and c.relkind = 'r'
  union all select 11, '1 RLS有効: ' || c.relname, case when c.relrowsecurity then 'PASS' else 'FAIL' end, '' from pg_class c, p where c.relnamespace = 'public'::regnamespace and c.relname = any (p.nt)
  union all select 12, '1 ポリシー無し', case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*)::text from pg_policies, p where schemaname = 'public' and tablename = any (p.nt)
  union all select 13, '1 所有者以外の権限付与が無い（表・列）', case when count(*) = 0 then 'PASS' else 'FAIL' end, coalesce(string_agg(x, ','), '') from (
      select c.relname || '→' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as x from pg_class c, p, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relname = any (p.nt) and a.grantee <> c.relowner
      union all select c.relname || '.' || at.attname || '(列)' from pg_attribute at join pg_class c on c.oid = at.attrelid, p where c.relnamespace = 'public'::regnamespace and c.relname = any (p.nt) and at.attacl is not null) s
  union all select 14, '1 実効権限なし: ' || rl || ' → ' || tb, case when not (has_table_privilege(rl, 'public.' || tb, 'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege(rl, 'public.' || tb, 'select,insert,update,references')) then 'PASS' else 'FAIL' end, ''
      from unnest(array['public','anon','authenticated','service_role']) rl, (select unnest(nt) tb from p) t
  union all select 20, '2 関数17個・同名の別版なし', case when count(*) = 17 and count(distinct pr.proname) = 17 then 'PASS' else 'FAIL' end, count(*)::text || '個/' || count(distinct pr.proname)::text || '名' from pg_proc pr, p where pr.pronamespace = 'public'::regnamespace and pr.proname = any (p.nf)
  union all select 21, '2 実行権限の付与先: ' || pr.proname, case when (pr.proname = any (p.pub) and g = 'authenticated') or (pr.proname <> all (p.pub) and g = '') then 'PASS' else 'FAIL' end, '付与先(所有者除く)=[' || g || ']'
      from pg_proc pr, p, lateral (select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1), '') as g from aclexplode(pr.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> pr.proowner) q
      where pr.pronamespace = 'public'::regnamespace and pr.proname = any (p.nf)
  union all select 22, '2 SECURITY DEFINER・search_path固定: ' || pr.proname, case when pr.prosecdef and coalesce(pr.proconfig::text like '%search_path%', false) then 'PASS' else 'FAIL' end, ''
      from pg_proc pr, p where pr.pronamespace = 'public'::regnamespace and pr.proname = any (p.pub)
  union all select 23, '2 anon・service_role・PUBLICは新関数を1つも実行できない', case when not bool_or(has_function_privilege('anon', pr.oid, 'execute') or has_function_privilege('service_role', pr.oid, 'execute') or has_function_privilege('public', pr.oid, 'execute')) then 'PASS' else 'FAIL' end, ''
      from pg_proc pr, p where pr.pronamespace = 'public'::regnamespace and pr.proname = any (p.nf)
  union all select 30, '3 定義の一致: ' || e.kind || ' ' || e.name, case when a.fp = e.fp then 'PASS' else 'FAIL' end, case when a.fp is null then '見つからない' when a.fp = e.fp then '' else '本番=' || a.fp || ' 期待=' || e.fp end
      from exp e left join act a on a.kind = e.kind and a.name = e.name
  union all select 40, '4 トリガー有効: ' || tg, case when exists (select 1 from pg_trigger where tgname = tg and not tgisinternal and tgenabled = 'O') then 'PASS' else 'FAIL' end, '' from unnest(array['trg_admin_threads_consistency','trg_admin_messages_rules']) tg
  union all select 41, '4 0061のトリガー関数は新しい2表にだけ付いている', case when count(*) = 2 and bool_and(c.relname = any (p.nt)) then 'PASS' else 'FAIL' end, coalesce(string_agg(c.relname, ','), '')
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc pr on pr.oid = t.tgfoid, p where pr.proname in ('_admin_threads_consistency','_admin_messages_rules') and not t.tgisinternal
  union all select 42, '4 一意制約: ' || ix, case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = ix) then 'PASS' else 'FAIL' end, '' from unnest(array['admin_messages_one_request','admin_visit_cases_one_open','account_invitations_one_active']) ix
  union all select 50, '5 行数（アプリ公開前は0のはず）: ' || tb, case when cnt = 0 then 'PASS' else 'INFO' end, cnt::text
      from (select tb, (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.' || quote_ident(tb), false, true, '')))[1]::text::bigint as cnt from (select unnest(nt) tb from p) z) y
  union all select 60, '6 既存オブジェクトの現在の基準ハッシュ（適用前との一致は未確認）', 'INFO', (
      select md5(string_agg(x, '|' order by x)) from (
        select 'tbl:' || c.relname || ':' || coalesce(c.relacl::text, '') as x from pg_class c, p where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v') and c.relname <> all (p.nt)
        union all select 'fn:' || pr.oid::regprocedure::text || ':' || coalesce(pr.proacl::text, '') from pg_proc pr, p where pr.pronamespace = 'public'::regnamespace and pr.proname <> all (p.nf)
        union all select 'trg:' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid, p where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname <> all (p.nt)) s)
)
select sort, name, result, info from r
union all select 99, 'VERDICT（FAILが0ならOK）', case when count(*) filter (where result = 'FAIL') = 0 then 'OK' else 'NG' end,
  'PASS=' || count(*) filter (where result = 'PASS') || ' FAIL=' || count(*) filter (where result = 'FAIL') || ' INFO=' || count(*) filter (where result = 'INFO') from r
order by 1, 2;
rollback;
