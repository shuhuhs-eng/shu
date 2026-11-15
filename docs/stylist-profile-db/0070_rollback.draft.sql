-- ============================================================================
-- 0070 巻き戻し（草案）【運用開始前の完全な取り消し用】
--
-- ★安全装置: 次のどれかに当てはまるときは、何も変更せずに中止（例外→トランザクション全体が取り消し）。
--    ・生年月日が1件でも登録されている／表示方法が1件でも選択されている（列を削除すると本人のデータが消えるため）
--    ・実年齢の開示依頼が1件でもある／開示依頼の通知が1件でもある（依頼・承認の記録を削除しないため）
--    ・移行したスカウト設定が、移行後に変更されている（本人が変えた設定を上書きして戻さないため）
--   中止された場合は 0070_suspend_keep_data.sql（データを残す停止）を使う。
--
-- ★Supabase の SQL エディタで、このファイルを全文そのまま実行できる（psql の \ コマンドは使っていない）。
--   中止条件に当たると例外で止まり、残りは実行されず、全体が取り消される。
-- ★給与提示の停止（feature_pauses・トリガー）は、この巻き戻しでも「外さない」。
--   不用意に再開しないため。再開は 0070_salary_offer_resume.sql を、承認後に別途実行する。
-- ============================================================================
begin;

-- ★同時保存からの保護（中止判定より前に、削除・復元の対象表への書き込みを止める）
--   対象と実際の書き込み経路:
--     生年月日・表示方法（stylist_private）= set_stylist_birth_date・set_stylist_age_display_mode・save_stylist_profile ／
--     開示依頼（age_disclosure_requests）= request/respond の各RPC ／ プロフィール（stylist_profiles）= save_stylist_profile ／
--     スカウト（scouts）= send_scout 系 ／ 通知（notifications）= 各通知の作成 ／ スカウト設定（user_settings）= 利用者の設定保存 ／
--     移行の退避表（scout_optout_migration_0070）・機能フラグ（feature_pauses）= 運営のSQLのみ。
--   ロックの強さ: この巻き戻しが「列・表を削除する」表（stylist_private・退避表）は ACCESS EXCLUSIVE を最初に取る
--     （あとから強いロックへ格上げすると、保存中の処理とデッドロックしうるため）。更新だけの表（user_settings・feature_pauses）は
--     SHARE ROW EXCLUSIVE（読み取りは止めず、書き込みだけを待たせる）。取得できなければ15秒で中止し、何も変更しない。
--   このロックは確認→削除・復元→コミットまで同じトランザクションで保持される。
--   ・保存が先に確定した場合: ここで待ち、確定後に下の確認が最新のデータを見て、巻き戻しを中止する。
--   ・巻き戻しが先に取った場合: 後続の保存は、巻き戻しのコミットまで待たされる（途中状態には割り込めない）。
set local lock_timeout = '15s';
-- 取得順は保存経路が表に触れる順（stylist_private → stylist_profiles）に合わせる。トリガー・制約を外す表も ACCESS EXCLUSIVE。
lock table public.stylist_private, public.scout_optout_migration_0070, public.age_disclosure_requests,
  public.stylist_profiles, public.scouts, public.notifications in access exclusive mode;
lock table public.user_settings, public.feature_pauses in share row exclusive mode;
-- ROLLBACK_LOCK_ACQUIRED（検証スクリプトが保持時間を挿入する目印。本番では単なるコメント）

do $$
declare n bigint;
begin
  -- 適用順は 0070→0071 固定。0071が適用済みなら、先に0071を巻き戻す（0071の公開判定が0070の関数・フラグに依存するため）
  if to_regclass('public.stylist_diagnosis_current') is not null
     or exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_profiles' and column_name='career_phase') then
    raise exception '巻き戻しを中止: 0071が適用されています。先に 0071_rollback.draft.sql を実行してください';
  end if;
  select count(*) into n from public.stylist_private where age_display_mode is not null;
  if n > 0 then
    raise exception '巻き戻しを中止: 年齢の表示方法が % 件選択されています（削除すると本人の選択が消えます）。0070_suspend_keep_data.sql を使ってください', n;
  end if;
  select count(*) into n from public.age_disclosure_requests;
  if n > 0 then
    raise exception '巻き戻しを中止: 実年齢の開示依頼が % 件あります（依頼・承認の記録は削除しません）。0070_suspend_keep_data.sql を使ってください', n;
  end if;
  select count(*) into n from public.notifications where type in ('age_disclosure_requested','age_disclosure_approved');
  if n > 0 then
    raise exception '巻き戻しを中止: 開示依頼の通知が % 件あります（削除しません）。0070_suspend_keep_data.sql を使ってください', n;
  end if;
  select count(*) into n from public.stylist_private where birth_date is not null;
  if n > 0 then
    raise exception '巻き戻しを中止: 生年月日が % 件登録されています（削除すると本人のデータが消えます）。0070_suspend_keep_data.sql を使ってください', n;
  end if;

  if to_regclass('public.scout_optout_migration_0070') is not null then
    select count(*) into n
    from public.scout_optout_migration_0070 m
    join public.user_settings us on us.user_id = m.user_id
    where us.scout_enabled is distinct from true or us.updated_at > m.migrated_at;
    if n > 0 then
      raise exception '巻き戻しを中止: 移行したスカウト設定のうち % 件が、移行後に変更されています。0070_suspend_keep_data.sql を使ってください', n;
    end if;
  end if;
end $$;

-- スカウト設定を、移行前（受信拒否）へ戻す。上の確認で「移行後に変更なし」と分かった分だけ。
update public.user_settings us set scout_enabled = false
  from public.scout_optout_migration_0070 m where us.user_id = m.user_id;
drop table if exists public.scout_optout_migration_0070;

drop policy if exists avatars_select_public_stylist_for_salon on storage.objects;
drop function if exists public.salon_can_view_stylist_avatar(text);

-- 実年齢の開示まわり（上の確認で、依頼・通知・表示方法・生年月日が無いと分かっている）
drop trigger if exists trg_scouts_publishable_guard on public.scouts;
drop trigger if exists trg_stylist_profiles_birth_required on public.stylist_profiles;
drop trigger if exists trg_stylist_private_birth_guard on public.stylist_private;
drop function if exists public._trg_scouts_publishable_guard();
drop function if exists public._trg_stylist_profiles_birth_required();
drop function if exists public._trg_stylist_private_birth_guard();
drop function if exists public.get_store_stylist_age_infos(uuid, uuid[]);
drop function if exists public.get_my_age_disclosure_requests();
drop function if exists public.respond_age_disclosure_request(uuid, boolean);
drop function if exists public.request_stylist_age_disclosure(uuid, uuid);
drop function if exists public.get_public_stylists_for_scout(uuid);
drop function if exists public._stylist_age_info(uuid, uuid);
drop table if exists public.age_disclosure_requests;
drop function if exists public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text);
drop function if exists public.set_stylist_age_display_mode(text);
drop function if exists public.set_stylist_birth_date(date);
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'scout_received','scout_responded','salary_offer_received','salary_offer_revised','salary_offer_accepted','salary_offer_revision_requested',
  'salary_offer_declined','evidence_verified','evidence_rejected','interview_action_required','stylist_interest_received',
  'hiring_interview_scheduled','hiring_interview_rescheduled','hiring_status_updated','hiring_offered','hiring_hired','hiring_declined_by_stylist']::text[]));

-- get_public_stylists_for_scout を 0025 の定義へ戻す（追加項目を外す）
create or replace function public.get_public_stylists_for_scout()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_salon_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_salon_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_salon_uid and role = 'salon') then
    raise exception 'caller is not a salon'; end if;
  with candidates as (
    select sp.user_id as stylist_user_id, sp.public_name, sp.prefecture, sp.desired_work_location, sp.experience_years,
      sp.current_position, sp.specialties, sp.job_change_intent, sp.bio,
      public.calculate_match_axes(sp.user_id, v_salon_uid) as match,
      prev_interest.created_at as previous_interest_at,
      coalesce(prev_scout.cnt, 0) as previous_scout_count, prev_scout.last_sent_at as previous_scout_last_sent_at
    from public.stylist_profiles sp
    join public.user_roles ur on ur.user_id = sp.user_id and ur.role = 'stylist'
    left join public.user_settings us on us.user_id = sp.user_id
    left join lateral (select created_at from public.stylist_salon_interests
      where stylist_user_id = sp.user_id and salon_user_id = v_salon_uid) prev_interest on true
    left join lateral (select count(*) as cnt, max(sent_at) as last_sent_at from public.scouts
      where stylist_user_id = sp.user_id and salon_user_id = v_salon_uid) prev_scout on true
    where sp.visibility = 'PUBLIC' and coalesce(us.scout_enabled, true) = true)
  select coalesce(jsonb_agg(jsonb_build_object(
    'stylist_user_id', stylist_user_id, 'public_name', public_name, 'prefecture', prefecture,
    'desired_work_location', desired_work_location, 'experience_years', experience_years,
    'current_position', current_position, 'specialties', specialties, 'job_change_intent', job_change_intent,
    'bio', bio, 'match', match, 'previous_interest_at', previous_interest_at,
    'previous_scout_count', previous_scout_count, 'previous_scout_last_sent_at', previous_scout_last_sent_at
  ) order by coalesce((match->>'overall_score')::numeric, -1) desc), '[]'::jsonb)
  into v_result from candidates;
  return v_result;
end; $$;
revoke all on function public.get_public_stylists_for_scout() from public, anon;
grant execute on function public.get_public_stylists_for_scout() to authenticated;

drop function if exists public.stylist_salon_publishable(uuid);
drop function if exists public.get_stylist_public_extended_enabled();
drop function if exists public.stylist_public_extended_enabled();
delete from public.feature_pauses where feature in ('stylist_public_extended','minor_salon_public');
drop function if exists public.stylist_age_years(date);
alter table public.stylist_private drop constraint if exists stylist_private_age_display_mode_check;
alter table public.stylist_private drop column if exists age_display_mode;
alter table public.stylist_private drop column if exists birth_date;

-- 給与提示の停止（feature_pauses・trg_salary_offers_00_pause・block_salary_offer_insert_when_paused）は意図的に残す。
commit;
