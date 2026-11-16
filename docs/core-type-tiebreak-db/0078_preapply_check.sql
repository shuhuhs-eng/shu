-- 0078 適用前チェック（SELECT1文・読み取り専用）
with r(ord, level, item, detail) as (values
 (1, case when to_regprocedure('public.save_core_type_result(uuid)') is not null and (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.save_core_type_result(uuid)')) = '319b6c1fd85ed6f22024d908a4b2bb3b' then 'PASS' else 'FAIL' end, 'save_core_type_result が 0004 の定義のまま（0078が未適用）', coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('public.save_core_type_result(uuid)')), '(関数なし)')),
 (2, case when (select array_agg(e::text order by o) from unnest(enum_range(null::public.stylist_core_type)) with ordinality as t(e,o)) = array['shimei_jishaku','aisare_ace','niaiwase_master','trend_maker','iyashi_charisma','repeat_king','mirai_no_ace','brand_builder'] then 'PASS' else 'FAIL' end, '8タイプの定義順がアプリの CORE_TYPE_CODES と同じ', ''),
 (3, case when has_function_privilege('authenticated', to_regprocedure('public.save_core_type_result(uuid)'), 'execute') and not has_function_privilege('anon', to_regprocedure('public.save_core_type_result(uuid)'), 'execute') and not has_function_privilege('public', to_regprocedure('public.save_core_type_result(uuid)'), 'execute') then 'PASS' else 'FAIL' end, '権限: authenticated のみ実行できる（変更しない）', ''),
 (4, 'INFO', '履歴の件数 / 1位が同点だった履歴（score_gap=0）/ 初回確定の件数（適用前後で変わらないこと）', (select count(*)::text||' / '||count(*) filter (where score_gap = 0)::text from public.stylist_core_type_history)||' / '||(select count(*)::text from public.stylist_core_type_assignments)),
 (5, 'INFO', '履歴の内容のハッシュ（適用後チェックと同じ値であること）', (select coalesce(md5(string_agg(id::text||'|'||user_id::text||'|'||diagnosis_result_id::text||'|'||top_type_code::text||'|'||second_type_code::text||'|'||score_gap::text||'|'||match_scores::text||'|'||created_at::text, ',' order by id)),'(none)') from public.stylist_core_type_history)),
 (6, 'INFO', '初回確定の内容のハッシュ（適用後チェックと同じ値であること）', (select coalesce(md5(string_agg(user_id::text||'|'||core_type_code::text||'|'||source_diagnosis_result_id::text||'|'||assignment_method||'|'||assigned_at::text, ',' order by user_id)),'(none)') from public.stylist_core_type_assignments))
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は人が確認）', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
