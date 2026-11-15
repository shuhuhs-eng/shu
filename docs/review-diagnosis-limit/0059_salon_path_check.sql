-- 0059適用後のDBで、サロン側の新しい保存経路（下書き保存→確定）が、authenticatedの権限だけで動くことの確認（ローカルDB専用・最後にROLLBACK）。
-- 0058_verify_salon_app.sql は別の検証用データに依存するため、この確認は最小の独立した利用者を自前で作る。
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;
create function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language sql as $$ insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info) $$;
create function pg_temp.base12(p int) returns jsonb language sql as $$
  select jsonb_build_object('q1_education_support',p,'q2_challenge_openness',p,'q3_personal_brand_support',p,'q4_team_collaboration',p,
   'q5_individual_autonomy',p,'q6_work_flexibility',p,'q7_technical_specialization',p,'q8_premium_value',p,'q9_trend_orientation',p,
   'q10_creative_output',p,'q11_relationship_distance',p,'q12_hierarchy_flatness',p) $$;
create function pg_temp.payload(p_base int) returns jsonb language sql as $$
  select jsonb_build_object('respondent_role','owner_representative','current_step',13,'answers',pg_temp.base12(p_base),
         'value_priorities','["skill_growth","teamwork","independence"]'::jsonb,'comment',null) $$;
grant execute on function pg_temp.base12(int), pg_temp.payload(int) to public;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000c901','s59@t') on conflict do nothing;
insert into public.profiles (id, role) values ('00000000-0000-0000-0000-00000000c901','salon') on conflict do nothing;
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000c901','salon') on conflict do nothing;
do $$
declare u uuid := '00000000-0000-0000-0000-00000000c901'; d public.salon_culture_drafts; r jsonb; r2 jsonb; e text;
begin
  perform pg_temp.chk('S0 前提: 旧サロン保存関数は authenticated から実行できない（0059適用済み）',
    not has_function_privilege('authenticated','public.save_salon_culture_profile(public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)','execute'));
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  d := public.save_salon_culture_draft(null, pg_temp.payload(3));
  perform pg_temp.chk('S1 下書き保存が動く', d.rev is not null, d.rev::text);
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), d.rev);
  perform pg_temp.chk('S2 初回の確定が動く', r->>'action' = 'initial', r::text);
  d := public.save_salon_culture_draft(null, pg_temp.payload(4));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), d.rev);
  perform pg_temp.chk('S3 変更の確定が動く（1回目の変更）', r->>'action' = 'change' and r->>'locked_until' is not null, r::text);
  d := public.save_salon_culture_draft(null, pg_temp.payload(5));
  begin
    perform public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), d.rev); e := 'accepted';
  exception when others then e := sqlerrm; end;
  perform pg_temp.chk('S4 ロック中の変更の確定は拒否される（0058の制限は0059後も有効）', e like '%locked%', e);
  r2 := public.get_diagnosis_change_status('salon_culture_user', null);
  perform pg_temp.chk('S5 状態の取得が動く', r2 is not null, r2::text);
  reset role;
  perform pg_temp.chk('S6 公開中の結果は変更1回分（変更回数1）', (select change_count from public.diagnosis_change_limits where user_id = u and kind='salon_culture_user') = 1);
  begin
    set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
    perform public.save_salon_culture_analysis_answers('salon-analysis-v1','{}','{}'); e := 'accepted';
  exception when others then e := sqlerrm; end;
  reset role;
  perform pg_temp.chk('S7 旧経路（旧サロン保存関数の直接呼び出し）は権限で拒否される', e like '%permission denied%', e);
end $$;
select n, name, case when ok then 'PASS' else 'FAIL' end as result, info from t_log order by n;
rollback;
