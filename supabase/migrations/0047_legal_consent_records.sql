-- ============================================================================
-- 0047_legal_consent_records.sql
--
-- 利用規約・プライバシーポリシーへの同意履歴（誰が・何に・どの版へ・いつ同意したか）を、
-- 後から証明できる形で永続化する。UIの確認チェックだけで済ませない。
--
-- ★構成
--   1. legal_documents          公開された規約の版（document_type・version・content_hash・施行日）。追記専用。
--   2. user_legal_acceptances   ユーザーの同意記録。追記専用（更新・削除不可）。
--
-- ★設計の要点
--   ・公開時に、ユーザーへ提示する「完成した本文」（運営者名・住所・問い合わせ先・施行日を含む）を
--     content_snapshot として不変保存する。後から環境変数やコードが変わっても、過去の版の本文は
--     変わらない。content_hash は、保存した content_snapshot からDBが計算する（呼び出し側が
--     指定したハッシュは信用しない）。
--   ・同意記録は document_id（legal_documents は削除不可）と、そのときの document_type /
--     version / content_hash を持つので、どの本文に同意したかを後から特定・証明できる。
--   ・同意は document 単位（terms と privacy を別々の行）。現在の版 = 種別ごとに、施行日が
--     過去で最新のもの。公開された版が無い種別は「同意不要」（nothing to accept）。
--   ・同意の主体は auth.uid() のみ。他人の分は記録できない。
--   ・user_id には外部キーを付けない（アカウント削除後も、同意の証拠を追記専用のまま保持する
--     ため。ON DELETE CASCADE/SET NULL は追記専用と両立しない）。
--   ・同意時のロール（stylist / salon）を role_context として残す（未選択なら null）。
--   ・版の公開は platform admin のみ（admin_publish_legal_document）。本文のハッシュはアプリが
--     コードの本文から計算して渡す。一度公開した版は変更・削除できない。
--   ・テーブルは RLS有効・権限なし。必ず SECURITY DEFINER RPC 経由。
--   ・個人を特定する内容（メール等）は同意記録に複製しない。IP・UserAgentも記録しない。
--
-- ★既存 0001〜0046 は編集しない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. legal_documents（公開された版・追記専用）
-- ----------------------------------------------------------------------------
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('terms', 'privacy')),
  version text not null check (char_length(version) between 1 and 40),
  title text not null check (char_length(title) between 1 and 100),
  -- その版でユーザーに提示する完成した本文（アプリが組み立てたJSON文字列）。公開後は変更不可。
  content_snapshot text not null check (char_length(content_snapshot) between 1 and 300000),
  -- 保存した本文からDBが計算したSHA-256（制約でも、本文と一致しない値を拒否する）。
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'
    and content_hash = encode(sha256(convert_to(content_snapshot, 'UTF8')), 'hex')),
  effective_at timestamptz not null,
  published_at timestamptz not null default now(),
  published_by_user_id uuid,  -- FK無し（履歴識別子）
  unique (document_type, version)
);
comment on table public.legal_documents is
  '公開された利用規約・プライバシーポリシーの版。公開時点の完成した本文（content_snapshot）とそのSHA-256を不変保存する。追記専用。';
alter table public.legal_documents enable row level security;
revoke all on public.legal_documents from public, anon, authenticated;

create trigger legal_documents_append_only
  before update or delete on public.legal_documents
  for each row execute function public.billing_append_only();
create trigger legal_documents_no_truncate
  before truncate on public.legal_documents
  for each statement execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 2. user_legal_acceptances（同意記録・追記専用）
-- ----------------------------------------------------------------------------
create table public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,  -- FK無し（アカウント削除後も証拠を保持）
  document_id uuid not null references public.legal_documents(id),
  document_type text not null,
  version text not null,
  content_hash text not null,
  role_context text check (role_context is null or role_context in ('stylist', 'salon')),
  context text not null check (context in ('first_acceptance', 'reacceptance')),
  accepted_at timestamptz not null default now(),
  unique (user_id, document_id)
);
comment on table public.user_legal_acceptances is
  'ユーザーの規約同意記録（誰が・どの版・どの本文ハッシュに・いつ）。追記専用。user_idは外部キーなし。';
create index user_legal_acceptances_user_idx on public.user_legal_acceptances (user_id, accepted_at desc);
alter table public.user_legal_acceptances enable row level security;
revoke all on public.user_legal_acceptances from public, anon, authenticated;

create trigger user_legal_acceptances_append_only
  before update or delete on public.user_legal_acceptances
  for each row execute function public.billing_append_only();
create trigger user_legal_acceptances_no_truncate
  before truncate on public.user_legal_acceptances
  for each statement execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 3. 現在の版（内部用ヘルパー）
-- ----------------------------------------------------------------------------
-- 種別ごとに「施行日が過去」で最新（同日なら公開が新しい）の1件。
create or replace function public.current_legal_documents()
returns setof public.legal_documents
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct on (d.document_type) d.*
  from public.legal_documents d
  where d.effective_at <= now()
  order by d.document_type, d.effective_at desc, d.published_at desc, d.id;
$$;
revoke all on function public.current_legal_documents() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. 公開RPC
-- ----------------------------------------------------------------------------
-- 現在の版（誰でも読める。公開ページの表示用に本文snapshotを含む）。
create or replace function public.get_current_legal_documents()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id', d.id, 'document_type', d.document_type, 'version', d.version, 'title', d.title,
    'content_hash', d.content_hash, 'content_snapshot', d.content_snapshot, 'effective_at', d.effective_at
  ) order by d.document_type), '[]'::jsonb)
  from public.current_legal_documents() d;
$$;
revoke all on function public.get_current_legal_documents() from public;
grant execute on function public.get_current_legal_documents() to anon, authenticated;

-- 自分が現在の版すべてに同意済みか。公開された版が無ければ同意不要（accepted = true）。
create or replace function public.get_my_legal_acceptance_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_pending jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id', d.id, 'document_type', d.document_type, 'version', d.version, 'title', d.title,
    'content_hash', d.content_hash
  ) order by d.document_type), '[]'::jsonb)
  into v_pending
  from public.current_legal_documents() d
  where not exists (
    select 1 from public.user_legal_acceptances a where a.user_id = v_uid and a.document_id = d.id
  );
  return jsonb_build_object('accepted', jsonb_array_length(v_pending) = 0, 'pending', v_pending);
end;
$$;
revoke all on function public.get_my_legal_acceptance_status() from public, anon;
grant execute on function public.get_my_legal_acceptance_status() to authenticated;

-- 同意を記録する。p_documents = [{document_id, document_type, version, content_hash}, ...]
--   ・未同意の「現在の版」すべてを、版とハッシュが一致する形で送らなければならない
--     （版が更新された／一部だけ／ハッシュ違いは拒否 → 古い画面での誤った同意を防ぐ）。
--   ・同意済みの版は再記録しない（二重記録しない）。戻り値は新しく記録した件数。
create or replace function public.accept_legal_documents(p_documents jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_had_any boolean;
  v_item jsonb;
  v_doc public.legal_documents;
  v_pending_ids uuid[];
  v_given_ids uuid[] := '{}';
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_documents is null or jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents) = 0 then
    raise exception 'documents are required';
  end if;
  if jsonb_array_length(p_documents) > 10 then raise exception 'too many documents'; end if;

  select array_agg(d.id) into v_pending_ids
  from public.current_legal_documents() d
  where not exists (select 1 from public.user_legal_acceptances a where a.user_id = v_uid and a.document_id = d.id);
  v_pending_ids := coalesce(v_pending_ids, '{}');

  for v_item in select * from jsonb_array_elements(p_documents) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'invalid document'; end if;
    select d.* into v_doc
    from public.current_legal_documents() d
    where d.document_type = v_item ->> 'document_type';
    if v_doc.id is null
       or v_doc.id::text is distinct from (v_item ->> 'document_id')
       or v_doc.version is distinct from (v_item ->> 'version')
       or v_doc.content_hash is distinct from (v_item ->> 'content_hash') then
      raise exception 'legal documents have changed';
    end if;
    v_given_ids := array_append(v_given_ids, v_doc.id);
  end loop;

  -- 未同意の現在の版がすべて含まれていること。
  if exists (select 1 from unnest(v_pending_ids) p where not (p = any (v_given_ids))) then
    raise exception 'legal documents have changed';
  end if;

  select role into v_role from public.user_roles where user_id = v_uid;
  select exists (select 1 from public.user_legal_acceptances where user_id = v_uid) into v_had_any;

  insert into public.user_legal_acceptances
    (user_id, document_id, document_type, version, content_hash, role_context, context)
  select v_uid, d.id, d.document_type, d.version, d.content_hash,
         case when v_role in ('stylist', 'salon') then v_role else null end,
         case when v_had_any then 'reacceptance' else 'first_acceptance' end
  from public.current_legal_documents() d
  where d.id = any (v_given_ids)
  on conflict (user_id, document_id) do nothing;
  get diagnostics v_count = row_count;

  return jsonb_build_object('recorded', v_count);
end;
$$;
revoke all on function public.accept_legal_documents(jsonb) from public, anon;
grant execute on function public.accept_legal_documents(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 運営者RPC（platform adminのみ）
-- ----------------------------------------------------------------------------
-- 版を公開する。公開済みの版は変更・削除できない（誤りは新しい版で上書きする）。
--   p_content_snapshot はアプリが組み立てた「完成した本文」（JSON文字列。運営者情報・施行日を含む）。
--   content_hash は、この本文からDBが計算する。snapshot内の document_type / version が引数と
--   一致しなければ拒否する。
create or replace function public.admin_publish_legal_document(
  p_document_type text,
  p_version text,
  p_title text,
  p_content_snapshot text,
  p_effective_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.legal_documents;
  v_json jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_document_type is null or p_document_type not in ('terms', 'privacy') then raise exception 'invalid document type'; end if;
  if p_version is null or btrim(p_version) = '' or char_length(p_version) > 40 then raise exception 'invalid version'; end if;
  if p_title is null or btrim(p_title) = '' or char_length(p_title) > 100 then raise exception 'invalid title'; end if;
  if p_content_snapshot is null or btrim(p_content_snapshot) = '' or char_length(p_content_snapshot) > 300000 then
    raise exception 'invalid content snapshot';
  end if;
  begin
    v_json := p_content_snapshot::jsonb;
  exception when others then
    raise exception 'invalid content snapshot';
  end;
  if jsonb_typeof(v_json) <> 'object'
     or (v_json ->> 'document_type') is distinct from p_document_type
     or (v_json ->> 'version') is distinct from btrim(p_version) then
    raise exception 'content snapshot does not match the document';
  end if;
  if p_effective_at is null then raise exception 'effective date is required'; end if;
  if exists (select 1 from public.legal_documents where document_type = p_document_type and version = btrim(p_version)) then
    raise exception 'version already published';
  end if;

  insert into public.legal_documents
    (document_type, version, title, content_snapshot, content_hash, effective_at, published_by_user_id)
  values (p_document_type, btrim(p_version), btrim(p_title), p_content_snapshot,
          encode(sha256(convert_to(p_content_snapshot, 'UTF8')), 'hex'), p_effective_at, auth.uid())
  returning * into v_row;

  return jsonb_build_object('document_id', v_row.id, 'document_type', v_row.document_type,
                            'version', v_row.version, 'content_hash', v_row.content_hash,
                            'effective_at', v_row.effective_at);
end;
$$;
revoke all on function public.admin_publish_legal_document(text, text, text, text, timestamptz) from public, anon;
grant execute on function public.admin_publish_legal_document(text, text, text, text, timestamptz) to authenticated;

-- 公開済みの全ての版（本文snapshotを含む）と同意件数。個人は返さない。
create or replace function public.get_admin_legal_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'document_id', d.id, 'document_type', d.document_type, 'version', d.version, 'title', d.title,
      'content_hash', d.content_hash, 'content_snapshot', d.content_snapshot,
      'effective_at', d.effective_at, 'published_at', d.published_at,
      'is_current', exists (select 1 from public.current_legal_documents() c where c.id = d.id),
      'accepted_count', (select count(*) from public.user_legal_acceptances a where a.document_id = d.id)
    ) order by d.document_type, d.effective_at desc, d.published_at desc)
    from public.legal_documents d
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_admin_legal_documents() from public, anon;
grant execute on function public.get_admin_legal_documents() to authenticated;

-- 特定ユーザーの同意記録（問い合わせ対応・証明用）。document_id から get_admin_legal_documents の本文snapshotを特定できる。メール等は返さない。
create or replace function public.get_admin_user_legal_acceptances(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'document_id', a.document_id, 'document_type', a.document_type, 'version', a.version,
      'content_hash', a.content_hash, 'role_context', a.role_context, 'context', a.context, 'accepted_at', a.accepted_at
    ) order by a.accepted_at desc)
    from public.user_legal_acceptances a where a.user_id = p_user_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_admin_user_legal_acceptances(uuid) from public, anon;
grant execute on function public.get_admin_user_legal_acceptances(uuid) to authenticated;

commit;
