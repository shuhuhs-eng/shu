-- ============================================================================
-- Beauty Reach — 0006_user_roles
--
-- 「1つのログインアカウントで美容師側とサロン側の両方を利用できる」ことを
-- 正式仕様にするための、複数role対応の中間テーブル。
--
-- 設計判断（実装報告にも記載）:
--   既存の stylist_profiles / salon_profiles の存在チェックだけでも
--   「そのroleのオンボーディングを完了しているか」は判定できるが、以下の
--   理由から明示的な user_roles テーブルを新設する方式を採用した。
--     1. 将来 admin 等、プロフィールテーブルを持たないroleにも同じ仕組みで
--        拡張できる（存在チェック方式はプロフィールテーブルが無いroleに使えない）。
--     2. 既存の profiles.onboarding_step はrole横断の単一値であり、
--        「どのroleのオンボーディングが完了しているか」を区別できない。
--        user_rolesはrole単位で明示的に記録するため、この曖昧さが無い。
--     3. 「そのuser_idがどのroleを持つか」を1回のSELECTで取得でき、
--        HOME画面・middleware・legacy /mypage振り分け等、複数箇所で
--        同じ判定ロジックを共有しやすい。
--
--   profiles.role は削除せず legacy 項目として残す（新規signup直後、まだ
--   どのroleのオンボーディングも完了していない一時的な状態での判定・
--   既存コードとの互換性のため）。新しい画面遷移・利用可否判定は
--   user_roles を正とし、profiles.role には依存させない。
-- ============================================================================

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.user_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
comment on table public.user_roles is '1ユーザーが複数roleを持てるようにするための中間テーブル。行の存在＝「そのroleのオンボーディングを完了している」ことを表す。書き込みはsave_stylist_profile()/save_salon_profile() RPCがオンボーディング完了時に行う唯一の経路で、クライアントからの直接書き込みは許可しない。profiles.roleとは独立しており、profiles.roleはlegacy項目（signup時点の初期role）として残す。';

alter table public.user_roles enable row level security;
create policy user_roles_select_own on public.user_roles
  for select using (user_id = auth.uid());

grant select on public.user_roles to authenticated;
-- INSERT/UPDATE/DELETEは意図的に一切GRANTしない。書き込みはsave_stylist_profile()/
-- save_salon_profile() RPC経由のみ（0007で両RPCへuser_roles書き込みを追加する）。

-- ---------- 既存ユーザーのbackfill ------------------------------------------
-- 実際にオンボーディングを完了済み（＝プロフィール本体テーブルに行が存在する）
-- ユーザーのみを対象にする。profiles.roleだけを見ると「signupしたがまだ
-- オンボーディングを完了していない」ユーザーまで誤って「完了済み」扱いに
-- なってしまうため、あえてprofiles.roleではなく実体テーブルの存在で判定する。
insert into public.user_roles (user_id, role)
select user_id, 'stylist'::public.user_role from public.stylist_profiles
on conflict (user_id, role) do nothing;

insert into public.user_roles (user_id, role)
select user_id, 'salon'::public.user_role from public.salon_profiles
on conflict (user_id, role) do nothing;
