-- ============================================================================
-- Beauty Reach — 0033_organization_scout_quota_foundation
--
-- 法人・複数店舗対応 Phase 4 Step 3。会社(organization)単位Scout quotaの
-- 基盤のみを新設する、完全な並走基盤。
--
-- ★今回のスコープ（厳守）:
--   ・public.organization_scout_quotasの新設（箱のみ）。
--   ・既存public.salon_scout_quotasは一切変更しない（DROP/ALTER/RENAME/
--     RLS変更/RPC変更いずれも行わない）。既存send_scout()は引き続き旧
--     salon_scout_quotasのみを参照し、挙動は一切変わらない。
--   ・send_scout_v2等の新RPCは今回作らない（書き込み経路は未実装のまま。
--     将来のRPCから利用される前提の箱のみ）。
--   ・既存migration(0001〜0032)は一切編集していない。
--   ・app/lib/components/typesは一切変更していない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. organization_scout_quotas テーブル。
--
-- ON DELETE方針: organization_id→salon_organizations(id)はON DELETE
-- CASCADEとする。既存salon_scout_quotas（salon_user_id→auth.users on
-- delete cascade）と同じ考え方で、quota行自体が「その会社が存在する前提
-- でのみ意味を持つ」設定値（salon_scout_quotasのような履歴テーブルでは
-- ない）であるため、会社が削除された時点でquota行も残す意味が無い
-- （0032のscouts/salary_offers.store_idのような「付加的な文脈情報」とは
-- 異なり、このテーブル自体の存在理由がorganizationそのもの）。
-- ----------------------------------------------------------------------------
create table public.organization_scout_quotas (
  organization_id uuid primary key references public.salon_organizations(id) on delete cascade,
  monthly_free_limit integer not null default 10 check (monthly_free_limit >= 0),
  additional_credits integer not null default 0 check (additional_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organization_scout_quotas is
  '法人・複数店舗対応 Phase 4。会社(organization)単位のScout送信枠。既存salon_scout_quotas（salon_user_id単位）とは完全に独立した並走基盤であり、今回はまだどのRPCからも書き込み・参照されない（既存send_scout()は引き続きsalon_scout_quotasのみを使う）。将来、会社単位の共有プールへ移行する際のRPC実装のための箱。';
comment on column public.organization_scout_quotas.monthly_free_limit is '会社単位の月間無料Scout枠。負数は不可（CHECK制約）。';
comment on column public.organization_scout_quotas.additional_credits is '会社単位の追加購入クレジット。負数は不可（CHECK制約）。';

-- updated_atは既存の共通trigger関数public.set_updated_at()（0001で定義済み）
-- をそのまま再利用する（このmigration専用の新しいtrigger関数は作らない）。
create trigger trg_organization_scout_quotas_updated
  before update on public.organization_scout_quotas
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. RLS。
--
-- SELECTのみ、既存organization_membersテーブルを直接参照して判定する
-- （新しい判定関数は作らない＝既存permission構造の再利用）。
-- is_organization_member()（0026、roleを問わず全メンバーにtrueを返す）は
-- ここでは使わない。quotaは課金に直結する情報のため、0026の
-- is_store_accessible()が「全店舗アクセス可能な3role」として扱っている
-- company_owner/company_admin/recruiting_adminに限定する（area_manager/
-- store_manager/recruiter/viewerは対象外。UIが未接続の現時点では、
-- 必要最小限の範囲に絞るのが安全側の判断）。
--
-- INSERT/UPDATE/DELETEはクライアントへ一切GRANTしない（将来のRPC経由
-- 書き込みのみを想定。現時点ではこのRPC自体も作らない）。
-- ----------------------------------------------------------------------------
alter table public.organization_scout_quotas enable row level security;

create policy organization_scout_quotas_select_member on public.organization_scout_quotas
  for select using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_scout_quotas.organization_id
        and om.user_id = auth.uid()
        and om.role in ('company_owner', 'company_admin', 'recruiting_admin')
    )
  );

revoke all on public.organization_scout_quotas from anon, authenticated;
grant select on public.organization_scout_quotas to authenticated;

-- ----------------------------------------------------------------------------
-- 3. GV既存quotaのbackfill。
--
-- canonical mappingはpublic.salon_onboarding_assignments（user_id PK×
-- organization_id×store_id）のみを使う。legacy_salon_user_idは使わない。
--
-- ★duplicate organization安全性（重要）: salon_onboarding_assignmentsは
-- user_id PKだが、organization_id自体にはunique制約が無い。今後、
-- 「複数のユーザーが同じorganization_idに対応するsalon_onboarding_
-- assignments行を持つ」状態が理論上あり得る場合、複数のsalon_scout_quotas
-- 行（salon_user_id単位）が同じorganization_idへJOINされ、どちらの値を
-- 新quotaに採用すべきか自明でなくなる。これを合算・最大値・最小値などで
-- 黙って解決せず、事前に検知して例外にする。
--
-- 現状確認（実装前調査）: organization_membersへのINSERTは0027（GVの
-- 1件限りのバックフィル）と0028のsave_salon_profile()内「初回オンボー
-- ディング時のみ・新しいorganizationをその場で作成するinsert」の2箇所
-- にしか存在しない。後者は必ずその場で新規作成したorganization_idを
-- 使うため、同一organization_idに2人目以降のuser_idがsalon_onboarding_
-- assignments経由で紐づくことは、現在のコードベースには存在しない
-- （招待・メンバー追加RPCがまだ実装されていないため）。つまり現時点では
-- 1 organization_id = 最大1 salon_onboarding_assignments行であり、
-- 本backfillが複数のsalon_scout_quotas行を同一organization_idへ
-- 衝突させることは構造的に起こらない。ただし将来この前提が崩れた場合に
-- 静かに情報を失わないよう、以下のDOブロックで実行時にも検証する。
-- ----------------------------------------------------------------------------
do $$
declare
  v_conflicting_orgs integer;
begin
  select count(*) into v_conflicting_orgs
  from (
    select soa.organization_id
    from public.salon_scout_quotas q
    join public.salon_onboarding_assignments soa on soa.user_id = q.salon_user_id
    group by soa.organization_id
    having count(*) > 1
  ) dupes;

  if v_conflicting_orgs > 0 then
    raise exception
      'organization_scout_quotas backfill aborted: % organization(s) have multiple source salon_scout_quotas rows via salon_onboarding_assignments. Manual review required before backfilling (do not aggregate/pick automatically).',
      v_conflicting_orgs;
  end if;
end $$;

insert into public.organization_scout_quotas (organization_id, monthly_free_limit, additional_credits)
select soa.organization_id, q.monthly_free_limit, q.additional_credits
from public.salon_scout_quotas q
join public.salon_onboarding_assignments soa on soa.user_id = q.salon_user_id;

commit;
