-- ============================================================================
-- 0113【適用SQL】（承認なしに本番へ実行しない。直前に 0113_1 の事前チェックが「適用可」であること）課金設定の変更履歴と、採用料の登録区分ルールの決定操作
-- 採番: 既存の 0112（スカウト台帳の送信）・0112b（スカウト台帳の切替）と重複しないよう 0113 とする。地域検索v2は番号未確定（0114以降を想定）。
-- 前提: 0109 適用済み（billing_settings・_billing_responsible_guard・admin_billing_setting_set がある）。0108・0110・0111・0112・0112b とは独立。
-- 追加するもの（既存の表・関数は変更しない）:
--   ① billing_setting_changes: 課金設定の変更履歴（追記専用。更新・削除は拒否。誰も直接読み書きできない）
--   ② トリガー: billing_settings の値・状態が変わるたびに履歴を1行記録する（どの経路の変更でも漏れない）
--   ③ admin_billing_setting_changes_list(limit): 履歴の一覧（責任者のみ）
--   ④ admin_billing_hire_role_rule_decide(): 「採用料の登録区分ルール（hire_fee_role_source）」だけを決定済みにする（責任者のみ）。
--      実行の前も後も、自動請求(auto_charge_enabled)とカード必須(salon_card_required)が 'false' であることを必須とする
--      （前が 'false' でなければ何も変更せず中止。後が 'false' でなければ例外で全体を戻す。null や未設定も不可）。
-- ★この草案は auto_charge_enabled・salon_card_required を変更する操作を一切提供しない。
-- 巻き戻し後の再適用に対応: 履歴の表と追記専用トリガーは巻き戻しでも残る（0113_..._rollback）。表が残っていれば列を確認して再利用する。
-- この版は草案に「適用前後で課金設定・依存関数・表の形が同一であること」の取引内検査を追加（違えば全体を戻す）。
-- 適用: Supabase SQL Editor に全文を貼り付けて1回実行（1トランザクション。前提が外れていれば例外で何も変わらない）。
-- 巻き戻し: 0113_billing_setting_history.rollback.DRAFT.sql（変更履歴は削除しない）
-- ============================================================================
begin;
set local lock_timeout = '5s';
do $pre$
declare v_cols text;
begin
  if to_regclass('public.billing_settings') is null or to_regprocedure('public.admin_billing_setting_set(text,text,text)') is null or to_regprocedure('public._billing_responsible_guard()') is null then
    raise exception '0113の前提（0109）が未適用です'; end if;
  if to_regprocedure('public.admin_billing_hire_role_rule_decide()') is not null or to_regprocedure('public.admin_billing_setting_changes_list(integer)') is not null
     or to_regprocedure('public._billing_setting_log_change()') is not null
     or exists (select 1 from pg_trigger where tgname = 'trg_billing_settings_log_change' and not tgisinternal) then
    raise exception '0113の対象がすでに存在します（適用済みの可能性）。中止します'; end if;
  if to_regclass('public.billing_setting_changes') is not null then   -- 巻き戻し後の再適用: 残っている履歴の表が想定の形かを確認する
    select string_agg(column_name, ',' order by column_name) into v_cols from information_schema.columns where table_schema = 'public' and table_name = 'billing_setting_changes';
    if v_cols is distinct from 'changed_at,changed_by,changed_by_db_role,id,new_status,new_value,note,old_status,old_value,setting_key' then
      raise exception '残っている billing_setting_changes の列が想定と違います（%）。中止します', v_cols; end if;
  end if;
end $pre$;

-- 適用前の課金設定の基準（この取引の中だけの一時表。commit で消える）
create temp table _br0113_before on commit drop as
select
  md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅'), ';' order by key) from public.billing_settings),'')) as core,
  md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅')||'|'||coalesce(note,'∅')||'|'||coalesce(updated_by::text,'∅')||'|'||coalesce(updated_at::text,'∅'), ';' order by key) from public.billing_settings),'')) as full_,
  (select count(*) from public.billing_settings) as n,
  md5(coalesce((select string_agg(t.sig||'='||coalesce(md5(p.prosrc||'|'||pg_get_function_arguments(p.oid)||'|'||pg_get_function_result(p.oid)||'|'||p.prosecdef::text||'|'||p.provolatile::text||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'')||'|'||coalesce(p.proconfig::text,'')),'∅'),';' order by t.sig)
      from (values ('public.admin_billing_setting_set(text,text,text)'),('public._billing_responsible_guard()'),('public._billing_setting(text)'),('public.admin_billing_settings_list()'),('public.is_platform_admin()')) t(sig)
      left join pg_proc p on p.oid = to_regprocedure(t.sig)),'')
    ||'#'||coalesce((select pg_get_userbyid(c.relowner)||'|'||c.relkind::text||'|'||c.relrowsecurity::text||'|'||coalesce(c.relacl::text,'')||'|'||
        (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)||'|'||
        coalesce((select string_agg(pg_get_constraintdef(k.oid),',' order by k.conname) from pg_constraint k where k.conrelid=c.oid),'')
      from pg_class c where c.oid=to_regclass('public.billing_settings')),'∅')) as deps;

create table if not exists public.billing_setting_changes (
  id bigint generated always as identity primary key,
  setting_key text not null,
  old_value text, old_status text not null,
  new_value text, new_status text not null,
  changed_by uuid,                                   -- 変更した責任者（SQL Editorなど認証なしの変更は null）
  changed_by_db_role text not null default session_user,
  note text,
  changed_at timestamptz not null default now()
);
alter table public.billing_setting_changes enable row level security;
revoke all on public.billing_setting_changes from public, anon, authenticated, service_role;
create index if not exists billing_setting_changes_key_idx on public.billing_setting_changes (setting_key, changed_at desc);

create or replace function public._billing_setting_changes_immutable() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin raise exception 'billing_setting_changes is append-only'; end; $$;
drop trigger if exists trg_billing_setting_changes_immutable on public.billing_setting_changes;   -- 履歴の行は消さない（トリガーだけ作り直す）
create trigger trg_billing_setting_changes_immutable before update or delete on public.billing_setting_changes for each row execute function public._billing_setting_changes_immutable();

create function public._billing_setting_log_change() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.value is distinct from old.value or new.status is distinct from old.status then
    insert into public.billing_setting_changes(setting_key, old_value, old_status, new_value, new_status, changed_by, note)
    values (new.key, old.value, old.status, new.value, new.status, auth.uid(), nullif(current_setting('app.billing_setting_note', true), ''));
  end if;
  return new;
end; $$;
create trigger trg_billing_settings_log_change after update on public.billing_settings for each row execute function public._billing_setting_log_change();

create function public.admin_billing_setting_changes_list(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'insufficient permission (responsible only)'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.id desc) from (select id, setting_key, old_value, old_status, new_value, new_status, changed_by, note, changed_at
    from public.billing_setting_changes order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) c), '[]'::jsonb);
end; $$;

create function public.admin_billing_hire_role_rule_decide() returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  perform public._billing_responsible_guard();
  select status into v_status from public.billing_settings where key = 'hire_fee_role_source';
  if v_status is null then raise exception 'unknown setting'; end if;
  if v_status = 'decided' then raise exception 'hire role rule already decided'; end if;
  -- 実行前: 自動請求とカード必須化が 'false' であること（null・未設定・'true' はすべて中止）
  if public._billing_setting('auto_charge_enabled') is distinct from 'false' or public._billing_setting('salon_card_required') is distinct from 'false' then
    raise exception 'auto charge and card requirement must be off before this decision'; end if;
  perform set_config('app.billing_setting_note', '2026-11-27決定: 採用料の区分は運営が本人に確認した登録区分（担当業務では決めない）', true);
  perform public.admin_billing_setting_set('hire_fee_role_source', 'operator_confirmed_registration_class', 'decided');
  perform set_config('app.billing_setting_note', '', true);
  -- 実行後: 同じく 'false' のままであること（外れていれば例外。この操作の全体が戻る）
  if public._billing_setting('auto_charge_enabled') is distinct from 'false' or public._billing_setting('salon_card_required') is distinct from 'false' then
    raise exception 'auto charge and card requirement must be off after this decision'; end if;
end; $$;

revoke all on function public._billing_setting_changes_immutable(), public._billing_setting_log_change() from public, anon, authenticated, service_role;
revoke all on function public.admin_billing_setting_changes_list(integer), public.admin_billing_hire_role_rule_decide() from public, anon, service_role;
grant execute on function public.admin_billing_setting_changes_list(integer), public.admin_billing_hire_role_rule_decide() to authenticated;

-- 適用後の確認（この取引の中）: 課金設定の中身・依存関数・表の形が適用前と同一であること。違えば例外で全体を戻す
do $post$
declare v_b record; v_a record;
begin
  select * into v_b from _br0113_before;
  select
    md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅'), ';' order by key) from public.billing_settings),'')) as core,
    md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅')||'|'||coalesce(note,'∅')||'|'||coalesce(updated_by::text,'∅')||'|'||coalesce(updated_at::text,'∅'), ';' order by key) from public.billing_settings),'')) as full_,
    (select count(*) from public.billing_settings) as n,
    md5(coalesce((select string_agg(t.sig||'='||coalesce(md5(p.prosrc||'|'||pg_get_function_arguments(p.oid)||'|'||pg_get_function_result(p.oid)||'|'||p.prosecdef::text||'|'||p.provolatile::text||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'')||'|'||coalesce(p.proconfig::text,'')),'∅'),';' order by t.sig)
        from (values ('public.admin_billing_setting_set(text,text,text)'),('public._billing_responsible_guard()'),('public._billing_setting(text)'),('public.admin_billing_settings_list()'),('public.is_platform_admin()')) t(sig)
        left join pg_proc p on p.oid = to_regprocedure(t.sig)),'')
      ||'#'||coalesce((select pg_get_userbyid(c.relowner)||'|'||c.relkind::text||'|'||c.relrowsecurity::text||'|'||coalesce(c.relacl::text,'')||'|'||
          (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)||'|'||
          coalesce((select string_agg(pg_get_constraintdef(k.oid),',' order by k.conname) from pg_constraint k where k.conrelid=c.oid),'')
        from pg_class c where c.oid=to_regclass('public.billing_settings')),'∅')) as deps
  into v_a;
  if v_a.core is distinct from v_b.core or v_a.full_ is distinct from v_b.full_ or v_a.n is distinct from v_b.n then
    raise exception '課金設定の中身が適用前と違います。中止して全体を戻します'; end if;
  if v_a.deps is distinct from v_b.deps then
    raise exception '依存する既存の関数または billing_settings の形が適用前と違います。中止して全体を戻します'; end if;
  if public._billing_setting('auto_charge_enabled') is distinct from 'false' or public._billing_setting('salon_card_required') is distinct from 'false' then
    raise exception '自動請求またはカード必須が false ではありません。中止して全体を戻します'; end if;
end $post$;
select 'OK: 0113 applied in this transaction（課金設定は適用前と同一）' as result;
commit;
