-- 0097_admin_staff_v2.draft.sql（草案・未適用・番号は提案。本番適用・commit・pushはレビューまで保留）
-- 旧0097草案（未適用）を置き換える。責任者（platform_admins / is_platform_admin()）と既存の運営RPCは一切変更しない。新規オブジェクトのみ。
-- 要点:
--  ・状態は invited(招待済み・未承諾) / active(有効なスタッフ) / suspended。登録しただけでは業務権限を持たない。active は本人が承諾(admin_staff_accept)して初めて。
--  ・招待の状態機械 admin_staff_invitations（request_id で冪等）。認証アカウントを「この操作で新規に作った・未使用」と証明できるものだけ補償削除の対象にする。既存利用者は採用も削除もしない。
--  ・停止は毎回の判定で即時に効く。再開後の再ログインは session_valid_after と JWT の session_id で担保（古いセッション由来のトークンは、再開後も拒否）。
-- ★検査（指紋）方式のガード生成は、設計のレビュー後に地域検索と同じ生成器で作る（未実施）。ここでは新規名の不在確認と適用後の存在確認だけを入れている。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('beauty-reach-0097v2'));
do $guard$
begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname in ('admin_staff', 'admin_staff_events', 'admin_staff_invitations'))
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_staff_events_immutable','is_admin_staff_active','is_admin_operator','admin_operator_role','_staff_session_ok','_staff_auth_user_unused',
        'admin_staff_invite_begin','admin_staff_invite_mark_auth_created','admin_staff_invite_register','admin_staff_invite_compensation_begin','admin_staff_invite_compensation_done','admin_staff_invitations_open',
        'admin_staff_accept','admin_staff_rename','admin_staff_set_status','admin_staff_list','admin_operator_directory')) then
    raise exception '0097v2 適用中止: 新規オブジェクトが既に存在します（二重適用または名前衝突）。何も変更しません' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null or to_regclass('public.platform_admins') is null or to_regclass('public.user_roles') is null then
    raise exception '0097v2 適用中止: 依存する既存オブジェクト(is_platform_admin・platform_admins・user_roles)がありません' using errcode = 'P0001';
  end if;
end $guard$;

-- ---- 1) スタッフ表（RPC経由のみ） ----
create table public.admin_staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  status text not null check (status in ('invited', 'active', 'suspended')),
  registered_by uuid not null references auth.users(id) on delete restrict,
  registered_at timestamptz not null default now(),
  accepted_at timestamptz,
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references auth.users(id) on delete restrict,
  session_valid_after timestamptz not null default now(),     -- この時刻より前に作られたセッション由来のトークンは、業務操作に使えない（登録・停止・再開のたびに更新）
  constraint admin_staff_active_needs_accept check (status <> 'active' or accepted_at is not null),
  constraint admin_staff_invited_not_accepted check (status <> 'invited' or accepted_at is null)
);
alter table public.admin_staff enable row level security;
revoke all on table public.admin_staff from public, anon, authenticated, service_role;
comment on table public.admin_staff is '運営スタッフ。invited=招待済み(権限なし)、active=承諾済みで有効、suspended=停止。履歴保持のためauth.users削除はRESTRICT。';

-- ---- 2) 管理操作の履歴（追記専用） ----
create table public.admin_staff_events (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('invited', 'accepted', 'renamed', 'suspended', 'reactivated', 'resent', 'password_reset')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index admin_staff_events_staff_idx on public.admin_staff_events (staff_user_id, created_at desc);
alter table public.admin_staff_events enable row level security;
revoke all on table public.admin_staff_events from public, anon, authenticated, service_role;
create function public.admin_staff_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp
as $$ begin raise exception 'admin_staff_events is append-only'; end; $$;
create trigger admin_staff_events_no_change before update or delete on public.admin_staff_events for each row execute function public.admin_staff_events_immutable();
create trigger admin_staff_events_no_truncate before truncate on public.admin_staff_events for each statement execute function public.admin_staff_events_immutable();
revoke all on function public.admin_staff_events_immutable() from public, anon, authenticated, service_role;

-- ---- 3) 招待の状態機械（request_id で冪等。認証アカウント作成の成否を記録し、補償の可否を判定する） ----
-- started → auth_created → registered（完了）／ started → aborted（安全でない採用の拒否など）
-- auth_created → compensating → compensated（補償完了）／ compensation_failed（再処理可）
create table public.admin_staff_invitations (
  request_id uuid primary key,                                  -- 画面が発行する冪等キー。同じ値での再実行は同じ招待の続きになる
  email_norm text not null check (email_norm = lower(btrim(email_norm)) and email_norm ~ '^[^@\s]+@[^@\s]+$' and char_length(email_norm) <= 254),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null check (status in ('started', 'auth_created', 'registered', 'aborted', 'compensating', 'compensated', 'compensation_failed')),
  auth_user_id uuid,                                            -- 外部キーなし（補償で認証アカウントが消えても記録は残す）
  last_error text check (last_error is null or char_length(last_error) <= 60),   -- 分類コードのみ（メール・本文を入れない）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index admin_staff_invitations_open_email on public.admin_staff_invitations (email_norm) where status in ('started', 'auth_created', 'compensating', 'compensation_failed');
alter table public.admin_staff_invitations enable row level security;
revoke all on table public.admin_staff_invitations from public, anon, authenticated, service_role;

-- ---- 4) 判定（毎回表を参照＝停止は即時。再開後の再ログイン要求は session_valid_after と JWT の session_id） ----
-- 内部: 現在のJWTのセッションが、基準時刻以降に作られた「実在するセッション」か。session_id が無い・不正・存在しない場合は拒否（fail closed）。
-- ★リフレッシュしてもセッションの作成時刻は変わらない。よって停止前のセッションは、再開後にトークンを更新しても通らない（新規ログインが必要）。
create function public._staff_session_ok(p_valid_after timestamptz) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_sid text := auth.jwt() ->> 'session_id';
begin
  if v_sid is null or v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return exists (select 1 from auth.sessions s where s.id = v_sid::uuid and s.user_id = auth.uid() and s.created_at >= p_valid_after);
end; $$;
revoke all on function public._staff_session_ok(timestamptz) from public, anon, authenticated, service_role;

create function public.is_admin_staff_active() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and not exists (select 1 from public.platform_admins where user_id = auth.uid())
    and exists (select 1 from public.admin_staff st where st.user_id = auth.uid() and st.status = 'active' and public._staff_session_ok(st.session_valid_after));
$$;
create function public.is_admin_operator() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select public.is_platform_admin() or public.is_admin_staff_active(); $$;
-- 画面・検証用: 'responsible' / 'staff' / null（拒否理由は返さない）
create function public.admin_operator_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select case when public.is_platform_admin() then 'responsible' when public.is_admin_staff_active() then 'staff' else null end; $$;
revoke all on function public.is_admin_staff_active(), public.is_admin_operator(), public.admin_operator_role() from public, anon, authenticated, service_role;
grant execute on function public.is_admin_staff_active(), public.is_admin_operator(), public.admin_operator_role() to authenticated;

-- ---- 5) 招待（責任者のJWTで呼ぶ。認証アカウントの作成・削除はサーバー側が秘密キーで行い、結果をここへ記録する） ----
-- 認証アカウントを「使われていない新規のもの」と言えるか。採用・補償削除の前に必ず通す。
-- 条件: 存在する／メールが一致／作成時に付けた invite_request_id が一致（本操作で作ったことの証明）／招待開始以後に作成／ログイン実績なし／どの権限・組織にも属さず、プロフィールは既定のまま
create function public._staff_auth_user_unused(p_request_id uuid, p_user_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare i public.admin_staff_invitations; u record;
begin
  select * into i from public.admin_staff_invitations where request_id = p_request_id;
  if not found or p_user_id is null then return false; end if;
  select id, email, created_at, last_sign_in_at, raw_user_meta_data into u from auth.users where id = p_user_id;
  if not found then return false; end if;
  return coalesce(lower(btrim(coalesce(u.email, ''))) = i.email_norm
     and (u.raw_user_meta_data ->> 'invite_request_id') = p_request_id::text
     and u.created_at >= i.created_at
     and u.last_sign_in_at is null
     and not exists (select 1 from public.platform_admins where user_id = p_user_id)
     and not exists (select 1 from public.user_roles where user_id = p_user_id)
     and not exists (select 1 from public.organization_members where user_id = p_user_id)
     and not exists (select 1 from public.profiles where id = p_user_id and (avatar_path is not null or onboarding_step <> 0 or profile_version <> 1))   -- 既存のトリガー(handle_new_user)が全利用者に既定のprofilesを作る。既定のままなら未使用
     and not exists (select 1 from public.stylist_profiles where user_id = p_user_id)
     and not exists (select 1 from public.admin_staff where user_id = p_user_id), false);   -- NULL(メタデータ無し等)は必ず『未使用ではない』扱いにする
end; $$;
revoke all on function public._staff_auth_user_unused(uuid, uuid) from public, anon, authenticated, service_role;

-- 開始／再処理。返す action: create_auth(認証アカウントを作る) / mark_auth(作成済みを記録) / register(登録) / done / compensate(補償) / terminal(終了済み・新しいrequest_idで再実行)
create function public.admin_staff_invite_begin(p_request_id uuid, p_email text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_email text := lower(btrim(coalesce(p_email, ''))); v_name text := btrim(coalesce(p_display_name, '')); i public.admin_staff_invitations; v_open uuid;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  if p_request_id is null then raise exception 'request_id required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_staff_invite:' || p_request_id::text, 0));
  select * into i from public.admin_staff_invitations where request_id = p_request_id for update;
  if found then
    if i.email_norm <> v_email then raise exception 'request_id reused with a different email'; end if;      -- 同じ冪等キーで別のメールは拒否
    return jsonb_build_object('request_id', i.request_id, 'status', i.status, 'auth_user_id', i.auth_user_id,
      'action', case i.status when 'started' then 'create_auth' when 'auth_created' then 'register' when 'registered' then 'done'
                              when 'compensating' then 'compensate' when 'compensation_failed' then 'compensate' else 'terminal' end);
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+$' or char_length(v_email) > 254 then raise exception 'invalid email'; end if;
  if v_name = '' or char_length(v_name) > 60 then raise exception 'invalid name'; end if;
  select request_id into v_open from public.admin_staff_invitations where email_norm = v_email and status in ('started', 'auth_created', 'compensating', 'compensation_failed');
  if found then raise exception 'open_invitation_exists'; end if;
  if exists (select 1 from auth.users where lower(btrim(coalesce(email, ''))) = v_email) then raise exception 'existing_user'; end if;   -- 既存の利用者は採用しない・削除しない
  insert into public.admin_staff_invitations (request_id, email_norm, display_name, actor_user_id, status) values (p_request_id, v_email, v_name, v_uid, 'started');
  return jsonb_build_object('request_id', p_request_id, 'status', 'started', 'action', 'create_auth', 'auth_user_id', null);
end; $$;

-- 認証アカウント作成後に、その id を記録。「本操作で作った・未使用」を満たさなければ採用せず中止（削除もしない）。
create function public.admin_staff_invite_mark_auth_created(p_request_id uuid, p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.admin_staff_invitations;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_staff_invite:' || p_request_id::text, 0));
  select * into i from public.admin_staff_invitations where request_id = p_request_id for update;
  if not found then raise exception 'invitation not found'; end if;
  if i.status = 'auth_created' and i.auth_user_id = p_auth_user_id then return jsonb_build_object('ok', true, 'status', 'auth_created'); end if;   -- 冪等
  if i.status <> 'started' then raise exception 'invalid state: %', i.status; end if;
  if public._staff_auth_user_unused(p_request_id, p_auth_user_id) is not true then
    update public.admin_staff_invitations set status = 'aborted', last_error = 'unsafe_adopt', updated_at = now() where request_id = p_request_id;
    return jsonb_build_object('ok', false, 'status', 'aborted', 'may_delete', false);
  end if;
  update public.admin_staff_invitations set status = 'auth_created', auth_user_id = p_auth_user_id, updated_at = now() where request_id = p_request_id;
  return jsonb_build_object('ok', true, 'status', 'auth_created');
end; $$;

-- スタッフ登録（status=invited。業務権限なし）。session_valid_after を更新。
create function public.admin_staff_invite_register(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); i public.admin_staff_invitations;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_staff_invite:' || p_request_id::text, 0));
  select * into i from public.admin_staff_invitations where request_id = p_request_id for update;
  if not found then raise exception 'invitation not found'; end if;
  if i.status = 'registered' then return jsonb_build_object('ok', true, 'status', 'registered'); end if;   -- 冪等
  if i.status <> 'auth_created' then raise exception 'invalid state: %', i.status; end if;
  if public._staff_auth_user_unused(p_request_id, i.auth_user_id) is not true then raise exception 'auth user is no longer unused'; end if;
  insert into public.admin_staff (user_id, display_name, status, registered_by, status_changed_by, session_valid_after)
    values (i.auth_user_id, i.display_name, 'invited', v_uid, v_uid, now());
  insert into public.admin_staff_events (staff_user_id, actor_user_id, action) values (i.auth_user_id, v_uid, 'invited');
  update public.admin_staff_invitations set status = 'registered', last_error = null, updated_at = now() where request_id = p_request_id;
  return jsonb_build_object('ok', true, 'status', 'registered');
end; $$;

-- 補償（登録に失敗した等）の開始。削除してよいのは、本操作で作った・未使用・スタッフ未登録の認証アカウントだけ。
create function public.admin_staff_invite_compensation_begin(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.admin_staff_invitations;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_staff_invite:' || p_request_id::text, 0));
  select * into i from public.admin_staff_invitations where request_id = p_request_id for update;
  if not found then raise exception 'invitation not found'; end if;
  if i.status not in ('auth_created', 'compensating', 'compensation_failed') then raise exception 'invalid state: %', i.status; end if;
  if i.auth_user_id is not null and not exists (select 1 from auth.users where id = i.auth_user_id) then   -- 既に消えている（前回の削除は成功していた）
    update public.admin_staff_invitations set status = 'compensated', last_error = null, updated_at = now() where request_id = p_request_id;
    return jsonb_build_object('may_delete', false, 'status', 'compensated');
  end if;
  if public._staff_auth_user_unused(p_request_id, i.auth_user_id) is not true then   -- 使われている・本操作のものと証明できない・スタッフ登録済み → 削除しない。手動の確認が必要
    update public.admin_staff_invitations set status = 'compensation_failed', last_error = 'not_deletable', updated_at = now() where request_id = p_request_id;
    return jsonb_build_object('may_delete', false, 'status', 'compensation_failed', 'reason', 'not_deletable');
  end if;
  update public.admin_staff_invitations set status = 'compensating', updated_at = now() where request_id = p_request_id;
  return jsonb_build_object('may_delete', true, 'status', 'compensating', 'auth_user_id', i.auth_user_id);
end; $$;

-- 補償の結果を記録。削除成功の申告でも、認証アカウントが実際に無くなっていなければ完了にしない。
create function public.admin_staff_invite_compensation_done(p_request_id uuid, p_deleted boolean, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.admin_staff_invitations;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_staff_invite:' || p_request_id::text, 0));
  select * into i from public.admin_staff_invitations where request_id = p_request_id for update;
  if not found then raise exception 'invitation not found'; end if;
  if i.status = 'compensated' then return jsonb_build_object('status', 'compensated'); end if;   -- 冪等
  if i.status <> 'compensating' then raise exception 'invalid state: %', i.status; end if;
  if coalesce(p_deleted, false) and not exists (select 1 from auth.users where id = i.auth_user_id) then
    update public.admin_staff_invitations set status = 'compensated', last_error = null, updated_at = now() where request_id = p_request_id;
    return jsonb_build_object('status', 'compensated');
  end if;
  update public.admin_staff_invitations set status = 'compensation_failed', last_error = left(coalesce(nullif(regexp_replace(coalesce(p_error, ''), '[^a-z0-9_]', '', 'g'), ''), case when coalesce(p_deleted, false) then 'still_exists' else 'delete_failed' end), 60), updated_at = now() where request_id = p_request_id;
  return jsonb_build_object('status', 'compensation_failed');
end; $$;

-- 責任者向け: 完了していない招待（補償失敗を含む）の一覧
create function public.admin_staff_invitations_open() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('request_id', request_id, 'email', email_norm, 'display_name', display_name, 'status', status, 'last_error', last_error, 'created_at', created_at) order by created_at)
                   from public.admin_staff_invitations where status in ('started', 'auth_created', 'compensating', 'compensation_failed', 'aborted')), '[]'::jsonb);
end; $$;

-- 再送（招待中のスタッフの有効期限を延ばし、新しいリンクを出せる状態にする。責任者のみ）。宛先メール・宛名はDBが返す（画面からの入力を使わない）。招待中(invited)だけ。期限切れも対象。
-- 認証側のリンク（メールのリンクは数時間〜最長24時間で失効する別の期限）は、サーバーが新しく発行する。ここでは14日の起点と履歴を更新する。
create function public.admin_staff_invite_resend(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); st public.admin_staff; v_email text;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  lock table public.admin_staff, public.admin_staff_events in row exclusive mode;
  select * into st from public.admin_staff where user_id = p_user_id for update;
  if not found then raise exception 'staff not found'; end if;
  if st.status <> 'invited' then raise exception 'only a pending invitation can be resent'; end if;
  if (select count(*) from public.admin_staff_events where staff_user_id = p_user_id and action = 'resent' and created_at > now() - interval '1 hour') >= 5 then raise exception 'too many resends'; end if;
  update public.admin_staff set registered_at = now(), status_changed_at = now(), status_changed_by = v_uid where user_id = p_user_id;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or btrim(v_email) = '' then raise exception 'staff has no email'; end if;
  insert into public.admin_staff_events (staff_user_id, actor_user_id, action) values (p_user_id, v_uid, 'resent');
  -- 宛先と宛名はDBが確定して返す（呼び出し側の入力は使わない）
  return jsonb_build_object('ok', true, 'status', 'invited', 'email', v_email, 'display_name', st.display_name);
end; $$;

-- パスワード再設定の送信前処理（責任者のみ）。承諾済みで有効(active)なスタッフだけ。
-- ・宛先メールはDBから返す（呼び出し側の入力を信用しない）。パスワードそのものはどこにも渡さない・保存しない（本人が再設定リンクから設定する）。
-- ・履歴(password_reset)を残す。1時間に5回まで。招待中は再送(admin_staff_invite_resend)、停止中は再開してから。
create function public.admin_staff_password_reset_begin(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); st public.admin_staff; v_email text;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  lock table public.admin_staff, public.admin_staff_events in row exclusive mode;
  select * into st from public.admin_staff where user_id = p_user_id for update;
  if not found then raise exception 'staff not found'; end if;
  if st.status <> 'active' then raise exception 'only an active staff can be reset'; end if;
  if (select count(*) from public.admin_staff_events where staff_user_id = p_user_id and action = 'password_reset' and created_at > now() - interval '1 hour') >= 5 then raise exception 'too many resets'; end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or btrim(v_email) = '' then raise exception 'staff has no email'; end if;
  insert into public.admin_staff_events (staff_user_id, actor_user_id, action) values (p_user_id, v_uid, 'password_reset');
  return jsonb_build_object('ok', true, 'email', v_email, 'display_name', st.display_name);
end; $$;

-- ---- 6) 本人の承諾・改名・停止/再開・一覧・担当候補 ----
-- 本人が承諾して初めて active。メール確認済みの本人のログインが必要。期限は招待から14日。
create function public.admin_staff_accept() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); st public.admin_staff;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  lock table public.admin_staff, public.admin_staff_events in row exclusive mode;
  select * into st from public.admin_staff where user_id = v_uid for update;
  if not found or st.status <> 'invited' then raise exception 'no pending invitation'; end if;
  -- 停止・再開より前に作られたセッション(発行済みリンクで入った等)では承諾させない
  if not public._staff_session_ok(st.session_valid_after) then raise exception 'no pending invitation'; end if;
  if st.registered_at < now() - interval '14 days' then raise exception 'invitation expired'; end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then raise exception 'email not confirmed'; end if;
  update public.admin_staff set status = 'active', accepted_at = now(), status_changed_at = now(), status_changed_by = v_uid where user_id = v_uid;
  insert into public.admin_staff_events (staff_user_id, actor_user_id, action) values (v_uid, v_uid, 'accepted');
end; $$;

create function public.admin_staff_rename(p_user_id uuid, p_display_name text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_name text := btrim(p_display_name);
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  lock table public.admin_staff, public.admin_staff_events in row exclusive mode;
  if v_name is null or v_name = '' or char_length(v_name) > 60 then raise exception 'invalid name'; end if;
  update public.admin_staff set display_name = v_name where user_id = p_user_id;
  if not found then raise exception 'staff not found'; end if;
  insert into public.admin_staff_events (staff_user_id, actor_user_id, action) values (p_user_id, v_uid, 'renamed');
end; $$;

-- 停止／再開（責任者のみ）。停止・再開のどちらも session_valid_after を更新し、既存セッションを（可能なら）失効させる。
-- 再開先: 一度も承諾していない人は invited に戻る（active にはしない）。
-- ★セッション失効(auth.sessions の削除)は補助策。権限が無い環境では行わず、判定側(_staff_session_ok)が主たる担保。
create function public.admin_staff_set_status(p_user_id uuid, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); cur public.admin_staff; v_new text; v_revoked integer := null;
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  lock table public.admin_staff, public.admin_staff_events in row exclusive mode;
  if p_status not in ('active', 'suspended') then raise exception 'invalid status'; end if;
  select * into cur from public.admin_staff where user_id = p_user_id for update;
  if not found then raise exception 'staff not found'; end if;
  if p_status = 'suspended' then
    if cur.status = 'suspended' then return jsonb_build_object('changed', false); end if;
    v_new := 'suspended';
  else
    if cur.status <> 'suspended' then return jsonb_build_object('changed', false); end if;     -- 停止中でなければ何もしない（invited を active にはできない）
    v_new := case when cur.accepted_at is null then 'invited' else 'active' end;
  end if;
  update public.admin_staff set status = v_new, status_changed_at = now(), status_changed_by = v_uid, session_valid_after = now() where user_id = p_user_id;
  insert into public.admin_staff_events (staff_user_id, actor_user_id, action, reason)
    values (p_user_id, v_uid, case p_status when 'suspended' then 'suspended' else 'reactivated' end, left(p_reason, 500));
  begin
    delete from auth.sessions where user_id = p_user_id; get diagnostics v_revoked = row_count;
  exception when insufficient_privilege or undefined_table then v_revoked := null;
  end;
  return jsonb_build_object('changed', true, 'status', v_new, 'sessions_revoked', v_revoked);
end; $$;

create function public.admin_staff_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'responsible admin required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'display_name', s.display_name, 'email', u.email, 'status', s.status,
           'registered_at', s.registered_at, 'accepted_at', s.accepted_at, 'status_changed_at', s.status_changed_at) order by s.registered_at)
         from public.admin_staff s join auth.users u on u.id = s.user_id), '[]'::jsonb);
end; $$;

-- 担当者候補・氏名表示（責任者と、承諾済みの有効スタッフ。メールは返さない）。停止中は履歴の氏名表示用に status 付きで返す。invited は含めない。
create function public.admin_operator_directory() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'role', x ->> 'display_name') from (
      select jsonb_build_object('user_id', s.user_id, 'display_name', s.display_name, 'role', 'staff', 'status', s.status) x from public.admin_staff s where s.status in ('active', 'suspended')
      union all
      select jsonb_build_object('user_id', p.user_id, 'display_name', coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), '責任者'), 'role', 'responsible', 'status', 'active')
        from public.platform_admins p join auth.users u on u.id = p.user_id
    ) q), '[]'::jsonb);
end; $$;

-- 自分の運営での状態（画面の出し分け専用。権限判定ではない＝各RPCが改めて確認する）。招待中・停止中・再ログイン待ちも返す。メール・他人の情報は返さない。
-- state: responsible / staff_active / staff_invited / staff_invited_expired / staff_suspended / staff_relogin / none
create function public.admin_my_operator_state() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); st public.admin_staff; v_state text;
begin
  if v_uid is null then return jsonb_build_object('state', 'none'); end if;
  if public.is_platform_admin() then return jsonb_build_object('state', 'responsible'); end if;
  select * into st from public.admin_staff where user_id = v_uid;
  if not found then return jsonb_build_object('state', 'none'); end if;
  v_state := case
    when st.status = 'suspended' then 'staff_suspended'
    when st.status = 'invited' and st.registered_at < now() - interval '14 days' then 'staff_invited_expired'
    when st.status = 'invited' then 'staff_invited'
    when public._staff_session_ok(st.session_valid_after) then 'staff_active'
    else 'staff_relogin' end;
  return jsonb_build_object('state', v_state, 'display_name', st.display_name);
end; $$;

-- ---- 7) 権限（必要最小限）。表・内部関数は誰にも直接付けない。RPCは authenticated のみ（中で責任者/運営/本人を確認）。service_role・anon・PUBLIC には付けない ----
revoke all on function public.admin_staff_invite_begin(uuid, text, text), public.admin_staff_invite_mark_auth_created(uuid, uuid), public.admin_staff_invite_register(uuid),
  public.admin_staff_invite_compensation_begin(uuid), public.admin_staff_invite_compensation_done(uuid, boolean, text), public.admin_staff_invitations_open(), public.admin_staff_invite_resend(uuid), public.admin_staff_password_reset_begin(uuid),
  public.admin_staff_accept(), public.admin_staff_rename(uuid, text), public.admin_staff_set_status(uuid, text, text), public.admin_staff_list(), public.admin_operator_directory(), public.admin_my_operator_state()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_staff_invite_begin(uuid, text, text), public.admin_staff_invite_mark_auth_created(uuid, uuid), public.admin_staff_invite_register(uuid),
  public.admin_staff_invite_compensation_begin(uuid), public.admin_staff_invite_compensation_done(uuid, boolean, text), public.admin_staff_invitations_open(), public.admin_staff_invite_resend(uuid), public.admin_staff_password_reset_begin(uuid),
  public.admin_staff_accept(), public.admin_staff_rename(uuid, text), public.admin_staff_set_status(uuid, text, text), public.admin_staff_list(), public.admin_operator_directory(), public.admin_my_operator_state() to authenticated;
commit;
