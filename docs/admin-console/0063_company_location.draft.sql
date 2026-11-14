-- ============================================================================
-- 0063（レビュー用草案・未適用）: 会社所在地の保存項目
-- ============================================================================
-- 方針（確定）: 会社所在地の保存項目を設ける。店舗所在地（salon_stores / salon_store_profiles）・請求先住所
--   （organization_billing_profiles）とは別の列として持つ。店舗住所から推測して埋めない。既存分は未設定(NULL)のまま。
-- 変更内容:
--   ・salon_organizations に nullable の列を5つ追加（デフォルト無し=既存行は書き換わらない。バックフィルはしない）。
--   ・都道府県は47の完全一致のみ許可。未入力は NULL（画面は「未設定」）。
--   ・更新は運営者専用RPC admin_set_organization_location のみ。履歴は organization_location_events（追記専用）に残す。
--   ・salon_organizations の権限は変更しない（authenticated は select のみ。会社の所属者は自社の所在地を読めるが、書けない）。
-- 影響: 既存のRLS・権限・関数は変更しない。巻き戻しは列と関数・履歴表のdrop。
begin;

create or replace function public.is_known_prefecture(p text) returns boolean
language sql immutable set search_path = public, pg_temp
as $$ select p = any (array['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']) $$;

alter table public.salon_organizations
  add column hq_prefecture text check (hq_prefecture is null or public.is_known_prefecture(hq_prefecture)),
  add column hq_city text check (hq_city is null or char_length(hq_city) between 1 and 50),
  add column hq_street_address text check (hq_street_address is null or char_length(hq_street_address) between 1 and 100),
  add column hq_location_updated_at timestamptz,
  add column hq_location_updated_by uuid references auth.users(id) on delete set null;
comment on column public.salon_organizations.hq_prefecture is '会社所在地（本社等）の都道府県。店舗所在地・請求先住所とは別。NULL=未設定（店舗住所から推測して埋めない）。';

create table public.organization_location_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  before_value jsonb not null, after_value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.organization_location_events enable row level security;
revoke all on public.organization_location_events from public, anon, authenticated, service_role;   -- 既定権限（Supabase）に依存せず、全ロールから明示的に外す

create or replace function public.admin_get_organization_location(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object('prefecture', o.hq_prefecture, 'city', o.hq_city, 'street_address', o.hq_street_address,
           'is_set', (o.hq_prefecture is not null or o.hq_city is not null or o.hq_street_address is not null),
           'updated_at', o.hq_location_updated_at, 'updated_by', o.hq_location_updated_by)
    into v from public.salon_organizations o where o.id = p_organization_id;
  if v is null then raise exception 'organization not found'; end if;
  return v;
end $$;

create or replace function public.admin_set_organization_location(p_organization_id uuid, p_prefecture text, p_city text, p_street_address text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb; v_new jsonb;
  v_pref text := nullif(trim(coalesce(p_prefecture, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_street text := nullif(trim(coalesce(p_street_address, '')), '');
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if v_pref is not null and not public.is_known_prefecture(v_pref) then raise exception 'invalid prefecture'; end if;
  select jsonb_build_object('prefecture', hq_prefecture, 'city', hq_city, 'street_address', hq_street_address) into v_old
    from public.salon_organizations where id = p_organization_id for update;
  if v_old is null then raise exception 'organization not found'; end if;
  v_new := jsonb_build_object('prefecture', v_pref, 'city', v_city, 'street_address', v_street);
  if v_new = v_old then return jsonb_build_object('changed', false); end if;
  update public.salon_organizations set hq_prefecture = v_pref, hq_city = v_city, hq_street_address = v_street,
         hq_location_updated_at = now(), hq_location_updated_by = v_uid where id = p_organization_id;
  insert into public.organization_location_events (organization_id, actor_user_id, before_value, after_value) values (p_organization_id, v_uid, v_old, v_new);
  return jsonb_build_object('changed', true);
end $$;

revoke all on function public.admin_get_organization_location(uuid), public.admin_set_organization_location(uuid, text, text, text), public.is_known_prefecture(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_organization_location(uuid), public.admin_set_organization_location(uuid, text, text, text) to authenticated;
grant execute on function public.is_known_prefecture(text) to authenticated;
commit;
